import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openGame } from '../src/archives/game.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readAnimation, type Animation } from '../src/resources/animation.ts';
import { animationToGlb } from '../src/resources/animation-gltf.ts';
import { readMesh } from '../src/resources/mesh.ts';

/** An `RAnimation` written as a glTF animation; the game's skips without `LBP_GAME`. */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

interface Json {
  nodes: { name?: string; translation?: number[]; rotation?: number[]; children?: number[] }[];
  animations: { channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
  accessors: { bufferView: number; count: number; type: string }[];
  bufferViews: { byteOffset: number }[];
}

function read(glb: Uint8Array): { json: Json; floats: (accessor: number) => number[] } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const length = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length))) as Json;
  const bin = 20 + length + 8;
  const per: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  const floats = (i: number): number[] => {
    const a = json.accessors[i];
    const at = bin + json.bufferViews[a.bufferView].byteOffset;
    return Array.from({ length: a.count * per[a.type] }, (_, k) => dv.getFloat32(at + k * 4, true));
  };
  return { json, floats };
}

test('an animation alone: its skeleton in the base pose, a channel per animated bone', () => {
  // Two bones, three frames at 10 fps; bone 1 turns and moves.
  const animation = {
    bones: [
      { animHash: 0xa, parent: -1, firstChild: 1, nextSibling: -1 },
      { animHash: 0xb, parent: 0, firstChild: -1, nextSibling: -1 },
    ],
    numFrames: 3, fps: 10, loopStart: 0, morphCount: 0,
    rotBonesAnimated: Uint8Array.of(1), posBonesAnimated: Uint8Array.of(1),
    scaleBonesAnimated: new Uint8Array(0), morphsAnimated: new Uint8Array(0),
    rotations: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0),
    positions: Float32Array.of(0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0),
    scales: Float32Array.of(1, 1, 1, 1, 1, 1),
    morphs: new Float32Array(0),
  } as unknown as Animation;
  const { json, floats } = read(animationToGlb(animation, { name: 'wave' }));
  assert.deepEqual(json.nodes[1].translation, [0, 1, 0]);
  assert.deepEqual(json.nodes[0].children, [1]);
  const [anim] = json.animations;
  assert.deepEqual(anim.channels.map((c) => [c.target.node, c.target.path]), [[1, 'rotation'], [1, 'translation']]);
  assert.deepEqual(floats(anim.samplers[0].input), [0, 0.1, 0.2].map(Math.fround));
  // Frame 0 the base pose, then the frames, each rotation made unit length.
  assert.deepEqual(floats(anim.samplers[0].output), [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0]);
  assert.deepEqual(floats(anim.samplers[1].output), [0, 1, 0, 0, 2, 0, 0, 3, 0]);
});

test("cs_emote_embarrassed_into_v1.anim on sack_boy.mol: its bones by animHash, its morphs on every mesh node", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const game = await openGame({
    fileDB: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.map'))),
    farcs: accesses.map((access, i) => ({ name: FARCS[i], access })),
  });
  const animation = await readAnimation((await game.resolve({ kind: 'guid', guid: 474219, type: 8 }))!, nodeInflate);
  const mesh = await readMesh((await game.resolve({ kind: 'guid', guid: 453737, type: 2 }))!, nodeInflate);
  const { json, floats } = read(animationToGlb(animation, { mesh }));
  const channels = json.animations[0].channels;
  const weights = channels.filter((c) => c.target.path === 'weights');
  assert.equal(weights.length, 17, 'one per region the mesh draws');
  assert.equal(json.accessors[json.animations[0].samplers[weights[0].sampler].output].count, animation.numFrames * 29);
  // Every bone channel lands on the mesh bone of the same animHash.
  for (const c of channels.filter((x) => x.target.path !== 'weights')) {
    assert.ok(c.target.node < mesh.bones.length, `node ${c.target.node}`);
    assert.ok(animation.bones.some((b) => b.animHash === mesh.bones[c.target.node].animHash));
  }
  assert.ok(floats(json.animations[0].samplers[0].input).every((s, f) => Math.abs(s - f / animation.fps) < 1e-6));
  for (const a of accesses) await a.close();
});
