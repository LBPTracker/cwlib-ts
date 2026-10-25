import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openGame, stackGames } from '../src/archives/game.ts';
import { readFar } from '../src/archives/savearchive.ts';
import { magicOf } from '../src/io/resource.ts';
import { looseFiles, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readDlc } from '../src/resources/dlc.ts';
import { readMusicSettings } from '../src/resources/music-settings.ts';
import { readThings } from '../src/things/level.ts';

/**
 * The 01.28 update over the 01.00 install: `LBP_PATCH` its folder
 * (`CUSA00063-patch`), `LBP_GAME` the install's; skips without both.
 * steering/level-files.md, *The 01.28 update*.
 */
const GAME = process.env.LBP_GAME ?? '';
const PATCH = process.env.LBP_PATCH ?? '';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];
const missing = (): string | undefined =>
  (GAME === '' || PATCH === '' ? 'LBP_GAME and LBP_PATCH are not both set'
    : !existsSync(path.join(PATCH, 'patch_001.farc')) ? `no update under ${PATCH}` : undefined);

test('a MUSt: a track, its flags and its stereo pairs', () => {
  const text = 'MUSt\nMasterVolume\t1\nTrackTranslatedTag\t"VOLCANO_IMUSIC"\nIsCopyrighted\tfalse\nStereoPairs\t1\n\t[0]\t\n'
    + '\t\tMusicStemTranslatedTag\t"MUSIC_STEM_MELODY"\n\t\tSliderIndex\t0\n\t\tFade\t2.18\n\t\tFadeIn\t2.18\n'
    + '\t\tFadeOut\t1\n\t\tForwardSend\t1\n\t\tRearSend\t0\n\t\tTrigger\tfalse\n';
  const music = readMusicSettings(new TextEncoder().encode(text));
  assert.equal(music.trackTranslatedTag, 'VOLCANO_IMUSIC');
  assert.equal(music.isSting, undefined, 'one of the game\'s has none');
  assert.deepEqual(music.stereoPairs.map((p) => [p.musicStemTranslatedTag, p.fade, p.trigger]), [['MUSIC_STEM_MELODY', 2.18, false]]);
});

test('the update over the install: its rows win, its files read', async (t) => {
  const skip = missing();
  if (skip) return t.skip(skip);
  const open = async (root: string, farcs: string[]) => openGame({
    fileDB: new Uint8Array(await readFile(path.join(root, 'output', 'orbisguids.map'))),
    remap: new Uint8Array(await readFile(path.join(root, 'output', 'orbisguids.remap'))),
    farcs: await Promise.all(farcs.map(async (name) => ({ name, access: await openFileAccess(path.join(root, name)) }))),
    loose: looseFiles(root),
  });
  const base = await open(GAME, FARCS);
  const patch = await open(PATCH, ['patch_001.farc']);
  const game = stackGames([patch, base]);
  assert.deepEqual([base.db.size, patch.db.size], [107673, 126779]);
  assert.equal(game.db.size, 107673 + 19613, 'the update adds 19,613 GUIDs and drops none from the merge');
  // A GUID both name with different bytes resolves to the update's.
  const changed = [...patch.db.values()].find((r) => base.db.get(r.guid) && base.db.get(r.guid)!.sha1 !== r.sha1 && patch.farcs[0].farc.entries.has(r.sha1))!;
  const bytes = await game.resolve({ kind: 'guid', guid: changed.guid, type: 0 });
  assert.equal(bytes!.length, changed.size);

  // Every DLCt and MUSt row of the update reads to its last line.
  let dlcs = 0;
  let music = 0;
  for (const row of patch.db.values()) {
    if (!patch.farcs[0].farc.entries.has(row.sha1)) continue;
    if (row.path.endsWith('.dlc')) {
      const b = (await patch.bySha1(row.sha1))!;
      if (magicOf(b) === 'DLCt') { readDlc(b); dlcs += 1; }
    } else if (row.path.endsWith('.mus')) {
      readMusicSettings((await patch.bySha1(row.sha1))!);
      music += 1;
    }
  }
  // 21 .mus rows name the FARC's 20 MUSt files: two rows share one.
  assert.deepEqual([dlcs, music], [6, 21]);
});

test("the update's Tiki DLC level: every chunk whole", async (t) => {
  const skip = missing();
  if (skip) return t.skip(skip);
  let chunks = 0;
  for (const { bytes } of await readFar(new Uint8Array(await readFile(path.join(PATCH, 'gamedata', 'lbp3', 'dlc', 'tiki', 'tiki_level.farc'))))) {
    if (magicOf(bytes) !== 'CHKb') continue;
    chunks += 1;
    assert.deepEqual((await readThings(bytes, nodeInflate)).problems ?? [], []);
  }
  assert.ok(chunks > 0);
  t.diagnostic(`${chunks} chunks`);
});
