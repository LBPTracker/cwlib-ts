/**
 * Resources added to an install (`src/archives/install.ts`), on the game's own
 * `intro_001.farc` and `output/orbisguids.map` (`LBP_GAME`), which nothing
 * commits: these skip without them, and the FileDB half also runs on a table
 * built here.
 */

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc, type RandomAccess } from '../src/archives/farc.ts';
import { fileDBRevision, readFileDB } from '../src/archives/filedb.ts';
import {
  addFileDBRow, appendToFarc, buildFileDB, installResources, nextGuid, patchFileDB, planList, removeFileDBRow,
} from '../src/archives/install.ts';
import { MIN_SAFE_GUID } from '../src/archives/mod.ts';
import { openFileAccess } from '../src/platform/node.ts';

const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';

/** The archive as it would be on disk after the append: its first `offset` bytes, then the tail. */
function appended(source: RandomAccess, offset: number, tail: Uint8Array): RandomAccess {
  return {
    size: offset + tail.length,
    async read(at, length) {
      const out = new Uint8Array(length);
      if (at < offset) out.set(await source.read(at, Math.min(length, offset - at)), 0);
      const from = Math.max(at, offset);
      if (from < at + length) out.set(tail.subarray(from - offset, at + length - offset), from - at);
      return out;
    },
  };
}

test('a FARC appended to keeps every row where it was, and adds each new resource once', async (t) => {
  const file = path.join(GAME, 'intro_001.farc');
  if (!GAME || !existsSync(file)) return t.skip(NO_GAME);
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    // Nothing added: the tail is the table as the game wrote it.
    const none = await appendToFarc(farc, []);
    assert.equal(none.offset + none.tail.length, access.size);
    assert.deepEqual(none.tail, await access.read(none.offset, access.size - none.offset));

    const resource = new TextEncoder().encode('PLNb a resource the archive does not hold');
    const known = (await farc.get([...farc.entries.keys()][0]!))!;
    const { offset, tail, added } = await appendToFarc(farc, [resource, known, resource]);
    assert.equal(added.length, 1, 'held already, or twice: added once');
    const after = await openFarc(appended(access, offset, tail));
    assert.equal(after.entries.size, farc.entries.size + 1);
    for (const [sha1, row] of farc.entries) assert.deepEqual(after.entries.get(sha1), row);
    assert.deepEqual(await after.get(added[0]!.sha1), resource);
    assert.equal(after.tableOffset, offset + resource.length);
  } finally {
    await access.close();
  }
});

test("the game's FileDB built again is its own bytes, and takes a row, a patch and a removal", async (t) => {
  const file = path.join(GAME, 'output', 'orbisguids.map');
  if (!GAME || !existsSync(file)) return t.skip(NO_GAME);
  const bytes = new Uint8Array(await readFile(file));
  const db = { revision: fileDBRevision(bytes), rows: readFileDB(bytes) };
  assert.deepEqual(buildFileDB(db), bytes, 'its rows are in GUID order already');

  const guid = nextGuid(db);
  assert.ok(guid >= MIN_SAFE_GUID && !db.rows.has(guid));
  const row = await addFileDBRow(db, 'gamedata/test/edited.bin', Uint8Array.of(1, 2, 3), { when: new Date(1e12) });
  assert.equal(row.guid, guid);
  await assert.rejects(addFileDBRow(db, 'gamedata/test/again.bin', Uint8Array.of(4), { guid }), /already exists/);
  patchFileDB(db, [{ ...row, path: 'gamedata/test/moved.bin' }]);
  const back = readFileDB(buildFileDB(db));
  assert.equal(back.get(guid)?.path, 'gamedata/test/moved.bin');
  assert.equal(back.get(guid)?.size, 3);
  assert.equal(back.size, db.rows.size);
  assert.ok(removeFileDBRow(db, guid));
  assert.deepEqual(buildFileDB(db), bytes, 'and gone again');
  assert.ok(planList(db).split('\n').every((line) => line === '' || line.endsWith('.plan')));
});

test('installResources gives a new item the next GUID and an existing one its new bytes', async () => {
  const rows = new Map([[MIN_SAFE_GUID, { path: 'a.plan', date: 0, size: 1, sha1: '00'.repeat(20), guid: MIN_SAFE_GUID }]]);
  const db = { revision: 0x01480100, rows };
  const empty = { entries: new Map(), tableOffset: 0, get: async () => undefined };
  const fresh = Uint8Array.of(9, 9);
  const replaced = Uint8Array.of(7);
  const { fileDB, farc, rows: made } = await installResources(db, empty, [
    { path: 'b.plan', bytes: fresh },
    { path: 'a.plan', bytes: replaced, guid: MIN_SAFE_GUID },
  ], new Date(0));
  assert.deepEqual(made.map((r) => r.guid), [MIN_SAFE_GUID + 1, MIN_SAFE_GUID]);
  const back = readFileDB(fileDB);
  assert.equal(back.get(MIN_SAFE_GUID)?.size, 1);
  assert.equal(back.get(MIN_SAFE_GUID + 1)?.path, 'b.plan');
  assert.equal(farc.added.length, 2);
  assert.equal(farc.tail.length, 3 + 2 * 28 + 8);
});
