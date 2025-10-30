import { Injectable, Logger } from '@nestjs/common';
import { MeiliSearch, Index } from 'meilisearch';
import { SearchAdapter, SearchRequest, SearchResponse } from './search.adapter';

type PropertyDoc = {
  id: string;
  title: string;
  address?: string | null;
  description?: string | null;
  amenities?: string[];
  ratingAvg?: number;
  ratingCount?: number;
  minNightlyPrice?: number | null;
  _geo?: { lat: number; lng: number } | null;
};

@Injectable()
export class MeiliSearchAdapter implements SearchAdapter {
  private readonly logger = new Logger(MeiliSearchAdapter.name);
  private client: MeiliSearch;
  private indexName: string;

  constructor() {
    const host = process.env.MEILI_HOST || 'http://127.0.0.1:7700';
    const apiKey = process.env.MEILI_API_KEY || '';
    const timeout = Number(process.env.MEILI_TIMEOUT_MS || 8000);
    this.indexName = process.env.MEILI_INDEX_PROPERTIES || 'properties';
    this.client = new MeiliSearch({ host, apiKey, timeout });
  }

  name() {
    return 'MEILI' as const;
  }
  private idx(): Index<PropertyDoc> {
    return this.client.index<PropertyDoc>(this.indexName);
  }

  async ensureIndex() {
    const exists = await this.client.getIndex(this.indexName).catch(() => null);
    if (!exists)
      await this.client.createIndex(this.indexName, { primaryKey: 'id' });
    await this.idx().updateSettings({
      searchableAttributes: ['title', 'address', 'description'],
      filterableAttributes: [
        'amenities',
        'ratingAvg',
        'ratingCount',
        'minNightlyPrice',
        '_geo',
      ],
      sortableAttributes: [
        'ratingAvg',
        'ratingCount',
        'minNightlyPrice',
        '_geo',
      ],
      displayedAttributes: [
        'id',
        'title',
        'address',
        'amenities',
        'ratingAvg',
        'ratingCount',
        'minNightlyPrice',
        '_geo',
      ],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'exactness',
        'ratingAvg:desc',
        'ratingCount:desc',
      ],
      typoTolerance: { enabled: true },
    });
  }

  async upsertPropertyDocs(docs: PropertyDoc[]) {
    if (!docs?.length) return;
    await this.ensureIndex();
    await this.idx().addDocuments(docs);
  }

  async deleteProperty(id: string) {
    await this.ensureIndex();
    await this.idx()
      .deleteDocument(id)
      .catch(() => {});
  }

  // -------- Search / Suggest

  private haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ) {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  async search(req: SearchRequest): Promise<SearchResponse> {
    await this.ensureIndex();
    const {
      q = '',
      lat,
      lng,
      radiusKm = 25,
      minPrice,
      maxPrice,
      amenities = [],
      sort = 'best',
      limit = 20,
      offset = 0,
    } = req;

    const filters: string[] = [];
    for (const a of amenities)
      filters.push(`amenities = "${escapeMeiliFilterValue(a)}"`);
    if (typeof minPrice === 'number')
      filters.push(`minNightlyPrice >= ${Math.max(0, minPrice)}`);
    if (typeof maxPrice === 'number')
      filters.push(`minNightlyPrice <= ${Math.max(0, maxPrice)}`);
    if (lat != null && lng != null) {
      const safeRadius = Math.min(Math.max(radiusKm ?? 25, 1), 200);
      const meters = Math.round(safeRadius * 1000);
      filters.push(`_geoRadius(${lat}, ${lng}, ${meters})`);
    }

    const meiliSort: string[] = [];
    if (sort === 'price') meiliSort.push('minNightlyPrice:asc');
    else if (sort === 'rating')
      meiliSort.push('ratingAvg:desc', 'ratingCount:desc');
    else if (sort === 'distance' && lat != null && lng != null)
      meiliSort.push(`_geoPoint(${lat}, ${lng}):asc`);

    const res = await this.idx().search(q, {
      filter: filters.length ? filters.join(' AND ') : undefined,
      sort: meiliSort.length ? meiliSort : undefined,
      limit: Math.min(Math.max(limit, 1), 100),
      offset: Math.max(offset, 0),
      attributesToRetrieve: [
        'id',
        'title',
        'address',
        'amenities',
        'ratingAvg',
        'ratingCount',
        'minNightlyPrice',
        '_geo',
      ],
      // showRankingScore: true as any, // bật nếu muốn xem điểm xếp hạng (Meili ≥1.3)
    });

    const origin = lat != null && lng != null ? { lat, lng } : null;
    const data = (res.hits || []).map((h: any) => {
      const geo = h._geo as { lat?: number; lng?: number } | undefined;
      const dKm =
        origin && geo?.lat != null && geo?.lng != null
          ? this.haversineKm(origin, { lat: geo.lat, lng: geo.lng })
          : null;
      return {
        id: h.id,
        title: h.title,
        address: h.address ?? null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        ratingAvg: h.ratingAvg ?? null,
        ratingCount: h.ratingCount ?? null,
        amenities: h.amenities ?? null,
        minNightlyPrice: h.minNightlyPrice ?? null,
        distanceKm: dKm,
        _score: h._rankingScore ?? null,
      };
    });

    return {
      data,
      paging: {
        limit,
        offset,
        estimatedTotal: res.estimatedTotalHits as number | undefined,
      },
    };
  }

  async suggest(
    q: string,
    field: 'title' | 'address' = 'title',
  ): Promise<string[]> {
    await this.ensureIndex();
    const res = await this.idx().search(q, {
      attributesToRetrieve: [field],
      limit: 15,
    });
    const key = field;
    const uniq: string[] = [];
    for (const h of res.hits as any[]) {
      const val = (h[key] || '') as string;
      if (!val) continue;
      if (
        val.toLowerCase().startsWith(q.toLowerCase()) &&
        !uniq.some((x) => x.toLowerCase() === val.toLowerCase())
      ) {
        uniq.push(val);
      }
      if (uniq.length >= 10) break;
    }
    return uniq;
  }
}

function escapeMeiliFilterValue(s: string) {
  return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
