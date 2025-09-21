// test/__mocks__/asset-path.ts
import * as path from 'path';

export const ensureFontPaths = (): void => {};

export const assetPath = (...p: string[]): string =>
  path.resolve(process.cwd(), 'assets', ...p);
