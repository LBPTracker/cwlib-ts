/**
 * Every `MATb` in an installed game's FARCs through `readPhysicsMaterial`:
 *
 *   node dev/physics-material-census.ts      LBP_GAME required
 *
 * Prints, per revision, how many read to their payload's last byte, and then
 * what the materials hold: the ranges of the physical constants, the sound
 * families, the collision bits and the flags -- the numbers in
 * steering/level-files.md, *Physics materials*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readPhysicsMaterial, type PhysicsMaterial } from '../src/resources/physics-material.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const { pathOf } = await gameFileDB();

const tally = new Map<string, number>();
const bump = (key: string): void => void tally.set(key, (tally.get(key) ?? 0) + 1);
const range = new Map<string, [number, number]>();
const widen = (key: string, v: number): void => {
  // `maxForce` is NaN below 0x13c and may be NaN in a file; one NaN would poison the range.
  if (Number.isNaN(v)) return bump(`${key} NaN`);
  const r = range.get(key) ?? [Infinity, -Infinity];
  range.set(key, [Math.min(r[0], v), Math.max(r[1], v)]);
};
const failures: string[] = [];
const examples: string[] = [];
const seen = new Set<string>();

const NUMBERS = [
  'traction', 'density', 'restitution', 'slidingFriction', 'rollingFriction', 'gravityMultiplier',
  'airResistanceMultiplier', 'breakMinVel', 'breakMinForce', 'explosionMinRadius', 'explosionMaxRadius',
  'explosionMaxVel', 'explosionMaxAngVel', 'explosionMaxForce', 'maxForce',
] as const;
const FLAGS = [
  'grabbable', 'limb', 'shiftGrip', 'dissolvable', 'explodable', 'cuttableByExplosion', 'breakable',
  'bullet', 'circuitBoard', 'disableCSG',
] as const;

function measure(m: PhysicsMaterial, name: string): void {
  for (const k of NUMBERS) widen(k, m[k]);
  for (const k of FLAGS) if (m[k]) bump(`${k} true`);
  bump(`soundEnum ${m.soundEnum}`);
  bump(`collideType 0x${m.collideType.toString(16)}`);
  bump(`collideIgnore 0x${m.collideIgnore.toString(16)}`);
  if (examples.length < 6) {
    examples.push(`${name}: traction ${m.traction} density ${m.density} restitution ${m.restitution}`
      + ` sliding ${m.slidingFriction} rolling ${m.rollingFriction} sound ${m.soundEnum}`);
  }
}

const byRevision = new Map<string, { ok: number; failed: number }>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      if (magicOf(head) !== 'MATb') continue;
      seen.add(entry.sha1);
      const revision = new DataView(head.buffer).getUint32(4, false).toString(16);
      const row = byRevision.get(revision) ?? { ok: 0, failed: 0 };
      byRevision.set(revision, row);
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      try {
        measure(await readPhysicsMaterial((await farc.get(entry.sha1))!, nodeInflate), name);
        row.ok += 1;
      } catch (error) {
        row.failed += 1;
        failures.push(`0x${revision} ${name}: ${(error as Error).message}`);
      }
    }
  } finally {
    await access.close();
  }
}

console.log(`${seen.size} MATb`);
for (const [revision, { ok, failed }] of [...byRevision].sort()) console.log(`  0x${revision}  ${ok} ok${failed ? `, ${failed} FAILED` : ''}`);
for (const f of failures.slice(0, 10)) console.log(`  ✗ ${f}`);
for (const [key, [lo, hi]] of range) console.log(`${key}: ${lo} .. ${hi}`);
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}`);
for (const e of examples) console.log(`  e.g. ${e}`);
