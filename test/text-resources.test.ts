import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { openFileAccess } from '../src/platform/node.ts';
import { readDlc } from '../src/resources/dlc.ts';
import { readGuidSubst } from '../src/resources/guid-subst.ts';

/**
 * The game's text-serialised `GSBt` and `DLCt`; the corpus tests skip without
 * `LBP_GAME`. steering/level-files.md, *Text resources*.
 */
const GAME = process.env.LBP_GAME ?? '';
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

test('a text resource takes any whitespace, names in any case, and # comments', () => {
  const subst = readGuidSubst(text('GSBt\r\nSubstitutions\t2\r\n\t[0]\r\n\t\tFrom.guid 42946 # photo tool\r\n'
    + '\t\tTo.guid 68525\t\t# delete\r\n\t[1]\t\r\n\t\tfrom.GUID\t1\t\r\n\t\tTo.guid\t2\r\n'));
  assert.deepEqual(subst, [{ from: 42946, to: 68525 }, { from: 1, to: 2 }]);
  assert.throws(() => readGuidSubst(text('GSBt\nSubstitutions\t1\n\t[0]\n\t\tFrom.guid\t1\n')), /ends where "To.guid"/);
  assert.throws(() => readGuidSubst(text('GSBt\nSubstitutions\t0\nExtra\t1\n')), /left unread/);
  assert.deepEqual(readDlc(text('DLCt\nGUIDS\t0\nFiles\t0\n')), { guids: [], files: [] });
});

test('every GSBt and DLCt in the FARCs reads to its last line', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const rows = [...db.values()].filter((r) => /\.(gsub|dlc)$/.test(r.path));
  const bytes = new Map<string, Uint8Array>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const row of rows) if (!bytes.has(row.path) && farc.entries.has(row.sha1)) bytes.set(row.path, (await farc.get(row.sha1))!);
    await access.close();
  }
  // Every path the FileDB lists, 85; three share their bytes with another.
  assert.equal(bytes.size, 85);
  let substitutions = 0;
  let files = 0;
  for (const [file, data] of bytes) {
    if (file.endsWith('.gsub')) substitutions += readGuidSubst(data).length;
    else files += readDlc(data).files.length;
  }
  assert.deepEqual([substitutions, files], [34985, 526]);

  const byGuid = new Map([...db.values()].map((r) => [r.guid, r.path]));
  const italian = readGuidSubst(bytes.get('gamedata/audio/dialogue_italian.gsub')!);
  assert.equal(italian.length, 1903);
  assert.equal(byGuid.get(italian[0].to), 'gamedata/audio/dialogue/italian/davinci/theme1_intro_110_davinci.mp3');
  // The file with comments, and one with `flags` for `Flags`.
  assert.deepEqual(readGuidSubst(bytes.get('gamedata/data/inventory_auto_pickup.gsub')!)[0], { from: 42946, to: 68525 });
  const downloadables = readDlc(bytes.get('gamedata/data/downloadables.dlc')!);
  assert.deepEqual([downloadables.guids.length, downloadables.files.length], [2342, 172]);
  assert.deepEqual(
    [downloadables.files[0].directory, downloadables.files[0].file, downloadables.files[0].guids.length],
    ['DEMO', 'seph.edat', 4],
  );
});
