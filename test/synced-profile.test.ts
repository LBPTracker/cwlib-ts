import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { readSaveArchive } from '../src/archives/savearchive.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate } from '../src/platform/node.ts';
import { readSyncedProfile } from '../src/resources/synced-profile.ts';

/**
 * `RSyncedProfile` on the one profile in the PS3 saves; skips without
 * `LBP_LEVELS`. steering/level-files.md, *Profiles*.
 */
const CORPUS = process.env.LBP_LEVELS ?? '';
const SAVE = path.join(CORPUS, 'data4', 'BCES00850LEVEL01CFF33A');

test('the saves\' synced profile reads to its last byte', async (t) => {
  if (CORPUS === '' || !existsSync(SAVE)) return t.skip(CORPUS ? `no ${SAVE}` : 'LBP_LEVELS is not set');
  const names = (await readdir(SAVE)).filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(a) - Number(b));
  const chunks = await Promise.all(names.map(async (n) => new Uint8Array(await readFile(path.join(SAVE, n)))));
  const resource = (await readSaveArchive(chunks)).find((r) => magicOf(r.bytes) === 'PRFb')!;
  const profile = await readSyncedProfile(resource.bytes, nodeInflate);
  assert.deepEqual([profile.revision.version, profile.revision.branchRevision], [0x3e2, 0x87]);
  assert.equal(profile.playerId, 'Offline_Player');
  assert.deepEqual(profile.colours.map((c) => c >>> 0), [0xff5ab432, 0xff1464c8, 0xff4bc8ff, 0xffaa0578]);
  assert.equal(profile.vitaValue, 5192869);
  // The Sackboy the player wears: a world of four Things, a creature in a costume.
  const world = profile.sackboyAvatarWorld!.parts.get('WORLD') as unknown[];
  assert.equal(world.length, 4);
});
