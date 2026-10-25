import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readThingRecording } from '../src/resources/thing-recording.ts';

/**
 * The game's 91 `RECb`, read by the eboot loader's three layouts; skips without
 * `LBP_GAME`. steering/level-files.md, *Thing recordings*.
 */
const GAME = process.env.LBP_GAME ?? '';
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('every Thing recording reads to its last byte, in the layout of its version', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map([...db.values()].map((r) => [r.sha1, r.path]));
  const layouts = { matrices: 0, positions: 0, packed: 0 };
  const seen = new Set<string>();
  let intro: Awaited<ReturnType<typeof readThingRecording>> | undefined;
  let packed: Awaited<ReturnType<typeof readThingRecording>> | undefined;
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || magicOf(await access.read(entry.offset, 8)) !== 'RECb') continue;
      seen.add(entry.sha1);
      const recording = await readThingRecording((await farc.get(entry.sha1))!, nodeInflate);
      if (recording.matrices) layouts.matrices += 1;
      if (recording.packed) layouts.packed += 1;
      else if (recording.positions) layouts.positions += 1;
      if (recording.positions) {
        // The arrays and the decoded packed frames alike: one of each a frame, flags 0 or 16.
        assert.ok(recording.flags!.every((f) => f === 0 || f === 16), 'a flag');
        assert.equal(recording.flags!.length, recording.positions.length);
        assert.equal(recording.angles!.length, recording.positions.length);
        if (!recording.packed) assert.ok(recording.angles!.every((a) => Math.abs(a) <= Math.PI + 1e-6), 'an angle');
      }
      if (pathOf.get(entry.sha1)?.endsWith('/move_cutscene_intro_recording_01.rec')) intro = recording;
      if (pathOf.get(entry.sha1)?.endsWith('/move_cutscene_intro_recording_36.rec')) packed = recording;
    }
    await access.close();
  }
  assert.deepEqual(layouts, { matrices: 1, positions: 54, packed: 36 });
  assert.equal(intro!.positions!.length, 324);
  assert.deepEqual(intro!.positions![0].map((x) => Math.round(x)), [3639, 6772, -200]);
  // Decoded from its bits: the first position whole, then 275 steps of x and y.
  assert.equal(packed!.positions!.length, 276);
  assert.deepEqual(packed!.positions![0].map((x) => Math.round(x)), [5886, 7804, -300]);
  assert.deepEqual(packed!.positions![275].map((x) => Math.round(x)), [7042, 6206, -300]);
});
