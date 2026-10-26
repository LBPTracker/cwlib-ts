/**
 * `StaticMeshBuilder` (src/imports/static-mesh-builder.ts) against Java's:
 * game meshes placed under one world matrix -- one mesh a backdrop, and
 * every fifth backdrop three meshes together -- baked by cwlib d6a2ef8's
 * `StaticMeshBuilder` through the harness `JStatic` and by ours, both read
 * back with `readStaticMesh` and compared field by field. Ours puts the
 * tangent at 28, where Java puts it at 20; that pair is compared crosswise.
 *
 *   node dev/import-staticmesh-java.ts <work dir> [count]
 *
 * Needs `LBP_GAME`, `JIMP_JAVA` and `JIMP_CP` (as `dev/import-java.ts`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { inflateChunkTable, magicOf, readDependencies } from '../src/io/resource.ts';
import { Serializer } from '../src/io/serializer.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readMesh, type Mesh } from '../src/resources/mesh.ts';
import { readStaticMesh, readStaticMeshInfo, writeStaticMesh, type StaticMesh } from '../src/resources/staticmesh.ts';
import { translationRotateScale } from '../src/imports/joml.ts';
import { StaticMeshBuilder } from '../src/imports/static-mesh-builder.ts';
import { required } from './env.ts';
import { FARCS, GAME } from './game.ts';

const work = path.resolve(process.argv[2] ?? 'import-static-java');
const count = Number(process.argv[3] ?? 200);
const JAVA = required('JIMP_JAVA', 'a JDK 17+ java executable');
const CP = required('JIMP_CP', "the classpath of JStatic, cwlib d6a2ef8's classes and the toolkit jar");
mkdirSync(work, { recursive: true });

// A placement with a rotation, a scale and a translation, in Java's floats.
const world = translationRotateScale([12.5, -3.25, 100], [0.1830127, 0.1830127, 0.6830127, 0.6830127], [1.5, 1.5, 1.5]).m;

const found: { sha1: string; file: string }[] = [];
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      if (magicOf(await access.read(entry.offset, 8)) === 'MSHb') found.push({ sha1: entry.sha1, file });
    }
  } finally {
    await access.close();
  }
}
const step = Math.max(1, found.length / count);
const picked = Array.from({ length: Math.min(count, found.length) }, (_, i) => found[Math.floor(i * step)]);
const meshes = new Map<string, Mesh>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const p of picked) {
      if (p.file !== file) continue;
      const bytes = (await farc.get(p.sha1))!;
      try {
        meshes.set(p.sha1, await readMesh(bytes, nodeInflate));
      } catch {
        continue;
      }
      const at = path.join(work, `${p.sha1}.mesh`);
      if (!existsSync(at)) writeFileSync(at, bytes);
    }
  } finally {
    await access.close();
  }
}
const groups: string[][] = [];
const ids = [...meshes.keys()];
ids.forEach((id, i) => {
  groups.push([id]);
  if (i % 5 === 4) groups.push(ids.slice(i - 2, i + 1));
});
const lines = groups.map((g, i) => `${path.join(work, `b${i}`)}\t${Array.from(world).join(',')}\t${g.join(',')}`);
writeFileSync(path.join(work, 'list.txt'), lines.join('\n'));
console.log(`${groups.length} backdrops of ${meshes.size} game meshes`);
console.log(execFileSync(JAVA, ['-cp', CP, 'JStatic', work, path.join(work, 'list.txt')], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim());

const tally = new Map<string, number>();
const bump = (k: string): void => void tally.set(k, (tally.get(k) ?? 0) + 1);
const examples = new Map<string, string>();
const note = (k: string, e: string): void => {
  bump(k);
  if (!examples.has(k)) examples.set(k, e);
};

/** Java's word at 20 per vertex, which `readStaticMesh` does not return. */
async function word20(bytes: Uint8Array): Promise<Uint32Array> {
  const s = new Serializer(bytes.subarray(0x0c), { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 }, 0);
  const info = readStaticMeshInfo(s);
  const { data } = await inflateChunkTable(bytes, 0x0c + s.position, nodeInflate, {});
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Uint32Array.from({ length: info.vertexStreamSize / 32 }, (_, v) => d.getUint32(v * 32 + 20, false));
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]) || (x === 0 && b[i] === 0));

for (let g = 0; g < groups.length; g += 1) {
  const base = path.join(work, `b${g}`);
  const label = `b${g} (${groups[g].join(',').slice(0, 50)})`;
  const javaError = existsSync(`${base}.err`) ? readFileSync(`${base}.err`, 'utf8').split('\n')[0] : undefined;
  let ours: StaticMesh;
  let oursFile: Uint8Array;
  try {
    const builder = new StaticMeshBuilder({ javaSkinning: true });
    for (const id of groups[g]) builder.add(meshes.get(id)!, { world });
    oursFile = await writeStaticMesh(builder.build(), nodeDeflate);
    ours = await readStaticMesh(oursFile, nodeInflate);
  } catch (error) {
    note(javaError ? 'both refuse' : `ours refuses: ${(error as Error).message.slice(0, 60)}`, `${label} ${(error as Error).message} | ${javaError}`);
    continue;
  }
  if (javaError) {
    note(`Java refuses, ours builds: ${javaError.slice(0, 80)}`, label);
    continue;
  }
  const javaFile = new Uint8Array(readFileSync(`${base}.smh`));
  const java = await readStaticMesh(javaFile, nodeInflate);
  const diffs: string[] = [];
  if (ours.vertexCount !== java.vertexCount) diffs.push('vertex count');
  if (!same(ours.positions, java.positions)) diffs.push('positions');
  if (!same(ours.normals, java.normals)) diffs.push('normals');
  if (!same(ours.uvs[0], java.uvs[0])) diffs.push('uv0');
  if (!same(ours.uvs[1], java.uvs[1])) diffs.push('uv1');
  const java20 = await word20(javaFile);
  const ours28 = await (async () => {
    const s = new Serializer(oursFile.subarray(0x0c), ours.revision, 0);
    const info = readStaticMeshInfo(s);
    const { data } = await inflateChunkTable(oursFile, 0x0c + s.position, nodeInflate, {});
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return Uint32Array.from({ length: info.vertexStreamSize / 32 }, (_, v) => d.getUint32(v * 32 + 28, false));
  })();
  if (!same(java20, ours28)) {
    // A word Java packs as sign and -0 decodes as 0 and is written back as +0.
    const decode = (w: number): number[] => [[w & 0x3ff, (w >>> 10) & 1, 1023], [(w >>> 11) & 0x3ff, (w >>> 21) & 1, 1023], [(w >>> 22) & 0x1ff, w >>> 31, 511]]
      .map(([m, s, steps]) => (s ? -((steps - m) / steps) : m / steps));
    const decodedSame = Array.from(java20).every((w, i) => same(decode(w), decode(ours28[i])));
    diffs.push(decodedSame ? 'tangent word (-0 written +0 only)' : "tangent (ours at 28, Java's at 20)");
  }
  if (!same(ours.indices!, java.indices!)) diffs.push('indices');
  if (ours.primitives.length !== java.primitives.length) diffs.push('primitive count');
  else {
    ours.primitives.forEach((p, i) => {
      const q = java.primitives[i];
      if (!same(p.min, q.min) || !same(p.max, q.max)) diffs.push(`primitive ${i} box`);
      if ((p.material?.guid ?? 0) !== (q.material?.guid ?? 0) || (p.material?.hash ? 1 : 0) !== (q.material?.hash ? 1 : 0)) diffs.push(`primitive ${i} material`);
      if (p.vertexStart !== q.vertexStart || p.indexStart !== q.indexStart || p.numIndices !== q.numIndices || p.type !== q.type) diffs.push(`primitive ${i} run`);
    });
  }
  const [on, jn] = [ours.unknownStructs![0], java.unknownStructs![0]];
  if (!same(on.min, jn.min) || !same(on.max, jn.max) || on.numPrimitives !== jn.numPrimitives || on.structIndexA !== jn.structIndexA) diffs.push('tree node');
  const deps = (b: Uint8Array): string => readDependencies(b).map((d) => JSON.stringify(d)).sort().join();
  if (deps(oursFile) !== deps(javaFile)) diffs.push('dependency set');
  const order = (b: Uint8Array): string => readDependencies(b).map((d) => JSON.stringify(d)).join();
  if (deps(oursFile) === deps(javaFile) && order(oursFile) !== order(javaFile)) diffs.push('dependency order');
  const fields = diffs.filter((d) => !d.startsWith('primitive ') || !d.endsWith('box')).map((d) => d.replace(/primitive \d+/, 'primitive'));
  const boxes = diffs.some((d) => d.endsWith('box'));
  note(diffs.length === 0 ? 'every field identical' : `differs: ${[...new Set(fields), ...(boxes ? ['primitive boxes'] : [])].join(', ')}`, label);
}
for (const [k, v] of [...tally].sort()) console.log(`${String(v).padStart(5)}  ${k}`);
for (const [k, v] of examples) console.log(`  e.g. ${k}: ${v}`);
