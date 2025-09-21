import {
  INestApplication,
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { PropertyService } from '../src/modules/property/property.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Mock Prisma in-memory cho Property/Availability
import { MockPrismaForProperty } from '../test/mocks-prisma-property';

// ===== Test controller (tối giản) dùng cho e2e =====
@Controller()
class TestPropertyController {
  constructor(private readonly svc: PropertyService) {}

  private host(req: any) {
    // Lấy hostId từ header để test ownership
    return req.headers['x-host'] ?? 'host_A';
  }

  @Post('/properties')
  async create(@Req() req: any, @Body() body: any) {
    return this.svc.createProperty(this.host(req), body);
  }

  @Get('/properties')
  async list(
    @Req() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.svc.listMyProperties(this.host(req), {
      skip: skip ? +skip : undefined,
      take: take ? +take : undefined,
    });
  }

  @Get('/properties/:id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.svc.getMyPropertyById(this.host(req), id);
  }

  @Patch('/properties/:id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateProperty(this.host(req), id, body);
  }

  @Post('/properties/:id/availability')
  async upsertAvail(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.svc.upsertAvailability(this.host(req), id, body);
  }

  @Get('/properties/:id/availability')
  async getAvail(
    @Req() req: any,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getAvailability(this.host(req), id, { from, to } as any);
  }
}

describe('Property E2E', () => {
  let app: INestApplication;
  let prisma: MockPrismaForProperty;
  let propIdA: string;

  beforeAll(async () => {
    prisma = new MockPrismaForProperty();

    // seed 1 property cho host_A
    const p = await prisma.property.create({
      data: {
        hostId: 'host_A',
        title: 'Seed A1',
        address: 'Addr A1',
        amenities: {},
      },
    });
    propIdA = p.id;

    const moduleRef = await Test.createTestingModule({
      controllers: [TestPropertyController],
      providers: [
        PropertyService,
        // override PrismaService = mock
        { provide: PrismaService, useValue: prisma as any },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /properties (create) rồi GET /properties (list)', async () => {
    // create
    const resCreate = await request(app.getHttpServer())
      .post('/properties')
      .set('x-host', 'host_A')
      .send({ title: 'P-New', address: 'A', amenities: { wifi: true } })
      .expect(201);

    expect(resCreate.body).toHaveProperty('id');
    const newId = resCreate.body.id;

    // list
    const resList = await request(app.getHttpServer())
      .get('/properties?skip=0&take=2')
      .set('x-host', 'host_A')
      .expect(200);

    expect(resList.body).toHaveProperty('items');
    expect(Array.isArray(resList.body.items)).toBe(true);
    expect(resList.body.total).toBeGreaterThanOrEqual(2);

    // get one
    const resOne = await request(app.getHttpServer())
      .get(`/properties/${newId}`)
      .set('x-host', 'host_A')
      .expect(200);

    expect(resOne.body.title).toBe('P-New');
  });

  it('PATCH /properties/:id (update) thay đổi title/lat/lng', async () => {
    await request(app.getHttpServer())
      .patch(`/properties/${propIdA}`)
      .set('x-host', 'host_A')
      .send({ title: 'Updated A1', lat: 10.5, lng: 20.1 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe('Updated A1');
        expect(body.lat).toBe(10.5);
        expect(body.lng).toBe(20.1);
      });
  });

  it('Ownership: GET/PATCH với host sai → Forbidden', async () => {
    await request(app.getHttpServer())
      .get(`/properties/${propIdA}`)
      .set('x-host', 'host_B')
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/properties/${propIdA}`)
      .set('x-host', 'host_B')
      .send({ title: 'Should Fail' })
      .expect(403);
  });

  it('POST /properties/:id/availability: tạo mới thiếu price → 400', async () => {
    await request(app.getHttpServer())
      .post(`/properties/${propIdA}/availability`)
      .set('x-host', 'host_A')
      .send({ items: [{ date: '2025-02-01' }] })
      .expect(400);
  });

  it('POST /properties/:id/availability: isBlocked=true ép remaining=0', async () => {
    await request(app.getHttpServer())
      .post(`/properties/${propIdA}/availability`)
      .set('x-host', 'host_A')
      .send({
        items: [
          { date: '2025-01-01', price: 100, remaining: 3 },
          { date: '2025-01-02', price: 200, isBlocked: true, remaining: 99 },
        ],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.updated).toBe(2);
      });

    const res = await request(app.getHttpServer())
      .get(`/properties/${propIdA}/availability?from=2025-01-01&to=2025-01-03`)
      .set('x-host', 'host_A')
      .expect(200);

    const byDate = (d: string) =>
      res.body.days.find((x: any) => x.date.slice(0, 10) === d);
    expect(byDate('2025-01-01').remaining).toBe(3);
    expect(byDate('2025-01-02').remaining).toBe(0);
    expect(byDate('2025-01-02').isBlocked).toBe(true);
  });

  it('GET /properties/:id/availability: to < from → 400', async () => {
    await request(app.getHttpServer())
      .get(`/properties/${propIdA}/availability?from=2025-07-10&to=2025-07-09`)
      .set('x-host', 'host_A')
      .expect(400);
  });

  it('GET /properties/:id/availability: window > 366 ngày → 400', async () => {
    await request(app.getHttpServer())
      .get(`/properties/${propIdA}/availability?from=2025-01-01&to=2027-01-01`)
      .set('x-host', 'host_A')
      .expect(400);
  });

  it('POST /properties/:id/availability: batch 200 items (chunk) → updated=200', async () => {
    const start = new Date(Date.UTC(2025, 4, 1));
    const items = Array.from({ length: 200 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d, price: 50 };
    });

    await request(app.getHttpServer())
      .post(`/properties/${propIdA}/availability`)
      .set('x-host', 'host_A')
      .send({ items })
      .expect(201)
      .expect(({ body }) => {
        expect(body.updated).toBe(200);
      });
  });

  it('Ownership: upsert/get availability với host sai → 403', async () => {
    await request(app.getHttpServer())
      .post(`/properties/${propIdA}/availability`)
      .set('x-host', 'host_B')
      .send({ items: [{ date: '2025-01-01', price: 1 }] })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/properties/${propIdA}/availability?from=2025-01-01&to=2025-01-03`)
      .set('x-host', 'host_B')
      .expect(403);
  });
});
