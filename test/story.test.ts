import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { readThings } from '../src/things/level.ts';
import type { AtmosphericTweakPart, CostumePart, MaterialOverridePart, ScriptInstance, ShapePart } from '../src/things/parts.ts';
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
  const kept = { costumes: 0, costumeMeshes: 0, weather: 0, overrides: 0 };
  const scripts = { instances: 0, withFields: 0, texts: 0 };
  let firstText = '';
  for (const name of ['needlepoint_peaks.farc', 'needlepoint_peaks_container.farc']) {
    const chunks = await readFar(new Uint8Array(await readFile(path.join(LEVEL, name))));
    for (const { bytes } of chunks) {
      assert.equal(magicOf(bytes), 'CHKb');
      // An island that does not open is a problem, not an exception; here there are none.
      const parse = await readThings(bytes, nodeInflate);
      assert.deepEqual(parse.problems ?? [], []);
      things += parse.things.length;
      for (const thing of parse.things) {
        // The parts kept since 0.4.12: every costume names its mesh.
        const costume = thing?.parts.get('COSTUME') as CostumePart | undefined;
        if (costume) {
          kept.costumes += 1;
          if (costume.mesh) kept.costumeMeshes += 1;
        }
        if (thing?.parts.get('ATMOSPHERIC_TWEAK') as AtmosphericTweakPart | undefined) kept.weather += 1;
        if (thing?.parts.get('MATERIAL_OVERRIDE') as MaterialOverridePart | undefined) kept.overrides += 1;
        // A script's fields come back with their values: a speech bubble's text is a wide string, a LAMS key.
        const script = thing?.parts.get('SCRIPT') as ScriptInstance | undefined;
        if (script) {
          scripts.instances += 1;
          if (script.fields.length > 0) scripts.withFields += 1;
          const text = script.fields.find((f) => f.name === 'Text')?.value;
          if (text && typeof text === 'object' && 'type' in text && text.type === 'stringW') {
            scripts.texts += 1;
            firstText ||= text.value;
          }
        }
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
  assert.deepEqual(kept, { costumes: 3, costumeMeshes: 3, weather: 19, overrides: 1 });
  assert.deepEqual(scripts, { instances: 346, withFields: 346, texts: 36 });
  assert.equal(firstText, 'NP_TU01B_130_NEWTON');
});

const ADVENTURES = path.join(GAME, 'gamedata', 'lbp3', 'official_adventure_levels');

test("titan_2 and game_outro: every island of every chunk opens, the world nested in one too", async (t) => {
  if (!GAME || !existsSync(ADVENTURES)) return t.skip(NO_GAME);
  // These held the story's last islands that would not open: three of titan_2's chunks carry a
  // plan with a world Thing in it (question 57), and six of game_outro's read short.
  const levels: Record<string, string[]> = {
    '03_ziggurat/06_titan_2': ['titan_2.farc', 'titan_2_container.farc'],
    '04_bunkum/c13_game_outro': ['game_outro.farc', 'game_outro_a.farc', 'game_outro_b.farc'],
  };
  let chunks = 0;
  for (const [dir, names] of Object.entries(levels)) {
    for (const name of names) {
      for (const { bytes } of await readFar(new Uint8Array(await readFile(path.join(ADVENTURES, dir, name))))) {
        if (magicOf(bytes) !== 'CHKb') continue;
        chunks += 1;
        assert.deepEqual((await readThings(bytes, nodeInflate)).problems ?? [], [], `${dir}/${name}`);
      }
    }
  }
  assert.equal(chunks, 1669);
});
