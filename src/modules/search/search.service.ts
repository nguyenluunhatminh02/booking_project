import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchPropertiesDto } from './dto/search-properties.dto';
import { MeiliSearchAdapter } from './adapters/meili.adapter';
import { SearchAdapter } from './adapters/search.adapter';
import { Prisma } from '@prisma/client';

@Injectable()
export class SearchService {
  private backend: 'PG' | 'MEILI';

  constructor(
    private readonly prisma: PrismaService,
    private readonly meili: MeiliSearchAdapter,
  ) {
    this.backend =
      (process.env.SEARCH_BACKEND || 'PG').toUpperCase() === 'MEILI'
        ? 'MEILI'
        : 'PG';
  }

  private adapter(): SearchAdapter {
    if (this.backend === 'MEILI') return this.meili;
    throw new Error(
      'PG adapter chưa implement. Đặt SEARCH_BACKEND=MEILI để dùng Meilisearch.',
    );
  }

  async searchProperties(q: SearchPropertiesDto) {
    const {
      q: text,
      lat,
      lng,
      radiusKm,
      startDate,
      endDate,
      minPrice,
      maxPrice,
      amenities,
      sort,
      limit = 20,
    } = q;

    const base = await this.adapter().search({
      q: text,
      lat,
      lng,
      radiusKm,
      minPrice,
      maxPrice,
      amenities,
      sort,
      limit: Math.min(200, Math.max(limit, 20)),
      offset: 0,
    });

    // Nếu chưa truyền start/end → trả về theo relevance/price/rating/distance của Meili
    if (!startDate || !endDate) {
      return {
        data: base.data.slice(0, limit),
        facets: {},
        paging: {
          limit,
          offset: 0,
          estimatedTotal: base.paging.estimatedTotal,
        },
      };
    }

    // Chuẩn hoá khoảng ngày
    const start = new Date(startDate);
    const end = new Date(endDate);
    const nights = Math.max(0, Math.round((+end - +start) / 86400000));
    if (nights <= 0) {
      return {
        data: [],
        facets: {},
        paging: { limit, offset: 0, estimatedTotal: 0 },
      };
    }

    // Lọc theo ID kết quả Meili, tính tổng giá & check đủ đêm từ DB (sự thật)
    const ids = base.data.map((h) => h.id);
    if (!ids.length)
      return {
        data: [],
        facets: {},
        paging: { limit, offset: 0, estimatedTotal: 0 },
      };

    interface PricedResult {
      id: string;
      totalPrice: number | null;
      nightsOk: boolean;
    }

    const priced = await this.prisma.$queryRaw<PricedResult[]>`
      SELECT p.id,
             (SELECT SUM(ad."price")
                FROM "AvailabilityDay" ad
               WHERE ad."propertyId" = p."id"
                 AND ad."date" >= ${start}
                 AND ad."date" < ${end}
                 AND ad."isBlocked" = false
                 AND ad."remaining" > 0) as "totalPrice",
             (SELECT COUNT(*) = ${nights}
                FROM "AvailabilityDay" ad
               WHERE ad."propertyId" = p."id"
                 AND ad."date" >= ${start}
                 AND ad."date" < ${end}
                 AND ad."isBlocked" = false
                 AND ad."remaining" > 0) as "nightsOk"
        FROM "Property" p
       WHERE p."id" IN (${Prisma.join(ids)})
    `;

    const priceMap = new Map(priced.map((r) => [r.id, r]));
    const filtered = base.data
      .map((h) => {
        const r = priceMap.get(h.id);
        const total = r?.totalPrice ?? null;
        const ok = !!r?.nightsOk && total != null;
        return ok ? { ...h, totalPrice: total } : null;
      })
      .filter(Boolean) as Array<
      (typeof base.data)[number] & { totalPrice: number }
    >;

    // Sắp xếp
    let sorted = filtered;
    if (sort === 'price') {
      sorted = filtered.sort((a, b) => a.totalPrice - b.totalPrice);
    } else if (sort === 'rating') {
      sorted = filtered.sort((a, b) => {
        const d = (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
        return d !== 0 ? d : (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
      });
    } else if (sort === 'distance') {
      sorted = filtered.sort(
        (a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
      );
    } // else giữ order relevance của Meili

    const finalData = sorted.slice(0, limit);
    return {
      data: finalData,
      facets: {},
      paging: { limit, offset: 0, estimatedTotal: finalData.length },
    };
  }

  async suggest(q: string, field: 'title' | 'address' = 'title') {
    return this.adapter().suggest(q, field);
  }
}
