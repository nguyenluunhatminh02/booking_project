import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeiliSearchAdapter } from './adapters/meili.adapter';

@Injectable()
export class SearchIndexerService {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meili: MeiliSearchAdapter,
  ) {}

  private async buildPropertyDoc(propertyId: string) {
    const p = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        title: true,
        address: true,
        description: true,
        lat: true,
        lng: true,
        ratingAvg: true,
        ratingCount: true,
        amenities: true,
      },
    });
    if (!p) return null;

    const amenities = extractAmenityKeys(p.amenities);
    const minNightlyPrice = await this.computeMinNightlyPrice(propertyId);

    return {
      id: p.id,
      title: p.title,
      address: p.address,
      description: p.description ?? null,
      amenities,
      ratingAvg: p.ratingAvg ?? 0,
      ratingCount: p.ratingCount ?? 0,
      minNightlyPrice,
      _geo: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
    };
  }

  async computeMinNightlyPrice(propertyId: string, days = 180) {
    const start = new Date();
    const end = new Date(start.getTime() + days * 86400000);
    const rows = await this.prisma.availabilityDay.findMany({
      where: {
        propertyId,
        date: { gte: start, lt: end },
        isBlocked: false,
        remaining: { gt: 0 },
      },
      select: { price: true },
      orderBy: { price: 'asc' },
      take: 1,
    });
    return rows[0]?.price ?? null;
  }

  async reindexProperty(propertyId: string) {
    const doc = await this.buildPropertyDoc(propertyId);
    if (!doc) return;
    await this.meili.upsertPropertyDocs([doc]);
  }

  async removeProperty(propertyId: string) {
    await this.meili.deleteProperty(propertyId);
  }

  async reindexAll(batchSize = 500) {
    await this.meili.ensureIndex();
    let cursor: string | null = null;
    const q: any = { take: batchSize, orderBy: { id: 'asc' } };
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      if (cursor) ((q.skip = 1), (q.cursor = { id: cursor }));
      const rows = await this.prisma.property.findMany({
        ...q,
        select: { id: true },
      });
      if (!rows.length) break;
      const docs: any[] = [];
      for (const r of rows) {
        const d = await this.buildPropertyDoc(r.id).catch(() => null);
        if (d) docs.push(d);
      }
      if (docs.length) await this.meili.upsertPropertyDocs(docs);
      cursor = rows[rows.length - 1].id;
      if (rows.length < batchSize) break;
    }
    return { ok: true };
  }
}

function extractAmenityKeys(json: any): string[] {
  try {
    if (!json) return [];
    if (Array.isArray(json)) return json.map(String);
    if (typeof json === 'object') {
      return Object.entries(json)
        .filter(([, v]) => !!v)
        .map(([k]) => String(k));
    }
    return [];
  } catch {
    return [];
  }
}
