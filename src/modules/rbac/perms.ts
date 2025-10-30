// src/modules/rbac/perms.ts
export const SUBJECTS = [
  'User',
  'Property',
  'Booking',
  'AuditLog',
  'Role',
  'Permission',
] as const;
export type Subject = (typeof SUBJECTS)[number];
export const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'manage',
] as const;
export type Action = (typeof ACTIONS)[number];

export type Permission = `${Subject}:${Action}`;
// Cho phép string tự do để hỗ trợ wildcard như "*:read", "manage:*"
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type PermLike = Permission | string;

// Constants tiện dùng (type-safe) ở controller
export const P = {
  User: {
    create: 'User:create',
    read: 'User:read',
    update: 'User:update',
    delete: 'User:delete',
    manage: 'User:manage',
  },
  Property: {
    create: 'Property:create',
    read: 'Property:read',
    update: 'Property:update',
    delete: 'Property:delete',
    manage: 'Property:manage',
  },
  Booking: {
    create: 'Booking:create',
    read: 'Booking:read',
    update: 'Booking:update',
    delete: 'Booking:delete',
    manage: 'Booking:manage',
  },
  AuditLog: {
    create: 'AuditLog:create',
    read: 'AuditLog:read',
    update: 'AuditLog:update',
    delete: 'AuditLog:delete',
    manage: 'AuditLog:manage',
  },
  Role: {
    create: 'Role:create',
    read: 'Role:read',
    update: 'Role:update',
    delete: 'Role:delete',
    manage: 'Role:manage',
  },
  Permission: {
    create: 'Permission:create',
    read: 'Permission:read',
    update: 'Permission:update',
    delete: 'Permission:delete',
    manage: 'Permission:manage',
  },
} as const;

// ================= Helpers normalize (DB dùng lowercase) =================
export const normSub = (s?: string) => (s ?? '').toLowerCase();
export const normAct = (s?: string) => (s ?? '').toLowerCase();
export const permKey = (subject: string, action: string) =>
  `${normSub(subject)}:${normAct(action)}`;

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export const asDbSubject = (s: Subject | string) => normSub(s);
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export const asDbAction = (a: Action | string) => normAct(a);

// ================= Resource helper cho decorator =================
export type IdIn = 'params' | 'query' | 'body' | 'headers';
export type IdSelector = { in: IdIn; key: string };
export type ResourceSpec = { type: Subject; idSelector?: IdSelector };

function mk(type: Subject) {
  return {
    params: (key = 'id'): ResourceSpec => ({
      type,
      idSelector: { in: 'params', key },
    }),
    query: (key: string): ResourceSpec => ({
      type,
      idSelector: { in: 'query', key },
    }),
    body: (key: string): ResourceSpec => ({
      type,
      idSelector: { in: 'body', key },
    }),
    headers: (key: string): ResourceSpec => ({
      type,
      idSelector: { in: 'headers', key },
    }),
    none: (): ResourceSpec => ({ type }),
  } as const;
}
export const R = {
  User: mk('User'),
  Property: mk('Property'),
  Booking: mk('Booking'),
  AuditLog: mk('AuditLog'),
  Role: mk('Role'),
  Permission: mk('Permission'),
} as const;
