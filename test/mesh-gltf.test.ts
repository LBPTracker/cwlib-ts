import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openGame } from '../src/archives/game.ts';
import { looseFiles, nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { gltfMaterials } from '../src/resources/gltf-material.ts';
import { readMesh, type Mesh } from '../src/resources/mesh.ts';
import { meshToGlb } from '../src/resources/mesh-gltf.ts';

/**
 * An `RMesh` written as a `.glb` and read back here; the game's skips without
 * `LBP_GAME`. src/resources/mesh-gltf.ts.
 */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

interface Gltf {
  asset: { version: string };
  nodes: { name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[]; mesh?: number; skin?: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material?: number; targets?: Record<string, number>[] }[]; extras?: { targetNames: string[] } }[];
  materials?: {
    name: string; doubleSided?: boolean; alphaMode?: string; alphaCutoff?: number;
    pbrMetallicRoughness: { baseColorFactor: number[]; baseColorTexture?: { index: number; texCoord?: number; extensions?: Record<string, { offset: number[]; rotation?: number; scale: number[] }> } };
    normalTexture?: { index: number };
    occlusionTexture?: { index: number };
    extensions?: { KHR_materials_specular?: { specularColorFactor: number[] } };
  }[];
  textures?: { source: number; sampler: number }[];
  images?: { bufferView: number; mimeType: string; name: string }[];
  samplers?: { wrapS: number; wrapT: number }[];
  extensionsUsed?: string[];
  skins?: { joints: number[]; inverseBindMatrices: number }[];
  accessors: { bufferView: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
}

/** The JSON chunk, and an accessor's values out of the BIN chunk. */
function readGlb(glb: Uint8Array): { json: Gltf; values: (accessor: number) => number[] } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67, 'glTF magic');
  assert.equal(dv.getUint32(8, true), glb.length, 'the header holds the length');
  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Gltf;
  const bin = 20 + jsonLength + 8;
  assert.equal(dv.getUint32(bin - 8, true) + bin, glb.length, 'the BIN chunk ends the file');
  const values = (index: number): number[] => {
    const a = json.accessors[index];
    const v = json.bufferViews[a.bufferView];
    const size = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : 1;
    const per = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]!;
    const at = bin + v.byteOffset;
    assert.equal(at % 4, 0, 'every view 4-aligned');
    return Array.from({ length: a.count * per }, (_, i) =>
      size === 4 ? dv.getFloat32(at + i * 4, true) : size === 2 ? dv.getUint16(at + i * 2, true) : dv.getUint8(at + i));
  };
  return { json, values };
}

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

test('a mesh comes back out of its .glb: vertices, triangles, regions, bones and a morph', () => {
  const lifted = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1);
  const bone = { flags: 0, animHash: 0, firstChild: -1, nextSibling: -1, boundBoxMin: [0, 0, 0, 0], boundBoxMax: [0, 0, 0, 0], boundSphere: [0, 0, 0, 0] } as const;
  const mesh = {
    vertexCount: 3,
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
    tangents: Float32Array.of(1, 0, 0, 1, 0, 0, 1, 0, 0),
    softbodyWeights: Float32Array.of(1, 0.5, 1),
    uvs: [Float32Array.of(0, 0, 1, 0, 0, 1)],
    // The second vertex names joint 1 twice, as the game's remainder slot often does.
    joints: Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0),
    weights: Float32Array.of(1, 0, 0, 0, 0.75, 0, 0, 0.25, 1, 0, 0, 0),
    primitives: [
      { material: { guid: 7 }, minVert: 0, maxVert: 2, firstIndex: 0, numIndices: 3, region: 0, triangles: Uint16Array.of(0, 1, 2) },
      { minVert: 0, maxVert: 2, firstIndex: 0, numIndices: 3, region: 5, triangles: Uint16Array.of(2, 1, 0) },
      { minVert: 0, maxVert: 0, firstIndex: 3, numIndices: 0, region: 5, triangles: new Uint16Array(0) },
    ],
    bones: [
      { ...bone, name: 'root', parent: -1, skinPose: identity, invSkinPose: identity },
      { ...bone, name: 'arm', parent: 0, skinPose: lifted, invSkinPose: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1) },
    ],
    morphNames: ['smile'],
    morphs: [{ name: 'smile', offsets: Float32Array.of(0, 0, 0, NaN, 0, 0, 0, 0.5, 0), normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1) }],
  } as unknown as Mesh;
  const { json, values } = readGlb(meshToGlb(mesh, { materialName: (ref) => (ref.guid === 7 ? 'jam' : undefined) }));
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.meshes.length, 2, 'one mesh per region');
  assert.equal(json.meshes[1].primitives.length, 1, 'the empty primitive is left out');
  const [first] = json.meshes[0].primitives;
  assert.deepEqual(values(first.attributes.POSITION), [...mesh.positions]);
  // u runs along +x and v along +y: glTF's green points to v = 0, so the bitangent is -y and w -1.
  assert.deepEqual(values(first.attributes.TANGENT), [1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]);
  assert.deepEqual(values(first.attributes._SOFTBODY_WEIGHT), [1, 0.5, 1]);
  assert.deepEqual(values(first.indices), [0, 1, 2]);
  assert.deepEqual(values(first.attributes.JOINTS_0), [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 'a joint named twice is named once');
  assert.deepEqual(values(first.attributes.WEIGHTS_0), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(json.materials![first.material!].name, 'jam');
  assert.deepEqual(values(first.targets![0].POSITION), [0, 0, 0, 0, 0, 0, 0, 0.5, 0], 'NaN written 0');
  assert.deepEqual(json.meshes[0].extras!.targetNames, ['smile']);
  assert.deepEqual(json.nodes.slice(0, 2).map((n) => n.name), ['root', 'arm']);
  assert.deepEqual([json.nodes[1].translation, json.nodes[1].rotation, json.nodes[1].scale], [[0, 2, 0], [0, 0, 0, 1], [1, 1, 1]], 'the arm sits 2 above its parent');
  assert.deepEqual(json.nodes[0].children, [1]);
  assert.deepEqual(json.skins![0].joints, [0, 1]);
  assert.deepEqual(values(json.skins![0].inverseBindMatrices).slice(16), [...mesh.bones[1].invSkinPose]);

  // The same mesh with its material made: a texture turned a quarter, on the second UV channel.
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
  const turned = { png, name: 'jam.tex', texCoord: 1, uvTransform: [0, 2, 0.5, -2, 0, 0.25] as const, wrapS: 1, wrapT: 2 };
  const made = new Map([['g7', {
    name: 'jam', doubleSided: true, alphaCutoff: 0.5, baseColorFactor: [1, 0, 0, 1] as const,
    baseColorTexture: turned, normalTexture: { ...turned, uvTransform: [1, 0, 0, 0, 1, 0] as const, wrapT: 1 },
    occlusionTexture: { ...turned, uvTransform: [1, 0, 0, 0, 1, 0] as const, wrapT: 1 }, specularColor: [0.5, 0.25, -1] as const,
  }]]);
  const textured = readGlb(meshToGlb(mesh, { materials: made }));
  const jam = textured.json.materials![0];
  assert.deepEqual([jam.name, jam.doubleSided, jam.alphaMode, jam.alphaCutoff], ['jam', true, 'MASK', 0.5]);
  assert.deepEqual(jam.pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1]);
  const base = jam.pbrMetallicRoughness.baseColorTexture!;
  assert.equal(base.texCoord, 1);
  const { offset, rotation, scale } = base.extensions!.KHR_texture_transform;
  assert.deepEqual(offset, [0.5, 0.25]);
  assert.ok(Math.abs(rotation! - Math.PI / 2) < 1e-9 && Math.abs(scale[0] - 2) < 1e-9 && Math.abs(scale[1] - 2) < 1e-9, JSON.stringify({ rotation, scale }));
  assert.ok(textured.json.extensionsUsed!.includes('KHR_texture_transform'));
  assert.equal(textured.json.images!.length, 1, 'one image, sampled twice');
  assert.deepEqual(textured.json.samplers, [{ wrapS: 10497, wrapT: 33648 }, { wrapS: 10497, wrapT: 10497 }]);
  assert.equal(textured.json.textures!.length, 2);
  const bytes = textured.json.bufferViews[textured.json.images![0].bufferView];
  assert.equal(bytes.byteLength, png.length);
  assert.equal(jam.occlusionTexture!.index, jam.normalTexture!.index, 'one image, one sampler: one texture');
  assert.deepEqual(jam.extensions!.KHR_materials_specular!.specularColorFactor, [0.5, 0.25, 0], 'no negative specular');
  assert.ok(textured.json.extensionsUsed!.includes('KHR_materials_specular'));
});

test("sack_boy.mol comes back out of its .glb whole", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const game = await openGame({
    fileDB: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.map'))),
    remap: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.remap'))),
    farcs: accesses.map((access, i) => ({ name: FARCS[i], access })),
    loose: looseFiles(GAME),
  });
  const mesh = await readMesh((await game.resolve({ kind: 'guid', guid: 453737, type: 2 }))!, nodeInflate);
  const name = (ref: { guid: number }) => game.row(ref.guid)?.path.split('/').pop();
  const materials = await gltfMaterials(mesh, { resolve: (d) => game.resolve(d), inflate: nodeInflate, deflate: nodeDeflate, name });
  const glb = meshToGlb(mesh, { materials, materialName: name });
  const { json, values } = readGlb(glb);
  // Every material reads, and each texture is a PNG in the buffer.
  assert.equal(materials.size, new Set(mesh.primitives.flatMap((p) => (p.material ? [p.material.guid] : []))).size);
  assert.ok(json.materials!.some((m) => m.pbrMetallicRoughness.baseColorTexture !== undefined));
  const bin = 20 + new DataView(glb.buffer).getUint32(12, true) + 8;
  for (const image of json.images!) {
    const at = bin + json.bufferViews[image.bufferView].byteOffset;
    assert.deepEqual([...glb.subarray(at + 1, at + 4)], [0x50, 0x4e, 0x47], image.name);
  }
  const primitives = json.meshes.flatMap((m) => m.primitives);
  assert.equal(primitives.length, mesh.primitives.filter((p) => p.triangles.length > 0).length);
  assert.deepEqual(values(primitives[0].attributes.POSITION).length, mesh.vertexCount * 3);
  assert.equal(json.skins![0].joints.length, mesh.bones.length);
  // The tangent lies across the normal.
  const across = Array.from({ length: mesh.vertexCount }, (_, v) => Math.abs(mesh.normals[v * 3] * mesh.tangents[v * 3] + mesh.normals[v * 3 + 1] * mesh.tangents[v * 3 + 1] + mesh.normals[v * 3 + 2] * mesh.tangents[v * 3 + 2]) < 0.1);
  assert.ok(across.filter(Boolean).length > 0.95 * mesh.vertexCount, `${across.filter(Boolean).length} of ${mesh.vertexCount}`);
  assert.ok(values(primitives[0].attributes.TANGENT).every((x, i) => i % 4 !== 3 || x === 1 || x === -1));
  assert.equal(primitives[0].targets!.length, 29);
  assert.ok(json.materials!.every((m) => m.name.endsWith('.gmat')), JSON.stringify(json.materials));
  for (const a of accesses) await a.close();
});

test("wall_light.mol's scrolling texture becomes an animation of its texture transform", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const game = await openGame({
    fileDB: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.map'))),
    remap: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.remap'))),
    farcs: accesses.map((access, i) => ({ name: FARCS[i], access })),
    loose: looseFiles(GAME),
  });
  const mesh = await readMesh((await game.resolve({ kind: 'guid', guid: 278140, type: 2 }))!, nodeInflate);
  const materials = await gltfMaterials(mesh, { resolve: (d) => game.resolve(d), inflate: nodeInflate, deflate: nodeDeflate });
  const animated = [...materials.values()].flatMap((m) => [m.baseColorTexture, m.normalTexture, m.occlusionTexture]).find((x) => x?.uvKeys);
  assert.ok(animated?.uvKeys, 'a sample with keys');
  const { json, values } = readGlb(meshToGlb(mesh, { materials }));
  const raw = json as unknown as {
    animations: { channels: { sampler: number; target: { path: string; extensions: { KHR_animation_pointer: { pointer: string } } } }[]; samplers: { input: number; output: number }[] }[];
  };
  assert.ok(json.extensionsUsed!.includes('KHR_animation_pointer'));
  const [animation] = raw.animations;
  const channel = animation!.channels[0]!;
  assert.equal(channel.target.path, 'pointer');
  const pointer = channel.target.extensions.KHR_animation_pointer.pointer;
  assert.match(pointer, /^\/materials\/\d+\/.*\/extensions\/KHR_texture_transform\/(offset|scale)$/);
  // The property the pointer names is in the document, and the keys are the box's, at 30 a second.
  const property = pointer.split('/').slice(1).reduce((at: any, key) => at?.[/^\d+$/.test(key) ? Number(key) : key], json);
  assert.ok(Array.isArray(property), pointer);
  const sampler = animation!.samplers[channel.sampler]!;
  const times = values(sampler.input);
  assert.equal(times.length, animated.uvKeys.length);
  assert.ok(Math.abs(times[1]! - 1 / 30) < 1e-6);
  const at = pointer.endsWith('offset') ? 2 : 0;
  assert.deepEqual(values(sampler.output).slice(0, 2), [...animated.uvKeys[0]!.slice(at, at + 2)].map(Math.fround));
  for (const a of accesses) await a.close();
});
