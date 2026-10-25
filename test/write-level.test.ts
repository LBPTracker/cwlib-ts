/**
 * Writing a level back through the tape (`src/io/tape.ts`, `src/things/write-level.ts`).
 *
 * The tape is checked on a stream built here, ids out of order as the game
 * writes them; the level edits on lbptracker's `ascetic.lvl` (`LBP_FIXTURES`),
 * which other people's data keeps out of the repository, so that half skips
 * without it. The whole game's levels are `dev/rewrite-levels.ts`.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMPRESSED_INTEGERS, Serializer, type RevisionInfo } from '../src/io/serializer.ts';
import { Tape } from '../src/io/tape.ts';
import { Writer } from '../src/io/writer.ts';
import { loadResource } from '../src/io/resource.ts';
import { readLevel } from '../src/things/level.ts';
import {
  addThings, editLevel, removeThings, setWorldPosition, worldThings, writeLevel, writeLevelPayload,
} from '../src/things/write-level.ts';
import { nodeDeflate, nodeInflate } from '../src/platform/node.ts';

const LBP3 = { version: 0x3f9, subVersion: 0x218, branchId: 0, branchRevision: 0 } as RevisionInfo;

const LEVEL = path.join(
  process.env.LBP_FIXTURES ?? fileURLToPath(new URL('../../lbptracker/fixtures', import.meta.url)),
  'levels', 'ascetic.lvl',
);

/** A list of three references -- ids 7, 3 and 7 again -- each body one byte, then a tail. */
function stream(): Uint8Array {
  return new Uint8Array([
    0x03, // count
    0x07, 0xaa, // id 7, its body
    0x03, 0xbb, // id 3, its body
    0x07, // id 7 again: a back-reference
    0x2a, // the tail
  ]);
}

function readOnTape(bytes: Uint8Array): { tape: Tape; values: (number | undefined)[] } {
  const s = new Serializer(bytes, LBP3, COMPRESSED_INTEGERS);
  const tape = new Tape(bytes);
  s.tape = tape;
  const values = s.list('items', (self) => self.reference((inner) => ({ byte: inner.u8() }))?.byte);
  s.u8();
  tape.finish(s.position);
  return { tape, values };
}

const write = (tape: Tape): Uint8Array => {
  const w = new Writer(LBP3, COMPRESSED_INTEGERS);
  tape.write(w);
  return w.done();
};

test('a tape writes its stream back with the ids it read, out of order as they are', () => {
  const { tape, values } = readOnTape(stream());
  assert.deepEqual(values, [0xaa, 0xbb, 0xaa]);
  assert.deepEqual(write(tape), stream());
});

test("a list item dropped moves the object's body to its next mention", () => {
  const { tape } = readOnTape(stream());
  const list = tape.root.find((segment) => !(segment instanceof Uint8Array) && segment.kind === 'list');
  assert.ok(list && !(list instanceof Uint8Array) && list.kind === 'list');
  list.items.shift();
  // id 3's body, then id 7 written whole where it is mentioned next.
  assert.deepEqual(write(tape), new Uint8Array([0x02, 0x03, 0xbb, 0x07, 0xaa, 0x2a]));
});

test('ascetic.lvl is written back byte for byte', async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no level at ${LEVEL}`);
  const bytes = new Uint8Array(readFileSync(LEVEL));
  const level = await editLevel(bytes, nodeInflate);
  assert.deepEqual(writeLevelPayload(level), (await loadResource(bytes, nodeInflate)).data);
  const written = await writeLevel(level, nodeDeflate);
  const tableOf = (b: Uint8Array): Uint8Array => b.subarray(new DataView(b.buffer, b.byteOffset).getUint32(8, false));
  assert.deepEqual(tableOf(written), tableOf(bytes));
});

test('a Thing moved, removed or copied in reads back so', async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no level at ${LEVEL}`);
  const bytes = new Uint8Array(readFileSync(LEVEL));
  const level = await editLevel(bytes, nodeInflate);
  const before = worldThings(level);

  const moved = before.find((thing) => thing.parts.get('POS') instanceof Float32Array && thing.parent === undefined)
    ?? before.find((thing) => thing.parts.get('POS') instanceof Float32Array)!;
  const matrix = Float32Array.from(moved.parts.get('POS') as Float32Array);
  matrix[12] += 100;
  matrix[13] -= 50;
  setWorldPosition(level, moved, matrix);

  // The last Thing with nothing parented under it, so exactly one leaves the list.
  const parents = new Set(before.map((thing) => thing.parent));
  const removed = [...before].reverse().find((thing) => !parents.has(thing) && thing !== moved)!;
  removeThings(level, [removed]);

  const other = await editLevel(bytes, nodeInflate);
  const copied = worldThings(other).filter((thing) => thing.parts.has('POS')).slice(0, 3);
  addThings(level, other, copied);

  const again = await readLevel(await writeLevel(level, nodeDeflate), nodeInflate);
  assert.equal(again.unreadTail, undefined);
  assert.equal(again.things.length, before.length - 1 + copied.length);
  const back = again.things.find((thing) => thing?.uid === moved.uid);
  assert.deepEqual(back?.parts.get('POS'), matrix);
  assert.equal(again.things.filter((thing) => thing?.uid === removed.uid).length, 0);
  for (const thing of copied) {
    assert.ok(again.things.filter((t2) => t2?.uid === thing.uid).length >= 1, `copied Thing ${thing.uid} is there`);
  }
});
