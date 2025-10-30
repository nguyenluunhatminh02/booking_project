// test/mocks.ts
export class MockRedis {
  store = new Map<string, string>();
  get = jest.fn(async (k: string) => this.store.get(k) ?? null);
  setEx = jest.fn(async (k: string, v: string, _ttlSec: number) => {
    this.store.set(k, v);
  });
  del = jest.fn(async (k: string) => {
    this.store.delete(k);
  });
}

export class MockPrisma {
  // giả lập bảng featureFlag
  data: Record<string, { enabled: boolean; payload: any; updatedAt: Date }> =
    {};
  featureFlag = {
    findUnique: jest.fn(async ({ where: { key }, select }: any) => {
      const row = this.data[key];
      if (!row) return null;
      // trả về đúng fields cần thiết
      const pick: any = {};
      if (select?.enabled) pick.enabled = row.enabled;
      if (select?.payload) pick.payload = row.payload;
      if (select?.key) pick.key = key;
      if (select?.updatedAt) pick.updatedAt = row.updatedAt;
      return pick;
    }),
    upsert: jest.fn(async ({ where: { key }, update, create, select }: any) => {
      const now = new Date();
      const exists = this.data[key];
      const next = exists
        ? { enabled: update.enabled, payload: update.payload, updatedAt: now }
        : { enabled: create.enabled, payload: create.payload, updatedAt: now };
      this.data[key] = next;
      const pick: any = {};
      if (select?.key) pick.key = key;
      if (select?.enabled) pick.enabled = next.enabled;
      if (select?.payload) pick.payload = next.payload;
      if (select?.updatedAt) pick.updatedAt = next.updatedAt;
      return pick;
    }),
  };
}
