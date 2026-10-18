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

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

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
    const sha1 = hex(bytes.subarray(at + 4, at + 24));
    const guid = view.getUint32(at + 24, false);
    at += 28;
    if (!rows.has(guid)) rows.set(guid, { path, date, size, sha1, guid });
  }
  return rows;
}
