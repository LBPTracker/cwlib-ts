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
 * cwlib's older text layout (`RTranslationTable(byte[])`, ennuo/toolkit
 * `d6a2ef8`): UTF-16 behind a big-endian BOM, a tag on one line and its text on
 * the next, an empty line where a tag would be skipped. ⚠️ **Ported from Java and
 * proven on no file**: the game holds none (steering/java-parity.md).
 */
function readTextTable(bytes: Uint8Array): TranslationTable {
  const lines = new TextDecoder('utf-16be').decode(bytes).split(/\r\n|\r|\n/);
  const table = new Map<number, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const tag = lines[i];
    if (tag === '' || i + 1 >= lines.length) continue;
    table.set(lamsKeyId(tag), lines[i + 1]);
    i += 1;
  }
  return table;
}

/**
 * Read a `.trans`: the game's binary layout, or cwlib's older text one
 * (`readTextTable`, unproven). Throws on a binary table whose strings do not
 * tile its string block exactly.
 */
export function readTranslationTable(bytes: Uint8Array): TranslationTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 2 && view.getUint16(0) === BOM) return readTextTable(bytes);
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

/**
 * Write a `.trans`: cwlib's `RTranslationTable.build`. The keys go out sorted,
 * each distinct text once, at the offset of the first key that uses it.
 *
 * ✔ **Every one of the game's 46 tables comes back byte for byte**
 * (`test/translation.test.ts`): their keys are sorted, no text is held twice,
 * and the texts lie in the order of their first key -- the order this writes.
 */
export function writeTranslationTable(table: TranslationTable): Uint8Array {
  const keys = [...table.keys()].map((k) => k >>> 0).sort((a, b) => a - b);
  const offsets = new Map<string, number>();
  const texts: string[] = [];
  let size = 0;
  const at = keys.map((key) => {
    const value = table.get(key)!;
    let offset = offsets.get(value);
    if (offset === undefined) {
      offset = size;
      offsets.set(value, offset);
      texts.push(value);
      size += 2 + value.length * 2;
    }
    return offset;
  });
  const strings = 4 + keys.length * 8;
  const out = new Uint8Array(strings + size);
  const view = new DataView(out.buffer);
  view.setUint32(0, keys.length);
  keys.forEach((key, i) => {
    view.setUint32(4 + i * 8, key);
    view.setUint32(8 + i * 8, at[i]);
  });
  let to = strings;
  for (const text of texts) {
    view.setUint16(to, BOM);
    for (let i = 0; i < text.length; i += 1) view.setUint16(to + 2 + i * 2, text.charCodeAt(i));
    to += 2 + text.length * 2;
  }
  return out;
}

/**
 * cwlib's `RTranslationTable.patch` (ennuo/toolkit `d6a2ef8`): every key of
 * `patch` put into the table, **its text replacing what the table had**. ⚠️ The
 * toolkit's own history is the trap: until 2024 (`bb79e81`) `patch` skipped a
 * key the table already held, and a checkout that old reads that way. Java is
 * the only definition; the game holds no patch with text to test it on.
 */
export function patchTranslationTable(table: TranslationTable, patch: TranslationTable): TranslationTable {
  const out = new Map(table);
  for (const [key, value] of patch) out.set(key >>> 0, value);
  return out;
}
