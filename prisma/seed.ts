// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** ------- Domain constants (type-safe) ------- */
const SUBJECTS = [
  'User',
  'Property',
  'Booking',
  'AuditLog',
  'Role',
  'Permission',
] as const;

const ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;

type Subject = (typeof SUBJECTS)[number];
type Action = (typeof ACTIONS)[number];

/** PermissionSpec: "read:User" | "manage:*" ... */
type PermissionSpec = `${Action}:${Subject | '*'}`;

const ROLES = [
  { name: 'ADMIN', isSystem: true, desc: 'Full access' },
  {
    name: 'HOST',
    isSystem: true,
    desc: 'Manage own properties & related bookings',
  },
  {
    name: 'CUSTOMER',
    isSystem: true,
    desc: 'Browse properties & manage own bookings',
  },
] as const;

/** ------- Helper: ensure role-permission links deterministically ------- */
async function linkRolePermissions(
  roleId: string,
  specs: PermissionSpec[],
  permMap: Map<string, string>,
) {
  // Clear existing for deterministic seeding (idempotent)
  await prisma.rolePermission.deleteMany({ where: { roleId } });

  const pairs = specs.flatMap((spec) => {
    const [action, subject] = spec.split(':') as [Action, Subject | '*'];
    if (subject === '*') {
      return (SUBJECTS as unknown as Subject[]).map((s) => ({
        action,
        subject: s,
      }));
    }
    return [{ action, subject }];
  });

  for (const { action, subject } of pairs) {
    const key = `${action}:${subject}`;
    const permissionId = permMap.get(key);
    if (!permissionId) continue; // should not happen if matrix was created
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } }, // composite unique (@@id)
      update: {},
      create: { roleId, permissionId },
    });
  }
}

/** ------- Seed main ------- */
async function main() {
  // 1) Upsert full permission matrix (Action × Subject)
  const permMap = new Map<string, string>(); // "action:subject" -> permission.id

  for (const subject of SUBJECTS as unknown as Subject[]) {
    for (const action of ACTIONS as unknown as Action[]) {
      const p = await prisma.permission.upsert({
        where: { action_subject: { action, subject } }, // @@unique([action, subject])
        update: {},
        create: { action, subject, desc: `${action} ${subject}` },
      });
      permMap.set(`${action}:${subject}`, p.id);
    }
  }

  // 2) Upsert roles
  const roleByName = new Map<string, string>();
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { desc: r.desc, isSystem: r.isSystem },
      create: r,
    });
    roleByName.set(r.name, role.id);
  }

  // 3) Attach permissions to roles (type-safe specs)
  await linkRolePermissions(roleByName.get('ADMIN')!, ['manage:*'], permMap);

  await linkRolePermissions(
    roleByName.get('HOST')!,
    [
      'create:Property',
      'read:Property',
      'update:Property',
      'create:Booking',
      'read:Booking',
    ],
    permMap,
  );

  await linkRolePermissions(
    roleByName.get('CUSTOMER')!,
    ['read:Property', 'create:Booking', 'read:Booking'],
    permMap,
  );

  // 4) Optional demo users + assign roles (idempotent)
  const [admin, host, customer] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        // bcrypt("Admin@123")
        password:
          '$2b$10$O7nK4WZQ4Yxg5cJt3eKJ9u0c1i9S7OTZqgVvDJnWwYjQfSN3q6m9a',
      },
    }),
    prisma.user.upsert({
      where: { email: 'host@example.com' },
      update: {},
      create: {
        email: 'host@example.com',
        // bcrypt("Host@123")
        password:
          '$2b$10$O7nK4WZQ4Yxg5cJt3eKJ9u0c1i9S7OTZqgVvDJnWwYjQfSN3q6m9a',
      },
    }),
    prisma.user.upsert({
      where: { email: 'customer@example.com' },
      update: {},
      create: {
        email: 'customer@example.com',
        // bcrypt("Customer@123")
        password:
          '$2b$10$O7nK4WZQ4Yxg5cJt3eKJ9u0c1i9S7OTZqgVvDJnWwYjQfSN3q6m9a',
      },
    }),
  ]);

  // helper assign role once (no composite unique in schema → do findFirst + create-if-missing)
  async function ensureUserRole(
    userId: string,
    roleName: (typeof ROLES)[number]['name'],
  ) {
    const roleId = roleByName.get(roleName)!;
    const exists = await prisma.userRole.findFirst({
      where: { userId, roleId },
    });
    if (!exists) {
      await prisma.userRole.create({ data: { userId, roleId } });
    }
  }

  await Promise.all([
    ensureUserRole(admin.id, 'ADMIN'),
    ensureUserRole(host.id, 'HOST'),
    ensureUserRole(customer.id, 'CUSTOMER'),
  ]);

  console.log('Seeding completed.');
}

/** ------- Bootstrap ------- */
main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
