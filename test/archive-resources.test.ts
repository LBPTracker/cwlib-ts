import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { nodeInflate } from '../src/platform/node.ts';
import { readThings } from '../src/things/level.ts';
import type { Thing } from '../src/things/thing.ts';

/**
 * Resources out of the public archive that once failed to open, one or two per
 * reader fix, each read to its payload's last byte. `LBP_ARCHIVE_RES` names a
 * folder of them laid out by SHA-1 as `<sha[0:2]>/<sha[2:4]>/<sha>`; the test
 * skips without it. steering/level-files.md, *The archive's sequencer census*.
 */
const RES = process.env.LBP_ARCHIVE_RES ?? '';
const fileOf = (sha: string): string => path.join(RES, sha.slice(0, 2), sha.slice(2, 4), sha);
const NO_RES = RES ? `no archive resources under ${RES}` : 'LBP_ARCHIVE_RES is not set';

const CASES: readonly (readonly [sha: string, why: string])[] = [
  ['00007f84314d82b671d20baab456941cc10b9fbd', 'a 0x3eb plan: no playerMode on a Thing of parts revision 0x2f'],
  ['00a4d71d9ab2a6752140f358380383373dc96246', 'a 0x3eb level: the same'],
  ['07976c6c6c80bff320fbec9acbabf5bbc45f99ab', 'a 0x1ae chunk: no island flags, no chunk-code list'],
  ['5239ff1a0786b7d18bfab17f02e46afc6fb3aac4', 'a 0x218 chunk: an island of flags bit 28 has one more count'],
  ['f8936ffd3dbed33af45dfd4061dccf46da85b446', 'the same, its sixth island of six'],
  ['046f45b938b5594bd00510a90c7c5740e59085da', 'an LBP1 plan: LEERDAMMER 0xb has the temporary costume pieces'],
  ['2751d637f741aa2d2fa0590a292905573eb06390', 'an LBP1 plan: PYellowHead and the popit below 0x2ed'],
  ['671d0182c9bca3e32914b41fa76eec2abc4d25e3', 'a 0x2c3 plan: the learned jumps, the behaviour i32, the old microchip'],
  ['31b7fae84459b8e3555ddb069f53d7644be58a3d', "a 0x218 level: the streaming manager's editing Things"],
  ['e09286292b52939da8b8625d5f2a0ee3cf28e460', 'the same with 647 of them'],
];

test('archive resources that once failed read to their last byte', async (t) => {
  if (!RES || !existsSync(fileOf(CASES[0]![0]))) return t.skip(NO_RES);
  for (const [sha, why] of CASES) {
    const parse = await readThings(await readFile(fileOf(sha)), nodeInflate);
    assert.equal(parse.unreadTail, undefined, `${sha.slice(0, 8)}, ${why}`);
    assert.deepEqual(parse.problems ?? [], [], `${sha.slice(0, 8)}, ${why}`);
    assert.ok(parse.things.length > 0, `${sha.slice(0, 8)}, ${why}`);
  }
});

test('a 0x3eb Thing of parts revision 0x2f has no playerMode', async (t) => {
  const sha = CASES[0]![0];
  if (!RES || !existsSync(fileOf(sha))) return t.skip(NO_RES);
  const { things } = await readThings(await readFile(fileOf(sha)), nodeInflate);
  const seen = new Set<Thing>();
  let switches = 0;
  const visit = (thing: Thing | undefined): void => {
    if (!thing || seen.has(thing)) return;
    seen.add(thing);
    for (const name of ['SWITCH', 'SWITCH_INPUT', 'CONTROLINATOR']) {
      const part = thing.parts.get(name) as { playerMode?: number } | undefined;
      if (!part) continue;
      switches += 1;
      assert.equal(thing.partsRevision, 0x2f);
      assert.equal(part.playerMode, undefined);
    }
  };
  things.forEach(visit);
  assert.ok(switches > 0, 'the plan has a switch');
});
