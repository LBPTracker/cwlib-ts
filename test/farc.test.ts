import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc, writeFarc, writeFarcTable } from '../src/archives/farc.ts';
import { openFileAccess } from '../src/platform/node.ts';

/**
 * A FARC written and read back; the game's own skip without `LBP_GAME`.
 * steering/level-files.md, *The FARC archives*.
 */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

/** A Blob-like reader over bytes in memory. */
const inMemory = (bytes: Uint8Array) => ({ size: bytes.length, read: async (at: number, n: number) => bytes.slice(at, at + n) });

test('a FARC survives the round trip, its table sorted by SHA-1', async () => {
  const resources = ['b', 'a', 'ccc', 'a'].map((s) => new TextEncoder().encode(s));
  const farc = await openFarc(inMemory(await writeFarc(resources)));
  const rows = [...farc.entries.values()];
  assert.equal(rows.length, 3, 'the repeat is dropped');
  assert.deepEqual(rows.map((r) => r.sha1), rows.map((r) => r.sha1).sort());
  assert.deepEqual(new TextDecoder().decode(await farc.get(rows.find((r) => r.offset === 0)!.sha1)), 'b');
  assert.throws(() => writeFarcTable([{ sha1: '00'.repeat(20), offset: 0xffffffff, size: 1 }]), /past a u32/);
});

test("every one of the game's FARC tables is written back as it is", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const rows = [...(await openFarc(access)).entries.values()];
    const table = writeFarcTable([...rows].reverse());
    assert.deepEqual(await access.read(access.size - table.length, table.length), table, file);
    await access.close();
  }
});

test("intro_001.farc comes back byte for byte from its entries in the order they lie", async (t) => {
  const file = path.join(GAME, 'intro_001.farc');
  if (GAME === '' || !existsSync(file)) return t.skip(NO_GAME);
  const bytes = new Uint8Array(await readFile(file));
  const farc = await openFarc(inMemory(bytes));
  const rows = [...farc.entries.values()].sort((a, b) => a.offset - b.offset);
  const written = await writeFarc(rows.map((r) => bytes.subarray(r.offset, r.offset + r.size)));
  assert.equal(written.length, bytes.length);
  assert.ok(written.every((b, i) => b === bytes[i]), 'identical');
});
