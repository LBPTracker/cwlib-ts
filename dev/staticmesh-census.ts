/**
 * Every `SMHb` in an installed game's FARCs through `readStaticMesh`, and the
 * checks behind its conventions:
 *
 *   node dev/staticmesh-census.ts          LBP_GAME, default D:/PS4Games/CUSA00063
 *
 * - how many read, the chunk data ending on the dependency table and the index
 *   buffer filling the payload after the vertices;
 * - **what `vertexStart` is**: every run's largest index, with and without it
 *   added, against the vertex count;
 * - **the winding**: triangles counter-clockwise about their vertices' own
 *   normals, which checks the strip parity and the normal unpacking together.
 *
 * The numbers in steering/level-files.md, *Backdrops*.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { openFarc } from '../src/farc.ts';
import { readFileDB } from '../src/filedb.ts';
import { readStaticMesh, type StaticMesh } from '../src/staticmesh.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

const GAME = process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];
const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
const pathOf = new Map<string, string>();
for (const row of db.values()) pathOf.set(row.sha1, row.path);

const tally = new Map<string, number>();
const bump = (k: string, by = 1): void => void tally.set(k, (tally.get(k) ?? 0) + by);
const failures: string[] = [];
const seen = new Set<string>();

function measure(m: StaticMesh): void {
  bump('vertices', m.vertexCount);
  let ccw = 0;
  let cw = 0;
  for (const p of m.primitives) {
    bump(`primitive type ${p.type}`);
    bump(`primitive material ${p.material ? 'named' : 'none'}`);
    const t = p.triangles;
    let max = -1;
    for (const i of t) max = Math.max(max, i);
    bump(`run's indices ${max < m.vertexCount ? 'inside' : 'PAST'} the vertices with vertexStart added`);
    if (max - p.vertexStart >= 0 && p.vertexStart > 0) bump(`vertexStart non-zero`);
    const P = m.positions;
    const N = m.normals;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3];
      if (t[i] >= m.vertexCount || t[i + 1] >= m.vertexCount || t[i + 2] >= m.vertexCount) continue;
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      let d = 0;
      for (const x of [a, b, c]) d += g[0] * N[x] + g[1] * N[x + 1] + g[2] * N[x + 2];
      if (d > 0) ccw += 1;
      else if (d < 0) cw += 1;
    }
  }
  bump('triangles counter-clockwise about their normals', ccw);
  bump('triangles clockwise about their normals', cw);
  bump(`maps: light ${m.lightmap ? 'x' : '-'} rise ${m.risemap ? 'x' : '-'} fall ${m.fallmap ? 'x' : '-'}`);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k += 1) { lo[k] = Math.min(lo[k], m.positions[i + k]); hi[k] = Math.max(hi[k], m.positions[i + k]); }
  bump(`bounds x ${Math.round(lo[0])}..${Math.round(hi[0])}`);
}

const byRevision = new Map<string, { ok: number; failed: number }>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      if (String.fromCharCode(...head.subarray(0, 4)) !== 'SMHb') continue;
      seen.add(entry.sha1);
      const revision = new DataView(head.buffer).getUint32(4, false).toString(16);
      const row = byRevision.get(revision) ?? { ok: 0, failed: 0 };
      byRevision.set(revision, row);
      try {
        measure(await readStaticMesh((await farc.get(entry.sha1))!, nodeInflate));
        row.ok += 1;
      } catch (error) {
        row.failed += 1;
        failures.push(`0x${revision} ${pathOf.get(entry.sha1)}: ${(error as Error).message}`);
      }
    }
  } finally {
    await access.close();
  }
}
console.log(`${seen.size} SMHb`);
for (const [revision, { ok, failed }] of [...byRevision].sort()) console.log(`  0x${revision}  ${ok} ok${failed ? `, ${failed} FAILED` : ''}`);
for (const f of failures.slice(0, 10)) console.log(`  ✗ ${f}`);
for (const [k, n] of [...tally].sort()) console.log(`${k}: ${n}`);
