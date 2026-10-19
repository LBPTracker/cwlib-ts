import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { readThings } from '../src/level.ts';
import { readFar } from '../src/savearchive.ts';
import { nodeInflate } from '../src/platform/node.ts';

/**
 * The game's own story levels, which `LBP_GAME` holds and nothing commits. A
 * story level's world is a `_container.bin` in the FARCs; its streaming chunks
 * are in a `.farc` and a `_container.farc` beside each other under
 * `gamedata/` -- both `FAR4` in the clear, holding nothing but `CHKb`. `dev/story-census.ts` is the same
 * over all 88 archives and 41,741 chunks.
 */
const GAME = process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063';
const LEVEL = path.join(GAME, 'gamedata', 'lbp3', 'official_adventure_levels', '01_prologue', '01_needlepoint_peaks');

test('Needlepoint Peaks: every chunk of the level and of its container reads', async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no game under ${GAME}`);
  const counts: number[] = [];
  let things = 0;
  for (const name of ['needlepoint_peaks.farc', 'needlepoint_peaks_container.farc']) {
    const chunks = await readFar(new Uint8Array(await readFile(path.join(LEVEL, name))));
    for (const { bytes } of chunks) {
      assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'CHKb');
      // An island that does not open is a problem, not an exception; here there are none.
      const parse = await readThings(bytes, nodeInflate);
      assert.deepEqual(parse.problems ?? [], []);
      things += parse.things.length;
    }
    counts.push(chunks.length);
  }
  assert.deepEqual(counts, [880, 63]);
  assert.equal(things, 9214);
});
