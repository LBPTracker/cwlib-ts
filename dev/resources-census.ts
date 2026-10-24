/**
 * Every resource of the smaller types in an installed game's FARCs through its
 * reader -- the proof a reader with no census of its own rests on:
 *
 *   node dev/resources-census.ts [MAGIC,MAGIC]    LBP_GAME required
 *
 * Prints, per magic and per head word, how many read to their payload's last
 * byte, with the first failures by path. The types with more to measure than
 * "does it read" have their own census (`bevel-census.ts`, `mesh-census.ts` …).
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf, type Inflate } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readCachedCostumeData } from '../src/resources/cached-costume-data.ts';
import { readJointSettings } from '../src/resources/joint-settings.ts';
import { readOutfitList } from '../src/resources/outfit-list.ts';
import { readPalette } from '../src/resources/palette.ts';
import { readPins } from '../src/resources/pins.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const READERS: Record<string, (bytes: Uint8Array, inflate: Inflate) => Promise<unknown>> = {
  CCDb: readCachedCostumeData,
  JNTb: readJointSettings,
  OUTb: readOutfitList,
  PALb: readPalette,
  PINb: readPins,
};
const only = process.argv[2]?.split(',');
const wanted = new Set(Object.keys(READERS).filter((m) => !only || only.includes(m)));

const { pathOf } = await gameFileDB();
const rows = new Map<string, Map<string, { ok: number; failed: number }>>();
const failures = new Map<string, string[]>();
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      const magic = magicOf(head);
      if (!wanted.has(magic)) continue;
      seen.add(entry.sha1);
      const word = `0x${new DataView(head.buffer).getUint32(4, false).toString(16)}`;
      const byWord = rows.get(magic) ?? rows.set(magic, new Map()).get(magic)!;
      const row = byWord.get(word) ?? byWord.set(word, { ok: 0, failed: 0 }).get(word)!;
      try {
        await READERS[magic]((await farc.get(entry.sha1))!, nodeInflate);
        row.ok += 1;
      } catch (error) {
        row.failed += 1;
        const list = failures.get(magic) ?? failures.set(magic, []).get(magic)!;
        list.push(`${word} ${pathOf.get(entry.sha1) ?? entry.sha1}: ${(error as Error).message}`);
      }
    }
  } finally {
    await access.close();
  }
}

for (const magic of [...wanted].sort()) {
  const byWord = rows.get(magic) ?? new Map();
  const total = [...byWord.values()].reduce((n, r) => n + r.ok + r.failed, 0);
  const ok = [...byWord.values()].reduce((n, r) => n + r.ok, 0);
  console.log(`${magic}: ${ok} of ${total} read, ${byWord.size} head words`);
  for (const [word, { ok: o, failed }] of [...byWord].sort()) console.log(`  ${word}  ${o} ok${failed ? `, ${failed} FAILED` : ''}`);
  for (const f of (failures.get(magic) ?? []).slice(0, 5)) console.log(`  ✗ ${f}`);
}
