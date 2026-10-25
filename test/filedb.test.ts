import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { fileDBRevision, readFileDB, writeFileDB } from '../src/archives/filedb.ts';

/**
 * The FileDB written and read back; the game's own skips without `LBP_GAME`.
 * steering/level-files.md, *The FileDB*.
 */
const GAME = process.env.LBP_GAME ?? '';
const MAP = path.join(GAME, 'output', 'orbisguids.map');

test('a FileDB row survives the round trip, in either layout', () => {
  const rows = [
    { path: 'gamedata/a.tex', date: 1700000000, size: 12, sha1: '00'.repeat(19) + 'ff', guid: 7 },
    { path: 'gamedata/b.plan', date: 0, size: 0, sha1: '12'.repeat(20), guid: 3 },
  ];
  for (const revision of [0x1480100, 0x01000000]) {
    const back = [...readFileDB(writeFileDB({ revision, rows })).values()];
    assert.deepEqual(back, rows, `revision 0x${revision.toString(16)}`);
  }
  assert.throws(() => writeFileDB({ revision: 0x1480100, rows: [{ ...rows[0], sha1: 'nope' }] }), /40 hex digits/);
});

test("the game's orbisguids.map comes back byte for byte", async (t) => {
  if (GAME === '' || !existsSync(MAP)) return t.skip(GAME ? `no ${MAP}` : 'LBP_GAME is not set');
  const bytes = new Uint8Array(await readFile(MAP));
  const rows = [...readFileDB(bytes).values()];
  assert.equal(rows.length, 107673);
  const written = writeFileDB({ revision: fileDBRevision(bytes), rows });
  assert.equal(written.length, bytes.length);
  assert.ok(written.every((b, i) => b === bytes[i]), 'identical');
});
