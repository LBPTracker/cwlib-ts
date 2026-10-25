/**
 * `RTranslationTable` -- the game's text by LAMS key: FileDB paths
 * `gamedata/languages/<language>.trans`, one per language, and an empty one per
 * language under `languages/patch/`. **No container and no magic**: the FARC
 * entry is the table itself.
 *
 * The layout is cwlib's `resources/RTranslationTable.java` (ennuo/toolkit
 * `d6a2ef8`); what the game's 46 files prove of it is steering/level-files.md,
 * *Translation tables*:
 *
 * ```
 * u32  count                          big-endian, like everything here
 * { u32 key; u32 offset }[count]      sorted by key
 * UTF-16BE strings                    each opening with a BOM, at offset from the
 *                                     table's end; keys share strings
 * ```
 *
 * A key is what `lamsKeyId` makes of a tag (`NP_TU01B_130_NEWTON`), and what a
 * plan's `titleKey` or a quest's keys already hold.
 */

import { SerializerError } from '../io/serializer.ts';

const BOM = 0xfeff;

/** cwlib's `makeLamsKeyID`: the 32-bit key of a translation tag. */
export function lamsKeyId(tag: string): number {
  // The reference sums in 64 bits and keeps the low 32; only multiplications
  // and additions are involved, so working mod 2^32 throughout is the same.
  const char = (i: number): number => (i < tag.length ? tag.charCodeAt(i) : 0x20);
  let v0 = 0;
  for (let i = 32; i > 0; i -= 1) v0 = (Math.imul(v0, 0x1b) + char(i - 1)) >>> 0;
  let v1 = 0xc8509800;
  if (tag.length > 32) {
    v1 = 0;
    for (let i = 64; i > 32; i -= 1) v1 = (Math.imul(v1, 0x1b) + char(i - 1)) >>> 0;
  }
  return (v0 + Math.imul(v1, 0xdeadbeef)) >>> 0;
}

/** LAMS key to text. */
export type TranslationTable = ReadonlyMap<number, string>;

/**
 * Read a `.trans`. Throws on cwlib's older text layout (a UTF-16 file of tag and
 * text lines), which no file of the game's is, and on a table whose strings do
 * not tile its string block exactly.
 */
export function readTranslationTable(bytes: Uint8Array): TranslationTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 2 && view.getUint16(0) === BOM) {
    throw new SerializerError('a text translation table: not read, the game has none');
  }
  if (bytes.length < 4) throw new SerializerError(`a translation table of ${bytes.length} bytes`);
  const count = view.getUint32(0);
  const strings = 4 + count * 8;
  if (strings > bytes.length) throw new SerializerError(`a translation table of ${count} keys runs past its end`);
  const keys: number[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(view.getUint32(4 + i * 8));
    offsets.push(view.getUint32(8 + i * 8));
  }
  // ✔ Each string runs to where the next one starts: in all 24 full tables the
  // distinct offsets are exactly the BOMs in the string block, the first at 0.
  const starts = [...new Set(offsets)].sort((a, b) => a - b);
  const end = new Map<number, number>();
  for (let i = 0; i < starts.length; i += 1) end.set(starts[i], i + 1 < starts.length ? starts[i + 1] : bytes.length - strings);
  if (starts.length > 0 && starts[0] !== 0) throw new SerializerError('a translation table whose first string is not at 0');
  const decoder = new TextDecoder('utf-16be');
  const text = new Map<number, string>();
  const table = new Map<number, string>();
  for (let i = 0; i < count; i += 1) {
    const start = offsets[i];
    let value = text.get(start);
    if (value === undefined) {
      const from = strings + start;
      const to = strings + end.get(start)!;
      if ((to - from) % 2 !== 0 || view.getUint16(from) !== BOM) {
        throw new SerializerError(`translation key 0x${keys[i].toString(16)}: no UTF-16 string at ${start}`);
      }
      // `TextDecoder` drops the leading BOM itself.
      value = decoder.decode(bytes.subarray(from, to));
      text.set(start, value);
    }
    table.set(keys[i], value);
  }
  return table;
}

/** A tag or a key in a table; undefined where the language has no text for it. */
export function translate(table: TranslationTable, key: string | number): string | undefined {
  return table.get(typeof key === 'string' ? lamsKeyId(key) : key >>> 0);
}
