/**
 * Every `MSHb` in an installed game's FARCs through `readMesh`, and the checks
 * behind each convention in `src/mesh.ts`:
 *
 *   node dev/mesh-census.ts            LBP_GAME required
 *
 * Prints, per revision, how many read to the payload's last byte and how many
 * threw (with the first few reasons), then the measurements: winding against
 * the vertices' own normals, joints against the bone count, each weighted
 * vertex against its bone's box, UV edge lengths, the bind poses, indices
 * against the vertex count. Nothing is written; the FARCs are read in place.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { readMesh, type Mesh } from '../src/resources/mesh.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { magicOf } from '../src/io/resource.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';


const { pathOf } = await gameFileDB();

const tally = new Map<string, number>();
const bump = (key: string, by = 1): void => void tally.set(key, (tally.get(key) ?? 0) + by);
const example = new Map<string, string>();
const note = (key: string, what: string): void => {
  bump(key);
  if (!example.has(key)) example.set(key, what);
};

const dot3 = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): number =>
  a[i] * b[j] + a[i + 1] * b[j + 1] + a[i + 2] * b[j + 2];

function measure(m: Mesh, name: string): void {
  const n = m.vertexCount;
  const P = m.positions;
  bump(`primitiveType ${m.primitiveType}`);
  bump(`uv channels ${m.uvs.length}`);
  bump('vertices', n);
  bump(`morphs ${m.morphNames.length === 0 ? 'none' : m.morphNames.length >= 29 ? '29' : '1-28'}`);
  for (let v = 0; v < n; v += 1) {
    for (let k = 0; k < 4; k += 1) {
      if (m.weights[v * 4 + k] === 0) continue;
      const j = m.joints[v * 4 + k];
      if (j >= m.bones.length) {
        note('joint >= bone count', `${name} v${v} joint ${j} of ${m.bones.length}`);
        continue;
      }
      if (m.bones.length < 2 || j === 0) continue;
      // The vertex, taken to bone space by the inverse bind pose read column-major.
      const bone = m.bones[j];
      const M = bone.invSkinPose;
      const q = [0, 1, 2].map((r) => M[r] * P[v * 3] + M[4 + r] * P[v * 3 + 1] + M[8 + r] * P[v * 3 + 2] + M[12 + r]);
      const inside = [0, 1, 2].every((c) => {
        const slack = 0.01 + 0.001 * Math.abs(bone.boundBoxMax[c] - bone.boundBoxMin[c]);
        return q[c] >= bone.boundBoxMin[c] - slack && q[c] <= bone.boundBoxMax[c] + slack;
      });
      bump(`weighted vertex in its bone's box: ${inside ? 'yes' : 'no'}`);
    }
  }
  let agree = 0;
  let disagree = 0;
  for (const p of m.primitives) {
    if (!p.material) bump('primitive without a material');
    else bump(`primitive material ${p.material.hash ? 'sha1' : 'guid'}`);
    const t = p.triangles;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
      if (a >= n || b >= n || c >= n) {
        note('index >= vertexCount', name);
        continue;
      }
      const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
      const w = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      let d = 0;
      for (const x of [a, b, c]) d += dot3(g, 0, m.normals, x * 3);
      if (d > 0) agree += 1;
      else if (d < 0) disagree += 1;
      for (const [ch, uv] of m.uvs.entries()) {
        const e = Math.abs(uv[a * 2] - uv[b * 2]) + Math.abs(uv[a * 2 + 1] - uv[b * 2 + 1]);
        if (Number.isFinite(e)) bump(`uv${ch} edge ${e < 0.1 ? '< 0.1' : '>= 0.1'}`);
      }
    }
  }
  bump('triangles counter-clockwise about their normals', agree);
  bump('triangles clockwise about their normals', disagree);
  for (const [i, bone] of m.bones.entries()) {
    if (bone.parent >= i || bone.parent < -1) note('bone parent not below it', `${name} ${bone.name}`);
    let err = 0;
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        let x = 0;
        for (let k = 0; k < 4; k += 1) x += bone.skinPose[k * 4 + r] * bone.invSkinPose[c * 4 + k];
        err = Math.max(err, Math.abs(x - (r === c ? 1 : 0)));
      }
    }
    bump(`skinPose * invSkinPose ${err < 1e-2 ? '== I' : '!= I'}`);
  }
}

const byRevision = new Map<string, { ok: number; failed: number }>();
const failures: string[] = [];
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      if (magicOf(head) !== 'MSHb') continue;
      seen.add(entry.sha1);
      const revision = new DataView(head.buffer).getUint32(4, false).toString(16);
      const row = byRevision.get(revision) ?? { ok: 0, failed: 0 };
      byRevision.set(revision, row);
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      let mesh: Mesh;
      try {
        mesh = await readMesh((await farc.get(entry.sha1))!, nodeInflate);
      } catch (error) {
        row.failed += 1;
        failures.push(`0x${revision} ${name}: ${(error as Error).message}`);
        continue;
      }
      row.ok += 1;
      measure(mesh, name);
    }
  } finally {
    await access.close();
  }
}

const total = [...byRevision.values()].reduce((sum, r) => sum + r.ok, 0);
console.log(`${seen.size} MSHb, ${total} read to their last byte`);
for (const [revision, { ok, failed }] of [...byRevision].sort(([a], [b]) => parseInt(a, 16) - parseInt(b, 16))) {
  console.log(`  0x${revision.padStart(3, '0')}  ${ok} ok${failed ? `, ${failed} FAILED` : ''}`);
}
for (const failure of failures.slice(0, 20)) console.log(`  ✗ ${failure}`);
for (const [key, count] of [...tally].sort()) {
  console.log(`${key}: ${count}${example.has(key) ? `   e.g. ${example.get(key)}` : ''}`);
}
const below = (head: number): number =>
  [...byRevision].filter(([r]) => parseInt(r, 16) < head).reduce((sum, [, r]) => sum + r.ok + r.failed, 0);
console.log(`headers below 0x271 (no branch pair): ${below(0x271)}; below 0x297 (no flags): ${below(0x297)}`);
