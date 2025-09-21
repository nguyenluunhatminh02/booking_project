import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PropertyService } from './property.service';
import { MockPrismaForProperty } from '../../../test/mocks-prisma-property';

describe('PropertyService', () => {
  let prisma: MockPrismaForProperty;
  let svc: PropertyService;
  const hostA = 'host_A';
  const hostB = 'host_B';
  let propIdA: string;

  beforeEach(async () => {
    prisma = new MockPrismaForProperty();
    // tạo 1 property cho hostA
    const created = await prisma.property.create({
      data: { hostId: hostA, title: 'P1', address: 'Addr', amenities: {} },
    });
    propIdA = created.id;

    // tạo thêm vài property để test list
    await prisma.property.create({
      data: { hostId: hostA, title: 'P2', address: 'Addr2', amenities: {} },
    });
    await prisma.property.create({
      data: { hostId: hostB, title: 'PB', address: 'AddrB', amenities: {} },
    });

    // @ts-ignore
    svc = new PropertyService(prisma as any);
  });

  // ---------- ownership ----------
  it('assertOwnership: ok với chủ sở hữu', async () => {
    await expect(svc.assertOwnership(hostA, propIdA)).resolves.toBeTruthy();
  });

  it('assertOwnership: ném NotFound khi id sai', async () => {
    await expect(
      svc.assertOwnership(hostA, 'not_exist'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertOwnership: ném Forbidden khi không phải chủ', async () => {
    await expect(svc.assertOwnership(hostB, propIdA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ---------- CRUD ----------
  it('createProperty & listMyProperties (phân trang)', async () => {
    await svc.createProperty(hostA, {
      title: 'Nx',
      address: 'A',
      amenities: {},
    });
    const page = await svc.listMyProperties(hostA, { skip: 0, take: 2 });
    expect(page.items.length).toBe(2);
    expect(page.total).toBe(3); // hostA có 3 property
  });

  it('updateProperty cập nhật các field gửi lên', async () => {
    const updated = await svc.updateProperty(hostA, propIdA, {
      title: 'New',
      lat: 10.5,
      lng: 20.1,
    });
    expect(updated.title).toBe('New');
    expect(updated.lat).toBe(10.5);
    expect(updated.lng).toBe(20.1);
  });

  // ---------- Availability: upsert ----------
  it('upsertAvailability: tạo mới cần price, isBlocked=true ép remaining=0', async () => {
    const d1 = '2025-01-01';
    const d2 = '2025-01-02';

    // tạo ok
    const res = await svc.upsertAvailability(hostA, propIdA, {
      items: [
        { date: d1, price: 100, remaining: 3 },
        { date: d2, price: 200, isBlocked: true, remaining: 10 }, // isBlocked=true → remaining=0
      ],
    });
    expect(res.updated).toBe(2);

    const list = await prisma.availabilityDay.findMany({
      where: {
        propertyId: propIdA,
        date: { gte: new Date('2025-01-01'), lt: new Date('2025-01-03') },
      },
      orderBy: { date: 'asc' },
    });

    expect(list[0]).toMatchObject({
      price: 100,
      remaining: 3,
      isBlocked: false,
    });
    expect(list[1]).toMatchObject({
      price: 200,
      remaining: 0,
      isBlocked: true,
    });
  });

  it('upsertAvailability: tạo mới thiếu price → BadRequest', async () => {
    await expect(
      svc.upsertAvailability(hostA, propIdA, {
        items: [{ date: '2025-02-01' }] as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertAvailability: cập nhật (update) chỉ field gửi lên', async () => {
    // seed trước
    await svc.upsertAvailability(hostA, propIdA, {
      items: [{ date: '2025-03-01', price: 100, remaining: 2 }],
    });
    // update: chỉ đổi price
    const res = await svc.upsertAvailability(hostA, propIdA, {
      items: [{ date: '2025-03-01', price: 120 }],
    });
    expect(res.updated).toBe(1);

    const [row] = await prisma.availabilityDay.findMany({
      where: {
        propertyId: propIdA,
        date: { gte: new Date('2025-03-01'), lt: new Date('2025-03-02') },
      },
      orderBy: { date: 'asc' },
    });
    expect(row.price).toBe(120);
    expect(row.remaining).toBe(2); // giữ nguyên
  });

  it('upsertAvailability: vượt MAX_CAL_ITEMS (366) → BadRequest', async () => {
    const items = Array.from({ length: 367 }, (_, i) => ({
      date: `2025-04-${String(i + 1).padStart(2, '0')}`,
      price: 1,
    }));
    await expect(
      svc.upsertAvailability(hostA, propIdA, { items }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertAvailability: chunk >150 vẫn OK (cộng dồn updated)', async () => {
    const start = new Date(Date.UTC(2025, 4, 1)); // 2025-05-01 (month 0-based)
    const items = Array.from({ length: 200 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i); // tự rollover tháng/năm
      return { date: d.toISOString().slice(0, 10), price: 50 };
    });
    const res = await svc.upsertAvailability(hostA, propIdA, { items });
    expect(res.updated).toBe(200);
  });

  // ---------- Availability: get ----------
  it('getAvailability: trả đúng cửa sổ và sắp xếp asc', async () => {
    // seed một vài ngày
    await svc.upsertAvailability(hostA, propIdA, {
      items: [
        { date: '2025-06-01', price: 100 },
        { date: '2025-06-03', price: 120 },
        { date: '2025-06-02', price: 110 },
      ],
    });

    const out = await svc.getAvailability(hostA, propIdA, {
      from: '2025-06-01',
      to: '2025-06-04',
    } as any);

    expect(out.days.map((d) => d.date.toISOString().slice(0, 10))).toEqual([
      '2025-06-01',
      '2025-06-02',
      '2025-06-03',
    ]);
  });

  it('getAvailability: to < from → BadRequest', async () => {
    await expect(
      svc.getAvailability(hostA, propIdA, {
        from: '2025-07-10',
        to: '2025-07-09',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getAvailability: window > 366 ngày → BadRequest', async () => {
    await expect(
      svc.getAvailability(hostA, propIdA, {
        from: '2025-01-01',
        to: '2026-12-31',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
