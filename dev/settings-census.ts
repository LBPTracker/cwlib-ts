/**
 * The lighting of the game's own levels: every `LVLb` in the four FARCs that
 * parses, its `PLevelSettings`, and the ranges its values take.
 *
 *   node dev/settings-census.ts            LBP_GAME, default D:/PS4Games/CUSA00063
 *
 * The numbers in steering/level-files.md, *Level settings*.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { openFarc } from '../src/farc.ts';
import { readFileDB } from '../src/filedb.ts';
import { readThings } from '../src/level.ts';
import type { LevelLighting, LevelSettingsPart } from '../src/parts.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readStaticMesh } from '../src/staticmesh.ts';

const GAME = process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];
const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
const pathOf = new Map<string, string>();
for (const row of db.values()) pathOf.set(row.sha1, row.path);

const tally = new Map<string, number>();
const bump = (k: string): void => void tally.set(k, (tally.get(k) ?? 0) + 1);
const range = new Map<string, [number, number]>();
const widen = (k: string, v: number): void => {
  const r = range.get(k) ?? [Infinity, -Infinity];
  range.set(k, [Math.min(r[0], v), Math.max(r[1], v)]);
};
const examples: string[] = [];
const seen = new Set<string>();
/** A backdrop's x extent and the level's own, for the repeat flags: GUID to width. */
const widths = new Map<number, number | undefined>();
const farcsOpen: { get(sha1: string): Promise<Uint8Array | undefined> }[] = [];
async function backdropWidth(guid: number): Promise<number | undefined> {
  if (!widths.has(guid)) {
    const row = db.get(guid);
    let width: number | undefined;
    for (const f of farcsOpen) {
      const bytes = row && (await f.get(row.sha1));
      if (!bytes) continue;
      try {
        const m = await readStaticMesh(bytes, nodeInflate);
        let lo = Infinity; let hi = -Infinity;
        for (let i = 0; i < m.positions.length; i += 3) { lo = Math.min(lo, m.positions[i]); hi = Math.max(hi, m.positions[i]); }
        width = hi - lo;
      } catch { /* not readable */ }
      break;
    }
    widths.set(guid, width);
  }
  return widths.get(guid);
}
function measure(l: LevelLighting): void {
  for (const k of ['sunColor', 'ambientColor', 'fogColor', 'rimColor', 'rimColor2'] as const) {
    l[k].forEach((v, i) => widen(`${k}[${i}]`, v));
  }
  for (const k of ['sunPositionScale', 'sunMultiplier', 'exposure', 'fogNear', 'fogFar'] as const) widen(k, l[k]);
  l.sunPosition.forEach((v, i) => widen(`sunPosition[${i}]`, v));
}
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    farcsOpen.push(farc);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const head = await access.read(entry.offset, 4);
      if (String.fromCharCode(...head) !== 'LVLb') continue;
      let things;
      try { things = (await readThings((await farc.get(entry.sha1))!, nodeInflate)).things; } catch { continue; }
      bump('levels parsed');
      const settings = things.filter((t) => t?.parts.has('LEVEL_SETTINGS'));
      bump(`LEVEL_SETTINGS on ${settings.length > 1 ? '2+' : settings.length} Things`);
      for (const t of settings) {
        const s = t!.parts.get('LEVEL_SETTINGS') as LevelSettingsPart;
        measure(s);
        bump(`presets ${s.presets.length}`);
        bump(`backdropMesh ${s.backdropMesh ? 'named' : 'none'}`);
        bump(`backgroundRepeatFlags 0x${s.backgroundRepeatFlags.toString(16)}`);
        if (s.backdropMesh) {
          const w = await backdropWidth(s.backdropMesh.guid);
          bump(`repeat 0x${s.backgroundRepeatFlags.toString(16)} with a backdrop ${w === undefined ? 'not read' : w < 80000 ? 'under 80,000 wide' : '80,000 wide or more'}`);
        }
        widen('backgroundSkyHeight', s.backgroundSkyHeight);
        if (examples.length < 4) examples.push(`${pathOf.get(entry.sha1)}: sun ${s.sunPosition.map(Math.round)} x${s.sunPositionScale} col ${s.sunColor.map((x) => x.toFixed(2))} amb ${s.ambientColor.map((x) => x.toFixed(2))} fog ${s.fogColor.map((x) => x.toFixed(2))} ${Math.round(s.fogNear)}..${Math.round(s.fogFar)} exp ${s.exposure.toFixed(2)} mult ${s.sunMultiplier.toFixed(2)}`);
      }
    }
  } finally {
    await access.close();
  }
}
for (const [k, n] of [...tally].sort()) console.log(`${k}: ${n}`);
for (const [k, [a, b]] of [...range].sort()) console.log(`${k}: ${a.toFixed(3)} .. ${b.toFixed(3)}`);
for (const e of examples) console.log(`e.g. ${e}`);
