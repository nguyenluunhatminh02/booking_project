// src/modules/rbac/decorators/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Permission, Subject, IdSelector, ResourceSpec } from '../perms';

export const REQUIRE_PERMS_KEY = 'require_perms';
export const RESOURCE_META_KEY = 'resource_meta';

export type PermMode = 'all' | 'any';
export type PermRequirement = string[] | { perms: string[]; mode?: PermMode };

export function RequirePermissions(...perms: Permission[]) {
  return SetMetadata(REQUIRE_PERMS_KEY, {
    perms,
    mode: 'all',
  } as PermRequirement);
}
export function RequireAnyPermissions(...perms: Permission[]) {
  return SetMetadata(REQUIRE_PERMS_KEY, {
    perms,
    mode: 'any',
  } as PermRequirement);
}

export function Resource(
  type: Subject,
  idSelector?: IdSelector,
): MethodDecorator;
export function Resource(spec: ResourceSpec): MethodDecorator;
export function Resource(
  typeOrSpec: Subject | ResourceSpec,
  idSelector?: IdSelector,
): MethodDecorator {
  const spec =
    typeof typeOrSpec === 'string'
      ? { type: typeOrSpec, idSelector }
      : typeOrSpec;
  return SetMetadata(RESOURCE_META_KEY, spec);
}
