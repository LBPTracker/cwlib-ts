import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc, type Farc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { readThings } from '../src/things/level.ts';
import { PRIMITIVE_TRIANGLE_STRIP, readMesh, type Mesh } from '../src/resources/mesh.ts';
import type { RenderMeshPart } from '../src/things/parts.ts';
import { loadResource } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

/**
 * The game's own files are Sony's and never committed -- see lbptracker's
 * `steering/game-assets.md`. `LBP_GAME` is an installed LBP3 PS4 build; without
 * it the mesh tests skip. `dev/mesh-census.ts` is the same checks over all
 * 5,941 meshes in its four FARCs; this is the 54 in the smallest.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FIXTURES = process.env.LBP_FIXTURES ?? path.join(import.meta.dirname, '..', '..', 'lbptracker', 'fixtures');
/** The game's FileDB, 11 MB and 107,673 rows: read once for this file's tests, not once per test. */
let fileDB: Promise<ReturnType<typeof readFileDB>> | undefined;
const gameFileDB = () => (fileDB ??= readFile(path.join(GAME, 'output', 'orbisguids.map')).then(readFileDB));
const ASCETIC = path.join(FIXTURES, 'levels', 'ascetic.lvl');

/** `badge_zip_entrance.mol`: 20 bones, three UV channels, five primitives. */
const BADGE_ZIP_ENTRANCE = 3729;

/* ------------------------------------------------------------- synthetic */

test('an LBP1-era header has no branch and no flags, and a chunk can be stored', async () => {
  // ⚠️ Head 0x239: the compressed bool straight after the dependency offset. And
  // a chunk whose two sizes are equal is the bytes themselves, not zlib.
  const payload = Uint8Array.of(1, 2, 3, 4, 5);
  const out = new Uint8Array(0xd + 4 + 4 + payload.length + 4);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('MSHb'), 0);
  view.setUint32(4, 0x239, false);
  view.setUint32(8, out.length - 4, false);
  out[0xc] = 1; // isCompressed
  view.setUint16(0xd, 1, false);
  view.setUint16(0xf, 1, false); // one chunk
  view.setUint16(0x11, payload.length, false);
  view.setUint16(0x13, payload.length, false);
  out.set(payload, 0x15);
  const resource = await loadResource(out, () => {
    throw new Error('a stored chunk is not inflated');
  });
  assert.equal(resource.revision.version, 0x239);
  assert.equal(resource.compressionFlags, 0);
  assert.deepEqual([...resource.data], [...payload]);
});

/* ---------------------------------------------------------------- the game */

async function meshes(file: string): Promise<{ farc: Farc; close(): Promise<void> } | undefined> {
  if (!inGame(file)) return undefined;
  const access = await openFileAccess(path.join(GAME, file));
  return { farc: await openFarc(access), close: () => access.close() };
}

function counterClockwise(m: Mesh): [number, number] {
  const P = m.positions;
  const N = m.normals;
  let ccw = 0;
  let cw = 0;
  for (const p of m.primitives) {
    for (let i = 0; i < p.triangles.length; i += 3) {
      const [a, b, c] = [p.triangles[i] * 3, p.triangles[i + 1] * 3, p.triangles[i + 2] * 3];
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      let d = 0;
      for (const x of [a, b, c]) d += g[0] * N[x] + g[1] * N[x + 1] + g[2] * N[x + 2];
      if (d > 0) ccw += 1;
      else if (d < 0) cw += 1;
    }
  }
  return [ccw, cw];
}

test("every mesh in intro_001.farc reads to its last byte, and draws the right way out", async (t) => {
  const open = await meshes('intro_001.farc');
  if (!open) return t.skip(NO_GAME);
  try {
    let count = 0;
    let ccw = 0;
    let cw = 0;
    for (const entry of open.farc.entries.values()) {
      const bytes = (await open.farc.get(entry.sha1))!;
      if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'MSHb') continue;
      // readMesh throws unless the walk ends exactly on the payload's last byte.
      const m = await readMesh(bytes, nodeInflate);
      count += 1;
      const [a, b] = counterClockwise(m);
      ccw += a;
      cw += b;
      for (let v = 0; v < m.vertexCount; v += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) {
          sum += m.weights[v * 4 + k];
          if (m.weights[v * 4 + k] > 0) assert.ok(m.joints[v * 4 + k] < m.bones.length, 'joints are 0-based');
        }
        assert.ok(Math.abs(sum - 1) < 1e-5);
      }
      for (const p of m.primitives) assert.ok(p.triangles.every((i) => i < m.vertexCount));
      for (const [i, bone] of m.bones.entries()) assert.ok(bone.parent < i);
    }
    assert.equal(count, 54);
    // The strip parity and the normal unpacking, checked against each other.
    assert.ok(ccw / (ccw + cw) > 0.99, `${ccw} counter-clockwise, ${cw} clockwise`);
  } finally {
    await open.close();
  }
});

test('badge_zip_entrance.mol: the bones, the channels and the materials', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = await gameFileDB();
  const row = db.get(BADGE_ZIP_ENTRANCE)!;
  assert.equal(row.path, 'gamedata/mesh_library/common_objects/badge_zip_entrance/badge_zip_entrance.mol');
  const open = (await meshes('intro_001.farc'))!;
  try {
    const m = await readMesh((await open.farc.get(row.sha1))!, nodeInflate);
    assert.equal(m.vertexCount, 1720);
    assert.equal(m.primitiveType, PRIMITIVE_TRIANGLE_STRIP);
    assert.equal(m.uvs.length, 3);
    assert.equal(m.positions.length, 1720 * 3);
    assert.equal(m.primitives.length, 5);
    assert.equal(m.primitives.reduce((sum, p) => sum + p.triangles.length / 3, 0), 1078);
    assert.equal(m.primitives[0].material?.guid, 3732);
    assert.equal(m.bones.length, 20);
    assert.equal(m.bones[0].name, 'badge_zip_entrance_dummy');
    assert.equal(m.bones[0].parent, -1);
    // Column-major, like PPos: the inverse bind pose undoes the bind pose.
    const [A, B] = [m.bones[5].skinPose, m.bones[5].invSkinPose];
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        let x = 0;
        for (let k = 0; k < 4; k += 1) x += A[k * 4 + r] * B[c * 4 + k];
        assert.ok(Math.abs(x - (r === c ? 1 : 0)) < 1e-3);
      }
    }
  } finally {
    await open.close();
  }
});

test("ascetic.lvl's render meshes name their mesh and the Things that pose it", async (t) => {
  if (!existsSync(ASCETIC)) return t.skip(`no ${ASCETIC}`);
  const parse = await readThings(new Uint8Array(await readFile(ASCETIC)), nodeInflate);
  const parts = parse.things.flatMap((thing) => {
    const part = thing?.parts.get('RENDER_MESH') as RenderMeshPart | undefined;
    return part ? [{ thing: thing!, part }] : [];
  });
  assert.equal(parts.length, 104);
  let nulls = 0;
  for (const { thing, part } of parts) {
    assert.ok(part.mesh?.guid, 'every one names a game mesh by GUID');
    // The first bone Thing is the Thing itself, each is posed by its POS, and
    // ⚠️ the nulls -- 138 of 257 entries here -- only ever trail.
    assert.equal(part.boneThings[0], thing);
    const real = part.boneThings.findIndex((bone) => !bone);
    const present = real < 0 ? part.boneThings : part.boneThings.slice(0, real);
    assert.ok(present.every((bone) => bone!.parts.get('POS') instanceof Float32Array));
    assert.ok(part.boneThings.slice(present.length).every((bone) => !bone));
    nulls += part.boneThings.length - present.length;
    assert.equal(part.visibilityFlags & ~3, 0);
  }
  assert.equal(nulls, 138);

  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = await gameFileDB();
  const archives = await Promise.all(
    ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'].map((f) => meshes(f)),
  );
  try {
    const bones = new Map<number, number>();
    let equal = 0;
    let longer = 0;
    let unresolved = 0;
    for (const { part } of parts) {
      const guid = part.mesh!.guid;
      if (!bones.has(guid)) {
        const row = db.get(guid);
        for (const open of archives) {
          const bytes = row && (await open!.farc.get(row.sha1));
          if (bytes) {
            bones.set(guid, (await readMesh(bytes, nodeInflate)).bones.length);
            break;
          }
        }
      }
      const count = bones.get(guid);
      if (count === undefined) unresolved += 1;
      else if (count === part.boneThings.length) equal += 1;
      // ⚠️ Not one per bone: the sequencer's one-bone chassis carries three.
      else if (part.boneThings.length > count) longer += 1;
    }
    assert.deepEqual([equal, longer, unresolved], [60, 21, 23]);
  } finally {
    for (const open of archives) await open?.close();
  }
});

test("sack_boy.mol's morph targets: each a vertex's offset and its normal", async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const row = (await gameFileDB()).get(453737)!;
  assert.equal(row.path, 'gamedata_orbis/mesh_library/player_character/sack_boy.mol');
  let bytes: Uint8Array | undefined;
  for (const file of ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc']) {
    const open = (await meshes(file))!;
    bytes ??= await open.farc.get(row.sha1);
    await open.close();
  }
  const m = await readMesh(bytes!, nodeInflate);
  assert.equal(m.morphs.length, m.morphNames.length);
  assert.equal(m.morphs.length, 29);
  for (const morph of m.morphs) {
    assert.equal(morph.offsets.length, m.vertexCount * 3);
    let moved = 0;
    for (let v = 0; v < m.vertexCount; v += 1) {
      const n = Math.hypot(morph.normals[v * 3], morph.normals[v * 3 + 1], morph.normals[v * 3 + 2]);
      assert.ok(Math.abs(n - 1) < 0.02, `${morph.name}: a normal of length ${n}`);
      if (morph.offsets[v * 3] || morph.offsets[v * 3 + 1] || morph.offsets[v * 3 + 2]) moved += 1;
    }
    // A morph moves some of the face, never the whole Sackboy.
    assert.ok(moved > 0 && moved < m.vertexCount, `${morph.name} moves ${moved}`);
  }
});
