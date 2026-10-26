/**
 * The importers against Java's (`src/imports/`): the game's meshes and
 * animations exported to `.glb` by this library (`meshToGlb`,
 * `animationToGlb`) -- or by Java's own exporter, where the folder already
 * holds those -- imported by cwlib d6a2ef8's `ModelImporter` /
 * `AnimationImporter` through the harness `JImp` and by ours, and the two
 * payloads and dependency tables compared byte for byte; where they differ,
 * the first differing field is named.
 *
 *   node dev/import-java.ts <model|anim> <work dir> [count] [max vertices]
 *
 * Needs `LBP_GAME`, `JIMP_JAVA` (a JDK 17+ `java`) and `JIMP_CP` (the
 * classpath holding `JImp`, cwlib d6a2ef8's classes and the toolkit jar's
 * libraries). The mesh imports run at `skeleton: null` with
 * `shareAccessors: false` -- Java's behaviour on this library's shared
 * accessors -- and are written at head `0x016b03f8`, flags 0.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { loadResource, magicOf, readDependencies } from '../src/io/resource.ts';
import type { RevisionInfo } from '../src/io/serializer.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { encodeAnimation, readAnimation } from '../src/resources/animation.ts';
import { animationToGlb } from '../src/resources/animation-gltf.ts';
import { encodeMesh, readMesh } from '../src/resources/mesh.ts';
import { meshToGlb } from '../src/resources/mesh-gltf.ts';
import { importAnimation } from '../src/imports/animation-importer.ts';
import { importModel } from '../src/imports/model-importer.ts';
import { javaDependencies, meshDescriptors } from '../src/imports/write.ts';
import { required } from './env.ts';
import { withSkin } from './import-glb.ts';
import { FARCS, GAME } from './game.ts';

const mode = process.argv[2] === 'anim' ? 'anim' : 'model';
const work = path.resolve(process.argv[3] ?? 'import-java');
const count = Number(process.argv[4] ?? 200);
const maxVertices = Number(process.argv[5] ?? 3000);
const JAVA = required('JIMP_JAVA', 'a JDK 17+ java executable');
const CP = required('JIMP_CP', "the classpath of JImp, cwlib d6a2ef8's classes and the toolkit jar");
mkdirSync(work, { recursive: true });

const revision: RevisionInfo = mode === 'model'
  ? { version: 0x3f8, subVersion: 0x16b, branchId: 0, branchRevision: 0 }
  : { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 };
const header = { revision, compressionFlags: 0 };
const magic = mode === 'model' ? 'MSHb' : 'ANMb';

// 1. The game's resources of the kind, sampled evenly, as glb.
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
const picked = Array.from({ length: Math.min(count, found.length) }, (_, i) => found[Math.floor(i * step)]);
const list: string[] = [];
const sources = new Map<string, Uint8Array>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const p of picked) {
      if (p.file !== file) continue;
      const bytes = (await farc.get(p.sha1))!;
      const glb = path.join(work, `${p.sha1}.glb`);
      try {
        if (mode === 'model') {
          const mesh = await readMesh(bytes, nodeInflate);
          if (mesh.vertexCount === 0 || mesh.vertexCount > maxVertices) continue;
          if (!existsSync(glb)) writeFileSync(glb, meshToGlb(mesh));
        } else {
          const animation = await readAnimation(bytes, nodeInflate);
          if (!existsSync(glb)) writeFileSync(glb, withSkin(animationToGlb(animation)));
        }
      } catch {
        continue;
      }
      sources.set(p.sha1, bytes);
      list.push(`${glb}\t${path.join(work, p.sha1)}`);
    }
  } finally {
    await access.close();
  }
}
writeFileSync(path.join(work, 'list.txt'), list.join('\n'));
console.log(`${list.length} ${magic} exported to glb of ${found.length} in the game`);

// 2. Java's import.
const head = ((revision.subVersion << 16) | revision.version) >>> 0;
console.log(execFileSync(JAVA, ['-cp', CP, 'JImp', mode, head.toString(16), '0', '0', '0', 'none', path.join(work, 'list.txt')], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim());

// 3. Ours, and the comparison.
const tally = new Map<string, number>();
const bump = (k: string): void => void tally.set(k, (tally.get(k) ?? 0) + 1);
const examples = new Map<string, string>();
for (const line of list) {
  const [glbPath, base] = line.split('\t');
  const sha1 = path.basename(base);
  const javaError = existsSync(`${base}.err`) ? readFileSync(`${base}.err`, 'utf8').split('\n')[0] : undefined;
  let ours: Uint8Array;
  let deps: string;
  try {
    const glb = readFileSync(glbPath);
    if (mode === 'model') {
      const { mesh } = importModel(glb, { shareAccessors: false, readSoftbodyWeight: false, revision });
      ours = encodeMesh(mesh, header);
      deps = JSON.stringify(javaDependencies(meshDescriptors(mesh, revision)).map((d) => [d.guid, d.type]));
    } else {
      ours = encodeAnimation(importAnimation(glb, { hashedBoneNames: false, readExtras: false, revision }).animation, header);
      deps = '[]';
    }
  } catch (error) {
    const key = javaError ? `both refuse` : `ours refuses, Java imports: ${(error as Error).message.slice(0, 80)}`;
    bump(key);
    if (!examples.has(key)) examples.set(key, `${sha1}: ${(error as Error).message} | java: ${javaError}`);
    continue;
  }
  if (javaError) {
    const key = `Java refuses, ours imports: ${javaError.slice(0, 90)}`;
    bump(key);
    if (!examples.has(key)) examples.set(key, sha1);
    continue;
  }
  const javaPayload = new Uint8Array(readFileSync(`${base}.payload`));
  const javaRes = new Uint8Array(readFileSync(`${base}.res`));
  const javaDeps = JSON.stringify(readDependencies(javaRes).map((d) => [d.kind === 'guid' ? d.guid : d.sha1, d.type]));
  if (javaDeps !== deps) {
    bump('dependency tables differ');
    if (!examples.has('dependency tables differ')) examples.set('dependency tables differ', `${sha1}: ${javaDeps} vs ${deps}`);
  }
  let first = -1;
  const n = Math.min(ours.length, javaPayload.length);
  for (let i = 0; i < n; i += 1) {
    if (ours[i] !== javaPayload[i]) {
      first = i;
      break;
    }
  }
  if (first === -1 && ours.length === javaPayload.length) {
    bump('payload identical');
    continue;
  }
  const where = first === -1 ? n : first;
  if (mode === 'model' && ours.length === javaPayload.length && (await edgesOnly(javaRes, ours, javaPayload))) {
    bump('payload identical but for the edge order in a Java tree bin (identity hashes)');
    continue;
  }
  const key = `payload differs (${await locate(javaRes, where, mode)})`;
  bump(key);
  if (!examples.has(key)) examples.set(key, `${sha1} at 0x${where.toString(16)} (${ours.length} vs ${javaPayload.length} bytes)`);
}
void sources;
for (const [k, v] of [...tally].sort()) console.log(`${String(v).padStart(5)}  ${k}`);
for (const [k, v] of examples) console.log(`  e.g. ${k}: ${v}`);

/**
 * Whether two payloads differ only inside the edge list, and there only in the
 * order of the same edges: what a HashSet<Edge> tree bin, ordered by
 * identity hashes, does to Java's (src/imports/java-hash.ts).
 */
async function edgesOnly(res: Uint8Array, ours: Uint8Array, java: Uint8Array): Promise<boolean> {
  const s = (await readMesh(res, nodeInflate)).stored!;
  const offsets = 7 * 4 + 32 * 16 + 4 + (s.minUV?.length ?? 0) * 4 + 4 + (s.maxUV?.length ?? 0) * 4 + 4;
  const attributes = offsets + s.streamOffsets.length * 4 + s.vertexCount * 16 * (2 + s.morphs.length);
  const start = attributes + 8 + s.attributes.length + s.numIndices * 2;
  const end = attributes + 8 + s.attributes.length + s.indices.length;
  for (let i = 0; i < ours.length; i += 1) if (ours[i] !== java[i] && (i < start || i >= end)) return false;
  const edges = (b: Uint8Array): string => {
    const list: string[] = [];
    for (let i = start; i < end; i += 4) list.push(Array.from(b.subarray(i, i + 4)).join(','));
    return list.sort().join(';');
  };
  return edges(ours) === edges(java);
}

/** The field a payload offset falls in, by the reader's own layout. */
async function locate(res: Uint8Array, at: number, kind: string): Promise<string> {
  if (kind !== 'model') return `offset 0x${at.toString(16)}`;
  const { data } = await loadResource(res, nodeInflate);
  const mesh = await readMesh(res, nodeInflate);
  const s = mesh.stored!;
  const morphNames = 7 * 4;
  const uv = morphNames + 32 * 16;
  const offsets = uv + 4 + (s.minUV?.length ?? 0) * 4 + 4 + (s.maxUV?.length ?? 0) * 4 + 4;
  const streams = offsets + s.streamOffsets.length * 4;
  const n = s.vertexCount * 16;
  const regions: [string, number][] = [
    ['counts', 0], ['morph names', morphNames], ['uv range', uv], ['stream offsets', offsets], ['positions', streams],
    ['skin', streams + n],
  ];
  for (let m = 0; m < s.morphs.length; m += 1) regions.push([`morph ${m}`, streams + n * (2 + m)]);
  const attributes = streams + n * (2 + s.morphs.length);
  regions.push(['attributes', attributes]);
  regions.push(['indices', attributes + 4 + s.attributes.length]);
  regions.push(['primitives, bones and tail', attributes + 8 + s.attributes.length + s.indices.length]);
  let name = 'counts';
  for (const [label, start] of regions) if (at >= start) name = label;
  if (name === 'skin') {
    const k = (at - streams - n) % 16;
    name += k < 3 ? ' weights' : k % 4 === 3 ? ' joints' : k < 7 ? ' normal' : k < 11 ? ' smooth normal' : ' tangent';
  }
  if (name === 'indices' && at - (attributes + 4 + s.attributes.length) - 4 >= s.numIndices * 2) name += ' (edge list)';
  void data;
  return name;
}
