// test/mocks-prisma-property.ts
import { BadRequestException } from '@nestjs/common';

type Property = {
  id: string;
  hostId: string;
  title: string;
  address: string;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  amenities?: any;
  createdAt: Date;
};

type AvailabilityDay = {
  propertyId: string;
  date: Date;
  price: number;
  remaining: number;
  isBlocked: boolean;
};

let PROP_SEQ = 1;

function keyOf(propId: string, date: Date) {
  // so sánh theo UTC ngày
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  return `${propId}|${d.toISOString()}`;
}

export class MockPrismaForProperty {
  // “DB” in-memory
  properties = new Map<string, Property>();
  availability = new Map<string, AvailabilityDay>();

  // ---------- property ----------
  property = {
    create: async ({ data }: any) => {
      const id = `prop_${PROP_SEQ++}`;
      const row: Property = {
        id,
        hostId: data.hostId,
        title: data.title,
        address: data.address,
        description: data.description ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        amenities: data.amenities ?? {},
        createdAt: new Date(),
      };
      this.properties.set(id, row);
      return row;
    },

    findUnique: async ({ where: { id }, include }: any) => {
      const row = this.properties.get(id);
      if (!row) return null;
      // include.photos/reviews bỏ qua (mock không cần)
      return {
        ...row,
        photos: include?.photos ? [] : undefined,
        reviews: include?.reviews ? [] : undefined,
      };
    },

    update: async ({ where: { id }, data }: any) => {
      const row = this.properties.get(id);
      if (!row) throw new BadRequestException('Property not found');
      const next: Property = {
        ...row,
        title: data.title ?? row.title,
        address: data.address ?? row.address,
        description: data.description ?? row.description,
        lat: data.lat ?? row.lat,
        lng: data.lng ?? row.lng,
        amenities: data.amenities ?? row.amenities,
      };
      this.properties.set(id, next);
      return next;
    },

    findMany: async ({
      where: { hostId },
      skip = 0,
      take = 20,
      orderBy,
    }: any) => {
      const list = [...this.properties.values()].filter(
        (p) => p.hostId === hostId,
      );
      if (orderBy?.createdAt === 'desc')
        list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return list.slice(skip, skip + take);
    },

    count: async ({ where: { hostId } }: any) => {
      return [...this.properties.values()].filter((p) => p.hostId === hostId)
        .length;
    },
  };

  // ---------- availabilityDay ----------
  availabilityDay = {
    upsert: async ({ where: { propertyId_date }, create, update }: any) => {
      const k = keyOf(propertyId_date.propertyId, propertyId_date.date);
      const existed = this.availability.get(k);
      if (!existed) {
        if (create.price == null) {
          throw new BadRequestException('price required on create');
        }
        const row: AvailabilityDay = {
          propertyId: create.propertyId,
          date: new Date(create.date),
          price: create.price,
          remaining: create.remaining ?? 0,
          isBlocked: create.isBlocked ?? false,
        };
        this.availability.set(k, row);
        return row;
      } else {
        const row: AvailabilityDay = {
          ...existed,
          price: update.price ?? existed.price,
          remaining: update.remaining ?? existed.remaining,
          isBlocked: update.isBlocked ?? existed.isBlocked,
        };
        this.availability.set(k, row);
        return row;
      }
    },

    findMany: async ({ where: { propertyId, date }, orderBy }: any) => {
      const from = date?.gte ? new Date(date.gte) : undefined;
      const to = date?.lt ? new Date(date.lt) : undefined;
      let list = [...this.availability.values()].filter(
        (d) => d.propertyId === propertyId,
      );
      if (from) list = list.filter((d) => d.date.getTime() >= from.getTime());
      if (to) list = list.filter((d) => d.date.getTime() < to.getTime());
      if (orderBy?.date === 'asc')
        list.sort((a, b) => a.date.getTime() - b.date.getTime());
      return list;
    },
  };

  // ---------- transactions ----------
  async $transaction(ops: any[]) {
    // Prisma cho mảng promise → Promise.all
    return Promise.all(ops);
  }
}
