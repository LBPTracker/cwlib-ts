import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { readStaticMesh } from '../src/resources/staticmesh.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

/**
 * A backdrop out of the game's FARCs; skips without `LBP_GAME`.
 * `dev/staticmesh-census.ts` is the same over all 47.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const PATH = 'gamedata/lbp3/unthemed/palettes/env_default_background_template.smh';

test("the default background template: a backdrop that reads, facing out", async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const row = [...db.values()].find((r) => r.path === PATH)!;
  let bytes: Uint8Array | undefined;
  for (const file of ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc']) {
    const access = await openFileAccess(path.join(GAME, file));
    bytes ??= await (await openFarc(access)).get(row.sha1);
    await access.close();
  }
  // readStaticMesh throws unless the chunks end on the dependency table and the
  // indices fill the payload after the vertices exactly.
  const m = await readStaticMesh(bytes!, nodeInflate);
  assert.ok(m.vertexCount > 0 && m.primitives.length > 0);
  assert.ok(m.lightmap && m.risemap && m.fallmap);
  let ccw = 0;
  let cw = 0;
  for (const p of m.primitives) {
    for (let i = 0; i < p.triangles.length; i += 3) {
      const [a, b, c] = [p.triangles[i] * 3, p.triangles[i + 1] * 3, p.triangles[i + 2] * 3];
      assert.ok(Math.max(a, b, c) < m.vertexCount * 3, 'indices, offset by vertexStart, stay inside');
      const P = m.positions;
      const N = m.normals;
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      let d = 0;
      for (const x of [a, b, c]) d += g[0] * N[x] + g[1] * N[x + 1] + g[2] * N[x + 2];
      if (d > 0) ccw += 1;
      else if (d < 0) cw += 1;
    }
  }
  assert.ok(ccw / (ccw + cw) > 0.98, `${ccw} counter-clockwise, ${cw} clockwise`);
});
