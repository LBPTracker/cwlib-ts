/**
 * Which way V runs, measured on the bytes alone:
 *
 *   node dev/uv-census.ts                  LBP_GAME, default D:/PS4Games/CUSA00063
 *
 * A cut-out texture -- alpha-clipped, its diffuse a texture sample -- is drawn
 * only where its alpha is opaque, so the triangles of the meshes that use it
 * are laid over its opaque texels. For every such primitive, each triangle's
 * centroid is taken through the sample's `uvTransform` and looked up in the
 * texture's first level two ways: row `floor(v * height)` counted from the
 * file's first row, and the same with `v` flipped. The reading under which
 * more centroids land on opaque texels is the one the game uses. The same is
 * done for `u`, as a control: flipping U should lose too. Only sparse textures
 * (5--60% opaque), identity transforms and centroids inside the unit square
 * count, so no wrap mode or transform stands between the reading and the texel.
 *
 *   node dev/uv-census.ts transform
 *
 * does the same on the samples whose `uvTransform` is not the identity, wrapped,
 * comparing cwlib's transform against none -- each with V as stored and flipped.
 *
 * Nothing is written; the FARCs are read in place.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { openFarc, type Farc } from '../src/farc.ts';
import { readFileDB, readGuidRemap } from '../src/filedb.ts';
import { materialSummary, readMaterial, type GfxMaterial } from '../src/material.ts';
import { readMesh } from '../src/mesh.ts';
import { decodeLevel, readTexture } from '../src/texture.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { magicOf } from '../src/resource.ts';

const GAME = process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063';
/** `transform`: on the samples whose transform is not the identity, cwlib's reading against none. */
const TRANSFORM = process.argv[2] === 'transform';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
const { remap } = readGuidRemap(await readFile(path.join(GAME, 'output', 'orbisguids.remap')));
const rowOf = (guid: number) => db.get(guid) ?? db.get(remap.get(guid)?.guid ?? -1);

const archives: Farc[] = [];
const closers: (() => Promise<void>)[] = [];
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  archives.push(await openFarc(access));
  closers.push(() => access.close());
}
async function bytesOf(sha1: string): Promise<Uint8Array | undefined> {
  for (const farc of archives) {
    const bytes = await farc.get(sha1);
    if (bytes) return bytes;
  }
  return undefined;
}

const materials = new Map<number, GfxMaterial | null>();
async function materialOf(guid: number): Promise<GfxMaterial | undefined> {
  if (!materials.has(guid)) {
    const row = rowOf(guid);
    const bytes = row && (await bytesOf(row.sha1));
    materials.set(guid, bytes ? await readMaterial(bytes, nodeInflate) : null);
  }
  return materials.get(guid) ?? undefined;
}
interface Alpha { width: number; height: number; alpha: Uint8Array; opaque: number }
const alphas = new Map<number, Alpha | null>();
async function alphaOf(guid: number): Promise<Alpha | undefined> {
  if (!alphas.has(guid)) {
    let found: Alpha | null = null;
    const row = rowOf(guid);
    const bytes = row && (await bytesOf(row.sha1));
    if (bytes) {
      const t = await readTexture(bytes, nodeInflate);
      const level = t.levels[0][0];
      const rgba = decodeLevel(t.format, level);
      const alpha = new Uint8Array(level.width * level.height);
      let opaque = 0;
      for (let i = 0; i < alpha.length; i += 1) {
        alpha[i] = rgba[i * 4 + 3];
        if (alpha[i] >= 128) opaque += 1;
      }
      found = { width: level.width, height: level.height, alpha, opaque: opaque / alpha.length };
    }
    alphas.set(guid, found);
  }
  return alphas.get(guid) ?? undefined;
}

const fract = (x: number): number => x - Math.floor(x);
const totals = { asIs: 0, flipV: 0, flipU: 0, both: 0, triangles: 0 };
let primitives = 0;
const wins = { asIs: 0, flipV: 0, flipU: 0, both: 0, tie: 0 };
const meshes: string[] = [];
for (const farc of archives) for (const e of farc.entries.values()) meshes.push(e.sha1);
const seen = new Set<string>();
for (const sha1 of meshes) {
  if (seen.has(sha1)) continue;
  seen.add(sha1);
  const bytes = (await bytesOf(sha1))!;
  if (bytes.length < 8 || magicOf(bytes) !== 'MSHb') continue;
  const mesh = await readMesh(bytes, nodeInflate);
  for (const p of mesh.primitives) {
    if (!p.material) continue;
    const m = await materialOf(p.material.guid);
    if (!m) continue;
    const s = materialSummary(m);
    const sample = s.diffuse?.sample;
    if (!s.alphaClipEnabled || s.diffuse?.shape !== 'texture' || !sample?.texture) continue;
    const tex = await alphaOf(sample.texture.guid);
    // Only a texture with both opaque and clear parts can tell the readings apart.
    // A sparse texture is the one that can tell the readings apart; a near-solid one cannot.
    if (!tex || tex.opaque < 0.05 || tex.opaque > 0.6) continue;
    const identity = sample.uvTransform.map((x) => x + 0).join() === '1,0,0,0,1,0';
    if (identity === TRANSFORM) continue;
    const uv = mesh.uvs[sample.uvChannel];
    if (!uv) continue;
    const [a, b, c, d, e, f] = sample.uvTransform;
    const hits = { asIs: 0, flipV: 0, flipU: 0, both: 0 };
    let n = 0;
    for (let i = 0; i < p.triangles.length; i += 3) {
      let u0 = 0;
      let v0 = 0;
      for (let k = 0; k < 3; k += 1) {
        u0 += uv[p.triangles[i + k] * 2] / 3;
        v0 += uv[p.triangles[i + k] * 2 + 1] / 3;
      }
      let u: number;
      let v: number;
      if (TRANSFORM) {
        // Wrapped, as the sample's slot says on nearly all (1, wrap). The four
        // readings become: cwlib's transform, none, and each with V flipped.
        u = fract(a * u0 + b * v0 + c);
        v = fract(d * u0 + e * v0 + f);
      } else {
        // Inside the unit square only: no wrap mode stands between the reading and the texel.
        if (u0 < 0 || u0 > 1 || v0 < 0 || v0 > 1) continue;
        u = u0;
        v = v0;
      }
      const [ru, rv] = [fract(u0), fract(v0)];
      const at = (x: number, y: number): boolean =>
        tex.alpha[Math.min(tex.height - 1, Math.floor(y * tex.height)) * tex.width + Math.min(tex.width - 1, Math.floor(x * tex.width))] >= 128;
      if (at(u, v)) hits.asIs += 1;
      if (at(u, 1 - v)) hits.flipV += 1;
      if (TRANSFORM ? at(ru, rv) : at(1 - u, v)) hits.flipU += 1;
      if (TRANSFORM ? at(ru, 1 - rv) : at(1 - u, 1 - v)) hits.both += 1;
      n += 1;
    }
    if (n < 4) continue;
    primitives += 1;
    totals.triangles += n;
    for (const k of ['asIs', 'flipV', 'flipU', 'both'] as const) totals[k] += hits[k];
    const best = Math.max(hits.asIs, hits.flipV, hits.flipU, hits.both);
    const winners = (['asIs', 'flipV', 'flipU', 'both'] as const).filter((k) => hits[k] === best);
    // Decisive: the best reading ahead of the next by a tenth of the triangles.
    const second = Math.max(...(['asIs', 'flipV', 'flipU', 'both'] as const).filter((k) => k !== winners[0]).map((k) => hits[k]));
    if (winners.length > 1 || best - second < n / 10) wins.tie += 1;
    else wins[winners[0]] += 1;
  }
}
for (const close of closers) await close();

console.log(`${primitives} alpha-clipped primitives with a sparse cut-out diffuse texture and ${TRANSFORM ? 'a transform other than the identity' : 'an identity transform'}, ${totals.triangles} triangles`);
const pct = (x: number): string => `${((100 * x) / totals.triangles).toFixed(1)}%`;
const names = TRANSFORM
  ? { asIs: 'cwlib transform', flipV: 'cwlib transform, V flipped', flipU: 'no transform', both: 'no transform, V flipped' }
  : { asIs: 'as stored', flipV: 'V flipped', flipU: 'U flipped', both: 'both flipped' };
const keys = ['asIs', 'flipV', 'flipU', 'both'] as const;
console.log(`centroids on opaque texels: ${keys.map((k) => `${names[k]} ${pct(totals[k])}`).join(', ')}`);
console.log(`primitives decided by more than a tenth of their triangles: ${keys.map((k) => `${names[k]} ${wins[k]}`).join(', ')}, undecided ${wins.tie}`);
