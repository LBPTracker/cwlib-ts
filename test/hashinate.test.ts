/**
 * Dependencies rewritten in place, and `hashinate` (`src/archives/hashinate.ts`)
 * on lbptracker's `ascetic.lvl` (`LBP_FIXTURES`) against the installed game
 * (`LBP_GAME`), which nothing commits: both halves skip without them. Every
 * type of the game's FARCs is `dev/rehash-census.ts`.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openGame } from '../src/archives/game.ts';
import { editResource, hashinate, replaceDependency } from '../src/archives/hashinate.ts';
import { toHex } from '../src/io/hex.ts';
import { readDependencies } from '../src/io/resource.ts';
import { readLevel } from '../src/things/level.ts';
import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import { readStaticMesh } from '../src/resources/staticmesh.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';

const LEVEL = path.join(
  process.env.LBP_FIXTURES ?? fileURLToPath(new URL('../../lbptracker/fixtures', import.meta.url)),
  'levels', 'ascetic.lvl',
);
const GAME = process.env.LBP_GAME ?? '';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];
/** The types whose payload form is a bare GUID, and scripts, which hashinate leaves. */
const LEFT = new Set([10, 11, 13, 40, 49]);

test("a level's GUID dependency replaced by a hash is named so, in its table and its Things", async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no level at ${LEVEL}`);
  const bytes = new Uint8Array(readFileSync(LEVEL));
  const edit = await editResource(bytes, nodeInflate);
  assert.ok(!('refused' in edit), 'refused' in edit ? edit.refused : '');
  const row = readDependencies(bytes).find((d) => d.kind === 'guid' && !LEFT.has(d.type));
  assert.ok(row && row.kind === 'guid');
  const hash = new Uint8Array(20).fill(0x5a);
  assert.ok(replaceDependency(edit, { guid: row.guid }, { hash }) > 1, 'a descriptor and the row');
  const written = await edit.write(nodeDeflate);
  const rows = readDependencies(written);
  assert.ok(rows.some((d) => d.kind === 'sha1' && d.sha1 === toHex(hash)));
  assert.ok(!rows.some((d) => d.kind === 'guid' && d.guid === row.guid));
  const again = await readLevel(written, nodeInflate);
  assert.equal(again.unreadTail, undefined);
  assert.equal(again.things.length, (await readLevel(bytes, nodeInflate)).things.length);
});

test("a backdrop's material, in the header before its chunks, is renamed and the mesh still reads", async (t) => {
  if (!GAME || !existsSync(path.join(GAME, FARCS[0]!))) return t.skip('LBP_GAME is not set');
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    try {
      const farc = await openFarc(access);
      for (const entry of farc.entries.values()) {
        if (entry.size < 0x16 || magicOf(await access.read(entry.offset, 4)) !== 'SMHb') continue;
        const bytes = (await farc.get(entry.sha1))!;
        const edit = await editResource(bytes, nodeInflate);
        assert.ok(!('refused' in edit), 'refused' in edit ? edit.refused : '');
        assert.deepEqual(await edit.write(nodeDeflate), bytes, 'unedited, the file is its own bytes');
        const mesh = await readStaticMesh(bytes, nodeInflate);
        const guid = mesh.primitives[0]!.material!.guid;
        const hash = new Uint8Array(20).fill(0x33);
        replaceDependency(edit, { guid }, { hash });
        const again = await readStaticMesh(await edit.write(nodeDeflate), nodeInflate);
        assert.deepEqual(again.primitives[0]!.material?.hash, hash);
        assert.deepEqual(again.positions, mesh.positions);
        return;
      }
    } finally {
      await access.close();
    }
  }
  assert.fail('no static mesh in the FARCs');
});

test('ascetic.lvl hashinated against the game names nothing by GUID it could name by hash', async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no level at ${LEVEL}`);
  if (!GAME || !existsSync(path.join(GAME, FARCS[0]!))) return t.skip('LBP_GAME is not set');
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  try {
    const game = await openGame({
      fileDB: new Uint8Array(readFileSync(path.join(GAME, 'output', 'orbisguids.map'))),
      remap: new Uint8Array(readFileSync(path.join(GAME, 'output', 'orbisguids.remap'))),
      farcs: accesses.map((access, i) => ({ name: FARCS[i]!, access })),
    });
    const { resources, missing } = await hashinate(new Uint8Array(readFileSync(LEVEL)), (d) => game.resolve(d), nodeInflate, nodeDeflate);
    const bySha1 = new Map(resources.map((r) => [r.sha1, r]));
    const unresolved = new Set(missing.map((d) => (d.kind === 'guid' ? `g${d.guid}` : `h${d.sha1}`)));
    for (const resource of resources) {
      assert.equal(toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', resource.bytes as BufferSource))), resource.sha1);
      if (resource.kept !== undefined || resource.bytes[3] !== 0x62) continue;
      // A GUID the payload holds bare cannot become a hash, and keeps its row.
      const edit = await editResource(resource.bytes, nodeInflate);
      const bare = new Set('refused' in edit ? [] : [edit, ...edit.parts].flatMap((e) =>
        e.marks.filter((m) => m.label === 'guid').map((m) => (m.value as { guid: number }).guid)));
      for (const row of readDependencies(resource.bytes)) {
        if (LEFT.has(row.type)) continue;
        if (row.kind === 'guid') {
          assert.ok(unresolved.has(`g${row.guid}`) || bare.has(row.guid), `GUID ${row.guid} left in a resource that was rewritten`);
        } else assert.ok(bySha1.has(row.sha1) || unresolved.has(`h${row.sha1}`), `hash ${row.sha1} names nothing in the set`);
      }
    }
    const root = resources.at(-1)!;
    assert.equal(root.type, undefined);
    assert.equal((await readLevel(root.bytes, nodeInflate)).unreadTail, undefined);
  } finally {
    for (const access of accesses) await access.close();
  }
});
