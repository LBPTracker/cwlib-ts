import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { nodeInflate } from '../src/platform/node.ts';
import { readBoneSet } from '../src/resources/bone-set.ts';

/**
 * The one `BSTb` there is, the toolkit's own `characters.boneset`; skips
 * without `LBP_TOOLKIT`, a checkout of ennuo/toolkit.
 */
const TOOLKIT = process.env.LBP_TOOLKIT ?? '';
const FILE = path.join(TOOLKIT, 'lib', 'cwlib', 'src', 'main', 'resources', 'binary', 'characters.boneset');

test("the toolkit's characters.boneset reads to its last byte: five skeletons, each mirror its own inverse", async (t) => {
  if (!TOOLKIT || !existsSync(FILE)) return t.skip(TOOLKIT ? `no ${FILE}` : 'LBP_TOOLKIT is not set');
  // readBoneSet throws unless the walk ends on the payload's last byte.
  const set = await readBoneSet(await readFile(FILE), nodeInflate);
  assert.deepEqual([set.revision.branchId, set.revision.branchRevision], [0x4d5a, 5]);
  assert.deepEqual(set.skeletons.map((sk) => sk.bones.length), [43, 39, 40, 35, 29]);
  for (const sk of set.skeletons) {
    assert.equal(sk.bones[0]!.name, 'Dummy01');
    assert.equal(sk.mirror.length, sk.bones.length);
    assert.equal(sk.cullBones.length, sk.bones.length);
    sk.mirror.forEach((m, i) => assert.equal(sk.mirror[m], i));
    sk.bones.forEach((b, i) => assert.ok(b.parent === -1 || (b.parent >= 0 && b.parent < i)));
    assert.equal(sk.type, undefined); // branch revision 5, past MZ_BST_REMOVE_SK
  }
});
