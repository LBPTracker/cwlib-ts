/**
 * Every `ANMb` in an installed game's FARCs through `readAnimation`:
 *
 *   node dev/animation-census.ts            LBP_GAME required
 *
 * Prints, per head word, how many read to their payload's last byte, the first
 * failures by path, and then what the animations hold: frame counts and rates,
 * bone and morph counts, the `fat` byte, locators, and the checks on the packed
 * values -- a rotation's three stored components must not exceed unit length,
 * and every value must be finite -- the numbers in steering/level-files.md,
 * *Animations*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readAnimation, type Animation } from '../src/resources/animation.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const { pathOf } = await gameFileDB();

const tally = new Map<string, number>();
const bump = (key: string, by = 1): void => void tally.set(key, (tally.get(key) ?? 0) + by);
const range = new Map<string, [number, number]>();
const widen = (key: string, v: number): void => {
  const r = range.get(key) ?? [Infinity, -Infinity];
  range.set(key, [Math.min(r[0], v), Math.max(r[1], v)]);
};
const failures: string[] = [];
const seen = new Set<string>();

function measure(a: Animation): void {
  widen('numFrames', a.numFrames);
  widen('fps', a.fps);
  widen('bones', a.bones.length);
  widen('morphCount', a.morphCount);
  widen('locators', a.locators.length);
  bump(`fat ${a.fat}`);
  if (a.loopStart > 0) bump('loopStart > 0');
  let over = 0;
  for (let i = 0; i < a.rotations.length; i += 4) {
    const n = a.rotations[i] ** 2 + a.rotations[i + 1] ** 2 + a.rotations[i + 2] ** 2;
    if (n > 1 + 1e-4) over += 1;
  }
  bump('rotations', a.rotations.length / 4);
  bump('rotations whose x, y, z exceed unit length', over);
  for (const [name, values] of [['positions', a.positions], ['scales', a.scales], ['morphs', a.morphs]] as const) {
    bump(name, values.length);
    bump(`${name} not finite`, values.filter((v) => !Number.isFinite(v)).length);
  }
  for (const b of a.bones) if (b.parent >= a.bones.length) bump('bone parent past the bones');
}

const byRevision = new Map<string, { ok: number; failed: number }>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      if (magicOf(head) !== 'ANMb') continue;
      seen.add(entry.sha1);
      const word = `0x${new DataView(head.buffer).getUint32(4, false).toString(16)}`;
      const row = byRevision.get(word) ?? byRevision.set(word, { ok: 0, failed: 0 }).get(word)!;
      try {
        measure(await readAnimation((await farc.get(entry.sha1))!, nodeInflate));
        row.ok += 1;
      } catch (error) {
        row.failed += 1;
        failures.push(`${word} ${pathOf.get(entry.sha1) ?? entry.sha1}: ${(error as Error).message}`);
      }
    }
  } finally {
    await access.close();
  }
}

const ok = [...byRevision.values()].reduce((n, r) => n + r.ok, 0);
console.log(`${ok} of ${seen.size} ANMb read, ${byRevision.size} head words`);
for (const [word, { ok: o, failed }] of [...byRevision].sort()) console.log(`  ${word}  ${o} ok${failed ? `, ${failed} FAILED` : ''}`);
for (const f of failures.slice(0, 12)) console.log(`  ✗ ${f}`);
for (const [key, [lo, hi]] of range) console.log(`${key}: ${lo} .. ${hi}`);
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}`);
