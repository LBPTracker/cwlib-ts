import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { lamsKeyId, patchTranslationTable, readTranslationTable, translate, writeTranslationTable } from '../src/resources/translation.ts';
import { readPlan } from '../src/things/level.ts';

/**
 * `RTranslationTable` and the LAMS key; the game's tables skip without
 * `LBP_GAME`. steering/level-files.md, *Translation tables*.
 */
const GAME = process.env.LBP_GAME ?? '';
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('lamsKeyId hashes a tag as the game keys its text', () => {
  // Keys the game's English table holds: a speech bubble's tag, a quest's, and
  // one of 33 characters, which takes the hash's second half.
  assert.equal(lamsKeyId('NP_TU01B_130_NEWTON'), 0x9dbefe3c);
  assert.equal(lamsKeyId('ZIGGURAT_QUEST_TITLE_30'), 0xf3528789);
  assert.equal(lamsKeyId('TWEAK_MEMORISER_CHANGE_LABEL_NAME'), 0x2c3140c0);
});

test('a translation table with no keys is empty', () => {
  assert.equal(readTranslationTable(new Uint8Array(4)).size, 0);
  assert.throws(() => readTranslationTable(new Uint8Array([0xfe, 0xff, 0, 0x41])), /text translation table/);
});

test('a table is written back with its texts shared, and a patch replaces and adds', () => {
  const table = new Map([[0xffffffff, 'Jam'], [2, 'Jar'], [1, 'Jam']]);
  const bytes = writeTranslationTable(table);
  // Three keys, two texts: BOM + 3 characters each.
  assert.equal(bytes.length, 4 + 3 * 8 + 2 * 8);
  assert.deepEqual(readTranslationTable(bytes), new Map([[1, 'Jam'], [2, 'Jar'], [0xffffffff, 'Jam']]));
  const patched = patchTranslationTable(table, new Map([[2, 'Pot'], [3, 'Lid']]));
  assert.deepEqual([patched.get(1), patched.get(2), patched.get(3)], ['Jam', 'Pot', 'Lid']);
});

test('every one of the game\'s tables reads, and English names a plan, a quest and a bubble', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const rows = [...db.values()].filter((r) => r.path.endsWith('.trans'));
  const plan = [...db.values()].find((r) => r.path === 'gamedata/lbp3/__prologue/palettes/obj_jam_jar.plan')!;
  const bytes = new Map<string, Uint8Array>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const row of [...rows, plan]) {
      if (!bytes.has(row.sha1) && farc.entries.has(row.sha1)) bytes.set(row.sha1, (await farc.get(row.sha1))!);
    }
    await access.close();
  }
  let full = 0;
  for (const row of rows) {
    const table = readTranslationTable(bytes.get(row.sha1)!);
    assert.deepEqual(writeTranslationTable(table), bytes.get(row.sha1), `${row.path} is written back as it is`);
    if (table.size > 0) full += 1;
    else assert.match(row.path, /\/patch\//, `${row.path} is empty`);
  }
  assert.equal(rows.length, 46);
  assert.equal(full, 24);

  const english = readTranslationTable(bytes.get(rows.find((r) => r.path === 'gamedata/languages/english.trans')!.sha1)!);
  assert.equal(english.size, 42508);
  assert.equal(translate(english, 'ZIGGURAT_QUEST_TITLE_30'), 'Boat Race');
  assert.equal(translate(english, 'TWEAK_MEMORISER_CHANGE_LABEL_NAME'), 'Change Label Name');
  const { inventory } = await readPlan(bytes.get(plan.sha1)!, nodeInflate);
  assert.equal(translate(english, inventory!.details.titleKey), 'Open Jar of Jam');
  // `CATEGORY_KEY` in write-plan.ts, the category the writer files a sequencer under.
  assert.equal(translate(english, 3423480070), 'My Objects');
});
