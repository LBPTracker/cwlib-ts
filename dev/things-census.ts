/**
 * Every `PLNb` and `LVLb` in an installed game's FARCs through `readThings`:
 *
 *   node dev/things-census.ts [list-file]     LBP_GAME required
 *
 * Prints how many parse, how many the version bound (or the oldest header
 * layout) refuses, and the rest grouped by their error with digits folded, one
 * example each -- the numbers in steering/level-files.md, *What of the game's
 * own Things opens*. With a file, every failing resource is listed there by
 * group: revision, SHA-1 and FileDB path, ready for `dev/dump-fields.ts`.
 */

import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { openFarc } from '../src/farc.ts';
import { readThings } from '../src/level.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { magicOf } from '../src/resource.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const LIST = process.argv[2];

const { pathOf } = await gameFileDB();

const groups = new Map<string, string[]>();
const counts: Record<string, number> = {};
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const head = await access.read(entry.offset, 8);
      const magic = magicOf(head);
      if (magic !== 'LVLb' && magic !== 'PLNb') continue;
      const revision = new DataView(head.buffer).getUint32(4, false).toString(16);
      try {
        await readThings((await farc.get(entry.sha1))!, nodeInflate);
        counts[`${magic} parse`] = (counts[`${magic} parse`] ?? 0) + 1;
      } catch (error) {
        const message = (error as Error).message;
        if (/outside the LBP3 range|older than the header layout/.test(message)) {
          counts[`${magic} refused`] = (counts[`${magic} refused`] ?? 0) + 1;
          continue;
        }
        counts[`${magic} fail`] = (counts[`${magic} fail`] ?? 0) + 1;
        const key = `${magic} ${message.replace(/\d+/g, 'N').slice(0, 110)}`;
        const list = groups.get(key) ?? [];
        list.push(`0x${revision} ${entry.sha1} ${pathOf.get(entry.sha1) ?? '?'}`);
        groups.set(key, list);
      }
    }
  } finally {
    await access.close();
  }
}

console.log(counts);
const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
for (const [key, list] of sorted) console.log(`${list.length} ${key}\n    e.g. ${list[0]}`);
if (LIST) await writeFile(LIST, sorted.map(([key, list]) => `${list.length} ${key}\n  ${list.join('\n  ')}`).join('\n'));
