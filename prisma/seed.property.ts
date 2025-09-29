// import { PrismaClient, BookingStatus, PromotionType } from '@prisma/client';
// import * as bcrypt from 'bcrypt';

// const prisma = new PrismaClient();

// function toUtcStartOfDay(input: Date): Date {
//   return new Date(
//     Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
//   );
// }

// async function upsertUser(
//   id: string,
//   email: string,
//   password: string,
//   roleName?: string,
// ) {
//   const hash = await bcrypt.hash(password, 10);

//   // users.email là CITEXT unique → dùng upsert theo email
//   const user = await prisma.user.upsert({
//     where: { email },
//     update: { password: hash },
//     create: {
//       id,
//       email,
//       password: hash,
//     },
//   });

//   if (roleName) {
//     // đảm bảo role tồn tại
//     const role = await prisma.role.upsert({
//       where: { name: roleName },
//       update: {},
//       create: {
//         name: roleName,
//         isSystem: true,
//         desc: `System role: ${roleName}`,
//       },
//     });

//     // gán role cho user (unique [userId, roleId])
//     await prisma.userRole.upsert({
//       where: {
//         user_role_unique: { userId: user.id, roleId: role.id },
//       },
//       update: {},
//       create: { userId: user.id, roleId: role.id },
//     });
//   }

//   return user;
// }

// async function upsertProperty(hostId: string) {
//   // Dùng id "prop_demo_1" để idempotent
//   const property = await prisma.property.upsert({
//     where: { id: 'prop_demo_1' },
//     update: {},
//     create: {
//       id: 'prop_demo_1',
//       hostId,
//       title: 'Cozy Studio • District 1',
//       address: '123 Lê Lợi, Q.1, TP.HCM',
//       description: 'Gần chợ Bến Thành, thuận tiện di chuyển.',
//       lat: 10.7758,
//       lng: 106.7004,
//       amenities: { wifi: true, ac: true, kitchen: false },
//     },
//   });

//   return property;
// }

// async function seedAvailability(propertyId: string, days = 60) {
//   const today = toUtcStartOfDay(new Date());
//   const rows: {
//     id: string;
//     propertyId: string;
//     date: Date;
//     price: number;
//     remaining: number;
//     isBlocked: boolean;
//   }[] = [];

//   for (let i = 0; i < days; i++) {
//     const d = new Date(today.getTime() + i * 86_400_000);
//     const iso = d.toISOString().slice(0, 10);

//     // Demo rule:
//     // - Giá cơ bản 1.200.000
//     // - 2 đêm đầu mỗi tuần (thứ 6–7) tăng nhẹ
//     // - Mỗi 15 ngày block bảo trì
//     const weekday = d.getUTCDay(); // 0 CN, 5 T6, 6 T7
//     const isWeekend = weekday === 5 || weekday === 6;
//     const isMaintenance = i % 15 === 0; // ngày 0, 15, 30, 45

//     const price = isWeekend ? 1_400_000 : 1_200_000;
//     const isBlocked = isMaintenance;
//     const remaining = isBlocked ? 0 : 3;

//     rows.push({
//       id: `avail_${propertyId}_${iso}`,
//       propertyId,
//       date: d,
//       price,
//       remaining,
//       isBlocked,
//     });
//   }

//   // createMany + skipDuplicates cho nhanh (đi kèm id cố định)
//   // Nếu đã có, nó bỏ qua; nếu muốn update lại giá/lịch, bạn có thể xóa trước hoặc viết upsert vòng lặp.
//   await prisma.availabilityDay.createMany({
//     data: rows,
//     skipDuplicates: true,
//   });
// }

// async function seedPromotion() {
//   await prisma.promotion.upsert({
//     where: { code: 'WELCOME10' },
//     update: { isActive: true, usedCount: 0 },
//     create: {
//       id: 'promo_welcome10',
//       code: 'WELCOME10',
//       type: PromotionType.PERCENT,
//       value: 10,
//       validFrom: new Date(),
//       validTo: new Date(Date.now() + 90 * 86_400_000),
//       minNights: 1,
//       minTotal: 500_000,
//       usageLimit: 10_000,
//       isActive: true,
//     },
//   });
// }

// async function seedCancelPolicy() {
//   await prisma.cancelPolicy.upsert({
//     where: { id: 'policy_flexible' },
//     update: { isActive: true },
//     create: {
//       id: 'policy_flexible',
//       name: 'Flexible',
//       isActive: true,
//       // Ví dụ rule: trước 7 ngày hoàn 100%, 3 ngày hoàn 50%, sau đó 0%
//       rules: [
//         { beforeDays: 7, refundPercent: 100 },
//         { beforeDays: 3, refundPercent: 50 },
//         { beforeDays: 0, refundPercent: 0 },
//       ],
//       checkInHour: 14,
//       cutoffHour: 12,
//     } as any, // JSON
//   });
// }

// async function seedDemoBooking(propertyId: string, customerId: string) {
//   // Tạo 1 booking mẫu đã HOLD -> PAID
//   const checkIn = toUtcStartOfDay(new Date(Date.now() + 10 * 86_400_000));
//   const checkOut = toUtcStartOfDay(new Date(Date.now() + 12 * 86_400_000));
//   const totalPrice = 2 * 1_200_000;

//   const booking = await prisma.booking.upsert({
//     where: { id: 'booking_demo_1' },
//     update: {},
//     create: {
//       id: 'booking_demo_1',
//       propertyId,
//       customerId,
//       checkIn,
//       checkOut,
//       status: BookingStatus.PAID,
//       totalPrice,
//       discountAmount: 0,
//       cancelPolicyId: 'policy_flexible',
//     },
//   });

//   await prisma.payment.upsert({
//     where: { bookingId: booking.id },
//     update: {},
//     create: {
//       id: 'payment_demo_1',
//       bookingId: booking.id,
//       amount: totalPrice,
//       provider: 'MOCK',
//       status: 'SUCCEEDED',
//       externalId: 'PAY_DEMO_001',
//     },
//   });
// }

// async function main() {
//   console.log('Seeding…');

//   // Roles cơ bản
//   const roles = ['ADMIN', 'HOST', 'CUSTOMER'];
//   for (const r of roles) {
//     await prisma.role.upsert({
//       where: { name: r },
//       update: {},
//       create: { name: r, isSystem: true, desc: `System role: ${r}` },
//     });
//   }

//   // Users (id cố định để idempotent)
//   const admin = await upsertUser(
//     'user_admin_demo',
//     'admin@demo.local',
//     'Password123!',
//     'ADMIN',
//   );
//   const host = await upsertUser(
//     'user_host_demo',
//     'host@demo.local',
//     'Password123!',
//     'HOST',
//   );
//   const cust = await upsertUser(
//     'user_customer_demo',
//     'customer@demo.local',
//     'Password123!',
//     'CUSTOMER',
//   );

//   // Property cho host
//   const property = await upsertProperty(host.id);

//   // Availability 60 ngày
//   await seedAvailability(property.id, 60);

//   // Promotion + Cancel Policy
//   await seedPromotion();
//   await seedCancelPolicy();

//   // Demo booking & payment
//   await seedDemoBooking(property.id, cust.id);

//   console.log('Seed done.');
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   // eslint-disable-next-line @typescript-eslint/no-misused-promises
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
