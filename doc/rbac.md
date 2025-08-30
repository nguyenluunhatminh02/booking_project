
# 0) Chuẩn bị

* Đã có các file: `perms.ts`, `rbac.service.ts`, `rbac-admin.service.ts`, `cache.service.ts`, `permissions.guard.ts`, `rbac.module.ts`.
* Prisma schema đã có các models: `Role`, `Permission`, `RolePermission`, `UserRole`, `ResourceACL`.


> Nếu bạn dùng JWT guard: nhớ đặt `JwtAuthGuard` trước `PermissionsGuard` (global hoặc @UseGuards theo thứ tự).

---

# 2) Seed dữ liệu quyền & vai trò

Tạo file seed (ví dụ `prisma/seed.rbac.ts`) rồi chạy.

```bash
# ví dụ
npx ts-node prisma/seed.rbac.ts
# hoặc
npm run prisma:seed
```

Seed sẽ:

* Tạo matrix `Permission` (Subject × Action) ở dạng **lowercase** trong DB.
* Tạo sẵn `admin`, `editor` và gán vài quyền mẫu.

---

# 3) Gán vai trò / cấp ACL cho user

Dùng service quản trị `RbacAdminService`.

## Cách A — gọi trực tiếp trong code (admin script, job)

```ts
await rbacAdmin.addRoleToUser(userId, roleId);          // gán role
await rbacAdmin.removeRoleFromUser(userId, roleId);     // bỏ role

await rbacAdmin.addPermissionToRole(roleId, 'Property', 'read'); // thêm quyền vào role
await rbacAdmin.removePermissionFromRole(roleId, 'Property', 'read');

await rbacAdmin.grantAcl({
  userId,
  resourceType: 'Property',
  resourceId: '123',
  action: 'update',
  effect: 'ALLOW', // hoặc 'DENY'
});
await rbacAdmin.revokeAcl(userId, 'Property', '123', 'update');
```

## Cách B — mở endpoint quản trị (gợi ý)

Bạn có thể tạo controller admin (chỉ admin mới gọi được):

```ts
@Post('admin/rbac/add-role')
async addRole(@Body() dto: { userId: string; roleId: string }) {
  return this.rbacAdmin.addRoleToUser(dto.userId, dto.roleId);
}
```

---

# 4) Sử dụng trong controller nghiệp vụ (type-safe & gọn)

Chỉ việc dán decorators.

```ts
import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { RequirePermissions, RequireAnyPermissions, Resource } from 'src/modules/rbac/decorators/permissions.decorator';
import { P, R } from 'src/modules/rbac/perms';
import { JwtAuthGuard } from 'src/modules/auth/jwt.guard';

@UseGuards(JwtAuthGuard) // PermissionsGuard đã global trong RbacModule, hoặc thêm đây
@Controller('properties')
export class PropertyController {
  // Yêu cầu đủ các quyền (mode all)
  @RequirePermissions(P.Property.read)
  @Resource(R.Property.params('id'))
  @Get(':id')
  getOne(@Param('id') id: string) { /* ... */ }

  // Yêu cầu 1 trong 2 quyền (mode any)
  @RequireAnyPermissions(P.Property.update, P.Property.manage)
  @Resource(R.Property.params('id'))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) { /* ... */ }
}
```

> Nếu cần wildcard:
> `@RequirePermissions('*:read' as string)` hoặc `@RequirePermissions('manage:*' as string)`.

---

# 5) Ownership rule (tùy chọn)

Bạn đã bật “chủ sở hữu có `property:manage`” trong `RbacService.applyOwnershipBoost`.
\=> Nếu bản ghi `property.ownerId === userId`, user tự động có `property:manage` (khỏi cấp ACL lẻ tẻ).

* Muốn tắt? Xóa/đổi logic trong `applyOwnershipBoost`.
* Muốn mở rộng cho `booking`? Thêm block tương tự.

---

# 6) Kiểm thử bằng `.http` (không dùng script, thân thiện mọi tool)

```http
@base = http://localhost:3000
@json = application/json
@adminToken = PASTE_ADMIN_ACCESS_TOKEN
@userToken = PASTE_USER_ACCESS_TOKEN

### (Admin) Gán role editor cho user
POST {{base}}/admin/rbac/add-role
Authorization: Bearer {{adminToken}}
Content-Type: {{json}}

{
  "userId": "USER_ID",
  "roleId": "ROLE_EDITOR_ID"
}

### (Admin) Cấp ACL cho 1 bản ghi
POST {{base}}/admin/rbac/grant-acl
Authorization: Bearer {{adminToken}}
Content-Type: {{json}}

{
  "userId": "USER_ID",
  "resourceType": "Property",
  "resourceId": "123",
  "action": "delete",
  "effect": "ALLOW"
}

### (User) Đọc property
GET {{base}}/properties/123
Authorization: Bearer {{userToken}}

### (User) Sửa property
PATCH {{base}}/properties/123
Authorization: Bearer {{userToken}}
Content-Type: {{json}}

{ "title": "New name" }
```

---

# 7) Cơ chế cache/invalidation (bạn không cần làm gì thêm)

* Cache quyền theo **stamp** = `userVersion | role1:ver,role2:ver,...`
* Khi:

  * Gán/bỏ vai trò cho user, hoặc cấp/thu ACL → `bumpUser(userId)` (đã gọi trong admin service).
  * Thêm/bớt quyền của role → `bumpRole(roleId)` (đã gọi trong admin service).
* Kết quả: cache tự miss và nạp lại. Không cần quét/xoá thủ công.

---

# 8) Best practices & lưu ý

* **DB normalize lowercase**: mọi quyền lưu ở DB là lowercase (`subject`, `action`).
  Controller dùng `P.Property.read` (TitleCase) vẫn OK vì service **normalize khi ghi/so**.
* **DENY ưu tiên** (chỉ ở ACL theo bản ghi). RBAC không có DENY global → tránh mâu thuẫn khó hiểu.
* **Hiệu lực vai trò theo thời gian**: `effectiveAt/ expiresAt` đã được áp tại query role → user hết hạn vai trò sẽ mất quyền.
* **Multi-tenant**: truyền `scopeKey = tenantId` khi gọi `checkPermissions()` nếu cần.
  (Hiện mặc định `'GLOBAL'`, có sẵn tham số để nâng cấp sau.)
* **Hiệu năng**:

  * Đừng gọi `expandUserPermissions` nhiều lần trong cùng request; nếu cần, bạn có thể memoize theo `req` (tuỳ), nhưng với cache Redis TTL ngắn đã rất ổn.
* **Giải quyết lỗi thường gặp**:

  * “Missing permissions: …” → kiểm tra: user có role? role có permission? ACL có DENY? ownership có đúng?
  * Thêm quyền cho role mà user không nhận ngay → kiểm tra `addPermissionToRole()` có gọi `bumpRole()` chưa (đã có), và request sau mới thấy hiệu lực (cache theo stamp sẽ miss).

---

# 9) Mẫu API quản trị (gợi ý)

Bạn có thể thêm controller admin để thao tác nhanh:

```ts
// admin-rbac.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RbacAdminService } from './rbac-admin.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RequirePermissions } from '../rbac/decorators/permissions.decorator';
import { P } from '../rbac/perms';

@UseGuards(JwtAuthGuard)
@Controller('admin/rbac')
export class AdminRbacController {
  constructor(private readonly rbac: RbacAdminService) {}

  @RequirePermissions(P.Role.manage)
  @Post('add-role')
  addRole(@Body() dto: { userId: string; roleId: string }) {
    return this.rbac.addRoleToUser(dto.userId, dto.roleId);
  }

  @RequirePermissions(P.Role.manage)
  @Post('remove-role')
  removeRole(@Body() dto: { userId: string; roleId: string }) {
    return this.rbac.removeRoleFromUser(dto.userId, dto.roleId);
  }

  @RequirePermissions(P.Permission.manage)
  @Post('role/add-permission')
  addPerm(@Body() dto: { roleId: string; subject: string; action: string }) {
    return this.rbac.addPermissionToRole(dto.roleId, dto.subject, dto.action);
  }

  @RequirePermissions(P.Permission.manage)
  @Post('role/remove-permission')
  removePerm(@Body() dto: { roleId: string; subject: string; action: string }) {
    return this.rbac.removePermissionFromRole(dto.roleId, dto.subject, dto.action);
  }

  @RequirePermissions(P.Permission.manage)
  @Post('grant-acl')
  grantAcl(@Body() dto: { userId: string; resourceType: string; resourceId: string; action: string; effect?: 'ALLOW'|'DENY' }) {
    return this.rbac.grantAcl(dto);
  }

  @RequirePermissions(P.Permission.manage)
  @Post('revoke-acl')
  revokeAcl(@Body() dto: { userId: string; resourceType: string; resourceId: string; action: string }) {
    const { userId, resourceType, resourceId, action } = dto;
    return this.rbac.revokeAcl(userId, resourceType, resourceId, action);
  }
}
```

---

# 10) Quy trình thường ngày (TL;DR)

1. **Seed** permissions & roles.
2. **Gán** role cho user → user có quyền theo vai trò.
3. **Dùng decorators** (`@RequirePermissions`, `@RequireAnyPermissions`, `@Resource`) trong controller.
4. Nếu có ngoại lệ theo bản ghi → **grant ACL** (ALLOW/DENY).
5. (Tuỳ) Bật ownership rule để owner luôn có `manage`.
6. Cache/invalidation tự lo.

---

Bạn muốn mình cung cấp thêm **migration seed script đầy đủ** (kèm tạo 2-3 role & user mẫu), hoặc **bộ `.http`** cho các endpoint admin vừa gợi ý không?


@Get('dashboard')
  @RequireRole('admin') // chỉ admin
  getAdminDashboard() {
    return { msg: 'Welcome admin!' };
  }

  @Get('editor-or-admin')
  @RequireAnyRole('admin', 'editor') // admin hoặc editor
  editorOrAdmin() {
    return { msg: 'You are admin or editor' };
  }