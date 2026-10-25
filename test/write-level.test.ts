/**
 * Writing a level back through the tape (`src/io/tape.ts`, `src/things/write-level.ts`).
 *
 * The tape is checked on a stream built here, ids out of order as the game
 * writes them; the level edits on lbptracker's `ascetic.lvl` (`LBP_FIXTURES`),
 * which other people's data keeps out of the repository, and the plan and
 * chunk ones on the game (`LBP_GAME`), so those skip without them. The whole
 * game's levels, plans and chunks are `dev/rewrite-levels.ts`.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMPRESSED_INTEGERS, Serializer, type RevisionInfo } from '../src/io/serializer.ts';
import { Tape } from '../src/io/tape.ts';
import { Writer } from '../src/io/writer.ts';
import { loadResource, magicOf } from '../src/io/resource.ts';
import { toHex } from '../src/io/hex.ts';
import { openFarc } from '../src/archives/farc.ts';
import { openGame } from '../src/archives/game.ts';
import { readFar } from '../src/archives/savearchive.ts';
import { readChunk, readLevel, readPlan } from '../src/things/level.ts';
import {
  addPart, addThings, editChunk, editLevel, editPlan, openIsland, removePart, removeThings, replaceChunk, setPart, setWorldPosition, worldThings,
  writeChunk, writeLevel, writeLevelPayload, writePlan, writePlanPayload,
} from '../src/things/write-level.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { withBone, type PosPart } from '../src/things/parts.ts';

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

const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const PEAKS = path.join(GAME, 'gamedata', 'lbp3', 'official_adventure_levels', '01_prologue', '01_needlepoint_peaks');
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test("Needlepoint Peaks: a Thing moved in a chunk's island, and the level naming the chunk written anew", async (t) => {
  if (!GAME || !existsSync(PEAKS)) return t.skip(NO_GAME);
  const chunks = await readFar(new Uint8Array(readFileSync(path.join(PEAKS, 'needlepoint_peaks.farc'))));
  const { sha1, bytes } = chunks[0]!;
  const chunk = await editChunk(bytes, nodeInflate);
  assert.deepEqual(await writeChunk(chunk, nodeDeflate), bytes, 'unedited, the chunk is its own bytes');

  const island = await openIsland(chunk, 0, nodeInflate);
  const moved = worldThings(island).find((thing) => thing.parts.get('POS') instanceof Float32Array)!;
  const matrix = Float32Array.from(moved.parts.get('POS') as Float32Array);
  matrix[13] += 25;
  setWorldPosition(island, moved, matrix);
  const written = await writeChunk(chunk, nodeDeflate);
  const again = await readChunk(written, nodeInflate);
  assert.deepEqual(again.problems, []);
  assert.deepEqual(again.things.find((thing) => thing?.uid === moved.uid)?.parts.get('POS'), matrix);

  // The level that names the chunk: the container `.bin` in the FARCs, by its chunk list.
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  try {
    const game = await openGame({
      fileDB: new Uint8Array(readFileSync(path.join(GAME, 'output', 'orbisguids.map'))),
      farcs: accesses.map((access, i) => ({ name: FARCS[i]!, access })),
    });
    let level;
    for (const row of game.db.values()) {
      if (!row.path.includes('needlepoint_peaks') || !row.path.endsWith('.bin')) continue;
      const candidate = await game.bySha1(row.sha1);
      if (!candidate) continue;
      const parse = await readLevel(candidate, nodeInflate).catch(() => undefined);
      if (parse?.chunks?.some((c) => c.sha1 === sha1)) {
        level = await editLevel(candidate, nodeInflate);
        break;
      }
    }
    assert.ok(level, 'a level names the chunk');
    const next = await replaceChunk(level, sha1, written);
    const named = await readLevel(await writeLevel(level, nodeDeflate), nodeInflate);
    assert.ok(named.chunks?.some((c) => c.sha1 === next));
    assert.ok(!named.chunks?.some((c) => c.sha1 === sha1));
    assert.ok(level.dependencies.some((d) => d.hash !== undefined && toHex(d.hash) === next));
  } finally {
    for (const access of accesses) await access.close();
  }
});

test('a plan of the game written back is its own payload, and takes Things from another', async (t) => {
  if (!GAME || !existsSync(path.join(GAME, FARCS[0]!))) return t.skip(NO_GAME);
  const access = await openFileAccess(path.join(GAME, FARCS[0]!));
  try {
    const farc = await openFarc(access);
    const plans: Uint8Array[] = [];
    for (const entry of farc.entries.values()) {
      if (plans.length === 2) break;
      if (entry.size < 8 || magicOf(await access.read(entry.offset, 8)) !== 'PLNb') continue;
      const bytes = (await farc.get(entry.sha1))!;
      const plan = await editPlan(bytes, nodeInflate).catch(() => undefined);
      if (plan && worldThings(plan).length > 1) plans.push(bytes);
    }
    const [a, b] = await Promise.all(plans.map((p) => editPlan(p, nodeInflate)));
    assert.deepEqual(writePlanPayload(a!), (await loadResource(plans[0]!, nodeInflate)).data);
    if (a!.revision.subVersion !== b!.revision.subVersion || a!.revision.version !== b!.revision.version) {
      // Two plans of one revision is what the copy needs; the same one twice will do.
      Object.assign(b!, await editPlan(plans[0]!, nodeInflate));
    }
    const before = worldThings(a!).length;
    const taken = worldThings(b!).slice(0, 1);
    addThings(a!, b!, taken);
    removeThings(a!, [worldThings(a!)[0]!]);
    const again = await readPlan(await writePlan(a!, nodeDeflate), nodeInflate);
    assert.equal(again.unreadTail, undefined);
    assert.equal(again.things.length, worldThings(a!).length);
    assert.ok(worldThings(a!).length <= before, 'one taken, one or more removed with their children');
  } finally {
    await access.close();
  }
});

test("a Thing's bone rides on its POS matrix, out of sight of the 16 floats, and stays when it moves", async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no level at ${LEVEL}`);
  const level = await editLevel(new Uint8Array(readFileSync(LEVEL)), nodeInflate);
  const boned = worldThings(level).find((thing) => (thing.parts.get('POS') as PosPart | undefined)?.thingOfWhichIAmABone);
  assert.ok(boned, 'a Thing riding a bone');
  const pos = boned.parts.get('POS') as PosPart;
  assert.equal(Object.keys(pos).length, 16, 'the bone is not an enumerable key');
  assert.equal(typeof pos.animHash, 'number');
  const bone = pos.thingOfWhichIAmABone;
  setWorldPosition(level, boned, pos);
  const moved = boned.parts.get('POS') as PosPart;
  assert.equal(moved.thingOfWhichIAmABone, bone);
  assert.equal(moved.animHash, pos.animHash);
});

test('a part written from its value, taken off a Thing and given back, reads back so', async (t) => {
  if (!existsSync(LEVEL)) return t.skip(`no level at ${LEVEL}`);
  const bytes = new Uint8Array(readFileSync(LEVEL));
  const level = await editLevel(bytes, nodeInflate);
  // Unedited but rewritten from its value, a POS is its own bytes.
  const first = worldThings(level).find((thing) => thing.parts.get('POS') instanceof Float32Array)!;
  setPart(level, first, 'POS', first.parts.get('POS'));
  assert.deepEqual(writeLevelPayload(level), (await loadResource(bytes, nodeInflate)).data);

  const moved = Float32Array.from(first.parts.get('POS') as Float32Array);
  moved[12] += 10;
  setPart(level, first, 'POS', withBone(moved, first.parts.get('POS') as PosPart));
  const other = worldThings(level).filter((thing) => thing.parts.has('POS'))[1]!;
  const pos = other.parts.get('POS');
  removePart(level, other, 'POS');
  let again = await readLevel(await writeLevel(level, nodeDeflate), nodeInflate);
  assert.equal(again.unreadTail, undefined);
  assert.deepEqual(again.things.find((thing) => thing?.uid === first.uid)?.parts.get('POS'), moved);
  assert.equal(again.things.find((thing) => thing?.uid === other.uid)?.parts.has('POS'), false);
  addPart(level, other, 'POS', pos);
  again = await readLevel(await writeLevel(level, nodeDeflate), nodeInflate);
  assert.equal(again.unreadTail, undefined);
  assert.deepEqual(again.things.find((thing) => thing?.uid === other.uid)?.parts.get('POS'), pos);
});
