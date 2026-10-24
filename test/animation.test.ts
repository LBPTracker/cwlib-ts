import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readAnimation, type Animation } from '../src/resources/animation.ts';

/**
 * The game's animations, out of its FARCs; skips without `LBP_GAME`.
 * `dev/animation-census.ts` prints what they hold.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('every ANMb the game ships reads to its last byte, across 97 revisions', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map([...db.values()].map((r) => [r.sha1, r.path]));
  const read = new Map<string, Animation>();
  const revisions = new Set<number>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (read.has(entry.sha1) || entry.size < 8) continue;
      if (magicOf(await access.read(entry.offset, 8)) !== 'ANMb') continue;
      // readAnimation throws unless the walk ends on the payload's last byte and the block's tail is zero padding.
      const a = await readAnimation((await farc.get(entry.sha1))!, nodeInflate);
      read.set(entry.sha1, a);
      revisions.add(a.revision.subVersion * 0x10000 + a.revision.version);
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      const frames = a.numFrames - 1;
      assert.equal(a.rotations.length, (a.bones.length + a.rotBonesAnimated.length * frames) * 4, name);
      assert.equal(a.positions.length, (a.bones.length + a.posBonesAnimated.length * frames) * 3, name);
      // A parent comes before its child: a pose can be built in one pass.
      a.bones.forEach((b, i) => assert.ok(b.parent === -1 || (b.parent >= 0 && b.parent < i), name));
    }
    await access.close();
  }
  assert.equal(read.size, 2664);
  assert.equal(revisions.size, 97);
  assert.equal([...read.values()].filter((a) => a.fat !== 0).length, 2);

  const byName = (end: string): Animation => [...read].find(([sha1]) => pathOf.get(sha1)?.endsWith(end))![1];
  const dwarf = byName('/dwarf_look_updown.anim');
  assert.deepEqual(
    [dwarf.bones.length, dwarf.numFrames, dwarf.fps, dwarf.morphCount, dwarf.rotBonesAnimated.length, dwarf.posBonesAnimated.length, dwarf.locators.length],
    [38, 9, 30, 22, 15, 3, 2],
  );
  assert.deepEqual([...dwarf.rotations.slice(0, 4)], [0, 0, 0, 1]);

  // fat: four-byte values, and the sign of w still in x's low bit.
  const claw = byName('/robotic_arm_claw.anim');
  assert.equal(claw.fat, 1);
  assert.deepEqual([claw.bones.length, claw.numFrames, claw.fps, claw.rotations.length, claw.positions.length], [12, 1000, 15, 20028, 15021]);
  assert.ok(Math.abs(claw.rotations[0]! - Math.SQRT1_2) < 1e-6 && Math.abs(claw.rotations[3]! - Math.SQRT1_2) < 1e-6);
});
