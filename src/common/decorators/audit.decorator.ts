// src/common/decorators/audit.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const AUDIT_META_KEY = 'audit_meta';

export type IdIn = 'params' | 'query' | 'body' | 'headers';
export type IdSelector = { in: IdIn; key: string };

export type AuditSpec =
  | { action: string; entity: string; idSelector?: IdSelector }
  | {
      action: string;
      entity: string;
      resolveId?: (req: any, res: any, result: any) => string | undefined;
    };

export function Audit(spec: AuditSpec) {
  return SetMetadata(AUDIT_META_KEY, spec);
}

// Helpers DX
export const AuditId = {
  params: (key = 'id'): IdSelector => ({ in: 'params', key }),
  query: (key: string): IdSelector => ({ in: 'query', key }),
  body: (key: string): IdSelector => ({ in: 'body', key }),
  headers: (key: string): IdSelector => ({ in: 'headers', key }),
};
