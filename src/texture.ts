/**
 * `RTexture` -- the game's textures and the users': magic `GTF ` for a game
 * texture resolved through the FileDB, `TEX ` for a user texture and for some
 * of the game's own (dependency type 1 either way).
 *
 * The containers were cwlib's reading first (`resources/RTexture.java`,
 * `structs/texture/CellGcmTexture.java`, `types/SerializedResource.java`,
 * toolkit `fee22399`) and are measured on **every `GTF ` and `TEX ` in LBP3 PS4
 * 1.28's four FARCs, 29,970 and 2,944** (`dev/texture-census.ts`) --
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

import type { Inflate } from './resource.ts';

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
   * paths. Bits 1 and 2 are not understood.
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

/** The `0x0001`, a chunk count and the `u16` pairs: the same table a resource carries. */
async function inflateChunks(bytes: Uint8Array, at: number, inflate: Inflate): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (at + 4 > bytes.length) throw new TextureFormatError('no chunk table');
  const count = view.getUint16(at + 2, false);
  if (count === 0) return bytes.subarray(at + 4);
  let p = at + 4 + count * 4;
  let total = 0;
  for (let i = 0; i < count; i += 1) total += view.getUint16(at + 6 + i * 4, false);
  const out = new Uint8Array(total);
  let written = 0;
  for (let i = 0; i < count; i += 1) {
    const packed = view.getUint16(at + 4 + i * 4, false);
    const raw = view.getUint16(at + 6 + i * 4, false);
    if (p + packed > bytes.length) throw new TextureFormatError(`chunk ${i}/${count} runs past the end`);
    const chunk = bytes.subarray(p, p + packed);
    p += packed;
    // A chunk that would not shrink is stored, as in a resource.
    const data = packed === raw ? chunk : await inflate(chunk, raw);
    if (data.length !== raw) throw new TextureFormatError(`chunk ${i}/${count} inflated to ${data.length}, not ${raw}`);
    out.set(data, written);
    written += raw;
  }
  if (p !== bytes.length) throw new TextureFormatError(`chunks end at ${p} of ${bytes.length}`);
  return out;
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
function morton(x: number, y: number, z: number, lw: number, lh: number, ld: number): number {
  let m = 0;
  let bit = 0;
  for (let i = 0; i < Math.max(lw, lh, ld); i += 1) {
    if (i < lw) m |= ((x >> i) & 1) << bit++;
    if (i < lh) m |= ((y >> i) & 1) << bit++;
    if (i < ld) m |= ((z >> i) & 1) << bit++;
  }
  return m >>> 0;
}

/** Expand one uncompressed GCM texel to RGBA through the remap register. */
function remapper(remap: number): (src: readonly number[]) => [number, number, number, number] {
  // Outputs in register order A, R, G, B; a source index 0..3 names A, R, G, B.
  const pick = [0, 1, 2, 3].map((k) => (remap >> (k * 2)) & 3);
  const op = [0, 1, 2, 3].map((k) => (remap >> (8 + k * 2)) & 3);
  return (src) => {
    const v = [0, 1, 2, 3].map((k) => (op[k] === 0 ? 0 : op[k] === 1 ? 255 : src[pick[k]]));
    return [v[1], v[2], v[3], v[0]];
  };
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
  const expand = remapper(gcm.remap);

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
        chain.push({ width: w, height: h, depth: d, data: data.slice(at, at + size) });
        at += size;
        continue;
      }
      const stride = linear ? gcm.pitch : w * texel;
      const size = linear ? stride * h * d : w * h * d * texel;
      if (at + size > data.length) throw new TextureFormatError(`mip ${mip} of face ${face} runs past the payload`);
      const out = new Uint8Array(w * h * d * 4);
      const [lw, lh, ld] = [log2(w), log2(h), log2(d)];
      const src = [0, 0, 0, 0];
      for (let z = 0; z < d; z += 1) {
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const from = at + (linear ? (z * h + y) * stride + x * texel : morton(x, y, z, lw, lh, ld) * texel);
            if (texel === 4) {
              src[0] = data[from];
              src[1] = data[from + 1];
              src[2] = data[from + 2];
              src[3] = data[from + 3];
            } else {
              // One channel, and it is B: a remap that reads A, R or G reads it too.
              src.fill(data[from]);
            }
            out.set(expand(src), ((z * h + y) * w + x) * 4);
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
  return {
    magic: 'GTF ', format, width: gcm.width, height: gcm.height, depth, mipCount, faces, levels,
    bump: (gcm.flags & 1) !== 0, gcm,
  };
}

const DDSD_MIPMAPCOUNT = 0x20000;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_VOLUME = 0x200000;

async function readTex(bytes: Uint8Array, inflate: Inflate): Promise<Texture> {
  const dds = await inflateChunks(bytes, 4, inflate);
  const view = new DataView(dds.buffer, dds.byteOffset, dds.byteLength);
  if (dds.length < DDS_HEADER || String.fromCharCode(...dds.subarray(0, 4)) !== 'DDS ') {
    throw new TextureFormatError('a TEX that does not hold a DDS');
  }
  const le = (o: number): number => view.getUint32(o, true);
  const flags = le(8);
  const height = le(12);
  const width = le(16);
  const mipCount = flags & DDSD_MIPMAPCOUNT ? Math.max(1, le(28)) : 1;
  const pf = le(80);
  const fourcc = String.fromCharCode(...dds.subarray(84, 88));
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
      chain.push({ width: w, height: h, depth: 1, data: dds.slice(at, at + size) });
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
  const bump = tail === 4 && String.fromCharCode(...dds.subarray(at)) === 'BUMP';
  if (tail !== 0 && !bump) throw new TextureFormatError(`${tail} bytes after the DDS's last mip`);
  return { magic: 'TEX ', format, width, height, depth: 1, mipCount, faces: 1, levels: [chain], bump };
}

/**
 * Read a `GTF ` or `TEX ` texture into its levels, ready to upload.
 *
 * Throws `TextureFormatError` on anything else -- the 48 JPEGs the game ships
 * under a `.tex` name included -- and whenever the levels do not account for
 * the payload exactly.
 */
export async function readTexture(bytes: Uint8Array, inflate: Inflate): Promise<Texture> {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === 'GTF ') return readGtf(bytes, inflate);
  if (magic === 'TEX ') return readTex(bytes, inflate);
  throw new TextureFormatError(`not a texture: magic ${JSON.stringify(magic)}`);
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
