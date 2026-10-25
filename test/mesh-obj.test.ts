import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openGame } from '../src/archives/game.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readMesh, type Mesh } from '../src/resources/mesh.ts';
import { meshClusterToObj, meshSpringsToObj, meshToObj } from '../src/resources/mesh-obj.ts';

/** An `RMesh` written as OBJ and read back here; the game's skips without `LBP_GAME`. */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

/** Each kind of line, its numbers. */
function readObj(text: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const [kind, ...rest] = line.split(' ');
    out.set(kind, [...(out.get(kind) ?? []), rest]);
  }
  return out;
}

test('a mesh comes back out of its OBJ: positions, UVs turned over, 1-based faces', () => {
  const mesh = {
    vertexCount: 3,
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0.5),
    normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
    uvs: [Float32Array.of(0, 0, 1, 0, 0, 0.25)],
    primitives: [
      { material: { guid: 7 }, firstIndex: 0, numIndices: 3, triangles: Uint16Array.of(0, 1, 2) },
      { material: { guid: 8 }, firstIndex: 0, numIndices: 3, triangles: Uint16Array.of(0, 1, 2) },
    ],
  } as unknown as Mesh;
  const obj = readObj(meshToObj(mesh, { materialName: (ref) => `m${ref.guid}` }));
  assert.deepEqual(obj.get('v')![2], ['0', '1', '0.5']);
  assert.deepEqual(obj.get('vt')![2], ['0', '0.75']);
  assert.deepEqual(obj.get('f'), [['1/1/1', '2/2/2', '3/3/3']], 'the repeated run once');
  assert.deepEqual(obj.get('usemtl'), [['m7']]);

  // Springs: the vertices from minSpringVert, which the springs count from; clusters by index.
  const soft = {
    ...mesh, softbodyWeights: Float32Array.of(1, 0.5, 0), softbodyClusterIndices: Uint8Array.of(0, 1, 1),
    tail: { minSpringVert: 1, maxSpringVert: 2, softbodySprings: [{ a: 1, b: 0, restLengthSq: 1.25 }] },
  } as unknown as Mesh;
  const springs = readObj(meshSpringsToObj(soft));
  assert.deepEqual(springs.get('v')!.map((v) => v.slice(0, 3)), [['1', '0', '0'], ['0', '1', '0.5']]);
  assert.deepEqual(springs.get('l'), [['2', '1']]);
  assert.deepEqual(readObj(meshClusterToObj(soft, 1)).get('v')!.map((v) => v.slice(0, 3)), [['1', '0', '0'], ['0', '1', '0.5']]);
});

test("sack_boy.mol's OBJ holds every vertex and every triangle", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const game = await openGame({
    fileDB: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.map'))),
    farcs: accesses.map((access, i) => ({ name: FARCS[i], access })),
  });
  const mesh = await readMesh((await game.resolve({ kind: 'guid', guid: 453737, type: 2 }))!, nodeInflate);
  const obj = readObj(meshToObj(mesh));
  for (const kind of ['v', 'vn', 'vt']) assert.equal(obj.get(kind)!.length, mesh.vertexCount, kind);
  const runs = new Map(mesh.primitives.map((p) => [`${p.firstIndex}/${p.numIndices}`, p.triangles.length / 3]));
  assert.equal(obj.get('f')!.length, [...runs.values()].reduce((a, b) => a + b, 0));
  assert.ok(obj.get('f')!.flat().every((c) => { const i = Number(c.split('/')[0]); return i >= 1 && i <= mesh.vertexCount; }));
  assert.ok(obj.get('v')!.flat().every((x) => Number.isFinite(Number(x))));
  for (const a of accesses) await a.close();
});
