import { PrismaClient } from '@prisma/client';
import { SUBJECTS, ACTIONS } from '../src/modules/rbac/perms';

const prisma = new PrismaClient();

async function main() {
  console.log('⏳ Seeding RBAC...');

  // 1. Tạo Permission matrix
  for (const s of SUBJECTS) {
    for (const a of ACTIONS) {
      const subject = s.toLowerCase();
      const action = a.toLowerCase();
      await prisma.permission.upsert({
        where: { action_subject: { subject, action } },
        update: {},
        create: { subject, action },
      });
    }
  }
  console.log('✅ Permissions seeded');

  // 2. Tạo Roles
  const admin = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', desc: 'System administrator', isSystem: true },
  });

  const editor = await prisma.role.upsert({
    where: { name: 'editor' },
    update: {},
    create: { name: 'editor', desc: 'Can manage properties & bookings' },
  });

  const viewer = await prisma.role.upsert({
    where: { name: 'viewer' },
    update: {},
    create: { name: 'viewer', desc: 'Read-only user' },
  });

  console.log('✅ Roles seeded');

  // 3. Gán permission cho role
  const allPerms = await prisma.permission.findMany();
  const rolePerms = async (roleId: string, filter: (p: any) => boolean) => {
    const toAdd = allPerms.filter(filter);
    for (const p of toAdd) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: p.id } },
        update: {},
        create: { roleId, permissionId: p.id },
      });
    }
  };

  // admin: tất cả
  await rolePerms(admin.id, () => true);

  // editor: manage Property & Booking
  await rolePerms(
    editor.id,
    (p) =>
      ['property', 'booking'].includes(p.subject) &&
      (p.action === 'manage' ||
        p.action === 'create' ||
        p.action === 'update' ||
        p.action === 'read'),
  );

  // viewer: chỉ read Property & Booking
  await rolePerms(
    viewer.id,
    (p) => ['property', 'booking'].includes(p.subject) && p.action === 'read',
  );

  console.log('✅ RolePermissions seeded');

  // 4. (Tuỳ chọn) Gán role cho user đầu tiên
  const firstUser = await prisma.user.findFirst();
  if (firstUser) {
    await prisma.userRole.upsert({
      where: { user_role_unique: { userId: firstUser.id, roleId: admin.id } },
      update: {},
      create: { userId: firstUser.id, roleId: admin.id },
    });
    console.log(`✅ Assigned "admin" role to user ${firstUser.email}`);
  }

  console.log('🎉 RBAC seed completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
