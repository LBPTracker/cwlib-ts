/**
 * `importBlendMesh` (src/imports/blend-packet-importer.ts) against Java's:
 * synthetic blend packets (`syntheticBlendPacket`: soft, skinned, clustered
 * grids of several sizes and flag sets -- there is no corpus of real ones)
 * read by cwlib d6a2ef8's `BlendPacket.FromFile` and built by the mesh half of
 * its `Work2` through the harness `JBlend`, and by ours; the payloads, written
 * at head `0x016b03f8`, flags 0, compared byte for byte.
 *
 *   node dev/import-blend-java.ts <work dir> [count]
 *
 * Needs `JIMP_JAVA` and `JIMP_CP` (as `dev/import-java.ts`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { encodeMesh } from '../src/resources/mesh.ts';
import {
  HAS_ARMATURE, HAS_SOFTBODY_CLUSTERS, HAS_SOFTBODY_SPRINGS, HAS_VERTEX_MASS, importBlendMesh, readBlendPacket, syntheticBlendPacket, writeBlendPacket,
} from '../src/imports/blend-packet-importer.ts';
import { required } from './env.ts';

const work = path.resolve(process.argv[2] ?? 'import-blend-java');
const count = Number(process.argv[3] ?? 40);
const JAVA = required('JIMP_JAVA', 'a JDK 17+ java executable');
const CP = required('JIMP_CP', "the classpath of JBlend, cwlib d6a2ef8's classes and the toolkit jar");
mkdirSync(work, { recursive: true });
const revision = { version: 0x3f8, subVersion: 0x16b, branchId: 0, branchRevision: 0 };
const flagSets = [
  HAS_ARMATURE,
  HAS_ARMATURE | HAS_VERTEX_MASS | HAS_SOFTBODY_SPRINGS,
  HAS_ARMATURE | HAS_VERTEX_MASS | HAS_SOFTBODY_CLUSTERS,
  HAS_ARMATURE | HAS_VERTEX_MASS | HAS_SOFTBODY_SPRINGS | HAS_SOFTBODY_CLUSTERS,
  HAS_SOFTBODY_SPRINGS | HAS_SOFTBODY_CLUSTERS,
];
const tally = new Map<string, number>();
const bump = (k: string): void => void tally.set(k, (tally.get(k) ?? 0) + 1);
for (let i = 0; i < count; i += 1) {
  const size = 3 + (i % 9);
  const flags = flagSets[i % flagSets.length];
  const file = path.join(work, `p${i}.blendpacket`);
  const bytes = writeBlendPacket(syntheticBlendPacket(size, i + 1, flags));
  writeFileSync(file, bytes);
  execFileSync(JAVA, ['-cp', CP, 'JBlend', file, path.join(work, `p${i}`)], { encoding: 'utf8' });
  const base = path.join(work, `p${i}.0`);
  let ours: Uint8Array | undefined;
  let error: string | undefined;
  try {
    ours = encodeMesh(importBlendMesh(readBlendPacket(bytes), 0, { revision }).mesh, { revision, compressionFlags: 0 });
  } catch (e) {
    error = (e as Error).message;
  }
  const javaError = existsSync(`${base}.err`) ? readFileSync(`${base}.err`, 'utf8') : undefined;
  if (error || javaError) {
    bump(`${error ? `ours: ${error}` : 'ours builds'} / ${javaError ? `Java: ${javaError.slice(0, 80)}` : 'Java builds'}`);
    continue;
  }
  const java = new Uint8Array(readFileSync(`${base}.payload`));
  let first = -1;
  for (let k = 0; k < Math.max(java.length, ours!.length); k += 1) {
    if (java[k] !== ours![k]) {
      first = k;
      break;
    }
  }
  bump(first === -1 ? 'payload identical' : `payload differs (flags ${flags}), first at 0x${first.toString(16)} of ${java.length}/${ours!.length}`);
}
for (const [k, v] of [...tally].sort()) console.log(`${String(v).padStart(5)}  ${k}`);
