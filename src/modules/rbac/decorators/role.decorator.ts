// src/modules/rbac/decorators/role.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ROLE_KEY = 'require_role';
export const REQUIRE_ANY_ROLE_KEY = 'require_any_role';

export function RequireRole(roleName: string) {
  return SetMetadata(REQUIRE_ROLE_KEY, roleName);
}

export function RequireAnyRole(...roleNames: string[]) {
  return SetMetadata(REQUIRE_ANY_ROLE_KEY, roleNames);
}
