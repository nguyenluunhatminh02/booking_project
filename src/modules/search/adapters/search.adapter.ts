export type SearchHit = {
  id: string;
  title: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
  amenities?: string[] | null;
  minNightlyPrice?: number | null;
  distanceKm?: number | null;
  _score?: number | null;
};

export type SearchRequest = {
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  minPrice?: number;
  maxPrice?: number;
  amenities?: string[];
  sort?: 'best' | 'price' | 'rating' | 'distance';
  limit?: number;
  offset?: number;
};

export type SearchResponse = {
  data: SearchHit[];
  paging: { limit: number; offset: number; estimatedTotal?: number };
};

export interface SearchAdapter {
  name(): 'PG' | 'MEILI';
  search(req: SearchRequest): Promise<SearchResponse>;
  suggest(q: string, field?: 'title' | 'address'): Promise<string[]>;

  // Indexing
  ensureIndex(): Promise<void>;
  upsertPropertyDocs(docs: any[]): Promise<void>;
  deleteProperty(id: string): Promise<void>;
}
