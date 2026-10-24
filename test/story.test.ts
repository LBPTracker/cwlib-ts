import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { readThings } from '../src/things/level.ts';
import type { ShapePart } from '../src/things/parts.ts';
import { readFar } from '../src/archives/savearchive.ts';
import { nodeInflate } from '../src/platform/node.ts';
import { magicOf } from '../src/io/resource.ts';

/**
 * The game's own story levels, which `LBP_GAME` holds and nothing commits. A
 * story level's world is a `_container.bin` in the FARCs; its streaming chunks
 * are in a `.farc` and a `_container.farc` beside each other under
 * `gamedata/` -- both `FAR4` in the clear, holding nothing but `CHKb`. `dev/story-census.ts` is the same
 * over all 88 archives and 41,741 chunks.
 */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const LEVEL = path.join(GAME, 'gamedata', 'lbp3', 'official_adventure_levels', '01_prologue', '01_needlepoint_peaks');

test('Needlepoint Peaks: every chunk of the level and of its container reads', async (t) => {
  if (!GAME || !existsSync(LEVEL)) return t.skip(NO_GAME);
  const counts: number[] = [];
  let things = 0;
  let shapes = 0;
  for (const name of ['needlepoint_peaks.farc', 'needlepoint_peaks_container.farc']) {
    const chunks = await readFar(new Uint8Array(await readFile(path.join(LEVEL, name))));
    for (const { bytes } of chunks) {
      assert.equal(magicOf(bytes), 'CHKb');
      // An island that does not open is a problem, not an exception; here there are none.
      const parse = await readThings(bytes, nodeInflate);
      assert.deepEqual(parse.problems ?? [], []);
      things += parse.things.length;
      for (const thing of parse.things) {
        const shape = thing?.parts.get('SHAPE') as ShapePart | undefined;
        if (shape === undefined) continue;
        shapes += 1;
        // The loops are runs of the vertex list: 80,002 of 80,002 over all 88 archives.
        assert.equal(shape.loops.reduce((a, b) => a + b, 0), shape.vertices.length / 3);
      }
    }
    counts.push(chunks.length);
  }
  assert.deepEqual(counts, [880, 63]);
  assert.equal(things, 9214);
  assert.equal(shapes, 2521);
});
