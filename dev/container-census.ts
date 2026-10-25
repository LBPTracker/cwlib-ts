/**
 * Every file of the formats with a container of their own -- `SMHb`, `GTF `,
 * `TEX `, `INSb` out of the game's FARCs, `FNTb` out of its loose
 * `gamedata/fonts/` -- written from its read value and checked against the
 * file:
 *
 *   node dev/container-census.ts [limit]     LBP_GAME required, LBP_PATCH optional
 *
 * ⚠️ **The zlib streams are this machine's, not the game's**, so a chunked file
 * is compared everywhere but its compressed bytes: the header before the chunk
 * table (a dependency offset, which moves with the compressed sizes, aside --
 * the written one is checked to land on the written chunks' end instead), the
 * chunk count and every chunk's raw size, the inflated payload byte for byte,
 * and the dependency table after the chunks byte for byte. A font has no
 * chunks and is compared whole.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { inflateChunkTable, loadResource, magicOf } from '../src/io/resource.ts';
import { Serializer } from '../src/io/serializer.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readFontFace, writeFontFace } from '../src/resources/font-face.ts';
import { readInstrumentFile, writeInstrument } from '../src/resources/instrument.ts';
import { readStaticMesh, readStaticMeshInfo, writeStaticMesh } from '../src/resources/staticmesh.ts';
import { readTexture, writeTexture } from '../src/resources/texture.ts';
import { FARCS, GAME } from './game.ts';

/** A file cut where the comparison cuts it. */
interface Layout {
  /** The bytes before the chunk table, the dependency offset zeroed. */
  readonly header: Uint8Array;
  readonly raws: readonly number[];
  readonly data: Uint8Array;
  /** The bytes after the chunks. */
  readonly tail: Uint8Array;
  /** The header's dependency offset, and where the chunks end. */
  readonly offset?: number;
  readonly end: number;
}

async function chunked(bytes: Uint8Array, tableAt: number, offsetField: boolean, storedEnd?: number): Promise<Layout> {
  const header = bytes.slice(0, tableAt);
  let offset: number | undefined;
  if (offsetField) {
    offset = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, false);
    header.fill(0, 8, 12);
  }
  const { chunks, data, end } = await inflateChunkTable(bytes, tableAt, nodeInflate, { storedEnd });
  return { header, raws: chunks.map((c) => c.rawSize), data, tail: bytes.subarray(end), offset, end };
}

async function layoutOf(magic: string, bytes: Uint8Array): Promise<Layout> {
  if (magic === 'GTF ') return chunked(bytes, 0x1c, false);
  if (magic === 'TEX ') return chunked(bytes, 4, false);
  if (magic === 'SMHb') {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const head = view.getUint32(4, false);
    const s = new Serializer(bytes.subarray(0x0c, view.getUint32(8, false)), { version: head & 0xffff, subVersion: head >>> 16, branchId: 0, branchRevision: 0 }, 0);
    readStaticMeshInfo(s);
    return chunked(bytes, 0x0c + s.position, true);
  }
  // A resource: the header is everything `loadResource` reads before the table.
  const r = await loadResource(bytes, nodeInflate);
  const head = r.revision.raw;
  const modern = head >= 0x189;
  const tableAt = 0x0c + (modern && head >= 0x271 ? 4 : 0) + (modern && (head >= 0x297 || (head === 0x272 && r.branchId === 0x4c44 && r.branchRevision >= 2)) ? 1 : 0) + (modern ? 1 : 0);
  if (!r.isCompressed) {
    const header = bytes.slice(0, tableAt);
    header.fill(0, 8, 12);
    return { header, raws: [], data: r.data, tail: bytes.subarray(r.dependencyTableOffset), offset: r.dependencyTableOffset, end: r.dependencyTableOffset };
  }
  return chunked(bytes, tableAt, true, r.dependencyTableOffset);
}

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** What differs between the game's file and ours, or undefined. */
async function compare(magic: string, game: Uint8Array, ours: Uint8Array): Promise<string | undefined> {
  if (magic === 'FNTb') {
    if (equal(game, ours)) return undefined;
    const n = Math.min(game.length, ours.length);
    let i = 0;
    while (i < n && game[i] === ours[i]) i += 1;
    return `file at ${i} of ${game.length} (written ${ours.length})`;
  }
  const a = await layoutOf(magic, game);
  const b = await layoutOf(magic, ours);
  if (b.offset !== undefined && b.offset !== b.end) return `written dependency offset ${b.offset}, chunks end ${b.end}`;
  if (!equal(a.header, b.header)) return `header (${a.header.length} / ${b.header.length} bytes)`;
  if (a.raws.join() !== b.raws.join()) return `chunk raw sizes ${a.raws.slice(0, 4)} / ${b.raws.slice(0, 4)} (${a.raws.length} / ${b.raws.length})`;
  if (!equal(a.data, b.data)) {
    let i = 0;
    while (i < a.data.length && a.data[i] === b.data[i]) i += 1;
    return `payload at ${i} of ${a.data.length} (written ${b.data.length})`;
  }
  if (!equal(a.tail, b.tail)) return `dependency table (${a.tail.length} / ${b.tail.length} bytes)`;
  return undefined;
}

const WRITE: Record<string, (bytes: Uint8Array) => Promise<Uint8Array>> = {
  'SMHb': async (b) => writeStaticMesh(await readStaticMesh(b, nodeInflate), nodeDeflate),
  'GTF ': async (b) => writeTexture(await readTexture(b, nodeInflate), nodeDeflate),
  'TEX ': async (b) => writeTexture(await readTexture(b, nodeInflate), nodeDeflate),
  'INSb': async (b) => writeInstrument(await readInstrumentFile(b, nodeInflate), nodeDeflate),
  'FNTb': async (b) => writeFontFace(readFontFace(b), nodeDeflate),
};

const limit = Number(process.argv[2] ?? Infinity);
const rows = new Map<string, { same: number; differ: number; threw: number; unread: number; examples: string[] }>();
const row = (magic: string) => rows.get(magic) ?? rows.set(magic, { same: 0, differ: 0, threw: 0, unread: 0, examples: [] }).get(magic)!;

async function check(magic: string, where: string, bytes: Uint8Array): Promise<void> {
  const r = row(magic);
  if (r.same + r.differ + r.threw + r.unread >= limit) return;
  let written: Uint8Array;
  try {
    written = await WRITE[magic](bytes);
  } catch (error) {
    // A file the reader refuses is unread; one the writer refuses threw.
    try {
      if (magic === 'FNTb') readFontFace(bytes);
      else if (magic === 'INSb') await readInstrumentFile(bytes, nodeInflate);
      else if (magic === 'SMHb') await readStaticMesh(bytes, nodeInflate);
      else await readTexture(bytes, nodeInflate);
    } catch {
      r.unread += 1;
      return;
    }
    r.threw += 1;
    if (r.examples.length < 3) r.examples.push(`${where} threw ${(error as Error).message.slice(0, 100)}`);
    return;
  }
  const diff = await compare(magic, bytes, written);
  if (diff === undefined) r.same += 1;
  else {
    r.differ += 1;
    if (r.examples.length < 3) r.examples.push(`${where}: ${diff}`);
  }
}

const archives = FARCS.map((f) => path.join(GAME, f));
if (process.env.LBP_PATCH) archives.push(path.join(process.env.LBP_PATCH, 'patch_001.farc'));
const seen = new Set<string>();
for (const file of archives) {
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 4));
      if (!(magic in WRITE) || magic === 'FNTb') continue;
      await check(magic, `${path.basename(file)} ${entry.sha1.slice(0, 8)}`, (await farc.get(entry.sha1))!);
    }
  } finally {
    await access.close();
  }
}
for (const root of [GAME, process.env.LBP_PATCH]) {
  const fonts = root && path.join(root, 'gamedata', 'fonts');
  if (!fonts || !existsSync(fonts)) continue;
  for (const name of (await readdir(fonts)).filter((f) => f.endsWith('.fnt'))) {
    await check('FNTb', name, new Uint8Array(await readFile(path.join(fonts, name))));
  }
}
for (const [magic, r] of rows) {
  console.log(`${magic} ${r.same} same, ${r.differ} differ, ${r.threw} threw, ${r.unread} unread`);
  for (const e of r.examples) console.log(`  e.g. ${e}`);
}
