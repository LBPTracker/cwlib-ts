/**
 * The game's story levels: every per-level archive under `gamedata/` and every
 * streaming chunk in it, through `readThings`:
 *
 *   node dev/story-census.ts               LBP_GAME, default D:/PS4Games/CUSA00063
 *
 * ❗ The story chunks are not in the four FARCs. Each level has a `.farc` --
 * which is a `FAR4` in the clear, not a FARC -- beside its `_container.farc`
 * (`gamedata/lbp3/official_adventure_levels/…`), and they hold nothing but
 * `CHKb`. `readFar` opens them and checks every SHA-1. Prints how many chunks
 * read, their Things, and the islands that did not, grouped by error --
 * steering/level-files.md, *Streaming levels* -- and then the shapes, the
 * level's material geometry: the checks behind *Shapes* there.
 */

import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { readThings } from '../src/level.ts';
import type { GeneratedMeshPart, ShapePart } from '../src/parts.ts';
import type { Thing } from '../src/thing.ts';
import { readFar } from '../src/savearchive.ts';
import { nodeInflate } from '../src/platform/node.ts';

const ROOT = path.join(process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063', 'gamedata');

const archives: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) walk(at);
    else if (name.endsWith('.farc')) archives.push(at);
  }
};
walk(ROOT);

const tally = new Map<string, number>();
const example = new Map<string, string>();
const bump = (key: string, what = '', by = 1): void => {
  tally.set(key, (tally.get(key) ?? 0) + by);
  if (what && !example.has(key)) example.set(key, what);
};
/** What a shape's bytes say about how it is drawn. */
function shape(thing: Thing): void {
  const part = thing.parts.get('SHAPE') as ShapePart | undefined;
  if (part === undefined) return;
  const mesh = thing.parts.get('GENERATED_MESH') as GeneratedMeshPart | undefined;
  const pos = thing.parts.get('POS') as Float32Array | undefined;
  const count = part.vertices.length / 3;
  bump('shape: shapes');
  bump(`shape: with a GENERATED_MESH ${mesh !== undefined}`);
  bump(`shape: loops sum ${part.loops.reduce((a, b) => a + b, 0) === count ? 'to' : 'NOT to'} the vertex count`);
  bump(`shape: loops ${part.loops.length > 1 ? 'more than one' : part.loops.length}`);
  if (part.requiresZ) {
    const zs = new Set<number>();
    for (let i = 2; i < part.vertices.length; i += 3) zs.add(Math.round(part.vertices[i]));
    const kind = zs.size === 1 && zs.has(0) ? 'all 0'
      : pos && zs.size === 1 && Math.round(pos[14]) === -[...zs][0] ? "all minus the Thing's world z"
      : zs.size === 1 ? 'one other value' : 'varying';
    bump(`shape: stored z ${kind}`);
  } else bump('shape: no stored z');
  if (pos) {
    bump(`shape: world z ${Math.round(pos[14]) % 100 === 0 ? 'a multiple of 100' : 'not a multiple of 100'}`);
    bump(`shape: thickness ${[10, 50, 90, 190].includes(Math.round(part.thickness)) ? Math.round(part.thickness) : 'other'}`);
  }
  if (mesh) {
    bump(`shape: visibilityFlags ${mesh.visibilityFlags}`);
    bump(`shape: gfx material ${mesh.gfxMaterial ? 'named' : 'none'}, bevel ${mesh.bevel ? 'named' : 'none'}`);
  }
}

for (const file of archives) {
  const where = path.relative(ROOT, file);
  const resources = await readFar(new Uint8Array(await readFile(file)));
  bump('archives');
  for (const { sha1, bytes } of resources) {
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    bump(`resource ${JSON.stringify(magic)}`);
    if (magic !== 'CHKb') continue;
    bump(`subVersion 0x${new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, false).toString(16)}`);
    try {
      const parse = await readThings(bytes, nodeInflate);
      bump('chunks read');
      bump('Things', '', parse.things.length);
      for (const thing of parse.things) if (thing) shape(thing);
      for (const problem of parse.problems ?? []) bump(`island problem: ${problem.replace(/\d+/g, 'N').slice(0, 100)}`, `${where} ${sha1}`);
    } catch (error) {
      bump(`chunk FAILED: ${(error as Error).message.replace(/\d+/g, 'N').slice(0, 100)}`, `${where} ${sha1}`);
    }
  }
}
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}${example.has(key) ? `   e.g. ${example.get(key)}` : ''}`);
