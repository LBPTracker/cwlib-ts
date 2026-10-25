import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf, openSerializer } from '../src/io/resource.ts';
import { vitaRevision } from '../src/io/serializer.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readThings } from '../src/things/level.ts';

/**
 * The game's resources on the Vita's branch, the crossplay levels and plans;
 * skips without `LBP_GAME`. steering/level-files.md, *The Vita branch*.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('all 148 Vita plans read, and 19 of the 25 Vita levels to their last byte', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  // Every Vita resource the game has is under these two folders.
  const wanted = new Set([...db.values()].filter((r) => /\/crossplay\/|\/e3demo2\//.test(r.path)).map((r) => r.sha1));
  const read = { LVLb: 0, PLNb: 0 };
  let whole = 0;
  const failed = { LVLb: 0, PLNb: 0 };
  const seen = new Set<string>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (!wanted.has(entry.sha1) || seen.has(entry.sha1)) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 8));
      if (magic !== 'LVLb' && magic !== 'PLNb') continue;
      const bytes = (await farc.get(entry.sha1))!;
      if (vitaRevision((await openSerializer(bytes, nodeInflate)).revision) < 0) continue;
      try {
        const parse = await readThings(bytes, nodeInflate);
        read[magic] += 1;
        // A level proves its parts only when readLevel reached the payload's last byte.
        if (magic === 'LVLb' && parse.unreadTail === undefined) whole += 1;
      } catch {
        failed[magic] += 1;
      }
    }
    await access.close();
  }
  assert.deepEqual(read, { LVLb: 19, PLNb: 148 });
  assert.equal(whole, 19);
  assert.deepEqual(failed, { LVLb: 6, PLNb: 0 });
});
