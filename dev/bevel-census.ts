/**
 * Every `BEVb` in an installed game's FARCs through `readBevel`:
 *
 *   node dev/bevel-census.ts               LBP_GAME, default D:/PS4Games/CUSA00063
 *
 * Prints, per revision, how many read to their payload's last byte, and then
 * what the profiles hold: vertex counts, the range of y and z, mapping modes,
 * which material slots are named, the fixed sizes and texture repeats -- the
 * numbers in steering/level-files.md, *Bevels*.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { readBevel, type Bevel } from '../src/bevel.ts';
import { openFarc } from '../src/farc.ts';
import { readFileDB } from '../src/filedb.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

const GAME = process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
const pathOf = new Map<string, string>();
for (const row of db.values()) pathOf.set(row.sha1, row.path);

const tally = new Map<string, number>();
const bump = (key: string): void => void tally.set(key, (tally.get(key) ?? 0) + 1);
const failures: string[] = [];
const examples: string[] = [];
const seen = new Set<string>();
let ys: [number, number] = [Infinity, -Infinity];
let zs: [number, number] = [Infinity, -Infinity];

function measure(b: Bevel, name: string): void {
  bump(`vertices ${b.vertices.length > 6 ? '7+' : b.vertices.length}`);
  for (const v of b.vertices) {
    ys = [Math.min(ys[0], v.y), Math.max(ys[1], v.y)];
    zs = [Math.min(zs[0], v.z), Math.max(zs[1], v.z)];
    bump(`mapping mode ${v.mappingMode}`);
    bump(`gmat slot ${v.gmatSlot}`);
  }
  bump(`material slots named ${b.materials.map((m) => (m ? 'x' : '-')).join('')}`);
  bump(`fixedBevelSize ${b.fixedBevelSize === 0 ? '0' : 'non-zero'}`);
  bump(`includeBackface ${b.includeBackface}`);
  bump(`spongy ${b.spongy}`);
  const zSorted = b.vertices.every((v, i, all) => i === 0 || v.z >= all[i - 1].z);
  const zSortedDown = b.vertices.every((v, i, all) => i === 0 || v.z <= all[i - 1].z);
  bump(`profile z ${zSorted ? 'ascending' : zSortedDown ? 'descending' : 'neither'}`);
  if (examples.length < 6) {
    examples.push(`${name}: ${b.vertices.map((v) => `(${v.y.toFixed(2)},${v.z.toFixed(2)} s${v.gmatSlot} m${v.mappingMode})`).join(' ')}`
      + ` fixed ${b.fixedBevelSize} repeats ${b.textureRepeats} relax ${b.relaxStrength} subdiv ${b.subDivRadius}`);
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
      if (String.fromCharCode(...head.subarray(0, 4)) !== 'BEVb') continue;
      seen.add(entry.sha1);
      const revision = new DataView(head.buffer).getUint32(4, false).toString(16);
      const row = byRevision.get(revision) ?? { ok: 0, failed: 0 };
      byRevision.set(revision, row);
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      try {
        measure(await readBevel((await farc.get(entry.sha1))!, nodeInflate), name);
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

console.log(`${seen.size} BEVb`);
for (const [revision, { ok, failed }] of [...byRevision].sort()) console.log(`  0x${revision}  ${ok} ok${failed ? `, ${failed} FAILED` : ''}`);
for (const f of failures.slice(0, 10)) console.log(`  ✗ ${f}`);
console.log(`y from ${ys[0]} to ${ys[1]}, z from ${zs[0]} to ${zs[1]}`);
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}`);
for (const e of examples) console.log(`  e.g. ${e}`);
