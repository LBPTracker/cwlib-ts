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
import { readTextTree, textValue } from '../src/io/text-resource.ts';
import { magicOf } from '../src/io/resource.ts';

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

test('a struct field holds its own fields, and values read as what they are', () => {
  const tree = readTextTree(text('PBRt\nTexture\tbrush1.tex\n\tGUID\t3587\n\tHash\t\nForce\t0,1.5,-2\nOn\ttrue\n'));
  assert.deepEqual(tree.fields[0], { name: 'Texture', value: 'brush1.tex', fields: [{ name: 'GUID', value: '3587' }, { name: 'Hash', value: '' }] });
  assert.deepEqual([textValue(tree.fields[1].value), textValue(tree.fields[2].value), textValue('"A B"')], [[0, 1.5, -2], true, 'A B']);
  assert.throws(() => readTextTree(text('X\nList\t2\n\t[0]\n')), /says 2, 1 follow/);
  assert.throws(() => readTextTree(text('X\nA\t1\n\t\tB\t2\n')), /below no array/);
});

test('every text resource in the FARCs reads whole as a tree', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  let soft: ReturnType<typeof readTextTree> | undefined;
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1)) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 8));
      if (!/^[A-Z]{3}t$/.test(magic)) continue;
      const tree = readTextTree((await farc.get(entry.sha1))!);
      counts.set(magic, (counts.get(magic) ?? 0) + 1);
      if (magic === 'SSPt' && !soft) soft = tree;
    }
    await access.close();
  }
  assert.deepEqual(Object.fromEntries([...counts].sort()), {
    ABKt: 5, AMPt: 1, ASTt: 13, AUMt: 1, CHAt: 9, CONt: 1, DLCt: 8, GSBt: 74, LMTt: 1, MIXt: 1, MUSt: 225,
    PBRt: 8, POPt: 1, SASt: 6, SLTt: 1, SMPt: 1, SRGt: 1, SSFt: 1, SSPt: 63,
  });
  assert.equal(soft!.fields[0].name, 'Damping');
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
