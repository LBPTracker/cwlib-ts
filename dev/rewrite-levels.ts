/**
 * Every `LVLb`, `PLNb` and `CHKb` read onto a tape and written back, compared
 * byte for byte:
 *
 *   node dev/rewrite-levels.ts [dir…]     LBP_GAME required, LBP_PATCH optional
 *
 * The levels and plans of the game's FARCs, of the 01.28 update's
 * `patch_001.farc` when `LBP_PATCH` names it, and of every file of each `dir`;
 * the chunks of every `FAR4` under the install's `gamedata/` (and the update's),
 * each island's plan written on its own as well. A compressed file is compared
 * by its inflated payload and its dependency table, since the zlib streams are
 * this machine's; an uncompressed one -- every chunk and island -- whole. A
 * level or plan written is read again and must hold as many Things. Prints the
 * tally, and each file that did not match -- the numbers in
 * steering/level-files.md, *Writing a level*.
 */

import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';

import { openFarc } from '../src/archives/farc.ts';
import { readFar } from '../src/archives/savearchive.ts';
import { readLevel, readPlan } from '../src/things/level.ts';
import {
  editChunk, editLevel, editPlan, openIsland, writeChunk, writeLevel, writeLevelPayload, writePlan, writePlanPayload,
  type EditableThings,
} from '../src/things/write-level.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { loadResource, magicOf } from '../src/io/resource.ts';
import { FARCS, GAME } from './game.ts';

const counts: Record<string, number> = {};
const examples = new Map<string, string>();
const bump = (key: string, example?: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
  if (example !== undefined && !examples.has(key)) examples.set(key, example);
};

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** The dependency table: from its offset to the file's end. */
const table = (bytes: Uint8Array): Uint8Array =>
  bytes.subarray(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false));

/** Why a file would not open, folded so that one cause is one line. */
function refusal(magic: string, name: string, error: unknown): void {
  const message = (error as Error).message;
  bump(/outside the range|older than the header layout/.test(message)
    ? `${magic} refused by the version bound`
    : `${magic} does not open: ${message.replace(/\d+/g, 'N').slice(0, 90)}`, name);
}

/** A written file against the one it was read from: whole when it is stored, else payload and table. */
async function compare(magic: string, name: string, bytes: Uint8Array, written: Uint8Array, payload?: Uint8Array): Promise<void> {
  const original = await loadResource(bytes, nodeInflate);
  if (!original.isCompressed) {
    if (same(bytes, written)) bump(`${magic} identical, whole`);
    else {
      bump(`${magic} differs`);
      console.log(`${name}: ${magic} differs (${bytes.length} → ${written.length} bytes)`);
    }
    return;
  }
  const ok = same(original.data, payload ?? (await loadResource(written, nodeInflate)).data) && same(table(bytes), table(written));
  bump(ok ? `${magic} identical, payload and table` : `${magic} differs`);
  if (!ok) console.log(`${name}: ${magic} payload or table differs`);
}

async function again(magic: string, name: string, written: Uint8Array, target: EditableThings): Promise<void> {
  const read = await (magic === 'LVLb' ? readLevel : readPlan)(written, nodeInflate);
  if (read.things.length === target.parse.things.length && read.unreadTail === undefined) bump(`${magic} re-read whole`);
  else console.log(`${name}: re-read ${read.things.length} of ${target.parse.things.length} Things, ${read.unreadTail ?? 'whole'}`);
}

async function check(source: string, name: string, bytes: Uint8Array): Promise<void> {
  const magic = magicOf(bytes);
  try {
    if (magic === 'LVLb') {
      const level = await editLevel(bytes, nodeInflate);
      bump(`LVLb opened from ${source}`);
      const written = await writeLevel(level, nodeDeflate);
      await compare(magic, name, bytes, written, writeLevelPayload(level));
      await again(magic, name, written, level);
    } else if (magic === 'PLNb') {
      const plan = await editPlan(bytes, nodeInflate);
      bump(`PLNb opened from ${source}`);
      const written = await writePlan(plan, nodeDeflate);
      await compare(magic, name, bytes, written, writePlanPayload(plan));
      await again(magic, name, written, plan);
    } else if (magic === 'CHKb') {
      const chunk = await editChunk(bytes, nodeInflate);
      bump(`CHKb opened from ${source}`);
      await compare(magic, name, bytes, await writeChunk(chunk, nodeDeflate));
      for (let i = 0; i < chunk.islands.length; i += 1) {
        const island = `${name} island ${i}`;
        let plan;
        try {
          plan = await openIsland(chunk, i, nodeInflate);
        } catch (error) {
          refusal('island', island, error);
          continue;
        }
        bump('island opened');
        await compare('island', island, chunk.islands[i]!.bytes, await writePlan(plan, nodeDeflate), writePlanPayload(plan));
      }
    }
  } catch (error) {
    refusal(magic, name, error);
  }
}

const archives = FARCS.map((file) => path.join(GAME, file));
if (process.env.LBP_PATCH) archives.push(path.join(process.env.LBP_PATCH, 'patch_001.farc'));
const seen = new Set<string>();
for (const file of archives) {
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 8));
      if (magic !== 'LVLb' && magic !== 'PLNb') continue;
      await check(path.basename(file), `${path.basename(file)} ${entry.sha1}`, (await farc.get(entry.sha1))!);
    }
  } finally {
    await access.close();
  }
}

/** The story levels' chunk archives: every `FAR4` under `gamedata/` that is not a container. */
const chunkArchives: string[] = [];
const walkSync = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) walkSync(at);
    else if (name.endsWith('.farc') && !name.includes('_container')) chunkArchives.push(at);
  }
};
const roots = [GAME, process.env.LBP_PATCH].filter((root): root is string => root !== undefined);
const installed = new Set<string>();
for (const root of roots) {
  const before = chunkArchives.length;
  walkSync(path.join(root, 'gamedata'));
  if (root === GAME) for (const file of chunkArchives.slice(before)) installed.add(file);
}
for (const file of chunkArchives) {
  for (const { sha1, bytes } of await readFar(new Uint8Array(await readFile(file)))) {
    if (seen.has(sha1) || magicOf(bytes) !== 'CHKb') continue;
    seen.add(sha1);
    await check(installed.has(file) ? 'the install' : 'the update', `${path.basename(file)} ${sha1}`, bytes);
  }
}

const walk = async (at: string): Promise<string[]> =>
  (await stat(at)).isDirectory()
    ? (await Promise.all((await readdir(at)).map((name) => walk(path.join(at, name))))).flat()
    : [at];
for (const dir of process.argv.slice(2)) {
  for (const file of await walk(dir)) {
    const bytes = new Uint8Array(await readFile(file));
    if (['LVLb', 'PLNb', 'CHKb'].includes(magicOf(bytes))) await check(path.basename(dir), path.relative(dir, file), bytes);
  }
}

for (const [key, n] of Object.entries(counts).sort()) {
  console.log(`${String(n).padStart(7)}  ${key}${examples.has(key) ? `  (e.g. ${examples.get(key)})` : ''}`);
}
