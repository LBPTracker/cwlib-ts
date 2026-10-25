/**
 * The game's **FARC** archives -- `base_001.farc` and its siblings -- read lazily.
 *
 * ❗ **`FARC` is not `FAR4`.** `FAR4` is the save archive (`savearchive.ts`),
 * with a save key and a hashinate; a FARC is the game's own resource store and
 * has neither. The layout was cwlib's `types/archives/FileArchive.java` and is
 * measured on all four of LBP3 PS4's archives -- steering/level-files.md:
 *
 * ```
 * 0               byte[]  the resources, back to back from offset 0, no padding
 * len-8-n*0x1c    Fat[n]  sha1[20], u32 offset, u32 size        big-endian
 * len-8           u32     n
 * len-4           char[4] "FARC"
 * ```
 *
 * A FARC runs to 3.3 GB, so nothing is read but the table until an entry is
 * asked for, and the file itself comes in through `RandomAccess` -- injected,
 * the way the inflater is: `platform/node.ts` opens a path, `platform/web.ts`
 * wraps a `Blob`.
 */

import { toHex } from '../io/hex.ts';

/** Positioned reads on something too big to hold: a file handle, a `Blob`. */
export interface RandomAccess {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** One row of a FARC's table. */
export interface FarcEntry {
  /** Lower-case hex. */
  readonly sha1: string;
  readonly offset: number;
  readonly size: number;
}

export interface Farc {
  /** The table, by SHA-1, in the archive's own order. */
  readonly entries: ReadonlyMap<string, FarcEntry>;
  /** An entry's bytes, read now; `undefined` when the archive does not hold it. */
  get(sha1: string): Promise<Uint8Array | undefined>;
}

const FARC_MAGIC = 0x46415243; // "FARC"
const FAT_ROW = 0x1c;

/**
 * Open a FARC: read its table and nothing else.
 *
 * ⚠️ **The offset is unsigned.** `chunk1_001.farc` is 3,344,395,907 bytes and
 * holds entries past 2^31; read as an `i32` they land before the file starts.
 * A row that runs into the table is refused here, so a misread table fails at
 * open rather than handing out the wrong bytes.
 */
export async function openFarc(source: RandomAccess): Promise<Farc> {
  if (source.size < 8) throw new Error('FARC is shorter than its footer');
  const footer = await source.read(source.size - 8, 8);
  const tail = new DataView(footer.buffer, footer.byteOffset, 8);
  if (tail.getUint32(4, false) !== FARC_MAGIC) throw new Error('not a FARC: the last four bytes are not "FARC"');
  const count = tail.getUint32(0, false);
  const fatOffset = source.size - 8 - count * FAT_ROW;
  if (fatOffset < 0) throw new Error(`FARC claims ${count} entries, more than the file can hold`);

  const fat = await source.read(fatOffset, count * FAT_ROW);
  const view = new DataView(fat.buffer, fat.byteOffset, fat.byteLength);
  const entries = new Map<string, FarcEntry>();
  for (let i = 0; i < count; i += 1) {
    const at = i * FAT_ROW;
    const sha1 = toHex(fat.subarray(at, at + 20));
    const offset = view.getUint32(at + 20, false);
    const size = view.getUint32(at + 24, false);
    if (offset + size > fatOffset) {
      throw new Error(`FARC entry ${sha1} runs to ${offset + size}, past the table at ${fatOffset}`);
    }
    entries.set(sha1, { sha1, offset, size });
  }

  return {
    entries,
    async get(sha1) {
      const entry = entries.get(sha1.toLowerCase());
      return entry && source.read(entry.offset, entry.size);
    },
  };
}

/**
 * A FARC's table and footer for data already laid out as `rows` say: what goes
 * at the end of the resources, for an archive too big to build in memory.
 *
 * ✔ **The rows go out sorted by SHA-1**, as all four of the game's archives
 * hold them, whatever order the data lies in (`test/farc.test.ts`). cwlib's
 * `FileArchive.save` instead appends new rows after the old ones, unsorted.
 */
export function writeFarcTable(rows: readonly FarcEntry[]): Uint8Array {
  const sorted = [...rows].sort((a, b) => (a.sha1 < b.sha1 ? -1 : a.sha1 > b.sha1 ? 1 : 0));
  const out = new Uint8Array(sorted.length * FAT_ROW + 8);
  const view = new DataView(out.buffer);
  sorted.forEach((row, i) => {
    const at = i * FAT_ROW;
    if (!/^[0-9a-f]{40}$/.test(row.sha1)) throw new Error(`a FARC row's SHA-1 is not 40 lower-case hex digits: ${row.sha1}`);
    if (i > 0 && sorted[i - 1].sha1 === row.sha1) throw new Error(`FARC row ${row.sha1} twice`);
    if (row.offset + row.size > 0xffffffff) throw new Error(`FARC entry ${row.sha1} runs to ${row.offset + row.size}, past a u32 offset`);
    for (let k = 0; k < 20; k += 1) out[at + k] = parseInt(row.sha1.slice(k * 2, k * 2 + 2), 16);
    view.setUint32(at + 20, row.offset, false);
    view.setUint32(at + 24, row.size, false);
  });
  view.setUint32(sorted.length * FAT_ROW, sorted.length, false);
  view.setUint32(sorted.length * FAT_ROW + 4, FARC_MAGIC, false);
  return out;
}

/**
 * A whole FARC: the resources back to back in the order given, a repeat of
 * one already written dropped, then `writeFarcTable`.
 *
 * ✔ **`intro_001.farc` comes back byte for byte** from its own entries read in
 * the order they lie (`test/farc.test.ts`).
 */
export async function writeFarc(resources: readonly Uint8Array[]): Promise<Uint8Array> {
  const digests = await Promise.all(resources.map((bytes) => crypto.subtle.digest('SHA-1', bytes as BufferSource)));
  const rows: FarcEntry[] = [];
  const kept: Uint8Array[] = [];
  const seen = new Set<string>();
  let offset = 0;
  resources.forEach((bytes, i) => {
    const sha1 = toHex(new Uint8Array(digests[i]));
    if (seen.has(sha1)) return;
    seen.add(sha1);
    rows.push({ sha1, offset, size: bytes.length });
    kept.push(bytes);
    offset += bytes.length;
  });
  const table = writeFarcTable(rows);
  const out = new Uint8Array(offset + table.length);
  rows.forEach((row, i) => out.set(kept[i], row.offset));
  out.set(table, offset);
  return out;
}
