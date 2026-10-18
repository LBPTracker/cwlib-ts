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

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

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
    const sha1 = hex(fat.subarray(at, at + 20));
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
