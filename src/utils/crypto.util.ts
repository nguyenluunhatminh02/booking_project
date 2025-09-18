import * as crypto from 'crypto';

export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as any).sort());
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
