// utils/asset-path.ts
import * as path from 'path';
import * as fs from 'fs';

export const assetPath = (...p: string[]) =>
  path.resolve(process.cwd(), 'assets', ...p);

export function ensureFontPaths(fontMap: Record<string, string[]>) {
  for (const [family, files] of Object.entries(fontMap)) {
    files.forEach((file) => {
      if (!fs.existsSync(file)) {
        throw new Error(`Font file missing for ${family}: ${file}`);
      }
    });
  }
}
