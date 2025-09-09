# Tổng quan

Hệ thống xác thực gồm hai lớp token:

* **Access Token (AT)**: JWT ngắn hạn (mặc định 15 phút), dùng để gọi API.

  * Claim chính: `sub` (user id), `jti` (JWT id), `av` (accessVersion toàn user), `sid` (session id), `sv` (sessionVersion — per session), `iat/exp`.
  * Có thể **thu hồi đơn lẻ** bằng denylist `jti`, **thu hồi toàn bộ** bằng tăng `av`, hoặc **thu hồi theo thiết bị** bằng tăng `sv`.

* **Refresh Token (RT)**: chuỗi dạng `sessionId.tokenPart`, lưu **hash** của `tokenPart` trong DB, TTL mặc định 30 ngày.

  * Luồng **rotate** an toàn với **CAS** + **grace window** (1 RT trước được dùng 1 lần trong \~20s).
  * Redis giữ sống/chết nhanh (`v1:auth:rt:<sid> = '1'`), còn **DB là source of truth**.

Ngoài ra có:

* **Session** (`user_sessions`) theo thiết bị, chứa `refreshHash`, `accessSv`, `approved`, fingerprint, v.v.
* **Device approval**: khi refresh từ UA/fingerprint lạ → chuyển `approved=false`, cấp token phê duyệt một lần qua email/link.
* **Chặn brute-force**: token bucket per email/IP, và đếm fail → **lock tạm** user.
* **Security events** (login success/failed, revoke, reuse) để theo dõi.

---

# Mô hình dữ liệu & key-value

## DB chính

* **User**

  * `id`, `email`, `password`
  * `accessVersion` (số nguyên ≥1). Tăng ⇒ vô hiệu **tất cả** AT của user.
  * `lockedUntil` (nếu dùng lock ở DB) — hiện lock lưu ở Redis.

* **UserSession**

  * `id` = `sid`
  * `refreshHash` (SHA-256 của tokenPart; **không** lưu plaintext)
  * `tokenVersion` (đếm lần rotate RT — phục vụ forensics)
  * `accessSv` (mặc định 1). Tăng ⇒ vô hiệu **AT của *riêng* session này**.
  * `prevRefreshHash` + `prevExpiresAt` (grace window cho RT cũ)
  * `revokedAt`, `revokedReason`
  * `expiresAt`, `lastUsedAt`, `rotatedAt`, `reusedAt`
  * `approved` + `deviceFp` + `userAgent` + `ip`

* **UserToken**

  * Dùng cho `DEVICE_APPROVAL` (id + opaque; lưu **hash**), `expiresAt`, `usedAt`.

* **SecurityEvent** / **AuditLog**: phục vụ theo dõi & điều tra.

## Redis keys

* `v1:auth:rt:<sid>` → `'1'` (TTL \~ refresh TTL). **Alive-bit** cho RT.

* `v1:auth:sv:<sid>` → `sv` (TTL \~ refresh TTL). Phiên bản AT theo session.

* `v1:auth:accver:<uid>` → `av` (cache).

* `v1:auth:deny:jti:<jti>` → `'1'` (TTL đến `exp+skew`). **Denylist AT theo jti**.

* `v1:auth:lock:user:<uid>` → `'1'` (TTL). **Khoá tạm user**.

* `v1:auth:rt:pending:<sid>:<oldHash>` → JSON `{refreshToken, refreshExpiresAt}` (TTL \~ grace). **Idempotency map** khi rotate.

* Login fail counters:

  * `v1:auth:login:fail:<uid>` → đếm fail trong 10 phút để lock với backoff.

---

# Cấu hình (env)

* `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_SECRET`
* `JWT_ACCESS_TTL` (mặc định 15m)
* `REFRESH_TTL` (mặc định 30d), `REFRESH_GRACE_SEC` (mặc định 20s)
* `BCRYPT_ROUNDS` (mặc định 12)
* `REUSE_LOCK_TTL_SEC` (mặc định 900s) — lock sau khi phát hiện RT reuse
* `DEVICE_APPROVAL_TTL_SEC` (mặc định 900s)
* `NODE_ENV` (`production` → cookie `secure: true`)
* (Tuỳ) `JWT_...` khác nếu thêm key rotation

---

# Luồng chính

## 1) Register

1. Validate + rate-limit (email/IP).
2. Hash password (bcrypt).
3. Tạo user.
4. **Tạo session** `sid` (DB) + set Redis:

   * `rt:<sid> = '1'` (TTL \~ refresh TTL)
   * `sv:<sid> = '1'` (TTL \~ refresh TTL)
5. Ký **AT** với `{ sub, jti, av, sid, sv }`.
6. Trả body: user + AT (+ exp info). **RT set vào cookie** HTTP-only (`rt`).

**Tính chất**: AT dùng ngay; RT lưu ở cookie (đường dẫn `/auth`, `SameSite=Lax`, `httpOnly`).

## 2) Login

Tương tự Register, khác ở bước xác thực & lock:

* Check lock theo `v1:auth:lock:user:<uid>`.
* So sánh password (bcrypt).
* Nếu fail: tăng counter → có thể lock (exponential backoff).
* Nếu ok: tạo session + ký AT như Register, ghi `LOGIN_SUCCESS`.

## 3) Refresh (an toàn, concurrent-safe, idempotent)

**Mục tiêu**: cấp AT mới, **rotate** RT; chống double-rotate & race; cho phép **grace** RT cũ 1 lần.

**Bước chi tiết**:

1. **Fast-path Redis**: `GET rt:<sid>`. Nếu miss ⇒ **reject** ngay (revoked/expired).
2. Load `userSession` + `user` từ DB:

   * `revokedAt`? ⇒ reject
   * `expiresAt` quá hạn? ⇒ xoá `rt:<sid>` + reject
   * `approved=false`? ⇒ reject với “Device approval required”
3. **Kiểm tra bất thường**: nếu `ua`/`deviceFp` lệch so với session:

   * `approved=false` (DB)
   * **`bumpSessionVersion(sid)`** để **giết AT** của **chính session này** ngay lập tức
   * `issue()` DEVICE\_APPROVAL (tạo token 1 lần)
   * reject “Device approval required”
4. **Match current hash?**

   * Nếu `verifyRefreshPart(tokenPart, refreshHash)` **đúng**:

     * Best-effort: update `lastUsedAt`
     * **CAS** rotate:

       * `updateMany(where: {id, userId, refreshHash, revokedAt: null}, data: {prev*, refreshHash=newHash, tokenVersion++, expiresAt, rotatedAt})`
       * Nếu **success**:

         * Redis: set `rt:<sid>` (gia hạn TTL), set/gia hạn `sv:<sid>` (giữ TTL)
         * Lưu idempotency map: `rt:pending:<sid>:<oldHash>` → RT mới (TTL \~ grace)
         * **Ký AT** mới (kèm `sid/sv` hiện tại) → **trả AT + RT**
       * Nếu **fail**:

         * Thử lấy **idempotency** từ `rt:pending:<sid>:<oldHash>` → nếu có, trả AT mới + RT từ pending
         * Nếu không: **reload session** và xử tiếp (khả năng request khác đã xoay)
5. **In-grace?** (client gửi RT cũ đúng trong **grace window**)

   * `prevRefreshHash` khớp và `prevExpiresAt > now`?
   * Clear `prev*` (single-use), thử idempotency map bằng `prevHash`; nếu không có ⇒ rotate từ current như bước 4.
6. **Reuse** (tokenPart không khớp current hay in-grace):

   * **revokeSession(sid)** (xóa `rt:<sid>`, `sv:<sid>`)
   * **bumpAccessVersion(userId)** (giết mọi AT của user)
   * **lock** user tạm thời (`REUSE_LOCK_TTL_SEC`)
   * Ghi sự kiện `REFRESH_REUSE` + reject.

## 4) Logout (1 thiết bị)

* Tách `sid` từ RT, gọi `revokeSession(sid, USER_LOGOUT)`:

  * DB: set `revokedAt`
  * Redis: `DEL rt:<sid>`, `DEL sv:<sid>`
* **AT hiện tại** của session đó: nếu muốn “chết ngay”, có 2 cách:

  * **Đã dùng `sv`**: chỉ cần **bump** `sv` (tức `bumpSessionVersion(sid)`) trước/đồng thời.
  * Hoặc **denylist** `jti` của **AT hiện tại** (endpoint `revoke-access`).

## 5) Logout-all

* Tìm mọi session của user (trừ `keepSessionId` nếu có), đánh dấu revoke + DEL `rt:*` + DEL `sv:*`.
* Sau đó **bumpAccessVersion(userId)** ⇒ **tất cả AT** (kể cả phiên đang giữ) đều invalid; **keepSession** có thể **refresh** để lấy AT mới.

> Nếu muốn “giữ AT hiện tại” đúng nghĩa: **đừng bump `av`**, mà `bumpSessionVersion(sid)` cho **các session bị revoke**.

## 6) Revoke a single access token

* Nhận **access token** (header/bearer).
* Verify, lấy `jti/exp`.
* Ghi denylist `v1:auth:deny:jti:<jti>` với TTL đến `exp + skew`.
* Từ lần request tiếp theo, **JwtStrategy** sẽ chặn.

## 7) Device approval

* Khi nghi ngờ (mismatch UA/FP) trong **refresh**:

  * Set `approved=false`, **bump sv** để kill AT của session này.
  * `issue(userId, sid, ctx)` → tạo `user_tokens` loại `DEVICE_APPROVAL` (hash `opaque`), TTL 15m.
* Khi user bấm link approve:

  * `approve(token)`:

    * Split `id.opaque`, verify hash, hạn, usedAt.
    * Mark `usedAt`, set `userSession.approved=true`.
    * (Tuỳ policy) lần refresh tiếp theo sẽ hoạt động.

---

# Verify & Guard

## JwtAccessStrategy.validate()

* **Dồn hết check vào đây**, guard chỉ xử `@Public`.
* Bước:

  1. `isJtiDenied(jti)` → chặn AT bị revoke đơn lẻ
  2. `isUserLocked(id)` → chặn user đang bị lock tạm
  3. `getAccessVersion(id)` và so với `av` trong token → kill-switch toàn user
  4. Nếu token có `sid/sv`: `getSessionVersion(sid)` và so với `sv` → revoke theo **session**
* **Fail-closed**: lỗi backend/Redis ⇒ 401 (`Auth backend unavailable`).

## JwtAuthGuard

* Chỉ kiểm `@Public()` rồi `super.canActivate()`.
* Tất cả logic đã nằm ở Strategy.

---

# Các invariant & thuộc tính bảo mật

* **Không bao giờ** lưu plaintext refresh token — chỉ lưu **hash** của `tokenPart`.
* **Rotate RT** dùng **CAS** với `where {id, userId, refreshHash, revokedAt: null}` ⇒ không thể “un-revoke”.
* **Grace window**: `prev*` cho phép RT cũ **1 lần** trong `REFRESH_GRACE_SEC` (tránh “kẹt” do mạng).
* **Idempotency map** ở Redis: đảm bảo 2 request refresh đồng thời trả cùng 1 RT mới.
* **Alive-bit** (`rt:<sid>`) chặn sớm; dù Redis lỗi/miss, DB vẫn là truth.
* **Per-user kill-switch** (`av`) + **Per-session kill-switch** (`sv`) + **Per-token denylist** (`jti`) ⇒ thu hồi linh hoạt theo **toàn cục / thiết bị / token**.
* **Lockout**: chặn brute-force bằng token bucket và lock Redis.
* **Fail-closed** ở Strategy: nếu không xác định được trạng thái bảo mật ⇒ **không** cho qua.

---

# Cookie & header

* RT trong cookie:

  * Tên: `rt`
  * `httpOnly: true`, `secure: (NODE_ENV === 'production')`, `sameSite: 'lax'`, `path: '/auth'`, `maxAge` \~ refresh TTL
* AT truyền qua `Authorization: Bearer <token>`.

---

# Các race/edge đã xử lý

* **Double rotate**: CAS + idempotency pending map.
* **Un-revoke bug**: remove `revokedAt: null` khỏi `data`, thêm vào `where`.
* **Refresh trong grace**: single-use `prev*` + idempotency theo `prevHash`.
* **Mismatch UA/FP**: set `approved=false`, **bump sv**, issue approve token.
* **Redis miss**: Strategy fail-closed; refresh path vẫn check DB ngay sau alive-bit.

---

# Migration & tương thích

* **Schema**: thêm `UserSession.accessSv Int @default(1)` → chạy migrate.
* **Token cũ** (không có `sid/sv`): Strategy đã để `sid/sv` **optional**; nếu không có `sid/sv` thì **bỏ qua** check `sv`. Người dùng sẽ dần thay bằng AT mới sau khi refresh/login.

---

# checklist

1. **Login** bình thường → nhận AT/RT; AT decode có `{sub, jti, av, sid, sv}`.
2. **Refresh** đơn lẻ → rotate RT; idempotency map tồn tại trong grace; TTL `rt:<sid>` và `sv:<sid>` gia hạn.
3. **Concurrent refresh** (2 req gần nhau) → 1 CAS win, 1 lấy pending → cùng RT mới.
4. **Reuse RT** (replay tokenPart cũ sau grace) → revoke session + bump `av` + lock user.
5. **Logout** → `revokedAt` set, `rt:<sid>`/`sv:<sid>` bị DEL; nếu có bump `sv`/deny `jti` thì AT chết ngay.
6. **Logout-all** với `keepSessionId` → các session khác bị revoke + DEL; `av` tăng; keep có thể refresh để lấy AT mới.
7. **Device mismatch** → `approved=false`, bump `sv`, issue approval; refresh sau khi approve lại OK.
8. **Denylist jti** → gọi `revoke-access` rồi request tiếp theo 401.
9. **Redis down** → Strategy fail-closed 401; refresh vẫn dựa DB (sau alive-bit).
10. **Lockout** → nhiều lần login sai gây lock; hết TTL mở lại.

---

# util 

* **`hashPassword/verifyPassword`**: bcrypt với `BCRYPT_ROUNDS`.
* **`hashRefreshPart`**: SHA-256 + base64url; so sánh bằng `timingSafeEqual`.
* **`splitRefreshToken/buildRefreshToken`**: tách/ghép `sid.tokenPart`, ngăn chặn SEP trong từng phần.
* **`parseDurationToSec`**: parse “1h30m”, “45s”, …; clamp TTL.

---

