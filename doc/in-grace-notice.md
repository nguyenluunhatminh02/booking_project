Hai request refresh gần nhau (A & B đều cầm RT₀)

Với in-grace:

A thắng CAS → xoay sang RT₁, set prevRefreshHash=RT₀ trong ~20s.

B đến sau dùng RT₀ → được chấp nhận 1 lần (in-grace) rồi xoay tiếp sang RT₂. UX trơn tru, không ai bị đá.

Không có in-grace:

Kịch bản nghiêm khắc (rơi vào “reuse”)
B đến sau không match refreshHash hiện tại ⇒ bị coi là reuse độc hại → bạn:

revokeSession(sid, 'SECURITY_REUSE')

bumpAccessVersion(userId) (vô hiệu mọi access token đang cầm)

lockUser(userId, TTL)
Hậu quả: đang dùng bình thường vẫn bị đá ra, toàn bộ AT đang cầm cũng chết → trải nghiệm tệ, dễ bị “tự khoá” chỉ vì 2 tab.

Kịch bản nhẹ tay (chỉ CAS fail)
Nếu B kiểm tra “match current” rồi gọi rotate và thua CAS, bạn trả 401 Refresh already rotated. Không đến mức revoke/lock, nhưng:

Tab/app B nhận 401, thường sẽ bắt user đăng nhập lại hoặc tự retry → gây “chập chờn”.

Nhiều tab/app, background retry, mạng chập chờn… sẽ làm 401 xuất hiện lắt nhắt.

Bất lợi khi bỏ in-grace

Dễ lock-out/đá phiên sai (nếu coi là reuse): một race hợp lệ có thể kích hoạt quy trình phòng thủ quá đà.

UX kém: 401 ngẫu nhiên khi có nhiều tab/app; người dùng tưởng “hết hạn” hay “lỗi đăng nhập”.

FE khó đảm bảo: yêu cầu FE phải serialize mọi refresh nghiêm ngặt (hàng đợi, mutex trên client). Trong thực tế (đa tab, background fetch, auto-retry), rất khó 100%.

Dễ tự DoS: một bug FE phát lệnh refresh đôi có thể khiến user liên tục bị fail/đá.