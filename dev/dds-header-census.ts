/**
 * Every `TEX ` of the game's FARCs: its stored DDS header against the one
 * `gameDdsHeader` writes for its format, size and level count, field by field:
 *
 *   node dev/dds-header-census.ts     LBP_GAME required, LBP_PATCH optional
 *
 * The rules and their counts are in `gameDdsHeader`'s comment (`src/resources/texture.ts`).
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { gameDdsHeader, readTexture } from '../src/resources/texture.ts';
import { FARCS, GAME } from './game.ts';

const FIELDS: readonly (readonly [string, number])[] = [
  ['flags', 8], ['height', 12], ['width', 16], ['pitch', 20], ['depth', 24], ['mipCount', 28],
  ['pfFlags', 80], ['fourCC', 84], ['bits', 88], ['caps', 108], ['caps2', 112],
];
const archives = FARCS.map((f) => path.join(GAME, f));
if (process.env.LBP_PATCH) archives.push(path.join(process.env.LBP_PATCH, 'patch_001.farc'));
const seen = new Set<string>();
const rows = new Map<string, { files: number; whole: number; off: Map<string, number> }>();
for (const file of archives) {
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      if (magicOf(await access.read(entry.offset, 4)) !== 'TEX ') continue;
      let value;
      try {
        value = await readTexture((await farc.get(entry.sha1))!, nodeInflate);
      } catch {
        continue;
      }
      const stored = (value as unknown as { stored?: Uint8Array }).stored;
      if (!stored || value.faces !== 1 || value.depth !== 1) continue;
      const key = `${value.format} ${value.mipCount > 1 ? 'levels' : 'one level'}`;
      const row = rows.get(key) ?? rows.set(key, { files: 0, whole: 0, off: new Map() }).get(key)!;
      row.files += 1;
      const ours = gameDdsHeader(value.format, value.width, value.height, value.mipCount);
      const a = new DataView(stored.buffer, stored.byteOffset, 128);
      const b = new DataView(ours.buffer);
      let whole = true;
      for (let i = 0; i < 128; i += 4) {
        if (a.getUint32(i, true) === b.getUint32(i, true)) continue;
        whole = false;
        const name = FIELDS.find(([, at]) => at === i)?.[0] ?? `@${i}`;
        row.off.set(name, (row.off.get(name) ?? 0) + 1);
      }
      if (whole) row.whole += 1;
    }
  } finally {
    await access.close();
  }
}
for (const [key, row] of [...rows].sort()) {
  console.log(`${key}: ${row.whole} of ${row.files} whole${row.off.size ? `; differ: ${[...row.off].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`);
}
