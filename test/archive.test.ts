import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc, type RandomAccess } from '../src/farc.ts';
import { readFileDB } from '../src/filedb.ts';
import { readLevel, readThings } from '../src/level.ts';
import { partReaders } from '../src/parts.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

/**
 * The game's own files are Sony's and never committed -- see lbptracker's
 * `steering/game-assets.md`. `LBP_GAME` is an installed LBP3 PS4 build, the
 * folder holding `base_001.farc` and `output/`; without it these skip.
 */
const GAME = process.env.LBP_GAME ?? 'D:\\PS4Games\\CUSA00063';
const LEVELS =
  process.env.LBP_LEVELS ?? 'C:\\Users\\sgdc3\\Desktop\\LBP\\toolkit\\tools\\sequencerdump';

const sha1 = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex');

/** `piano_c3.smp`, the chain lbptracker's game-assets.md walks end to end. */
const PIANO_C3 = 122694;

/* ------------------------------------------------------------- synthetic */

test('an LBP2 FileDB row has a u32 path length and an s64 date', () => {
  // ⚠️ cwlib's layout, not a measurement: no LBP2 FileDB was on this disk.
  const path = new TextEncoder().encode('gamedata/a.tex');
  const out = new Uint8Array(8 + 4 + path.length + 8 + 4 + 20 + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x01070100, false); // 0x107 < 0x148: the LBP2 row
  view.setUint32(4, 1, false);
  view.setUint32(8, path.length, false);
  out.set(path, 12);
  let at = 12 + path.length;
  view.setBigInt64(at, 1_300_000_000n, false);
  view.setUint32(at + 8, 77, false);
  out.fill(0xab, at + 12, at + 32);
  view.setUint32(at + 32, 4242, false);
  assert.deepEqual(readFileDB(out).get(4242), {
    path: 'gamedata/a.tex', date: 1_300_000_000, size: 77, sha1: 'ab'.repeat(20), guid: 4242,
  });
});

test('a FARC is its table at the end, and an entry is read only when asked for', async () => {
  const a = Uint8Array.of(1, 2, 3);
  const b = Uint8Array.of(4, 5);
  const out = new Uint8Array(5 + 2 * 0x1c + 8);
  const view = new DataView(out.buffer);
  out.set(a, 0);
  out.set(b, 3);
  for (const [i, [bytes, offset]] of [[a, 0], [b, 3]].entries() as Iterable<[number, [Uint8Array, number]]>) {
    out.set(createHash('sha1').update(bytes).digest(), 5 + i * 0x1c);
    view.setUint32(5 + i * 0x1c + 20, offset, false);
    view.setUint32(5 + i * 0x1c + 24, bytes.length, false);
  }
  view.setUint32(out.length - 8, 2, false);
  out.set(new TextEncoder().encode('FARC'), out.length - 4);
  const reads: [number, number][] = [];
  const source: RandomAccess = {
    size: out.length,
    read: async (offset, length) => {
      reads.push([offset, length]);
      return out.slice(offset, offset + length);
    },
  };
  const farc = await openFarc(source);
  assert.equal(farc.entries.size, 2);
  assert.ok(reads.every(([offset]) => offset >= 5), 'opening reads no entry');
  assert.deepEqual([...(await farc.get(sha1(b).toUpperCase()))!], [4, 5]);
  assert.equal(await farc.get('00'.repeat(20)), undefined);
  // A table pointing into itself is refused at open.
  view.setUint32(5 + 0x1c + 24, 40, false);
  await assert.rejects(openFarc(source), /past the table/);
});

test('readThings refuses a magic that holds no Things', async () => {
  await assert.rejects(readThings(new TextEncoder().encode('TEX \0\0\0\0'), nodeInflate), /"TEX "/);
});

/* ---------------------------------------------------------------- the game */

test("the game's FileDB names piano_c3, and base_001.farc holds its bytes", async (t) => {
  if (!existsSync(path.join(GAME, 'base_001.farc'))) return t.skip(`no game under ${GAME}`);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  // ❗ 107,673 rows on 1.28 and no GUID twice, so nothing is dropped.
  assert.equal(db.size, 107_673);
  const row = db.get(PIANO_C3)!;
  assert.equal(row.path, 'gamedata/audio/music/samples/keys/piano/piano_c3.smp');

  const access = await openFileAccess(path.join(GAME, 'base_001.farc'));
  try {
    const farc = await openFarc(access);
    assert.equal(farc.entries.size, 19_545);
    assert.equal(farc.entries.get(row.sha1)!.size, row.size);
    const bytes = (await farc.get(row.sha1))!;
    assert.equal(bytes.length, 73_440);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(sha1(bytes), row.sha1);
  } finally {
    await access.close();
  }
});

test('an entry past 2^31 in chunk1_001.farc reads whole', async (t) => {
  if (!existsSync(path.join(GAME, 'chunk1_001.farc'))) return t.skip(`no game under ${GAME}`);
  // ⚠️ The offset is a u32: read as an i32, every entry here is before the file.
  const access = await openFileAccess(path.join(GAME, 'chunk1_001.farc'));
  try {
    const farc = await openFarc(access);
    const high = [...farc.entries.values()].filter((e) => e.offset >= 2 ** 31);
    assert.ok(high.length > 10_000, `${high.length} entries past 2^31`);
    const last = high.reduce((l, r) => (r.offset > l.offset ? r : l));
    assert.equal(sha1((await farc.get(last.sha1))!), last.sha1);
  } finally {
    await access.close();
  }
});

test('every entry of intro_001.farc matches the SHA-1 it is filed under', async (t) => {
  if (!existsSync(path.join(GAME, 'intro_001.farc'))) return t.skip(`no game under ${GAME}`);
  const access = await openFileAccess(path.join(GAME, 'intro_001.farc'));
  try {
    const farc = await openFarc(access);
    assert.equal(farc.entries.size, 2_695);
    let packed = 0;
    for (const entry of farc.entries.values()) {
      assert.equal(sha1((await farc.get(entry.sha1))!), entry.sha1);
      packed += entry.size;
    }
    // The entries tile the file from 0 to the table with no gap.
    assert.equal(packed, access.size - 8 - farc.entries.size * 0x1c);
  } finally {
    await access.close();
  }
});

test('readThings opens a level and a game plan, a fresh part table each', async (t) => {
  if (!existsSync(path.join(GAME, 'intro_001.farc'))) return t.skip(`no game under ${GAME}`);
  const access = await openFileAccess(path.join(GAME, 'intro_001.farc'));
  try {
    const farc = await openFarc(access);
    let plans = 0;
    for (const entry of farc.entries.values()) {
      const bytes = (await farc.get(entry.sha1))!;
      if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'PLNb') continue;
      const parse = await readThings(bytes, nodeInflate).catch(() => undefined);
      if (!parse) continue;
      assert.equal(parse.kind, 'plan');
      plans += 1;
      if (plans === 20) break;
    }
    assert.equal(plans, 20);
  } finally {
    await access.close();
  }

  const folder = path.join(LEVELS, 'data');
  if (!existsSync(folder)) return t.skip(`no levels under ${folder}`);
  const name = (await readdir(folder)).find((f) => !f.includes('.'))!;
  const bytes = new Uint8Array(await readFile(path.join(folder, name)));
  // Twice: a second level through a shared table would meet the first one's WORLD.
  for (let i = 0; i < 2; i += 1) {
    const parse = await readThings(bytes, nodeInflate);
    assert.equal(parse.kind, 'level');
    assert.equal(parse.things.length, (await readLevel(bytes, nodeInflate, partReaders())).things.length);
  }
});
