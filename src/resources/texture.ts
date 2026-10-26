/**
 * `RTexture` -- the game's textures and the users': magic `GTF ` for a game
 * texture resolved through the FileDB, `TEX ` for a user texture and for some
 * of the game's own (dependency type 1 either way).
 *
 * The containers were cwlib's reading first (`resources/RTexture.java`,
 * `structs/texture/CellGcmTexture.java`, `types/SerializedResource.java`,
 * toolkit `fee22399`) and are measured on **every `GTF ` and `TEX ` in LBP3 PS4
 * 01.00's four FARCs, 29,970 and 2,944** (`dev/texture-census.ts`) --
 * steering/level-files.md, *The game's textures*:
 *
 * - `GTF ` is a 24-byte big-endian `CellGcmTexture` and then a chunk table;
 *   `TEX ` is the chunk table straight after the magic, and inflates to a DDS
 *   file. Neither has the revision or the dependency table a resource has.
 * - ❗ **The PS4 build kept the PS3's layouts.** BC blocks are linear,
 *   row-major; the uncompressed `B8` and `A8R8G8B8` are **Morton-swizzled**
 *   unless the format carries the `LN` bit `0x20`, in which case rows are
 *   `pitch` bytes apart. A volume is swizzled in three dimensions. The proof is
 *   images that look right (`out/textures/`, written by the census) and, over
 *   the corpus, texels smoother as read than read the other way on 31,379 of
 *   31,607 textures.
 * - Mip levels follow one another; the chain is padded to 128 bytes -- per face
 *   on a cube map (6 of 6) -- and every `GTF ` payload is exactly that long.
 */

import { inflateChunkTable, magicOf, type Inflate } from '../io/resource.ts';
import { latin1 } from '../io/serializer.ts';
import type { Deflate } from '../io/writer.ts';

/** `CellGcmEnumForGtf`, the low five bits and the `UN` bit of `CellGcmTexture.format`. */
export const GCM_B8 = 0x81;
export const GCM_A8R8G8B8 = 0x85;
export const GCM_DXT1 = 0x86;
export const GCM_DXT3 = 0x87;
export const GCM_DXT5 = 0x88;
/** `CELL_GCM_TEXTURE_LN`: rows `pitch` apart rather than swizzled. */
export const GCM_LINEAR = 0x20;

/**
 * What `levels` holds. The three BC formats are the raw blocks, as WebGPU's
 * `texture-compression-bc` takes them; `rgba8` is unswizzled and expanded to
 * R, G, B, A bytes, as `rgba8unorm` takes it.
 */
export type TextureFormat = 'bc1' | 'bc2' | 'bc3' | 'rgba8';

/** The WebGPU format to upload `levels` as. sRGB or not is the renderer's call -- see `bump`. */
export const GPU_FORMAT: Readonly<Record<TextureFormat, string>> = {
  bc1: 'bc1-rgba-unorm',
  bc2: 'bc2-rgba-unorm',
  bc3: 'bc3-rgba-unorm',
  rgba8: 'rgba8unorm',
};

export interface TextureLevel {
  readonly width: number;
  readonly height: number;
  /** 1 unless the texture is a volume. */
  readonly depth: number;
  /**
   * BC blocks row-major, or RGBA8 row-major (slice after slice in a volume),
   * with no padding: `bytesPerRow` is `ceil(width / 4) * 8 or 16`, or `width * 4`.
   *
   * ⚠️ A BC level is a **view** into the one buffer the texture inflated into,
   * shared with its other levels, so writing to it writes to them.
   */
  readonly data: Uint8Array;
}

/** `CellGcmTexture` as the `GTF ` header carries it. */
export interface GcmTexture {
  /** The format byte, `UN` and `LN` bits and all: 0x81, 0x85, 0x86, 0x88 and 0xa5 in the game. */
  readonly format: number;
  readonly mipmap: number;
  /** 2, or 3 for a volume. */
  readonly dimension: number;
  readonly cubemap: boolean;
  /**
   * The channel remap: bits 0--7 pick each output's source channel, bits
   * 8--15 say whether it is that channel, zero or one. `0xaae4` is the identity
   * and is on every texture but 82 `B8`s (`0xa9ff`, 79; `0x02ff`, 3). Applied
   * when an uncompressed texture is expanded to RGBA8 -- a reading of the RSX's
   * remap register, which the images agree with, not a measurement of its bits.
   */
  readonly remap: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly location: number;
  /**
   * cwlib calls bit 0 "bump texture, no sRGB". Over the game: 0 on 1,958, 1 on
   * 3,292, 2 on 16,231, 3 on 501, 6 on 7,388, 7 on 600. Bit 0 is set on 4,393,
   * every one of whose paths names a normal or bump map, and clear on 36 such
   * paths. Bit 1 marks a PS4 re-export (set on 24,719 of 24,720 under
   * `gamedata_orbis/`, clear on 5,250 of 5,251 under `gamedata/`); bit 2 is not
   * understood. Neither says colour or data.
   */
  readonly flags: number;
  /** Row stride in bytes of a `LN` texture; 0 otherwise. */
  readonly pitch: number;
  readonly offset: number;
}

export interface Texture {
  readonly magic: 'GTF ' | 'TEX ';
  readonly format: TextureFormat;
  readonly width: number;
  readonly height: number;
  /** 1 unless a volume. */
  readonly depth: number;
  readonly mipCount: number;
  /** 6 on a cube map, in the order the file stores them; 1 otherwise. */
  readonly faces: number;
  /** `levels[face][mip]`. */
  readonly levels: TextureLevel[][];
  /**
   * The texture holds data rather than colour -- a normal map: `GTF ` flags
   * bit 0, or a `TEX ` whose DDS ends in the four bytes `BUMP` (7 of the
   * game's 2,944). cwlib's reading, and the hint to upload without sRGB.
   */
  readonly bump: boolean;
  /** The `GTF ` header; absent on a `TEX `. */
  readonly gcm?: GcmTexture;
}

export class TextureFormatError extends Error {}

const GTF_HEADER = 0x1c;
const DDS_HEADER = 0x80;
const CHAIN_ALIGN = 0x80;

/**
 * The chunk table a resource carries, after the texture's own header, and
 * the chunks to the file's last byte. With no chunks the rest of the file is
 * the payload as it is.
 */
async function inflateChunks(bytes: Uint8Array, at: number, inflate: Inflate): Promise<Uint8Array> {
  if (at + 4 > bytes.length) throw new TextureFormatError('no chunk table');
  // With no chunks the payload is a copy, so the levels can be views into it.
  const { data, end } = await inflateChunkTable(bytes, at, inflate, { error: TextureFormatError });
  if (end !== bytes.length) throw new TextureFormatError(`chunks end at ${end} of ${bytes.length}`);
  return data;
}

const blocksOf = (n: number): number => Math.max(1, Math.ceil(n / 4));
const half = (n: number, mip: number): number => Math.max(1, n >> mip);
const log2 = (n: number): number => 31 - Math.clz32(n);

/**
 * The Morton index of `(x, y, z)` in a power-of-two box: one bit of x, of y and
 * of z in turn from the lowest, each axis dropping out once its bits run out.
 * x in the lowest bit is measured on `dc_comics_promo_32bit` (512 x 256), which
 * any other order scrambles; on the five non-cubic volumes x-then-y-then-z is
 * the smoothest of the six orders.
 */
function mortonTables(lw: number, lh: number, ld: number): [Uint32Array, Uint32Array, Uint32Array] {
  // ⚠️ **Each axis's bits land in places that depend only on the box**, so the
  // index is `mx[x] | my[y] | mz[z]`: three tables per mip instead of a loop
  // of a dozen steps per texel.
  const tables = [new Uint32Array(1 << lw), new Uint32Array(1 << lh), new Uint32Array(1 << ld)];
  const sizes = [lw, lh, ld];
  let bit = 0;
  for (let i = 0; i < Math.max(lw, lh, ld); i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (i >= sizes[axis]) continue;
      const table = tables[axis];
      for (let v = 0; v < table.length; v += 1) if ((v >> i) & 1) table[v] |= 1 << bit;
      bit += 1;
    }
  }
  return tables as [Uint32Array, Uint32Array, Uint32Array];
}

/**
 * The remap register as what each output byte R, G, B, A takes: an offset into
 * the source texel, or -1 with `constant` 0 or 255.
 *
 * The register lists its outputs A, R, G, B, and a source index 0..3 names A,
 * R, G, B of the texel. ⚠️ A one-byte texel is B, and a remap that reads A, R
 * or G of it reads that byte too -- so every offset is 0 then.
 */
function remapOffsets(remap: number, texel: number): { offset: Int8Array; constant: Uint8Array } {
  const offset = new Int8Array(4);
  const constant = new Uint8Array(4);
  for (let c = 0; c < 4; c += 1) {
    const k = (c + 1) & 3; // output R, G, B, A is register slot 1, 2, 3, 0
    const op = (remap >> (8 + k * 2)) & 3;
    if (op === 0 || op === 1) {
      offset[c] = -1;
      constant[c] = op === 0 ? 0 : 255;
    } else offset[c] = texel === 4 ? (remap >> (k * 2)) & 3 : 0;
  }
  return { offset, constant };
}

async function readGtf(bytes: Uint8Array, inflate: Inflate): Promise<Texture> {
  if (bytes.length < GTF_HEADER + 4) throw new TextureFormatError('too short for a GTF header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gcm: GcmTexture = {
    format: bytes[4],
    mipmap: bytes[5],
    dimension: bytes[6],
    cubemap: bytes[7] !== 0,
    remap: view.getUint32(8, false),
    width: view.getUint16(12, false),
    height: view.getUint16(14, false),
    depth: view.getUint16(16, false),
    location: bytes[18],
    flags: bytes[19],
    pitch: view.getUint32(20, false),
    offset: view.getUint32(24, false),
  };
  const data = await inflateChunks(bytes, GTF_HEADER, inflate);
  const base = gcm.format & ~GCM_LINEAR;
  const linear = (gcm.format & GCM_LINEAR) !== 0;
  const format: TextureFormat | undefined =
    base === GCM_DXT1 ? 'bc1' : base === GCM_DXT3 ? 'bc2' : base === GCM_DXT5 ? 'bc3' :
    base === GCM_B8 || base === GCM_A8R8G8B8 ? 'rgba8' : undefined;
  if (!format) throw new TextureFormatError(`GCM format 0x${gcm.format.toString(16)} is not one the game uses`);
  const bc = format !== 'rgba8';
  if (bc && linear) throw new TextureFormatError('a linear BC texture is not in the game');
  const texel = base === GCM_A8R8G8B8 ? 4 : 1;
  const volume = gcm.dimension === 3;
  const faces = gcm.cubemap ? 6 : 1;
  const mipCount = Math.max(1, gcm.mipmap);
  const depth = volume ? Math.max(1, gcm.depth) : 1;
  if (!linear && !bc) {
    for (const n of [gcm.width, gcm.height, depth]) {
      if (n & (n - 1)) throw new TextureFormatError(`a swizzled texture of ${gcm.width}x${gcm.height}x${depth}`);
    }
  }
  const { offset, constant } = remapOffsets(gcm.remap, texel);

  const levels: TextureLevel[][] = [];
  let at = 0;
  for (let face = 0; face < faces; face += 1) {
    const chain: TextureLevel[] = [];
    const start = at;
    for (let mip = 0; mip < mipCount; mip += 1) {
      const w = half(gcm.width, mip);
      const h = half(gcm.height, mip);
      const d = half(depth, mip);
      if (bc) {
        const size = blocksOf(w) * blocksOf(h) * (format === 'bc1' ? 8 : 16) * d;
        if (at + size > data.length) throw new TextureFormatError(`mip ${mip} of face ${face} runs past the payload`);
        chain.push({ width: w, height: h, depth: d, data: data.subarray(at, at + size) });
        at += size;
        continue;
      }
      const stride = linear ? gcm.pitch : w * texel;
      const size = linear ? stride * h * d : w * h * d * texel;
      if (at + size > data.length) throw new TextureFormatError(`mip ${mip} of face ${face} runs past the payload`);
      const out = new Uint8Array(w * h * d * 4);
      // A linear texture reads by `stride` and never looks in the tables.
      const [mx, my, mz] = linear ? mortonTables(0, 0, 0) : mortonTables(log2(w), log2(h), log2(d));
      const [o0, o1, o2, o3] = offset;
      const [c0, c1, c2, c3] = constant;
      let to = 0;
      for (let z = 0; z < d; z += 1) {
        for (let y = 0; y < h; y += 1) {
          const row = linear ? at + (z * h + y) * stride : 0;
          const yz = linear ? 0 : my[y] | mz[z];
          for (let x = 0; x < w; x += 1) {
            const from = linear ? row + x * texel : at + ((mx[x] | yz) >>> 0) * texel;
            out[to] = o0 < 0 ? c0 : data[from + o0];
            out[to + 1] = o1 < 0 ? c1 : data[from + o1];
            out[to + 2] = o2 < 0 ? c2 : data[from + o2];
            out[to + 3] = o3 < 0 ? c3 : data[from + o3];
            to += 4;
          }
        }
      }
      chain.push({ width: w, height: h, depth: d, data: out });
      at += size;
    }
    // Each face's chain is padded to 128 bytes: 6 of the game's 6 cube maps.
    if (faces > 1) at = start + Math.ceil((at - start) / CHAIN_ALIGN) * CHAIN_ALIGN;
    levels.push(chain);
  }
  // ❗ The whole payload is accounted for: the chain padded to 128, and no more.
  if (Math.ceil(at / CHAIN_ALIGN) * CHAIN_ALIGN !== data.length) {
    throw new TextureFormatError(`the mip chain is ${at} bytes and the payload ${data.length}`);
  }
  return keepStored<Texture>({
    magic: 'GTF ', format, width: gcm.width, height: gcm.height, depth, mipCount, faces, levels,
    bump: (gcm.flags & 1) !== 0, gcm,
  }, data);
}

const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_VOLUME = 0x200000;

async function readTex(bytes: Uint8Array, inflate: Inflate): Promise<Texture> {
  const dds = await inflateChunks(bytes, 4, inflate);
  const view = new DataView(dds.buffer, dds.byteOffset, dds.byteLength);
  if (dds.length < DDS_HEADER || magicOf(dds) !== 'DDS ') {
    throw new TextureFormatError('a TEX that does not hold a DDS');
  }
  const le = (o: number): number => view.getUint32(o, true);
  const flags = le(8);
  const height = le(12);
  const width = le(16);
  const mipCount = flags & DDSD_MIPMAPCOUNT ? Math.max(1, le(28)) : 1;
  const pf = le(80);
  const fourcc = latin1(dds.subarray(84, 88));
  if (le(112) & (DDSCAPS2_CUBEMAP | DDSCAPS2_VOLUME)) {
    throw new TextureFormatError('a cube or volume DDS: none is in the game to measure');
  }
  let format: TextureFormat;
  if (pf & DDPF_FOURCC) {
    if (fourcc === 'DXT1') format = 'bc1';
    else if (fourcc === 'DXT3') format = 'bc2';
    else if (fourcc === 'DXT5') format = 'bc3';
    else throw new TextureFormatError(`DDS FourCC ${JSON.stringify(fourcc)}`);
  } else if (pf & DDPF_RGB && le(88) === 32) {
    format = 'rgba8';
  } else {
    throw new TextureFormatError(`DDS pixel format flags 0x${pf.toString(16)}, ${le(88)} bits`);
  }
  // Uncompressed: one byte per mask, little-endian words as DDS has them.
  const masks = [le(92), le(96), le(100), pf & DDPF_ALPHAPIXELS ? le(104) : 0];
  const shifts = masks.map((m) => (m ? 31 - Math.clz32(m & -m) : -1));

  const chain: TextureLevel[] = [];
  let at = DDS_HEADER;
  for (let mip = 0; mip < mipCount; mip += 1) {
    const w = half(width, mip);
    const h = half(height, mip);
    if (format !== 'rgba8') {
      const size = blocksOf(w) * blocksOf(h) * (format === 'bc1' ? 8 : 16);
      if (at + size > dds.length) throw new TextureFormatError(`mip ${mip} runs past the DDS`);
      chain.push({ width: w, height: h, depth: 1, data: dds.subarray(at, at + size) });
      at += size;
      continue;
    }
    const size = w * h * 4;
    if (at + size > dds.length) throw new TextureFormatError(`mip ${mip} runs past the DDS`);
    const out = new Uint8Array(size);
    for (let i = 0; i < w * h; i += 1) {
      const v = view.getUint32(at + i * 4, true);
      for (let c = 0; c < 4; c += 1) out[i * 4 + c] = shifts[c] < 0 ? 255 : (v >>> shifts[c]) & 0xff;
    }
    chain.push({ width: w, height: h, depth: 1, data: out });
    at += size;
  }
  // ❗ The DDS is used up exactly -- or but for the `BUMP` footer cwlib names
  // (2,937 and 7 of the game's 2,944).
  const tail = dds.length - at;
  const bump = tail === 4 && latin1(dds.subarray(at)) === 'BUMP';
  if (tail !== 0 && !bump) throw new TextureFormatError(`${tail} bytes after the DDS's last mip`);
  return keepStored<Texture>({ magic: 'TEX ', format, width, height, depth: 1, mipCount, faces: 1, levels: [chain], bump }, dds);
}

/**
 * Read a `GTF ` or `TEX ` texture into its levels, ready to upload.
 *
 * Throws `TextureFormatError` on anything else -- the 48 JPEGs the game ships
 * under a `.tex` name included -- and whenever the levels do not account for
 * the payload exactly.
 */
export async function readTexture(bytes: Uint8Array, inflate: Inflate): Promise<Texture> {
  const magic = magicOf(bytes);
  if (magic === 'GTF ') return readGtf(bytes, inflate);
  if (magic === 'TEX ') return readTex(bytes, inflate);
  throw new TextureFormatError(`not a texture: magic ${JSON.stringify(magic)}`);
}

/* ------------------------------------------------------------- writing */

/** A non-enumerable property of a read `Texture`: the payload as it inflated, a GTF's chain or a TEX's DDS. */
const STORED = 'stored';

function keepStored<T extends object>(value: T, payload: Uint8Array): T {
  Object.defineProperty(value, STORED, { value: payload });
  return value;
}

function storedOf(value: object): Uint8Array | undefined {
  return (value as Record<string, Uint8Array | undefined>)[STORED];
}

/** Raw chunk size: the game's textures and backdrops are cut here, the last chunk short. */
const CHUNK_SIZE = 0x8000;

/**
 * `inflateChunkTable`'s inverse: the `0x0001` flag, the count, a `(compressed,
 * raw)` pair per chunk of `0x8000` raw bytes, then the chunks. A chunk that
 * would not shrink is stored as it is, both sizes equal -- 47 of the game's
 * `TEX `s carry one -- and an empty payload is a table of no chunks. Shared with
 * `staticmesh.ts`, whose chunk table is the same.
 */
export async function writeChunkTable(payload: Uint8Array, deflate: Deflate): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const raws: number[] = [];
  for (let at = 0; at < payload.length; at += CHUNK_SIZE) {
    const raw = payload.subarray(at, Math.min(at + CHUNK_SIZE, payload.length));
    const deflated = await deflate(raw);
    chunks.push(deflated.length < raw.length ? deflated : raw);
    raws.push(raw.length);
  }
  if (chunks.length > 0xffff) throw new TextureFormatError(`${chunks.length} chunks, over 0xffff`);
  let size = 4 + chunks.length * 4;
  for (const chunk of chunks) size += chunk.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint16(0, 1, false);
  view.setUint16(2, chunks.length, false);
  let at = 4 + chunks.length * 4;
  chunks.forEach((chunk, i) => {
    view.setUint16(4 + i * 4, chunk.length, false);
    view.setUint16(6 + i * 4, raws[i], false);
    out.set(chunk, at);
    at += chunk.length;
  });
  return out;
}

/** A GTF's chain from its levels: `readGtf`'s walk, written. */
function packGtf(value: Texture, gcm: GcmTexture): Uint8Array {
  const base = gcm.format & ~GCM_LINEAR;
  const linear = (gcm.format & GCM_LINEAR) !== 0;
  const bc = value.format !== 'rgba8';
  const texel = base === GCM_A8R8G8B8 ? 4 : 1;
  const faces = gcm.cubemap ? 6 : 1;
  const mipCount = Math.max(1, gcm.mipmap);
  const depth = gcm.dimension === 3 ? Math.max(1, gcm.depth) : 1;
  // Where every level goes, the padding included: the length first.
  const places: { face: number; mip: number; at: number; w: number; h: number; d: number }[] = [];
  let at = 0;
  for (let face = 0; face < faces; face += 1) {
    const start = at;
    for (let mip = 0; mip < mipCount; mip += 1) {
      const w = half(gcm.width, mip);
      const h = half(gcm.height, mip);
      const d = half(depth, mip);
      places.push({ face, mip, at, w, h, d });
      at += bc ? blocksOf(w) * blocksOf(h) * (value.format === 'bc1' ? 8 : 16) * d : (linear ? gcm.pitch * h * d : w * h * d * texel);
    }
    if (faces > 1) at = start + Math.ceil((at - start) / CHAIN_ALIGN) * CHAIN_ALIGN;
  }
  const length = Math.ceil(at / CHAIN_ALIGN) * CHAIN_ALIGN;
  const stored = storedOf(value);
  // The stored chain is the ground: it holds the padding, and the bytes of a
  // texel the remap never reads, which no level carries.
  const out = stored && stored.length === length ? stored.slice() : new Uint8Array(length);
  const { offset } = remapOffsets(gcm.remap, texel);
  for (const { face, mip, at: from, w, h, d } of places) {
    const level = value.levels[face]?.[mip];
    if (!level) throw new TextureFormatError(`no level ${mip} of face ${face}`);
    if (bc) {
      out.set(level.data, from);
      continue;
    }
    if (level.data.length !== w * h * d * 4) throw new TextureFormatError(`level ${mip} of face ${face} is not ${w}x${h}x${d} RGBA8`);
    const stride = linear ? gcm.pitch : w * texel;
    const [mx, my, mz] = linear ? mortonTables(0, 0, 0) : mortonTables(log2(w), log2(h), log2(d));
    let src = 0;
    for (let z = 0; z < d; z += 1) {
      for (let y = 0; y < h; y += 1) {
        const row = linear ? from + (z * h + y) * stride : 0;
        const yz = linear ? 0 : my[y] | mz[z];
        for (let x = 0; x < w; x += 1) {
          const to = linear ? row + x * texel : from + ((mx[x] | yz) >>> 0) * texel;
          // From A down to R, so where two outputs read one byte R's is kept.
          for (let c = 3; c >= 0; c -= 1) if (offset[c] >= 0) out[to + offset[c]] = level.data[src + c];
          src += 4;
        }
      }
    }
  }
  return out;
}

/**
 * The DDS header of the game's own `TEX `s, for a texture that has none stored.
 * Measured on the 2,944 in LBP3 PS4 01.00's four FARCs (`dev/dds-header-census.ts`,
 * 2026-10-26), this header whole on 2,308:
 * - the 337 DXTs of more than one level: flags `0x21007` (`DDSD_MIPMAPCOUNT`,
 *   no `DDSD_LINEARSIZE`), pitch 0, the level count, caps `0x401008` -- every one;
 * - the 2,606 DXTs of one level: flags `0x81007` (`DDSD_LINEARSIZE`), a level
 *   count of 0, caps `0x1000` -- every one; the level's size as the pitch on all
 *   DXT1s and 778 of 1,412 DXT5s. ⚠️ The other 634 DXT5s give half that, a DXT1's
 *   size; what picks it is not known (not the alpha). Two DXT1s hold a word at 124;
 * - the one `A8R8G8B8`, of 9 levels: `0xa1007` and its first level's size.
 */
export function gameDdsHeader(format: TextureFormat, width: number, height: number, mipCount: number): Uint8Array {
  const out = new Uint8Array(DDS_HEADER);
  const view = new DataView(out.buffer);
  const bc = format !== 'rgba8';
  const many = mipCount > 1;
  const le = (o: number, v: number): void => view.setUint32(o, v >>> 0, true);
  out.set([0x44, 0x44, 0x53, 0x20]);
  le(4, 124);
  le(8, 0x1007 | (many ? DDSD_MIPMAPCOUNT : 0) | (!many || !bc ? DDSD_LINEARSIZE : 0));
  le(12, height);
  le(16, width);
  if (!many || !bc) le(20, bc ? blocksOf(width) * blocksOf(height) * (format === 'bc1' ? 8 : 16) : width * height * 4);
  le(28, many ? mipCount : 0);
  le(76, 32);
  if (bc) {
    le(80, DDPF_FOURCC);
    out.set([...(format === 'bc1' ? 'DXT1' : format === 'bc2' ? 'DXT3' : 'DXT5')].map((c) => c.charCodeAt(0)), 84);
  } else {
    le(80, DDPF_RGB | DDPF_ALPHAPIXELS);
    le(88, 32);
    le(92, 0x00ff0000);
    le(96, 0x0000ff00);
    le(100, 0x000000ff);
    le(104, 0xff000000);
  }
  le(108, 0x1000 | (many ? 0x400008 : 0));
  return out;
}

/** A TEX's DDS from its levels: `readTex`'s walk, written. */
function packTex(value: Texture): Uint8Array {
  const chain = value.levels[0] ?? [];
  const bc = value.format !== 'rgba8';
  let length = DDS_HEADER;
  for (let mip = 0; mip < value.mipCount; mip += 1) {
    const w = half(value.width, mip);
    const h = half(value.height, mip);
    length += bc ? blocksOf(w) * blocksOf(h) * (value.format === 'bc1' ? 8 : 16) : w * h * 4;
  }
  if (value.bump) length += 4;
  const stored = storedOf(value);
  const out = new Uint8Array(length);
  if (stored && stored.length === length) out.set(stored);
  else out.set(gameDdsHeader(value.format, value.width, value.height, value.mipCount));
  const view = new DataView(out.buffer);
  const pf = view.getUint32(80, true);
  const masks = [view.getUint32(92, true), view.getUint32(96, true), view.getUint32(100, true), pf & DDPF_ALPHAPIXELS ? view.getUint32(104, true) : 0];
  const shifts = masks.map((m) => (m ? 31 - Math.clz32(m & -m) : -1));
  const covered = (masks[0] | masks[1] | masks[2] | masks[3]) >>> 0;
  let at = DDS_HEADER;
  for (let mip = 0; mip < value.mipCount; mip += 1) {
    const level = chain[mip];
    if (!level) throw new TextureFormatError(`no level ${mip}`);
    if (bc) {
      out.set(level.data, at);
      at += level.data.length;
      continue;
    }
    const n = level.width * level.height;
    for (let i = 0; i < n; i += 1) {
      // The bits no mask covers stay as stored.
      let word = view.getUint32(at + i * 4, true) & ~covered;
      for (let c = 0; c < 4; c += 1) if (shifts[c] >= 0) word |= (level.data[i * 4 + c] << shifts[c]) & masks[c];
      view.setUint32(at + i * 4, word >>> 0, true);
    }
    at += n * 4;
  }
  if (value.bump) out.set([0x42, 0x55, 0x4d, 0x50], at);
  return out;
}

/**
 * `readTexture`'s inverse: the whole `GTF ` or `TEX ` file from the value --
 * the `CellGcmTexture` header of a GTF (`gcm`) or nothing of a TEX, then the
 * chunk table and its chunks.
 *
 * ⚠️ **The levels are written as they are held; nothing is compressed to BC.**
 * A BC level is its raw blocks and goes back as such, and RGBA8 is swizzled
 * and remapped back into the stored texel layout; encoding RGBA to DXT is not
 * done, so a BC texture's levels have to be blocks already. What no level
 * carries -- the chain's padding, the bytes of a texel the remap never reads,
 * the DDS header of a TEX -- comes from the payload the texture was read
 * from, or is zero (a fresh DDS header) on a texture made from nothing.
 */
export async function writeTexture(value: Texture, deflate: Deflate): Promise<Uint8Array> {
  if (value.magic === 'TEX ') {
    const chunks = await writeChunkTable(packTex(value), deflate);
    const out = new Uint8Array(4 + chunks.length);
    out.set([0x54, 0x45, 0x58, 0x20]);
    out.set(chunks, 4);
    return out;
  }
  const gcm = value.gcm;
  if (!gcm) throw new TextureFormatError('a GTF texture without its CellGcmTexture header');
  const chunks = await writeChunkTable(packGtf(value, gcm), deflate);
  const out = new Uint8Array(GTF_HEADER + chunks.length);
  const view = new DataView(out.buffer);
  out.set([0x47, 0x54, 0x46, 0x20]);
  out[4] = gcm.format;
  out[5] = gcm.mipmap;
  out[6] = gcm.dimension;
  out[7] = gcm.cubemap ? 1 : 0;
  view.setUint32(8, gcm.remap, false);
  view.setUint16(12, gcm.width, false);
  view.setUint16(14, gcm.height, false);
  view.setUint16(16, gcm.depth, false);
  out[18] = gcm.location;
  out[19] = gcm.flags;
  view.setUint32(20, gcm.pitch, false);
  view.setUint32(24, gcm.offset, false);
  out.set(chunks, GTF_HEADER);
  return out;
}

/* ------------------------------------------------------------- BC decode */

function colour565(c: number, out: Uint8Array, at: number): void {
  out[at] = (((c >> 11) & 31) * 255 + 15) / 31 | 0;
  out[at + 1] = (((c >> 5) & 63) * 255 + 31) / 63 | 0;
  out[at + 2] = ((c & 31) * 255 + 15) / 31 | 0;
  out[at + 3] = 255;
}

/**
 * Decode one level to RGBA8, for a browser without `texture-compression-bc`
 * or for a look at it. BC1 with its one-bit alpha, BC2's explicit alpha, BC3's
 * interpolated alpha, all as the S3TC specification has them; an `rgba8`
 * level comes back as it is.
 */
export function decodeLevel(format: TextureFormat, level: TextureLevel): Uint8Array {
  if (format === 'rgba8') return level.data;
  const { width: w, height: h, data } = level;
  const bw = blocksOf(w);
  const bh = blocksOf(h);
  const block = format === 'bc1' ? 8 : 16;
  const out = new Uint8Array(w * h * 4 * level.depth);
  const palette = new Uint8Array(16);
  const alpha = new Uint8Array(8);
  for (let z = 0; z < level.depth; z += 1) {
    for (let by = 0; by < bh; by += 1) {
      for (let bx = 0; bx < bw; bx += 1) {
        const at = ((z * bh + by) * bw + bx) * block;
        const c = at + block - 8;
        const c0 = data[c] | (data[c + 1] << 8);
        const c1 = data[c + 2] | (data[c + 3] << 8);
        colour565(c0, palette, 0);
        colour565(c1, palette, 4);
        if (c0 > c1 || format !== 'bc1') {
          for (let k = 0; k < 3; k += 1) {
            palette[8 + k] = (2 * palette[k] + palette[4 + k] + 1) / 3 | 0;
            palette[12 + k] = (palette[k] + 2 * palette[4 + k] + 1) / 3 | 0;
          }
          palette[11] = palette[15] = 255;
        } else {
          for (let k = 0; k < 3; k += 1) {
            palette[8 + k] = (palette[k] + palette[4 + k]) >> 1;
            palette[12 + k] = 0;
          }
          palette[11] = 255;
          palette[15] = 0;
        }
        if (format === 'bc3') {
          const a0 = data[at];
          const a1 = data[at + 1];
          alpha[0] = a0;
          alpha[1] = a1;
          if (a0 > a1) {
            for (let k = 1; k < 7; k += 1) alpha[k + 1] = ((7 - k) * a0 + k * a1 + 3) / 7 | 0;
          } else {
            for (let k = 1; k < 5; k += 1) alpha[k + 1] = ((5 - k) * a0 + k * a1 + 2) / 5 | 0;
            alpha[6] = 0;
            alpha[7] = 255;
          }
        }
        const bits = (data[c + 4] | (data[c + 5] << 8) | (data[c + 6] << 16) | (data[c + 7] << 24)) >>> 0;
        // The 48 alpha index bits, as two 24-bit halves.
        const lo = data[at + 2] | (data[at + 3] << 8) | (data[at + 4] << 16);
        const hi = data[at + 5] | (data[at + 6] << 8) | (data[at + 7] << 16);
        for (let py = 0; py < 4; py += 1) {
          const y = by * 4 + py;
          if (y >= h) break;
          for (let px = 0; px < 4; px += 1) {
            const x = bx * 4 + px;
            if (x >= w) break;
            const k = py * 4 + px;
            const o = ((z * h + y) * w + x) * 4;
            const ci = ((bits >>> (2 * k)) & 3) * 4;
            out[o] = palette[ci];
            out[o + 1] = palette[ci + 1];
            out[o + 2] = palette[ci + 2];
            out[o + 3] = palette[ci + 3];
            if (format === 'bc2') {
              out[o + 3] = ((data[at + (k >> 1)] >> ((k & 1) * 4)) & 15) * 17;
            } else if (format === 'bc3') {
              const bit = 3 * k;
              out[o + 3] = alpha[bit < 24 ? (lo >> bit) & 7 : (hi >> (bit - 24)) & 7];
            }
          }
        }
      }
    }
  }
  return out;
}
