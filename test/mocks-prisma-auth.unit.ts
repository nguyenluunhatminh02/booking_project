// test/mocks-prisma-auth.unit.ts
export class MockPrismaAuthUnit {
  users: any[] = [];
  sessions: any[] = [];
  tokens: any[] = [];
  private _id = 1;

  private clone<T>(x: T): T {
    return x == null ? (x as any) : JSON.parse(JSON.stringify(x));
  }
  private nextId(p = 'id') {
    return `${p}_${this._id++}`;
  }

  // --- $transaction: hỗ trợ both callback & array ---
  $transaction = async <T>(arg: any): Promise<T> => {
    if (Array.isArray(arg)) return (await Promise.all(arg)) as unknown as T;
    if (typeof arg === 'function') return await arg(this);
    return arg as T;
  };

  // ----------------- user -----------------
  user = {
    create: async ({ data, select }: any) => {
      const row = {
        id: this.nextId('usr'),
        email: data.email,
        password: data.password ?? '',
        accessVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.push(row);
      return select ? pick(row, select) : this.clone(row);
    },
    findUnique: async ({ where, select }: any) => {
      let row: any;
      if (where?.id) row = this.users.find((u) => u.id === where.id);
      if (!row && where?.email)
        row = this.users.find((u) => u.email === where.email);
      if (!row) return null;
      return select ? pick(row, select) : this.clone(row);
    },
    update: async ({ where: { id }, data, select }: any) => {
      const row = this.users.find((u) => u.id === id);
      if (!row) throw new Error('user not found');
      if (data?.accessVersion?.increment)
        row.accessVersion += data.accessVersion.increment;
      row.updatedAt = new Date();
      return select ? pick(row, select) : this.clone(row);
    },
  };

  // -------------- userSession --------------
  userSession = {
    create: async ({ data }: any) => {
      const row = {
        id: data.id,
        userId: data.userId,
        deviceId: data.deviceId ?? null,
        refreshHash: data.refreshHash,
        tokenVersion: data.tokenVersion ?? 0,
        accessSv: data.accessSv ?? 1,
        expiresAt: new Date(data.expiresAt),
        revokedAt: null as Date | null,
        revokedReason: null as any,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        deviceFp: data.deviceFp ?? null,
        approved: data.approved ?? true,
        lastUsedAt: null as Date | null,
        rotatedAt: null as Date | null,
        reusedAt: null as Date | null,
        prevRefreshHash: null as string | null,
        prevExpiresAt: null as Date | null,
        createdAt: new Date(),
      };
      this.sessions.push(row);
      return this.clone(row);
    },

    findUnique: async ({ where, include, select }: any) => {
      const row = this.sessions.find((s) => s.id === where.id);
      if (!row) return null;
      const out: any = this.clone(row);
      if (include?.user) {
        const u = this.users.find((us) => us.id === row.userId);
        out.user = include.user.select
          ? pick(u, include.user.select)
          : this.clone(u);
      }
      return select ? pick(out, select) : out;
    },

    findMany: async ({ where, select }: any) => {
      let res = this.sessions.slice();
      if (where?.userId) res = res.filter((s) => s.userId === where.userId);
      if (where?.id) res = res.filter((s) => s.id === where.id);
      return select ? res.map((r) => pick(r, select)) : this.clone(res);
    },

    update: async ({ where: { id }, data }: any) => {
      const row = this.sessions.find((s) => s.id === id);
      if (!row) throw new Error('session not found');
      applySessionUpdate(row, data);
      return this.clone(row);
    },

    updateMany: async ({ where, data }: any) => {
      let res = this.sessions.slice();
      if (where?.id) res = res.filter((s) => s.id === where.id);
      if (where?.userId) res = res.filter((s) => s.userId === where.userId);
      if (where?.revokedAt === null)
        res = res.filter((s) => s.revokedAt === null);
      if (where?.expiresAt?.gt)
        res = res.filter((s) => s.expiresAt > new Date(where.expiresAt.gt));
      // optional exact-match guards
      if (where?.refreshHash)
        res = res.filter((s) => s.refreshHash === where.refreshHash);

      let count = 0;
      for (const row of res) {
        applySessionUpdate(row, data);
        count++;
      }
      return { count };
    },
  };

  // ---------------- userToken ----------------
  userToken = {
    create: async ({ data }: any) => {
      const row = {
        id: data.id,
        userId: data.userId ?? null,
        type: data.type,
        tokenHash: data.tokenHash,
        meta: data.meta ?? {},
        createdAt: new Date(),
        expiresAt: new Date(data.expiresAt),
        usedAt: null as Date | null,
        usedByIp: null as string | null,
      };
      this.tokens.push(row);
      return this.clone(row);
    },

    findUnique: async ({ where: { id } }: any) => {
      const row = this.tokens.find((t) => t.id === id);
      return row ? this.clone(row) : null;
    },

    update: async ({ where: { id }, data }: any) => {
      const row = this.tokens.find((t) => t.id === id);
      if (!row) throw new Error('token not found');
      if (data.usedAt !== undefined) row.usedAt = new Date(data.usedAt);
      if (data.usedByIp !== undefined) row.usedByIp = data.usedByIp;
      return this.clone(row);
    },
  };
}

// ---------- helpers ----------
function pick(obj: any, select: Record<string, boolean>) {
  if (!obj || !select) return obj;
  const keys = Object.keys(select);
  if (!keys.length) return obj;
  const out: any = {};
  for (const k of keys) if (select[k]) out[k] = obj[k];
  return out;
}

function applySessionUpdate(row: any, data: any) {
  if (!data) return;
  if (data.refreshHash !== undefined) row.refreshHash = data.refreshHash;
  if (data.prevRefreshHash !== undefined)
    row.prevRefreshHash = data.prevRefreshHash;
  if (data.prevExpiresAt !== undefined)
    row.prevExpiresAt = data.prevExpiresAt
      ? new Date(data.prevExpiresAt)
      : null;
  if (data.tokenVersion?.increment)
    row.tokenVersion += data.tokenVersion.increment;
  if (data.accessSv?.increment) row.accessSv += data.accessSv.increment;
  if (data.expiresAt !== undefined) row.expiresAt = new Date(data.expiresAt);
  if (data.rotatedAt !== undefined) row.rotatedAt = new Date(data.rotatedAt);
  if (data.lastUsedAt !== undefined) row.lastUsedAt = new Date(data.lastUsedAt);
  if (data.revokedAt !== undefined) row.revokedAt = new Date(data.revokedAt);
  if (data.revokedReason !== undefined) row.revokedReason = data.revokedReason;
  if (typeof data.approved === 'boolean') row.approved = data.approved;
  if (data.userAgent !== undefined) row.userAgent = data.userAgent;
  if (data.deviceFp !== undefined) row.deviceFp = data.deviceFp;
}
