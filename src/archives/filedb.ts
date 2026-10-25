/**
 * The **FileDB** (`.map`) -- the game's table from a GUID to a path and a SHA-1.
 *
 * A GUID dependency names a game asset; the FileDB says which bytes that is,
 * and the FARCs (`farc.ts`) hold the bytes by SHA-1. The toolkit's `.mod`
 * carries one too, as `data.map` (`mod.ts`).
 *
 * The row layout was cwlib's `types/databases/FileDB.java` (`process`) and is
 * measured on the game's own `output/orbisguids.map`: 107,673 LBP3 rows whose
 * walk ends on the file's last byte. See steering/level-files.md.
 *
 * ```
 * u32  revision            (revision >> 16) >= 0x148 picks the LBP3 row
 * u32  count
 * per row        LBP3            LBP2
 *   path length  u16             u32
 *   path         utf-8, no NUL
 *   date         u32             s64        seconds
 *   size         u32
 *   sha1         20 bytes
 *   guid         u32
 * ```
 *
 * ⚠️ The LBP2 row is cwlib's reading only: no LBP2 FileDB was on this disk.
 */

import { toHex } from '../io/hex.ts';

/** One FileDB row. */
export interface FileDBEntry {
  readonly path: string;
  /** Seconds since 1970; 0 on some game rows. */
  readonly date: number;
  readonly size: number;
  /** Lower-case hex. All zeros on a row with no bytes behind it. */
  readonly sha1: string;
  readonly guid: number;
}

/** The revision that starts the LBP3 row: `u16` path length and a `u32` date. */
const LBP3_HEAD = 0x148;

/**
 * Read a FileDB into a GUID → row lookup, in the file's own row order.
 *
 * A GUID that appears twice keeps its first row, as `FileDB.process` does --
 * the game's own database has none, so that rule is cwlib's and untested.
 */
export function readFileDB(bytes: Uint8Array): Map<number, FileDBEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) throw new Error('FileDB is shorter than its header');
  const lbp3 = (view.getUint32(0, false) >>> 16) >= LBP3_HEAD;
  const count = view.getUint32(4, false);
  const decoder = new TextDecoder();
  const rows = new Map<number, FileDBEntry>();
  let at = 8;
  for (let i = 0; i < count; i += 1) {
    if (at + (lbp3 ? 2 : 4) > bytes.length) throw new Error('FileDB runs past its end');
    const length = lbp3 ? view.getUint16(at, false) : view.getUint32(at, false);
    at += lbp3 ? 2 : 4;
    if (at + length + (lbp3 ? 4 : 8) + 28 > bytes.length) throw new Error('FileDB runs past its end');
    const path = decoder.decode(bytes.subarray(at, at + length));
    at += length;
    const date = lbp3 ? view.getUint32(at, false) : Number(view.getBigInt64(at, false));
    at += lbp3 ? 4 : 8;
    const size = view.getUint32(at, false);
    const sha1 = toHex(bytes.subarray(at + 4, at + 24));
    const guid = view.getUint32(at + 24, false);
    at += 28;
    if (!rows.has(guid)) rows.set(guid, { path, date, size, sha1, guid });
  }
  return rows;
}

/** Rows in the order given; each of `FileDBEntry`, with `sha1` as hex. */
export interface FileDBRows {
  /** The head word: `(revision >> 16) >= 0x148` writes the LBP3 row. */
  readonly revision: number;
  readonly rows: readonly FileDBEntry[];
}

/**
 * Write a FileDB: the layout `readFileDB` reads, cwlib's `FileDB.build`. Rows go
 * out in the order given -- sort them first for the GUID order `build` uses.
 *
 * ✔ **The game's own `output/orbisguids.map` comes back byte for byte**, read
 * with `readFileDB` and written with its own revision (`test/filedb.test.ts`).
 */
export function writeFileDB({ revision, rows }: FileDBRows): Uint8Array {
  const lbp3 = (revision >>> 16) >= LBP3_HEAD;
  const encoder = new TextEncoder();
  const paths = rows.map((row) => encoder.encode(row.path));
  const rowSize = (lbp3 ? 2 + 4 : 4 + 8) + 28;
  const out = new Uint8Array(8 + paths.reduce((sum, p) => sum + rowSize + p.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, revision >>> 0, false);
  view.setUint32(4, rows.length, false);
  let at = 8;
  rows.forEach((row, i) => {
    const path = paths[i];
    if (lbp3) {
      if (path.length > 0xffff) throw new Error(`a FileDB path of ${path.length} bytes`);
      view.setUint16(at, path.length, false);
      at += 2;
    } else {
      view.setUint32(at, path.length, false);
      at += 4;
    }
    out.set(path, at);
    at += path.length;
    if (lbp3) {
      view.setUint32(at, row.date >>> 0, false);
      at += 4;
    } else {
      view.setBigInt64(at, BigInt(row.date), false);
      at += 8;
    }
    view.setUint32(at, row.size >>> 0, false);
    if (!/^[0-9a-f]{40}$/.test(row.sha1)) throw new Error(`a FileDB row's SHA-1 is not 40 hex digits: ${row.sha1}`);
    for (let k = 0; k < 20; k += 1) out[at + 4 + k] = parseInt(row.sha1.slice(k * 2, k * 2 + 2), 16);
    view.setUint32(at + 24, row.guid >>> 0, false);
    at += 28;
  });
  return out;
}

/** The head word of a FileDB, which `readFileDB` reads and does not return. */
export function fileDBRevision(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
}

/** One row of `orbisguids.remap`: where an old GUID went. */
export interface GuidRemap {
  /** The GUID the PS4 build gives the asset; a FileDB row for 36,326 of 56,271. */
  readonly guid: number;
  /** The asset's old path, `gamedata/gmat/….gmat` where its new row says `gamedata_orbis/…`. */
  readonly path: string;
}

/**
 * Read `output/orbisguids.remap`: the PS4 build's table from an asset's old
 * GUID to the one it was re-exported under.
 *
 * ❗ **The game's meshes name their materials, and the materials their
 * textures, by the old GUID**, which has no FileDB row: of the material GUIDs
 * on the game's mesh primitives only 679 of 12,346 resolve without it. Resolve
 * a GUID through the FileDB first, and through this when that misses.
 *
 * cwlib's `types/databases/RemapDB.java` reads the same layout and calls the
 * pair `(to, from)`, the way its toolkit uses it -- to turn a PS4 FileDB back
 * into the old GUIDs. ⚠️ Its comment that the path row's GUID is "the same as
 * row.to" is wrong: it is the pair's second word, the new GUID. Measured on
 * LBP3 PS4 1.28's own file (steering/level-files.md, *The GUID remap*):
 *
 * ```
 * u32  0x00ea03e7          not understood; kept as `revision`
 * u32  n
 * n x  u32 old, u32 new
 * u32  n again
 * n x  u32 length, path (no NUL), u32 new   -- row i is pair i's new GUID, 56,271 of 56,271
 * ```
 *
 * The walk ends on the file's last byte; no old GUID is a FileDB row (0 of
 * 56,271), and no GUID appears twice on either side.
 */
export function readGuidRemap(bytes: Uint8Array): { revision: number; remap: Map<number, GuidRemap> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8) throw new Error('GUID remap is shorter than its header');
  const revision = view.getUint32(0, false);
  const count = view.getUint32(4, false);
  let at = 8 + count * 8;
  if (at + 4 > bytes.length || view.getUint32(at, false) !== count) {
    throw new Error('GUID remap: the path table does not follow the pairs');
  }
  at += 4;
  const decoder = new TextDecoder();
  const remap = new Map<number, GuidRemap>();
  for (let i = 0; i < count; i += 1) {
    if (at + 4 > bytes.length) throw new Error('GUID remap runs past its end');
    const length = view.getUint32(at, false);
    if (at + 4 + length + 4 > bytes.length) throw new Error('GUID remap runs past its end');
    const path = decoder.decode(bytes.subarray(at + 4, at + 4 + length));
    at += 4 + length;
    const guid = view.getUint32(at, false);
    at += 4;
    const old = view.getUint32(8 + i * 8, false);
    if (view.getUint32(12 + i * 8, false) !== guid) throw new Error(`GUID remap row ${i} names ${guid}, its pair another`);
    if (!remap.has(old)) remap.set(old, { guid, path });
  }
  if (at !== bytes.length) throw new Error(`GUID remap ends at ${at} of ${bytes.length}`);
  return { revision, remap };
}
