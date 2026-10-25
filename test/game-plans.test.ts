import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readPlan } from '../src/things/level.ts';

/**
 * The game's plans that only the game's own loaders could settle; skips without
 * `LBP_GAME`. steering/level-files.md, *`playerMode` at 0x3eb, and the plans
 * that still fail*.
 */
const GAME = process.env.LBP_GAME ?? '';
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const PLANS = [
  // PSwitch: a live-streaming choice's five labels.
  'gamedata/lbp3/common/palettes/gad_gamelivestreaming_choice.plan',
  // PStickers: the descriptor array of versions 0x3bc–0x3cb.
  'gamedata/lbp2/dlc/move/levels/cutscene_intro/cutscene_intro_stick_palette_identity_27.plan',
  'gamedata/lbp2/dlc/move/levels/cutscene_intro/cutscene_intro_stick_palette_identity_28.plan',
  'gamedata/lbp2/dlc/move/levels/cutscene_intro/cutscene_intro_stick_palette_identity_29.plan',
  'gamedata/lbp2/dlc/move/levels/cutscene_intro/cutscene_intro_stick_palette_identity_30.plan',
  'gamedata/lbp2/dlc/move/levels/main_4/move_main_4_b_stick_palette_identity_35.plan',
];

test('the plans the eboot settled read to their Thing array\'s last byte', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const sha1 = new Map([...db.values()].map((r) => [r.path, r.sha1]));
  const found = new Map<string, Uint8Array>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const plan of PLANS) {
      const bytes = found.has(plan) ? undefined : await farc.get(sha1.get(plan)!);
      if (bytes) found.set(plan, bytes);
    }
    await access.close();
  }
  for (const plan of PLANS) {
    const bytes = found.get(plan);
    assert.ok(bytes, `${plan} is in no FARC`);
    // readPlan throws unless the walk ends on the Thing array's last byte.
    const { things } = await readPlan(bytes, nodeInflate);
    assert.equal(things.length, 1, plan);
  }
});
