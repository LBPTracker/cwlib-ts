/**
 * The importers on the game's own files, there and back: every `MSHb`,
 * `ANMb` and `SMHb` of the four FARCs exported to `.glb` by this library
 * (`meshToGlb`, `animationToGlb` plus a skin, `staticMeshToGlb` a primitive at
 * a time), imported (`importModel`, `importAnimation`, `importModel` +
 * `StaticMeshBuilder`), written at the original's revision and flags
 * (`writeMeshResource`, `writeAnimationResource`, `writeStaticMesh`), read
 * back, and compared with the original: how many survive within float and
 * packing tolerance, and what is lost and how often.
 *
 *   node dev/import-roundtrip.ts <mesh|anim|backdrop> [count]
 *
 * Needs `LBP_GAME`.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { loadResource, magicOf } from '../src/io/resource.ts';
import type { ResourceRef } from '../src/io/serializer.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readAnimation, type Animation } from '../src/resources/animation.ts';
import { animationToGlb } from '../src/resources/animation-gltf.ts';
import { refKey } from '../src/resources/gltf-material.ts';
import { readMesh, type Mesh } from '../src/resources/mesh.ts';
import { meshToGlb } from '../src/resources/mesh-gltf.ts';
import { readStaticMesh, writeStaticMesh, type StaticMesh } from '../src/resources/staticmesh.ts';
import { staticMeshToGlb } from '../src/resources/staticmesh-gltf.ts';
import { importAnimation } from '../src/imports/animation-importer.ts';
import { importModel } from '../src/imports/model-importer.ts';
import { StaticMeshBuilder } from '../src/imports/static-mesh-builder.ts';
import { writeAnimationResource, writeMeshResource } from '../src/imports/write.ts';
import { FARCS, GAME } from './game.ts';
import { primitivesAsGlbs, withSkin } from './import-glb.ts';

const kind = process.argv[2] ?? 'mesh';
const count = Number(process.argv[3] ?? 1e9);
const magic = kind === 'anim' ? 'ANMb' : kind === 'backdrop' ? 'SMHb' : 'MSHb';

const tally = new Map<string, number>();
const bump = (k: string, by = 1): void => void tally.set(k, (tally.get(k) ?? 0) + by);
const examples = new Map<string, string>();
const note = (k: string, e: string): void => {
  bump(k);
  if (!examples.has(k)) examples.set(k, e);
};
const worst = new Map<string, number>();
const err = (k: string, v: number): void => {
  if (!(v <= (worst.get(k) ?? -1))) worst.set(k, v);
};

const found: { sha1: string; file: string }[] = [];
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      if (magicOf(await access.read(entry.offset, 8)) === magic) found.push({ sha1: entry.sha1, file });
    }
  } finally {
    await access.close();
  }
}
const step = Math.max(1, found.length / count);
const picked = new Set(Array.from({ length: Math.min(count, found.length) }, (_, i) => found[Math.floor(i * step)].sha1));

const key3 = (a: ArrayLike<number>, i: number): string => `${a[i * 3]},${a[i * 3 + 1]},${a[i * 3 + 2]}`;
/** A triangle as its three indices rotated to start at the least, keeping its winding. */
const canonical = (a: number, b: number, c: number): string => {
  const m = Math.min(a, b, c);
  return m === a ? `${a},${b},${c}` : m === b ? `${b},${c},${a}` : `${c},${a},${b}`;
};
const maxDiff = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number, n: number): number => {
  let d = 0;
  for (let k = 0; k < n; k += 1) d = Math.max(d, Math.abs(a[i * n + k] - b[j * n + k]));
  return d;
};

async function meshTrip(bytes: Uint8Array, sha1: string): Promise<void> {
  const original = await readMesh(bytes, nodeInflate);
  const { compressionFlags } = await loadResource(bytes, nodeInflate);
  if (original.vertexCount === 0) return note('skipped: no vertices', sha1);
  const overrides: Record<string, ResourceRef> = {};
  for (const p of original.primitives) if (p.material) overrides[refKey(p.material)] = p.material;
  let back: Mesh;
  try {
    const { mesh } = importModel(meshToGlb(original), { materialOverrides: overrides, revision: original.revision });
    back = await readMesh(await writeMeshResource(mesh, { revision: original.revision, compressionFlags }, nodeDeflate), nodeInflate);
  } catch (error) {
    return note(`refused: ${(error as Error).message.slice(0, 70)}`, sha1);
  }
  const n = original.vertexCount;
  const pad = back.vertexCount - n;
  const lost: string[] = [];
  if (pad < 0 || pad > 7) return note('vertex count changed beyond padding', `${sha1} ${n} -> ${back.vertexCount}`);
  let positions = true;
  let uvs = back.uvs.length === original.uvs.length;
  let skin = true;
  let normals = 0;
  let tangents = 0;
  let weights = 0;
  for (let v = 0; v < n; v += 1) {
    const w = v + pad;
    if (key3(original.positions, v) !== key3(back.positions, w)) positions = false;
    if (uvs) for (let c = 0; c < original.uvs.length; c += 1) if (maxDiff(original.uvs[c], v, back.uvs[c], w, 2) > 0 && !Number.isNaN(original.uvs[c][v * 2])) uvs = false;
    normals = Math.max(normals, maxDiff(original.normals, v, back.normals, w, 3));
    tangents = Math.max(tangents, maxDiff(original.tangents, v, back.tangents, w, 3));
    // Skinning: the weight each bone gets, which the exporter regroups by joint.
    const byBone = (m: Mesh, i: number): Map<number, number> => {
      const out = new Map<number, number>();
      for (let k = 0; k < 4; k += 1) if (m.weights[i * 4 + k] > 0) out.set(m.joints[i * 4 + k], (out.get(m.joints[i * 4 + k]) ?? 0) + m.weights[i * 4 + k]);
      return out;
    };
    const a = byBone(original, v);
    const b = byBone(back, w);
    for (const bone of new Set([...a.keys(), ...b.keys()])) {
      const d = Math.abs((a.get(bone) ?? 0) - (b.get(bone) ?? 0));
      weights = Math.max(weights, d);
      if (d > 3.5 / 255) skin = false;
    }
  }
  err('mesh normal', normals);
  err('mesh tangent', tangents);
  err('mesh weight', weights);
  if (!positions) lost.push('positions');
  if (!uvs) lost.push('uvs');
  if (!skin) lost.push('skin weights beyond 3.5/255');
  if (Number.isNaN(normals) || normals > 2.5 / 1023) lost.push('normals beyond 2.5 steps');
  if (Number.isNaN(tangents) || tangents > 2.5 / 1023) lost.push('tangents beyond 2.5 steps');
  // Draws: the multiset of (material, triangle set).
  const draws = (m: Mesh, offset: number, wound = true): string[] => m.primitives.filter((p) => p.triangles.length > 0).map((p) => {
    const t: string[] = [];
    for (let i = 0; i + 2 < p.triangles.length; i += 3) {
      const [a, b, c] = [p.triangles[i] - offset, p.triangles[i + 1] - offset, p.triangles[i + 2] - offset];
      t.push(wound ? canonical(a, b, c) : [a, b, c].sort((x, y) => x - y).join());
    }
    return `${p.material ? refKey(p.material) : 'g10803'}|${t.sort().join(';')}`;
  }).sort();
  if (draws(original, 0, false).join('\n') !== draws(back, pad, false).join('\n')) lost.push('triangles or materials');
  else if (draws(original, 0).join('\n') !== draws(back, pad).join('\n')) lost.push('winding: NvTriStrip turns some triangles round, as in Java');
  if (original.primitives.some((p) => p.region !== 0)) lost.push('(regions)');
  if (original.primitives.some((p) => !p.material && p.triangles.length > 0)) lost.push('(no material: GUID 10803, as Java)');
  // Bones.
  if (back.bones.length !== original.bones.length || back.bones.some((b, i) => b.name !== original.bones[i].name || b.parent !== original.bones[i].parent)) {
    lost.push('bone hierarchy');
  } else {
    let pose = 0;
    let inverse = 0;
    back.bones.forEach((b, i) => {
      pose = Math.max(pose, maxDiff(b.skinPose, 0, original.bones[i].skinPose, 0, 16));
      inverse = Math.max(inverse, maxDiff(b.invSkinPose, 0, original.bones[i].invSkinPose, 0, 16));
    });
    err('bone skinPose', pose);
    err('bone invSkinPose', inverse);
    if (!(inverse < 1e-3)) lost.push('inverse bind poses beyond 1e-3');
    else if (!(pose < 1e-3)) lost.push('(bind pose: a shear glTF TRS cannot hold)');
  }
  // Morphs.
  if (original.morphs.length > 0) {
    if (back.morphs.length !== original.morphs.length || back.morphNames.join() !== original.morphNames.map((x) => x.slice(0, 15)).join()) lost.push('morph names');
    else {
      let offsets = true;
      let morphNormals = 0;
      original.morphs.forEach((m, k) => {
        for (let v = 0; v < n; v += 1) {
          if (key3(m.offsets, v) !== key3(back.morphs[k].offsets, v + pad) && !Number.isNaN(m.offsets[v * 3])) offsets = false;
          morphNormals = Math.max(morphNormals, maxDiff(m.normals, v, back.morphs[k].normals, v + pad, 3));
        }
      });
      err('morph normal', morphNormals);
      if (!offsets) lost.push('morph offsets');
      if (!(morphNormals < 3 / 511)) lost.push('morph normals');
    }
  }
  const t = original.tail;
  if (t.softbodySprings.length > 0 || t.softbodyClusters.length > 0) lost.push('(softbody)');
  if (original.softbodyWeights.some((x, v) => Math.abs(x - back.softbodyWeights[v + pad]) > 1 / 255)) lost.push('softbody weights');
  if (t.mirrorBones.some((m, i) => m !== i)) lost.push('(bone mirroring)');
  if (original.skeletonType !== 0) lost.push('(skeleton type)');
  if (t.costumeCategoriesUsed !== 0 || t.regionIDsToHide.length > 0) lost.push('(costume fields)');
  if (original.bones.some((b) => (b.stored?.shapeVerts.length ?? 0) > 0)) lost.push('(bone shapes)');
  for (const l of lost) note(`  lost: ${l}`, sha1);
  note(lost.filter((l) => !l.startsWith('(')).length === 0 ? 'survives' : 'differs', sha1);
}

/** An animation's pose of `bone` at `frame`: rotation, position, scale. */
function pose(a: Animation, frame: number, bone: number): number[][] {
  const pick = (values: Float32Array, per: number, animated: Uint8Array): number[] => {
    const k = animated.indexOf(bone);
    const at = frame === 0 || k < 0 ? bone : a.bones.length + (frame - 1) * animated.length + k;
    return Array.from(values.subarray(at * per, at * per + per));
  };
  return [pick(a.rotations, 4, a.rotBonesAnimated), pick(a.positions, 3, a.posBonesAnimated), pick(a.scales, 3, a.scaleBonesAnimated)];
}

async function animTrip(bytes: Uint8Array, sha1: string): Promise<void> {
  const original = await readAnimation(bytes, nodeInflate);
  const { compressionFlags } = await loadResource(bytes, nodeInflate);
  let back: Animation;
  try {
    const { animation } = importAnimation(withSkin(animationToGlb(original)), { revision: original.revision });
    back = await readAnimation(await writeAnimationResource(animation, { revision: original.revision, compressionFlags }, nodeDeflate), nodeInflate);
  } catch (error) {
    return note(`refused: ${(error as Error).message.slice(0, 70)}`, `${sha1} (${original.numFrames} frames, ${original.rotBonesAnimated.length + original.posBonesAnimated.length + original.scaleBonesAnimated.length} tracks)`);
  }
  const lost: string[] = [];
  const bonesSame = back.bones.length === original.bones.length && back.bones.every((b, i) => {
    const o = original.bones[i];
    return b.animHash === o.animHash && b.parent === o.parent;
  });
  if (!bonesSame) lost.push('bones');
  else if (back.bones.some((b, i) => b.firstChild !== original.bones[i].firstChild || b.nextSibling !== original.bones[i].nextSibling)) {
    lost.push('(sibling order: glTF children are listed by index)');
  }
  if (back.numFrames !== original.numFrames) lost.push('frame count');
  if (back.fps !== original.fps || back.loopStart !== original.loopStart) lost.push('fps or loop start');
  let rotation = 0;
  let position = 0;
  let scale = 0;
  if (bonesSame && back.numFrames === original.numFrames) {
    for (let f = 0; f < original.numFrames; f += 1) {
      for (let b = 0; b < original.bones.length; b += 1) {
        const [r0, p0, s0] = pose(original, f, b);
        const [r1, p1, s1] = pose(back, f, b);
        const dot = Math.abs(r0.reduce((s, x, i) => s + x * r1[i], 0)) / (Math.hypot(...r0) * Math.hypot(...r1) || 1);
        rotation = Math.max(rotation, 1 - Math.min(1, dot));
        position = Math.max(position, ...p0.map((x, i) => Math.abs(x - p1[i]) / Math.max(1, Math.abs(x))));
        scale = Math.max(scale, ...s0.map((x, i) => Math.abs(x - s1[i]) / Math.max(1, Math.abs(x))));
      }
    }
    err('anim rotation 1-|dot|', rotation);
    err('anim position (relative)', position);
    err('anim scale (relative)', scale);
    if (!(rotation < 1e-6)) lost.push('rotations beyond 1e-6 in 1-|dot|');
    if (!(position < 2e-3) || !(scale < 2e-3)) lost.push('positions or scales beyond a half step');
  }
  if (original.morphsAnimated.length > 0 || original.morphCount > 0) lost.push('(morph tracks)');
  if (original.locators.length > 0 || (original.locatorKeyData?.length ?? 0) > 0) lost.push('(locators)');
  if (original.fat !== 0) lost.push('(fat: f32 keys written as halves)');
  if (original.posOffset.some((x, i) => x !== [0, 0, 0, 1][i]) || original.posScale.some((x) => x !== 1)) lost.push('(posOffset/posScale)');
  const animated = (a: Animation): string => [a.rotBonesAnimated, a.posBonesAnimated, a.scaleBonesAnimated].map((l) => [...l].sort((x, y) => x - y).join()).join('|');
  if (bonesSame && animated(original) !== animated(back)) lost.push('(animated-track lists: a track that never moves is the base pose)');
  for (const l of lost) note(`  lost: ${l}`, sha1);
  note(lost.filter((l) => !l.startsWith('(')).length === 0 ? 'survives' : 'differs', sha1);
}

async function backdropTrip(bytes: Uint8Array, sha1: string): Promise<void> {
  const original = await readStaticMesh(bytes, nodeInflate);
  let back: StaticMesh;
  const lost: string[] = [];
  try {
    const overrides: Record<string, ResourceRef> = {};
    for (const p of original.primitives) if (p.material) overrides[refKey(p.material)] = p.material;
    const builder = new StaticMeshBuilder();
    for (const part of primitivesAsGlbs(staticMeshToGlb(original))) {
      builder.add(importModel(part.glb, { materialOverrides: overrides }).mesh, { world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    }
    back = await readStaticMesh(await writeStaticMesh(builder.build(original.revision), nodeDeflate), nodeInflate);
  } catch (error) {
    return note(`refused: ${(error as Error).message.slice(0, 70)}`, sha1);
  }
  const drawn = original.primitives.filter((p) => p.triangles.length > 0);
  if (drawn.length !== back.primitives.length) lost.push('primitive count');
  let normals = 0;
  let tangents = 0;
  let uvs = 0;
  let exact = true;
  drawn.forEach((p, i) => {
    const q = back.primitives[i];
    if (!q) return;
    if ((p.material ? refKey(p.material) : '-') !== (q.material ? refKey(q.material) : '-')) lost.push('materials');
    // Each triangle as its corners' positions rotated to start at the least, keeping the winding, with its vertices.
    const triangles = (m: StaticMesh, t: Uint32Array): Map<string, number[]> => {
      const out = new Map<string, number[]>();
      for (let k = 0; k + 2 < t.length; k += 3) {
        let c = [t[k], t[k + 1], t[k + 2]];
        const keys = c.map((v) => key3(m.positions, v));
        const r = keys.indexOf([...keys].sort()[0]);
        c = [c[r], c[(r + 1) % 3], c[(r + 2) % 3]];
        const key = c.map((v) => key3(m.positions, v)).join('/');
        if (!out.has(key)) out.set(key, c);
      }
      return out;
    };
    const a = triangles(original, p.triangles);
    const b = triangles(back, q.triangles);
    if (a.size !== b.size) exact = false;
    for (const [k, va] of a) {
      const vb = b.get(k);
      if (!vb) {
        exact = false;
        bump('  backdrop triangles missing', 1);
        if (!examples.has('missing triangle')) examples.set('missing triangle', `${sha1} ${k}`);
        continue;
      }
      va.forEach((v, c) => {
        const w = vb[c];
        const dn = maxDiff(original.normals, v, back.normals, w, 3);
        const dt = maxDiff(original.tangents, v, back.tangents, w, 3);
        normals = Math.max(normals, dn);
        tangents = Math.max(tangents, dt);
        uvs = Math.max(uvs, maxDiff(original.uvs[0], v, back.uvs[0], w, 2), maxDiff(original.uvs[1], v, back.uvs[1], w, 2));
        bump('  backdrop corners compared');
        if (!(dn < 3 / 511)) bump('  backdrop corners: normal beyond 3 steps');
        if (!(dn < 0.05)) bump('  backdrop corners: normal beyond 0.05');
        if (!(dt < 3 / 511)) bump('  backdrop corners: tangent beyond 3 steps');
      });
    }
  });
  err('backdrop normal', normals);
  err('backdrop tangent', tangents);
  err('backdrop uv', uvs);
  if (!exact) lost.push('triangles (as position triples)');
  if (!(normals < 3 / 511)) lost.push('normals beyond 3 steps');
  if (!(tangents < 3 / 511)) lost.push('tangents beyond 3 steps');
  if (uvs > 0) lost.push('uvs');
  if (original.lightmap || original.risemap || original.fallmap) lost.push('(light maps)');
  if ((original.unknownStructs?.length ?? 0) > 1) lost.push('(culling tree: one node)');
  for (const l of lost) note(`  lost: ${l}`, sha1);
  note(lost.filter((l) => !l.startsWith('(')).length === 0 ? 'survives' : 'differs', sha1);
}

let done = 0;
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const { sha1, file: where } of found) {
      if (where !== file || !picked.has(sha1)) continue;
      const bytes = (await farc.get(sha1))!;
      try {
        if (kind === 'anim') await animTrip(bytes, sha1);
        else if (kind === 'backdrop') await backdropTrip(bytes, sha1);
        else await meshTrip(bytes, sha1);
      } catch (error) {
        note(`harness error: ${(error as Error).message.slice(0, 70)}`, sha1);
      }
      done += 1;
    }
  } finally {
    await access.close();
  }
}
console.log(`${done} ${magic} of ${found.length}`);
for (const [k, v] of [...tally].sort((a, b) => (a[0].startsWith('  ') === b[0].startsWith('  ') ? a[0].localeCompare(b[0]) : a[0].startsWith('  ') ? 1 : -1))) {
  console.log(`${String(v).padStart(6)}  ${k}`);
}
console.log('worst differences:');
for (const [k, v] of worst) console.log(`  ${k}: ${v}`);
for (const [k, v] of examples) console.log(`  e.g. ${k}: ${v}`);
