import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readPhysicsMaterial, type PhysicsMaterial } from '../src/resources/physics-material.ts';

/**
 * The game's physics materials, out of its FARCs; skips without `LBP_GAME`.
 * `dev/physics-material-census.ts` prints what they hold.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('every MATb the game ships reads to its last byte, across 46 revisions', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map([...db.values()].map((r) => [r.sha1, r.path]));
  const read = new Map<string, PhysicsMaterial>();
  const revisions = new Set<number>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (read.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      if (magicOf(head) !== 'MATb') continue;
      // readPhysicsMaterial throws unless the walk ends on the payload's last byte.
      const m = await readPhysicsMaterial((await farc.get(entry.sha1))!, nodeInflate);
      read.set(entry.sha1, m);
      revisions.add(m.revision.subVersion * 0x10000 + m.revision.version); // the head word, as the census counts it
      // `maxForce` arrived at 0x13c: NaN, cwlib's default, before; never NaN in a file.
      assert.equal(Number.isNaN(m.maxForce), m.revision.version < 0x13c, pathOf.get(entry.sha1) ?? entry.sha1);
    }
    await access.close();
  }
  assert.equal(read.size, 86);
  assert.equal(revisions.size, 46);

  const plastic = [...read].find(([sha1]) => pathOf.get(sha1)?.endsWith('/base_plastic.mat'))![1];
  assert.equal(plastic.soundEnum, 24);
  assert.equal(Math.fround(plastic.traction), Math.fround(0.05));
  assert.ok(Math.abs(plastic.density - 3.2618291) < 1e-6, `density ${plastic.density}`);
});
