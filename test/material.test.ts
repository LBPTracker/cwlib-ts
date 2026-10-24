import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc, type Farc } from '../src/farc.ts';
import { readFileDB, readGuidRemap } from '../src/filedb.ts';
import { BOX_TEXTURE_SAMPLE, materialSummary, readMaterial, type GfxMaterial } from '../src/material.ts';
import { readMesh } from '../src/mesh.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

/**
 * The game's own files are Sony's and never committed. `LBP_GAME` is an
 * installed LBP3 PS4 build; without it these skip. `dev/material-census.ts` is
 * the same checks over all 11,011 materials and 5,941 meshes.
 */
const GAME = process.env.LBP_GAME ?? 'D:\\PS4Games\\CUSA00063';

/** The game's FileDB, 11 MB and 107,673 rows: read once for this file's tests, not once per test. */
let fileDB: Promise<ReturnType<typeof readFileDB>> | undefined;
const gameFileDB = () => (fileDB ??= readFile(path.join(GAME, 'output', 'orbisguids.map')).then(readFileDB));
/** `orbisguids.remap`, likewise. */
let guidRemap: Promise<ReturnType<typeof readGuidRemap>['remap']> | undefined;
const gameRemap = () => (guidRemap ??= readFile(path.join(GAME, 'output', 'orbisguids.remap')).then((b) => readGuidRemap(b).remap));

/* ------------------------------------------------------------- synthetic */

test('the GUID remap: pairs, then the paths, each row naming its pair', () => {
  const enc = new TextEncoder();
  const paths = ['gamedata/gmat/a.gmat', 'gamedata/b.tex'];
  const pairs: [number, number][] = [[3732, 347494], [341349, 387252]];
  const parts: number[] = [];
  const u32 = (n: number): void => void parts.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  u32(0x00ea03e7);
  u32(2);
  for (const [a, b] of pairs) {
    u32(a);
    u32(b);
  }
  u32(2);
  for (const [i, p] of paths.entries()) {
    u32(p.length);
    parts.push(...enc.encode(p));
    u32(pairs[i][1]);
  }
  const { revision, remap } = readGuidRemap(Uint8Array.from(parts));
  assert.equal(revision, 0x00ea03e7);
  assert.deepEqual(remap.get(3732), { guid: 347494, path: 'gamedata/gmat/a.gmat' });
  assert.equal(remap.get(341349)?.guid, 387252);
  assert.throws(() => readGuidRemap(Uint8Array.from([...parts, 0])));
});

/* ---------------------------------------------------------------- the game */

async function archive(file: string): Promise<{ farc: Farc; close(): Promise<void> } | undefined> {
  if (!existsSync(path.join(GAME, file))) return undefined;
  const access = await openFileAccess(path.join(GAME, file));
  return { farc: await openFarc(access), close: () => access.close() };
}

test("orbisguids.remap: 56,271 old GUIDs, none of them a FileDB row", async (t) => {
  if (!existsSync(path.join(GAME, 'output', 'orbisguids.remap'))) return t.skip(`no game under ${GAME}`);
  const db = await gameFileDB();
  const remap = await gameRemap();
  assert.equal(remap.size, 56271);
  assert.ok([...remap.keys()].every((old) => !db.has(old)));
  // badge_zip_entrance.mol's first primitive names 3732, which has no row.
  assert.deepEqual(remap.get(3732), { guid: 347494, path: 'gamedata/gmat/badge_zip_entrance_cloth.gmat' });
  assert.equal(db.get(347494)?.path, 'gamedata_orbis/gmat/badge_zip_entrance_cloth.gmat');
});

test("every material and mesh in intro_001.farc: each primitive's material reads, its UV channels exist", async (t) => {
  const open = await archive('intro_001.farc');
  if (!open || !existsSync(path.join(GAME, 'output', 'orbisguids.remap'))) return t.skip(`no game under ${GAME}`);
  const db = await gameFileDB();
  const remap = await gameRemap();
  try {
    const materials = new Map<string, GfxMaterial>();
    const meshes: Uint8Array[] = [];
    for (const entry of open.farc.entries.values()) {
      const bytes = (await open.farc.get(entry.sha1))!;
      const magic = new TextDecoder().decode(bytes.subarray(0, 4));
      // readMaterial throws unless the walk ends exactly on the payload's last byte.
      if (magic === 'GMTb') materials.set(entry.sha1, await readMaterial(bytes, nodeInflate));
      if (magic === 'MSHb') meshes.push(bytes);
    }
    assert.equal(materials.size, 176);
    let primitives = 0;
    let channels = 0;
    for (const bytes of meshes) {
      const mesh = await readMesh(bytes, nodeInflate);
      for (const p of mesh.primitives) {
        if (!p.material) continue;
        const row = db.get(p.material.guid) ?? db.get(remap.get(p.material.guid)?.guid ?? -1);
        const m = row && materials.get(row.sha1);
        if (!m) continue; // in another archive
        primitives += 1;
        for (const box of m.boxes) {
          if (box.type !== BOX_TEXTURE_SAMPLE) continue;
          assert.ok(box.params[4] < mesh.uvs.length, 'a sample reads a UV channel the mesh has');
          channels += 1;
        }
      }
    }
    assert.ok(primitives > 100 && channels > 100, `${primitives} primitives, ${channels} samples`);
  } finally {
    await open.close();
  }
});

test('badge_zip_entrance_cloth.gmat: the graph and its summary', async (t) => {
  const open = await archive('intro_001.farc');
  if (!open) return t.skip(`no game under ${GAME}`);
  const db = await gameFileDB();
  try {
    const m = await readMaterial((await open.farc.get(db.get(347494)!.sha1))!, nodeInflate);
    assert.equal(m.flags, 0x2709);
    assert.equal(m.boxes.length, 16);
    assert.equal(m.wires.length, 20);
    assert.deepEqual(m.textures.map((r) => r?.guid), [3324, 1671, 1672, undefined, undefined, undefined, undefined, undefined]);
    assert.equal(m.shaders.length, 10);
    assert.ok(m.wires.every((w) => w.swizzle === ''));
    const s = materialSummary(m);
    assert.equal(s.twoSided, true);
    // Diffuse is slot 0 times two samples of slot 1, at scale 0.5 and 2: a graph.
    assert.equal(s.diffuse?.shape, 'graph');
    assert.deepEqual([s.diffuse?.sample?.slot, s.diffuse?.sample?.uvChannel], [0, 0]);
    // -0 is stored as such; + 0 makes it 0.
    assert.deepEqual(s.diffuse?.sample?.uvTransform.map((x) => x + 0), [1, 0, 0, 0, 1, 0]);
    assert.equal(s.bump?.sample?.slot, 2);
    assert.deepEqual(s.bump?.sample?.uvTransform.map((x) => x + 0), [0.5, 0, 0, 0, 0.5, 0]);
  } finally {
    await open.close();
  }
});
