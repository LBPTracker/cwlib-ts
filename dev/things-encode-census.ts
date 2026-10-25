/**
 * Every level and plan of the game's FARCs encoded from its values, against
 * the payload the file holds:
 *
 *   node dev/things-encode-census.ts [limit]     LBP_GAME required, LBP_PATCH optional
 *
 * Each `LVLb` and `PLNb` of the four FARCs (and the 01.28 update's
 * `patch_001.farc`) is read with `readLevel` or `readPlan` -- no tape -- and
 * `encodeLevel` or `encodePlan` (`src/things/encode-things.ts`) writes its
 * payload from what came back, compared byte for byte with
 * `loadResource(bytes).data`. A file that will not read, or reads with an
 * `unreadTail`, is skipped and counted. Prints same, differ (the first with
 * its SHA-1, revision and first differing offset) and threw: the numbers in
 * steering/level-files.md, *Levels written from their values*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { loadResource, magicOf } from '../src/io/resource.ts';
import { encodeLevel, encodePlan } from '../src/things/encode-things.ts';
import { readLevel, readPlan, type LevelParse } from '../src/things/level.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { FARCS, GAME } from './game.ts';

const limit = Number(process.argv[2] ?? Infinity);

interface Row { same: number; differ: number; threw: number; skipped: number; examples: string[] }
const rows = new Map<string, Row>();
const row = (magic: string): Row => rows.get(magic) ?? rows.set(magic, { same: 0, differ: 0, threw: 0, skipped: 0, examples: [] }).get(magic)!;
const example = (r: Row, text: string): void => {
  if (r.examples.length < 5) r.examples.push(text);
};

const firstDiffer = (a: Uint8Array, b: Uint8Array): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

const archives = FARCS.map((f) => path.join(GAME, f));
if (process.env.LBP_PATCH) archives.push(path.join(process.env.LBP_PATCH, 'patch_001.farc'));
const seen = new Set<string>();
let files = 0;
outer: for (const file of archives) {
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (files >= limit) break outer;
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 4));
      if (magic !== 'LVLb' && magic !== 'PLNb') continue;
      files += 1;
      const r = row(magic);
      const bytes = (await farc.get(entry.sha1))!;
      let parse: LevelParse;
      try {
        parse = magic === 'LVLb' ? await readLevel(bytes, nodeInflate) : await readPlan(bytes, nodeInflate);
      } catch {
        r.skipped += 1;
        continue;
      }
      if (parse.unreadTail !== undefined) {
        r.skipped += 1;
        continue;
      }
      const resource = await loadResource(bytes, nodeInflate);
      const header = { revision: resource.revisionInfo, compressionFlags: resource.compressionFlags };
      const where = `${path.basename(file)} ${entry.sha1.slice(0, 8)} rev 0x${header.revision.version.toString(16)}/${header.revision.subVersion.toString(16)}`;
      let payload: Uint8Array;
      try {
        payload = magic === 'LVLb' ? encodeLevel(parse, header) : encodePlan(parse, header);
      } catch (error) {
        r.threw += 1;
        example(r, `${where} threw ${(error as Error).message.slice(0, 100)}`);
        continue;
      }
      const at = firstDiffer(resource.data, payload);
      if (at < 0) r.same += 1;
      else {
        r.differ += 1;
        example(r, `${where} at ${at} of ${resource.data.length} (written ${payload.length})`);
      }
    }
  } finally {
    await access.close();
  }
}

console.log(`${files} files`);
for (const [magic, r] of rows) {
  console.log(`${magic} ${r.same} same, ${r.differ} differ, ${r.threw} threw, ${r.skipped} skipped (would not read whole)`);
  for (const e of r.examples) console.log(`  e.g. ${e}`);
}
