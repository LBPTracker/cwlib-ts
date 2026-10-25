import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB, readGuidRemap } from '../src/archives/filedb.ts';
import { gatherDependencies } from '../src/archives/gather.ts';
import { toHex } from '../src/io/hex.ts';
import type { Dependency } from '../src/io/resource.ts';
import { writeResource, type DependencyOut } from '../src/io/writer.ts';
import { nodeDeflate, openFileAccess } from '../src/platform/node.ts';

/**
 * A resource's dependencies gathered, as `Resources.collect` does; the game's
 * own skip without `LBP_GAME`. src/archives/gather.ts.
 */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const resource = (dependencies: DependencyOut[]): Promise<Uint8Array> => writeResource({
  magic: 'PLNb',
  revision: { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 },
  compressionFlags: 7,
  payload: Uint8Array.of(0),
  dependencies,
}, nodeDeflate);

test('each resource is gathered once, dependencies first, through a loop and past a gap', async () => {
  const texture = new TextEncoder().encode('TEX not a resource with a table');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', texture));
  // B names A back -- the loop 527 of the game's 534 scripts make with themselves.
  const b = await resource([{ guid: 1, type: 38 }, { hash, type: 1 }]);
  const a = await resource([{ guid: 2, type: 38 }, { hash, type: 1 }, { guid: 9, type: 38 }]);
  const bytes = (d: Dependency) => (d.kind === 'sha1' ? texture : d.guid === 1 ? a : d.guid === 2 ? b : undefined);
  const { gathered, missing } = await gatherDependencies(a, async (d) => bytes(d));
  assert.deepEqual(gathered.map((g) => g.bytes), [texture, b, a]);
  assert.deepEqual(gathered.map((g) => [g.guid, g.type]), [[undefined, 1], [2, 38], [undefined, undefined]]);
  assert.equal(gathered[0].sha1, toHex(hash));
  assert.deepEqual(missing, [{ kind: 'guid', guid: 9, type: 38 }]);
});

test("a plan and the biggest level of the game's gather whole but for what no FARC holds", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const { remap } = readGuidRemap(await readFile(path.join(GAME, 'output', 'orbisguids.remap')));
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const farcs = await Promise.all(accesses.map((a) => openFarc(a)));
  const bySha1 = async (sha1: string) => farcs.find((f) => f.entries.has(sha1))?.get(sha1);
  const row = (guid: number) => db.get(guid) ?? db.get(remap.get(guid)?.guid ?? -1);
  const resolve = async (d: Dependency) => (d.kind === 'sha1' ? bySha1(d.sha1) : row(d.guid) && bySha1(row(d.guid)!.sha1));
  const byPath = (p: string) => [...db.values()].find((r) => r.path === p)!;

  const plan = await gatherDependencies((await bySha1(byPath('gamedata/lbp3/__prologue/palettes/obj_jam_jar.plan').sha1))!, resolve);
  assert.deepEqual([plan.gathered.length, plan.missing.length], [11, 0]);

  const level = await gatherDependencies((await bySha1(byPath('gamedata/levels/goty_levels/x-nobody-x.bin').sha1))!, resolve);
  assert.deepEqual([level.gathered.length, level.missing.length], [1256, 18]);
  // Every row it cannot reach has a FileDB row: audio or a video no FARC holds, loose in the install.
  for (const m of level.missing) {
    assert.ok(m.kind === 'guid' && /\.(fsb|bik)$/.test(row(m.guid)?.path ?? ''), JSON.stringify(m));
  }
  for (const a of accesses) await a.close();
});
