/**
 * `RFontFace` -- a bitmap font: magic `FNTb`, the install's loose
 * `gamedata/fonts/*.fnt` (the FileDB lists 19, no FARC holds one). A glyph
 * table, then every glyph's bitmap in one block.
 *
 * The layout is cwlib's `resources/RFontFace.java` and `structs/font/GlyphInfo.java`
 * (ennuo/toolkit `d6a2ef8`); what the game's 11 prove of it is
 * steering/level-files.md, *Fonts*:
 *
 * ```
 * "FNTb"  u32 revision (the head word)  u32 data offset  u32 0
 * i16[] glyphIndex       128 of them
 * i32[] glyphPageUsed    16
 * GlyphInfo[] glyphs     i16 character, i16 advance, i8 left, i8 top,
 *                        u8 width, u8 height, i32 offset, i16 nextGlyph
 * bool  compressed       version > 0x272
 * u8    data[]           to the file's end; `data offset` is where it starts,
 *                        counted from the end of the 16-byte header
 * ```
 *
 * No container and no compression of the stream: the fields are plain
 * big-endian, as cwlib reads them.
 */

import type { Inflate } from '../io/resource.ts';
import { Serializer, SerializerError, type RevisionInfo } from '../io/serializer.ts';

export interface Glyph {
  /** The UTF-16 code unit it draws. */
  readonly character: number;
  /** How far the pen moves after it. */
  readonly advance: number;
  /** Where the bitmap sits from the pen. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Into `FontFace.data`. */
  readonly offset: number;
  /** The next glyph in its `glyphIndex` chain, an index into `glyphs`; -1 ends it. */
  readonly nextGlyph: number;
}

export interface FontFace {
  readonly revision: RevisionInfo;
  /**
   * ✔ 128 chain heads, one per `character & 127`, each running through
   * `nextGlyph`; in all 11 of the game's fonts the chains reach every glyph and
   * hold only their own bucket's.
   */
  readonly glyphIndex: readonly number[];
  /**
   * ✔ A set of 128-character pages, bit `character >> 7` counted from each
   * word's lowest: exactly the pages the glyphs fall in, in all 11.
   */
  readonly glyphPageUsed: readonly number[];
  /** Sorted by `character` in every font the game has. */
  readonly glyphs: readonly Glyph[];
  /**
   * How the bitmaps are stored. Compressed: a big-endian `u16` byte count that
   * includes itself, then a zlib stream of one byte per pixel. Not: two bytes
   * per pixel, read by cwlib as green and blue.
   */
  readonly compressed: boolean;
  readonly data: Uint8Array;
}

/** Read an `FNTb`. Throws unless the glyph table ends where the header says the data starts. */
export function readFontFace(bytes: Uint8Array): FontFace {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || view.getUint32(0) !== 0x464e5462) throw new SerializerError('not a font: no "FNTb"');
  const head = view.getUint32(4);
  const dataOffset = view.getUint32(8);
  const revision: RevisionInfo = { version: head & 0xffff, subVersion: head >>> 16, branchId: 0, branchRevision: 0 };
  const s = new Serializer(bytes.subarray(16), revision, 0);
  const glyphIndex = s.array((self) => self.i16());
  const glyphPageUsed = s.array((self) => self.i32());
  const glyphs = s.array((self): Glyph => ({
    character: self.u16(),
    advance: self.i16(),
    left: self.i8(),
    top: self.i8(),
    width: self.u8(),
    height: self.u8(),
    offset: self.i32(),
    nextGlyph: self.i16(),
  }));
  const compressed = revision.version > 0x272 ? s.bool() : false;
  // ✔ The header's offset is the proof the table was read whole: it is where
  // this walk ends in all 11 of the game's fonts.
  if (s.position !== dataOffset) {
    throw new SerializerError(`a font's glyph table ends at ${s.position}, its header says ${dataOffset}`);
  }
  return { revision, glyphIndex, glyphPageUsed, glyphs, compressed, data: bytes.subarray(16 + dataOffset) };
}

/** The glyph that draws a UTF-16 code unit, through its `glyphIndex` chain. */
export function findGlyph(font: FontFace, character: number): Glyph | undefined {
  let i = font.glyphIndex[character & 127];
  for (let steps = 0; i >= 0 && i < font.glyphs.length && steps <= font.glyphs.length; steps += 1) {
    const glyph = font.glyphs[i];
    if (glyph.character === character) return glyph;
    i = glyph.nextGlyph;
  }
  return undefined;
}

/** One glyph's pixels, one byte each; for an uncompressed font, two bytes each as stored. */
export async function glyphBitmap(font: FontFace, glyph: Glyph, inflate: Inflate): Promise<Uint8Array> {
  const pixels = glyph.width * glyph.height;
  if (!font.compressed) return font.data.subarray(glyph.offset, glyph.offset + pixels * 2);
  const size = (font.data[glyph.offset] << 8) | font.data[glyph.offset + 1];
  const bitmap = await inflate(font.data.subarray(glyph.offset + 2, glyph.offset + size), pixels);
  if (bitmap.length !== pixels) {
    throw new SerializerError(`glyph 0x${glyph.character.toString(16)} inflated to ${bitmap.length} bytes, not ${pixels}`);
  }
  return bitmap;
}
