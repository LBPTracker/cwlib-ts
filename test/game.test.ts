import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { writeFarc } from '../src/archives/farc.ts';
import { writeFileDB } from '../src/archives/filedb.ts';
import { openGame } from '../src/archives/game.ts';
import { gatherDependencies } from '../src/archives/gather.ts';
import { toHex } from '../src/io/hex.ts';
import { looseFiles, openFileAccess } from '../src/platform/node.ts';

/**
 * One install opened as cwlib's `ResourceSystem` would; the game's own skips
 * without `LBP_GAME`. src/archives/game.ts.
 */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const sha1 = async (bytes: Uint8Array) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource)));
const inMemory = (bytes: Uint8Array) => ({ size: bytes.length, read: async (at: number, n: number) => bytes.slice(at, at + n) });

/** `orbisguids.remap`: the pairs, then each new GUID's path. */
function remapOf(pairs: [old: number, guid: number, path: string][]): Uint8Array {
  const paths = pairs.map(([, , p]) => new TextEncoder().encode(p));
  const out = new Uint8Array(12 + pairs.length * 8 + paths.reduce((n, p) => n + 8 + p.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(4, pairs.length);
  pairs.forEach(([old, guid], i) => {
    view.setUint32(8 + i * 8, old);
    view.setUint32(12 + i * 8, guid);
  });
  let at = 8 + pairs.length * 8;
  view.setUint32(at, pairs.length);
  at += 4;
  paths.forEach((p, i) => {
    view.setUint32(at, p.length);
    out.set(p, at + 4);
    view.setUint32(at + 4 + p.length, pairs[i][1]);
    at += 8 + p.length;
  });
  return out;
}

test('a GUID resolves through the FileDB or the remap, from a FARC or loose', async () => {
  const packed = Uint8Array.of(1, 2, 3);
  const loose = Uint8Array.of(4, 5);
  const fileDB = writeFileDB({
    revision: 0x1480100,
    rows: [
      { path: 'gamedata/a.tex', date: 0, size: 3, sha1: await sha1(packed), guid: 10 },
      { path: 'gamedata/b.fsb', date: 0, size: 2, sha1: await sha1(loose), guid: 11 },
      { path: 'gamedata/c.tex', date: 0, size: 1, sha1: '11'.repeat(20), guid: 12 },
    ],
  });
  const game = await openGame({
    fileDB,
    remap: remapOf([[900, 10, 'gamedata/a.tex']]),
    farcs: [{ name: 'only.farc', access: inMemory(await writeFarc([packed])) }],
    loose: async (p) => (p === 'gamedata/b.fsb' ? loose : undefined),
  });
  assert.deepEqual(await game.resolve({ kind: 'guid', guid: 10, type: 1 }), packed);
  assert.deepEqual(await game.resolve({ kind: 'guid', guid: 900, type: 1 }), packed, 'through the remap');
  assert.deepEqual(await game.resolve({ kind: 'guid', guid: 11, type: 0 }), loose, 'loose');
  assert.equal(await game.resolve({ kind: 'guid', guid: 12, type: 1 }), undefined, 'in neither');
  assert.deepEqual(await game.resolve({ kind: 'sha1', sha1: await sha1(packed), type: 1 }), packed);
  assert.equal(game.row(900)?.path, 'gamedata/a.tex');
  await assert.rejects(looseFiles('.')('../outside'), /outside/);
  assert.equal(await looseFiles('.')('no/such/file'), undefined);
});

test("with its loose files, the biggest level of the game's gathers whole", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const game = await openGame({
    fileDB: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.map'))),
    remap: new Uint8Array(await readFile(path.join(GAME, 'output', 'orbisguids.remap'))),
    farcs: accesses.map((access, i) => ({ name: FARCS[i], access })),
    loose: looseFiles(GAME),
  });
  const level = [...game.db.values()].find((r) => r.path === 'gamedata/levels/goty_levels/x-nobody-x.bin')!;
  const { gathered, missing } = await gatherDependencies((await game.bySha1(level.sha1))!, (d) => game.resolve(d));
  // 1,256 through the FARCs alone (test/gather.test.ts), and the 18 rows they missed lie loose.
  assert.deepEqual([gathered.length, missing.length], [1256 + 11, 0]);
  for (const a of accesses) await a.close();
});
