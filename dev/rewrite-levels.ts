/**
 * Every `LVLb` read onto a tape and written back, compared byte for byte:
 *
 *   node dev/rewrite-levels.ts [dir…]     LBP_GAME required, LBP_PATCH optional
 *
 * The game's FARCs, the 01.28 update's `patch_001.farc` when `LBP_PATCH` names
 * it, and every file of each `dir` that is a level. For each level the payload
 * `writeLevelPayload` writes is compared with the one the file inflates to, and
 * the dependency table `writeLevel` writes with the file's own; the written
 * file is then read again and must hold as many Things. Prints the tally, and
 * the first differing byte of each level that did not match -- the numbers in
 * steering/level-files.md, *Writing a level*.
 */

import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

import { openFarc } from '../src/archives/farc.ts';
import { readLevel } from '../src/things/level.ts';
import { editLevel, writeLevel, writeLevelPayload } from '../src/things/write-level.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { loadResource, magicOf } from '../src/io/resource.ts';
import { FARCS, GAME } from './game.ts';

const counts: Record<string, number> = {};
const bump = (key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};
const examples = new Map<string, string>();

const firstDifference = (a: Uint8Array, b: Uint8Array): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

/** The dependency table: from its offset to the file's end. */
const table = (bytes: Uint8Array): Uint8Array =>
  bytes.subarray(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false));

async function check(source: string, name: string, bytes: Uint8Array): Promise<void> {
  let level;
  try {
    level = await editLevel(bytes, nodeInflate);
  } catch (error) {
    const message = (error as Error).message;
    const key = /outside the LBP3 range|older than the header layout/.test(message)
      ? 'refused by the version bound'
      : `does not open: ${message.replace(/\d+/g, 'N').slice(0, 90)}`;
    bump(key);
    if (!examples.has(key)) examples.set(key, name);
    return;
  }
  bump('opened');
  bump(`opened from ${source}`);
  const original = (await loadResource(bytes, nodeInflate)).data;
  const payload = writeLevelPayload(level);
  const at = firstDifference(original, payload);
  if (at === -1) bump('payload identical');
  else {
    bump('payload differs');
    console.log(`${name}: payload differs at ${at} of ${original.length} (written ${payload.length})`);
  }
  const written = await writeLevel(level, nodeDeflate);
  if (firstDifference(table(bytes), table(written)) === -1) bump('dependency table identical');
  else {
    bump('dependency table differs');
    console.log(`${name}: dependency table differs`);
  }
  const again = await readLevel(written, nodeInflate);
  if (again.things.length === level.parse.things.length && again.unreadTail === undefined) bump('re-read whole');
  else console.log(`${name}: re-read ${again.things.length} of ${level.parse.things.length} Things, ${again.unreadTail ?? 'whole'}`);
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
      if (magicOf(await access.read(entry.offset, 8)) !== 'LVLb') continue;
      await check(path.basename(file), `${path.basename(file)} ${entry.sha1}`, (await farc.get(entry.sha1))!);
    }
  } finally {
    await access.close();
  }
}

const walk = async (at: string): Promise<string[]> =>
  (await stat(at)).isDirectory()
    ? (await Promise.all((await readdir(at)).map((name) => walk(path.join(at, name))))).flat()
    : [at];
for (const dir of process.argv.slice(2)) {
  for (const file of await walk(dir)) {
    const bytes = new Uint8Array(await readFile(file));
    if (magicOf(bytes) === 'LVLb') await check(path.basename(dir), path.relative(dir, file), bytes);
  }
}

for (const [key, n] of Object.entries(counts).sort()) {
  console.log(`${String(n).padStart(6)}  ${key}${examples.has(key) ? `  (e.g. ${examples.get(key)})` : ''}`);
}
