import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readAdventureCreateProfile } from '../src/resources/adventure-create-profile.ts';
import { readAdventureSharedData } from '../src/resources/adventure-shared-data.ts';
import { readSyncedProfile } from '../src/resources/synced-profile.ts';

/**
 * The install's profiles: 17 synced ones inside crossplay `.cpv`s and three
 * adventure create profiles; skips without `LBP_GAME`. steering/level-files.md,
 * *Profiles*.
 */
const GAME = process.env.LBP_GAME ?? '';
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

async function byMagic(...magics: string[]): Promise<Map<string, Uint8Array>> {
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map([...db.values()].map((r) => [r.sha1, r.path]));
  const out = new Map<string, Uint8Array>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      if (out.has(name) || !magics.includes(magicOf(await access.read(entry.offset, 8)))) continue;
      out.set(name, (await farc.get(entry.sha1))!);
    }
    await access.close();
  }
  return out;
}

test('the install\'s 17 synced profiles read to their last byte, each with the Vita\'s integer', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const profiles = await byMagic('PRFb');
  assert.equal(profiles.size, 17);
  const branchRevisions = new Set<number>();
  for (const [name, bytes] of profiles) {
    const profile = await readSyncedProfile(bytes, nodeInflate);
    branchRevisions.add(profile.revision.branchRevision);
    assert.ok(profile.vitaValue !== undefined, name);
    assert.match(profile.playerId ?? '', /^Offline_?Player$/, name);
  }
  assert.deepEqual([...branchRevisions].sort((a, b) => a - b), [0x7a, 0x80, 0x87]);
});

test('the three adventure create profiles read to their last byte', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const profiles = await byMagic('ADCb');
  assert.deepEqual([...profiles.keys()].sort(), [
    'gamedata/lbp3/marketing_demo1/adventure.adc',
    'gamedata/lbp3/marketing_demo2/demo.adc',
    'gamedata/lbp3/popit_puzzle_planet/popit_puzzle_planet.adc',
  ]);
  const story = await readAdventureCreateProfile(profiles.get('gamedata/lbp3/marketing_demo1/adventure.adc')!, nodeInflate);
  assert.deepEqual([story.slots.length, story.links.length, story.areas.length], [54, 114, 15]);
  assert.equal(story.slots[1].slot.name, 'Needlepoint Peaks');
  assert.ok(story.planetWorld?.parts.has('WORLD'));
  assert.ok(story.areas[0].area?.parts.has('LEVEL_SETTINGS'), 'an area is a world with its own settings');
  for (const name of profiles.keys()) await readAdventureCreateProfile(profiles.get(name)!, nodeInflate);
});

test("each adventure's shared data is one AdventureData, to its last byte, and names its quests", async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOfGuid = new Map([...db.values()].map((r) => [r.guid, r.path]));
  const shared = await byMagic('ADSb');
  assert.equal(shared.size, 3);
  for (const bytes of shared.values()) await readAdventureSharedData(bytes, nodeInflate);
  const story = await readAdventureSharedData(shared.get('gamedata/lbp3/marketing_demo1/adventure.ads')!, nodeInflate);
  assert.deepEqual([story.items.length, story.quests.length, story.startPoints.length], [8, 24, 9]);
  assert.ok(story.quests.every((q) => pathOfGuid.get(q!.guid)?.endsWith('.qst')), 'every quest is a .qst');
});
