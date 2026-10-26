import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openGame } from '../src/archives/game.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { encodeAnimation, readAnimation } from '../src/resources/animation.ts';
import { readBoneSet } from '../src/resources/bone-set.ts';
import { refKey } from '../src/resources/gltf-material.ts';
import { encodeMesh, readMesh } from '../src/resources/mesh.ts';
import { meshToGlb } from '../src/resources/mesh-gltf.ts';
import { readStaticMesh, writeStaticMesh } from '../src/resources/staticmesh.ts';
import { importAnimation } from '../src/imports/animation-importer.ts';
import {
  HAS_ARMATURE, HAS_SOFTPHYSICS, HAS_VERTEX_MASS, importBlendMesh, makePathGuid, readBlendPacket, syntheticBlendPacket, writeBlendPacket,
} from '../src/imports/blend-packet-importer.ts';
import { JavaHashSet } from '../src/imports/java-hash.ts';
import { translationRotateScale } from '../src/imports/joml.ts';
import { animationHash, packNormal24, unrollStrip } from '../src/imports/mesh-builder.ts';
import { importModel } from '../src/imports/model-importer.ts';
import { StaticMeshBuilder, javaHalf } from '../src/imports/static-mesh-builder.ts';
import { generateStrips } from '../src/imports/tristrip.ts';
import { writeAnimationResource, writeMeshResource } from '../src/imports/write.ts';
import { gridGlb } from '../dev/import-fixtures.ts';

/**
 * The importers (src/imports/), ports of Java cwlib's `io/imports/` at
 * ennuo/toolkit `d6a2ef8`. The SHA-1s pinned below are of the payloads
 * cwlib's own importers build from the same inputs (the harnesses `JImp` and
 * `JBlend` over `dev/import-fixtures.ts`, written at head `0x016b03f8`, flags
 * 0); the game-wide comparisons are `dev/import-java.ts`,
 * `dev/import-staticmesh-java.ts`, `dev/import-blend-java.ts` and
 * `dev/import-roundtrip.ts`.
 */
const REVISION = { version: 0x3f8, subVersion: 0x16b, branchId: 0, branchRevision: 0 };
const HEADER = { revision: REVISION, compressionFlags: 0 };
const sha1 = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex');
const TOOLKIT = process.env.LBP_TOOLKIT ?? '';
const BONESET = path.join(TOOLKIT, 'lib', 'cwlib', 'src', 'main', 'resources', 'binary', 'characters.boneset');
const GAME = process.env.LBP_GAME ?? '';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test("Java's arithmetic: the bone hash, the truncating normal pack, half floats rounding ties away, a quaternion's matrix", () => {
  assert.equal(animationHash('Dummy01'), animationHash('Dummy01'));
  assert.equal(animationHash(null), 0);
  // " R " and " L " are cut and add 3 and 2.
  assert.equal(animationHash('Bip01 R Hand') - animationHash('Bip01Hand'), 3);
  // (int)(0.5 * 2047) = 1023, not 1024; a negative counts down from bit 11.
  assert.equal(packNormal24(0.5, 0, 1) & 0xfff, 1023);
  assert.equal(packNormal24(-0.5, 0, -1) >>> 23, 1);
  assert.equal(javaHalf(1), 0x3c00);
  assert.equal(javaHalf(Math.fround(1 + 2 ** -11)), 0x3c01); // a tie, away from zero (IEEE would round to even, 0x3c00)
  const m = translationRotateScale([1, 2, 3], [0, 0, Math.SQRT1_2, Math.SQRT1_2], [1, 1, 1]).m;
  assert.deepEqual(Array.from(m.subarray(12, 15)), [1, 2, 3]);
  assert.ok(Math.abs(m[1] - 1) < 1e-6 && Math.abs(m[4] + 1) < 1e-6);
});

test("a HashSet's order: buckets by hash, insertion order within, and a tree bin flagged", () => {
  const set = new JavaHashSet<number>();
  for (const v of [40, 3, 17, 3, 1]) set.add(String(v), v, v);
  assert.deepEqual(set.values(), [17, 1, 3, 40]); // buckets 1 (17, then 1), 3, 8 (40 & 15)
  assert.equal(set.treeified, false);
  const fan = new JavaHashSet<number>(128);
  for (let i = 0; i < 10; i += 1) fan.add(`e${i}`, 7, i);
  assert.equal(fan.treeified, true);
});

test('NvTriStrip: a strip that unrolls to the same triangles, wound the same way', () => {
  const w = 6;
  const tris: number[] = [];
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < w - 1; x += 1) tris.push(y * w + x, (y + 1) * w + x, y * w + x + 1, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1);
  const groups = generateStrips(tris);
  assert.equal(groups.length, 1);
  const canonical = (a: number, b: number, c: number): string => (a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`);
  const want = new Set<string>();
  for (let i = 0; i < tris.length; i += 3) want.add(canonical(tris[i], tris[i + 1], tris[i + 2]));
  const got = new Set<string>();
  const unrolled = unrollStrip(groups[0].indices);
  for (let i = 0; i < unrolled.length; i += 3) {
    const [a, b, c] = [unrolled[i], unrolled[i + 1], unrolled[i + 2]];
    if (a !== b && b !== c && a !== c) got.add(canonical(a, b, c));
  }
  assert.deepEqual([...got].sort(), [...want].sort());
});

test("importModel builds Java's RMesh to the byte, from the glTF's skins and from Sackboy's skeleton", async (t) => {
  const { mesh, springyTriangles } = importModel(gridGlb(), { revision: REVISION });
  assert.equal(sha1(encodeMesh(mesh, HEADER)), '2a5b90667944afe843bed5963ce3e41f6893295a');
  assert.equal(springyTriangles, 0);
  // 40 vertices, already a multiple of 8: no padding; two draws, both on GUID 10803 with no overrides.
  assert.equal(mesh.vertexCount, 40);
  assert.deepEqual(mesh.primitives.map((p) => p.material?.guid), [10803, 10803]);
  assert.deepEqual(mesh.bones.map((b) => b.name), ['root', 'bend']);
  assert.deepEqual(mesh.morphNames, ['smile']);
  // Written and read back: the dependency table holds the materials.
  const named = importModel(gridGlb(), { revision: REVISION, materialOverrides: { jam: { guid: 7 }, toast: { guid: 9 } } }).mesh;
  const file = await writeMeshResource(named, HEADER, nodeDeflate);
  const back = await readMesh(file, nodeInflate);
  assert.deepEqual(back.primitives.map((p) => p.material?.guid), [7, 9]);
  assert.deepEqual(Array.from(back.positions), Array.from(named.positions));

  if (!TOOLKIT || !existsSync(BONESET)) return t.skip(TOOLKIT ? `no ${BONESET}` : 'LBP_TOOLKIT is not set: Sackboy skeleton not checked');
  const set = await readBoneSet(await readFile(BONESET), nodeInflate);
  const sackboy = importModel(gridGlb(), { revision: REVISION, skeleton: set.skeletons[0] }).mesh;
  assert.equal(sha1(encodeMesh(sackboy, HEADER)), '3f42ebf92612a0204afb741b98e315a7becb01ae');
  assert.equal(sackboy.bones.length, 43);
});

test("importAnimation builds Java's RAnimation to the byte", async () => {
  const revision = { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 };
  const { animation, skippedChannels } = importAnimation(gridGlb(), { revision });
  assert.equal(sha1(encodeAnimation(animation, { revision, compressionFlags: 0 })), 'd934fafdfd0c02ae2c09c6b1c1b574db97505500');
  assert.equal(skippedChannels, 0);
  assert.equal(animation.numFrames, 6);
  assert.equal(animation.fps, 24);
  // The bend's rotation moves; its translation never does and is the base pose alone.
  assert.deepEqual([...animation.rotBonesAnimated], [1]);
  assert.deepEqual([...animation.posBonesAnimated], []);
  const back = await readAnimation(await writeAnimationResource(animation, { revision, compressionFlags: 0 }, nodeDeflate), nodeInflate);
  assert.equal(back.bones[1].animHash, animationHash('bend'));
  assert.equal(back.bones[1].parent, 0);
});

test("a blend packet reads, writes back, and builds Java's soft RMesh to the byte", () => {
  const packet = syntheticBlendPacket(6, 7, HAS_ARMATURE | HAS_VERTEX_MASS | HAS_SOFTPHYSICS);
  const bytes = writeBlendPacket(packet);
  const read = readBlendPacket(bytes);
  assert.deepEqual(writeBlendPacket(read), bytes);
  assert.equal(read.textures[0].pixels[0], 0x7f102030);
  const { mesh } = importBlendMesh(read, 0, { revision: REVISION });
  assert.equal(sha1(encodeMesh(mesh, HEADER)), 'f735b0c9dbdc4a75afa9ebe87915063a7afa85b1');
  assert.equal(mesh.tail.softbodyClusters.length, 3);
  assert.ok(mesh.tail.softbodySprings.length > 0);
  assert.equal(mesh.tail.softPhysSettings?.guid, makePathGuid('gamedata/softphys/grid.sph'));
  assert.equal(mesh.primitives[0].material?.guid, makePathGuid('gamedata_randy/gmat/grid_a.gmat'));
});

test('StaticMeshBuilder bakes a placed mesh into a backdrop that writes and reads back', async () => {
  const { mesh } = importModel(gridGlb(), { revision: REVISION, materialOverrides: { jam: { guid: 7 } } });
  const builder = new StaticMeshBuilder();
  const world = translationRotateScale([10, 0, 0], [0, 0, 0, 1], [2, 2, 2]).m;
  builder.add(mesh, { world });
  builder.add(mesh, { world: translationRotateScale([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]).m });
  const backdrop = builder.build();
  assert.equal(backdrop.vertexCount, 80);
  assert.equal(backdrop.primitives.length, 4);
  assert.deepEqual(backdrop.primitives.map((p) => p.vertexStart), [0, 20, 40, 60]); // each primitive its own accessors, so its own vertices
  const back = await readStaticMesh(await writeStaticMesh(backdrop, nodeDeflate), nodeInflate);
  // The root bone's pose places every vertex: scaled by 2 and moved by 10 (bone 0 is the identity bind) -- Java's blend moves it by 40.
  assert.equal(back.positions[0], mesh.positions[0] * 2 + 10);
  assert.deepEqual(Array.from(back.positions.subarray(120)), Array.from(mesh.positions));
  assert.deepEqual(back.primitives.map((p) => p.material?.guid), [7, 10803, 7, 10803]);
  assert.equal(back.primitives[0].triangles.length, mesh.primitives[0].triangles.length);
});

test("a game mesh survives meshToGlb and importModel: positions, UVs, triangles and materials", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(GAME ? `no game under ${GAME}` : 'LBP_GAME is not set');
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const game = await openGame({
    fileDB: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.map'))),
    remap: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.remap'))),
    farcs: accesses.map((access, i) => ({ name: FARCS[i], access })),
  });
  try {
    const original = await readMesh((await game.resolve({ kind: 'guid', guid: 453737, type: 2 }))!, nodeInflate);
    const overrides = Object.fromEntries(original.primitives.flatMap((p) => (p.material ? [[refKey(p.material), p.material]] : [])));
    const { mesh } = importModel(meshToGlb(original), { materialOverrides: overrides, revision: original.revision });
    const back = await readMesh(await writeMeshResource(mesh, { revision: original.revision, compressionFlags: 7 }, nodeDeflate), nodeInflate);
    const pad = back.vertexCount - original.vertexCount;
    assert.ok(pad >= 0 && pad < 8 && (back.vertexCount % 8 === 0));
    assert.deepEqual(Array.from(back.positions.subarray(pad * 3)), Array.from(original.positions));
    original.uvs.forEach((uv, c) => assert.deepEqual(Array.from(back.uvs[c].subarray(pad * 2)), Array.from(uv)));
    const draws = (m: typeof original, offset: number): string[] => m.primitives.filter((p) => p.triangles.length > 0).map((p) => {
      const t: string[] = [];
      for (let i = 0; i < p.triangles.length; i += 3) {
        const [a, b, c] = [p.triangles[i] - offset, p.triangles[i + 1] - offset, p.triangles[i + 2] - offset];
        t.push(a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`);
      }
      return `${p.material ? refKey(p.material) : 'g10803'}|${t.sort().join(';')}`;
    }).sort();
    assert.deepEqual(draws(back, pad), draws(original, 0));
  } finally {
    for (const a of accesses) await a.close();
  }
});
