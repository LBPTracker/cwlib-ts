import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readCachedCostumeData } from '../src/resources/cached-costume-data.ts';
import { readJointSettings } from '../src/resources/joint-settings.ts';
import { readOutfitList } from '../src/resources/outfit-list.ts';
import { readPalette, type Palette } from '../src/resources/palette.ts';
import { readPins } from '../src/resources/pins.ts';

/**
 * The smaller resource types, every file of each in the game's FARCs; skips
 * without `LBP_GAME`. `dev/resources-census.ts` prints the same per head word.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const READERS = {
  PALb: readPalette,
  OUTb: readOutfitList,
  JNTb: readJointSettings,
  PINb: readPins,
  CCDb: readCachedCostumeData,
} as const;

test('palettes, outfit lists, joints, pins and the costume index all read to their last byte', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map([...db.values()].map((r) => [r.sha1, r.path]));
  const read = new Map<string, Map<string, unknown>>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (entry.size < 8) continue;
      const magic = magicOf(await access.read(entry.offset, 8)) as keyof typeof READERS;
      if (!(magic in READERS)) continue;
      const byMagic = read.get(magic) ?? read.set(magic, new Map()).get(magic)!;
      if (byMagic.has(entry.sha1)) continue;
      // Every reader throws unless its walk ends on the payload's last byte.
      byMagic.set(entry.sha1, await READERS[magic]((await farc.get(entry.sha1))!, nodeInflate));
    }
    await access.close();
  }
  assert.deepEqual(
    Object.fromEntries([...read].map(([m, files]) => [m, files.size])),
    { PALb: 178, OUTb: 59, JNTb: 9, PINb: 1, CCDb: 1 },
  );

  // The one palette with converted plans: six pairs, a hash then a GUID.
  const palettes = [...read.get('PALb')!] as [string, Palette][];
  const converted = palettes.filter(([, p]) => p.convertedPlans.length > 0);
  assert.equal(converted.length, 1);
  assert.ok(pathOf.get(converted[0][0])?.endsWith('/pal_unthemed_toys_vehicles_palette.pal'));
  assert.deepEqual(converted[0][1].convertedPlans.map(([a, b]) => [!!a?.hash, b?.guid]), [
    [true, 173454], [true, 173455], [true, 173456], [true, 173457], [true, 173458], [true, 173459],
  ]);

  const costumes = [...read.get('CCDb')!.values()][0] as Awaited<ReturnType<typeof readCachedCostumeData>>;
  assert.equal(costumes.costumes.length, 4161);
  assert.equal(costumes.keys.length, 485);
  assert.equal(costumes.keys[0], 'PLITTLEBIGDEMO01');
});
