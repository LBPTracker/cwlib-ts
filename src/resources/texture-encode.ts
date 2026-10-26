/**
 * An image to a texture: cwlib's `Images.toGTF`, `Images.toTEX` and
 * `Images.toBump` (`util/Images.java`, with `util/DDS.java`'s
 * `getDDSHeader`, `structs/texture/CellGcmTexture.java`'s constructor from a
 * DDS and `types/SerializedResource.java`'s texture branch; toolkit `d6a2ef8`,
 * MIT), with the DXT blocks from `texture-encode-bc.ts` where cwlib calls
 * jsquish. The oracle is cwlib itself: the toolkit's `sequencerdump-0.1.jar`
 * (cwlib `bb79e81`) run on the same images writes the same `CellGcmTexture`,
 * DDS header, footer and payload length as `layout: 'cwlib'` on 276 of 276
 * (23 images, DXT1/3/5, `GTF ` and `TEX `, with and without mipmaps and
 * `noSRGB`); `test/texture-encode.test.ts` keeps four of those headers.
 *
 * What cwlib does, and so what this does:
 * - The image is **scaled down to powers of two**, each side to its highest
 *   set bit (`toNearest`): 300 x 200 becomes 256 x 128.
 * - With mipmaps, each level halves both sides **until either is 1**, and stops
 *   there: 256 x 64 has 7 levels, the last 4 x 1, not the full chain of 9.
 * - A `GTF ` gets the `CellGcmTexture` cwlib builds from its DDS: the format,
 *   the level count, dimension 2, remap `0xaae4`, flags 1 when `noSRGB` and 0
 *   otherwise, everything else 0. A `TEX ` is a DDS header and the levels.
 * - `noSRGB` marks the texture as data, not colour: `GTF ` flags bit 0, or a
 *   `TEX ` whose DDS ends `BUMP`. `bump` is `toBump` run first: each texel
 *   becomes `(G, G, G, R)` -- unless the first texel is grey, which cwlib takes
 *   for an image that is no normal map, and leaves. (Nothing in cwlib calls
 *   `toBump`; it is here because it is there.)
 *
 * Where it differs, `layout` says so. ❗ **cwlib's own bytes do not read back
 * here**: its `GTF ` chain is not padded to 128 bytes, and its `TEX ` without
 * `noSRGB` ends in four zero bytes, and `readTexture` refuses both; no texture
 * in the game has either (`texture.ts`, 29,970 and 2,944 measured). `layout: 'game'`, the default, pads the chain, leaves the
 * zeros off and writes the DDS header the game's `TEX `s have
 * (`gameDdsHeader`); `layout: 'cwlib'` writes cwlib's bytes, its DDS header
 * included (`cwlibDdsHeader`).
 *
 * Also not cwlib's:
 * - the scaling, a box filter over each texel's footprint where cwlib uses
 *   imgscalr's `Scalr.resize` (each level from the first, `ULTRA_QUALITY`, at
 *   `d6a2ef8`; from the one above, `AUTOMATIC`, in the jar's `bb79e81`); here
 *   a level is the one above it box-filtered by 2.
 * - `RGBA8` (`A8R8G8B8`, Morton-swizzled in a `GTF `): cwlib's `toDDS` only
 *   takes Squish's three types, though its `CellGcmTexture` takes an
 *   `A8R8G8B8` DDS when one is imported as it is.
 * - the chunks: cwlib deflates every one, even one that grows; this stores
 *   such a chunk as it is, as 47 of the game's `TEX `s do.
 */

import type { Deflate } from '../io/writer.ts';
import { compressBc, type BcMetric } from './texture-encode-bc.ts';
import {
  GCM_A8R8G8B8, GCM_DXT1, GCM_DXT3, GCM_DXT5, TextureFormatError, gameDdsHeader as textureDdsHeader, writeChunkTable, writeTexture,
  type GcmTexture, type Texture, type TextureFormat, type TextureLevel,
} from './texture.ts';

/** cwlib's choices -- Squish's `CompressionType` -- and `A8R8G8B8`. */
export type ImageTextureFormat = 'DXT1' | 'DXT3' | 'DXT5' | 'RGBA8';

export interface ImageTextureOptions {
  readonly format: ImageTextureFormat;
  /** `GTF `, as the game's own; `TEX `, as a user's. */
  readonly container: 'GTF ' | 'TEX ';
  /** cwlib's `generateMips`. Default false. */
  readonly mipmaps?: boolean;
  /** Data, not colour: `GTF ` flags bit 0, the `TEX ` footer `BUMP`. Default false. */
  readonly noSRGB?: boolean;
  /** Run `toBump` on the image first. Default false. */
  readonly bump?: boolean;
  /** What the DXT fit minimises. Default `perceptual`, Squish's. */
  readonly metric?: BcMetric;
  /** `game` (the default): what the game's textures and `readTexture` have. `cwlib`: cwlib's bytes. */
  readonly layout?: 'game' | 'cwlib';
}

const FORMAT: Readonly<Record<ImageTextureFormat, { format: TextureFormat; gcm: number; fourcc?: string }>> = {
  DXT1: { format: 'bc1', gcm: GCM_DXT1, fourcc: 'DXT1' },
  DXT3: { format: 'bc2', gcm: GCM_DXT3, fourcc: 'DXT3' },
  DXT5: { format: 'bc3', gcm: GCM_DXT5, fourcc: 'DXT5' },
  RGBA8: { format: 'rgba8', gcm: GCM_A8R8G8B8 },
};

/** cwlib's `toNearest`: the highest set bit, so a side scales down to a power of two. */
export function floorPowerOfTwo(n: number): number {
  return n < 1 ? 0 : 2 ** Math.floor(Math.log2(n));
}

/**
 * cwlib's `toBump`: when the first texel is not grey, every texel becomes
 * `(G, G, G, R)`. A copy; the input is untouched.
 */
export function toBump(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = rgba.slice(0, width * height * 4);
  if (out[0] === out[1] && out[0] === out[2]) return out;
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    out[i] = g;
    out[i + 2] = g;
    out[i + 3] = r;
  }
  return out;
}

/**
 * Scale an RGBA8 image to `nw x nh` by averaging each new texel's footprint,
 * partial texels by the share of them it covers. Down only; halving is the
 * 2 x 2 mean, rounded.
 */
export function resizeImage(rgba: Uint8Array, width: number, height: number, nw: number, nh: number): Uint8Array {
  if (nw === width && nh === height) return rgba.slice(0, width * height * 4);
  if (nw > width || nh > height) throw new RangeError(`resizeImage scales down only: ${width}x${height} to ${nw}x${nh}`);
  // Separable: across, into floats, then down.
  const spans = (from: number, to: number): { first: number; weights: number[] }[] => {
    const scale = from / to;
    const out: { first: number; weights: number[] }[] = [];
    for (let i = 0; i < to; i += 1) {
      const a = i * scale;
      const b = (i + 1) * scale;
      const first = Math.floor(a);
      const weights: number[] = [];
      for (let s = first; s < Math.min(from, Math.ceil(b)); s += 1) weights.push((Math.min(b, s + 1) - Math.max(a, s)) / scale);
      out.push({ first, weights });
    }
    return out;
  };
  const across = spans(width, nw);
  const down = spans(height, nh);
  const mid = new Float64Array(nw * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < nw; x += 1) {
      const { first, weights } = across[x];
      for (let c = 0; c < 4; c += 1) {
        let acc = 0;
        for (let k = 0; k < weights.length; k += 1) acc += weights[k] * rgba[(y * width + first + k) * 4 + c];
        mid[(y * nw + x) * 4 + c] = acc;
      }
    }
  }
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y += 1) {
    const { first, weights } = down[y];
    for (let x = 0; x < nw; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let acc = 0;
        for (let k = 0; k < weights.length; k += 1) acc += weights[k] * mid[((first + k) * nw + x) * 4 + c];
        out[(y * nw + x) * 4 + c] = Math.min(255, Math.round(acc));
      }
    }
  }
  return out;
}

/**
 * The levels cwlib would make of an image: scaled to powers of two, then, with
 * `mipmaps`, halved until a side is 1. Each is RGBA8.
 */
export function mipChain(rgba: Uint8Array, width: number, height: number, mipmaps: boolean): { width: number; height: number; rgba: Uint8Array }[] {
  if (!(width >= 1 && height >= 1) || rgba.length < width * height * 4) {
    throw new RangeError(`${rgba.length} bytes is not a ${width}x${height} RGBA8 image`);
  }
  let w = floorPowerOfTwo(width);
  let h = floorPowerOfTwo(height);
  if (w > 0xffff || h > 0xffff) throw new TextureFormatError(`${w}x${h} is over a GTF's 16-bit sides`);
  const chain = [{ width: w, height: h, rgba: resizeImage(rgba, width, height, w, h) }];
  // ⚠️ cwlib's loop asks for a side of 0 -- and fails -- when the image starts
  // with a side of 1; here that image has its one level.
  while (mipmaps && w > 1 && h > 1) {
    const above = chain[chain.length - 1].rgba;
    chain.push({ width: w >> 1, height: h >> 1, rgba: resizeImage(above, w, h, w >> 1, h >> 1) });
    w >>= 1;
    h >>= 1;
  }
  return chain;
}

/**
 * `Texture` for an image, as cwlib's `toGTF` or `toTEX` makes it: its levels
 * compressed to `format`, the `GTF ` header cwlib writes. `writeTexture` writes
 * it -- a `GTF ` exactly as `encodeImageTexture` does with `layout: 'game'`; a
 * `TEX ` under `writeTexture`'s own DDS header rather than cwlib's, which
 * `encodeImageTexture` writes.
 */
export function textureFromImage(rgba: Uint8Array, width: number, height: number, options: ImageTextureOptions): Texture {
  const spec = FORMAT[options.format];
  if (!spec) throw new TextureFormatError(`no image texture format ${JSON.stringify(options.format)}`);
  if (options.container !== 'GTF ' && options.container !== 'TEX ') {
    throw new TextureFormatError(`no texture container ${JSON.stringify(options.container)}`);
  }
  const image = options.bump ? toBump(rgba, width, height) : rgba;
  const chain = mipChain(image, width, height, options.mipmaps ?? false);
  const levels: TextureLevel[] = chain.map((level) => ({
    width: level.width,
    height: level.height,
    depth: 1,
    data: spec.format === 'rgba8' ? level.rgba : compressBc(level.rgba, level.width, level.height, spec.format, { metric: options.metric }),
  }));
  const noSRGB = options.noSRGB ?? false;
  const w = chain[0].width;
  const h = chain[0].height;
  const gcm: GcmTexture | undefined = options.container === 'GTF ' ? {
    format: spec.gcm, mipmap: chain.length, dimension: 2, cubemap: false, remap: 0xaae4,
    width: w, height: h, depth: 1, location: 0, flags: noSRGB ? 1 : 0, pitch: 0, offset: 0,
  } : undefined;
  return {
    magic: options.container, format: spec.format, width: w, height: h, depth: 1,
    mipCount: chain.length, faces: 1, levels: [levels], bump: noSRGB, ...(gcm ? { gcm } : {}),
  };
}

const DDS_HEADER = 0x80;
const GTF_HEADER = 0x1c;

/**
 * cwlib's `DDS.getDDSHeader` for a 2D texture: flags `0x1007`, `0x20000` with
 * more than one level; no pitch, no depth; the level count; the pixel format;
 * caps `0x1000`, `0x400008` with more than one level.
 */
export function cwlibDdsHeader(format: ImageTextureFormat, width: number, height: number, mips: number): Uint8Array {
  const out = new Uint8Array(DDS_HEADER);
  const view = new DataView(out.buffer);
  const le = (o: number, v: number): void => view.setUint32(o, v >>> 0, true);
  out.set([0x44, 0x44, 0x53, 0x20]);
  le(4, 0x7c);
  le(8, 0x1007 | (mips !== 1 ? 0x20000 : 0));
  le(12, height);
  le(16, width);
  le(28, mips);
  le(76, 0x20);
  const fourcc = FORMAT[format].fourcc;
  if (fourcc) {
    le(80, 0x4);
    out.set([...fourcc].map((c) => c.charCodeAt(0)), 84);
  } else {
    // DDSPF_A8R8G8B8.
    le(80, 0x41);
    le(88, 32);
    le(92, 0x00ff0000);
    le(96, 0x0000ff00);
    le(100, 0x000000ff);
    le(104, 0xff000000);
  }
  le(108, 0x1000 | (mips !== 1 ? 0x400008 : 0));
  return out;
}

/** The DDS header of the game's own `TEX `s (`gameDdsHeader` in `texture.ts`), cwlib's but for one level and `A8R8G8B8`. */
export function gameDdsHeader(format: ImageTextureFormat, width: number, height: number, mips: number): Uint8Array {
  return textureDdsHeader(FORMAT[format].format, width, height, mips);
}

/** The levels' bytes as a DDS stores them: BC blocks as they are, RGBA8 as little-endian ARGB words. */
function ddsLevels(value: Texture): Uint8Array[] {
  return value.levels[0].map((level) => {
    if (value.format !== 'rgba8') return level.data;
    const out = new Uint8Array(level.data.length);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = level.data[i + 2];
      out[i + 1] = level.data[i + 1];
      out[i + 2] = level.data[i];
      out[i + 3] = level.data[i + 3];
    }
    return out;
  });
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A deflate that never shrinks, so `writeChunkTable` stores every chunk as it is. */
const store: Deflate = (raw) => raw;

/**
 * The `GTF ` header and the padded chain `writeTexture` lays out -- the swizzle
 * of an `A8R8G8B8` included -- read back out of a file written with every chunk
 * stored.
 */
async function gtfParts(value: Texture): Promise<{ header: Uint8Array; chain: Uint8Array }> {
  const file = await writeTexture(value, store);
  const count = new DataView(file.buffer, file.byteOffset).getUint16(GTF_HEADER + 2, false);
  return { header: file.subarray(0, GTF_HEADER), chain: file.subarray(GTF_HEADER + 4 + count * 4) };
}

/**
 * An image as a whole `GTF ` or `TEX ` file: `textureFromImage`, then the
 * container -- cwlib's `toGTF` or `toTEX`, but for what `layout` changes.
 */
export async function encodeImageTexture(
  rgba: Uint8Array, width: number, height: number, options: ImageTextureOptions, deflate: Deflate,
): Promise<Uint8Array> {
  const value = textureFromImage(rgba, width, height, options);
  const cwlib = (options.layout ?? 'game') === 'cwlib';
  if (value.magic === 'GTF ') {
    if (!cwlib) return writeTexture(value, deflate);
    const { header, chain } = await gtfParts(value);
    // cwlib's chain is the levels and no padding.
    const length = value.levels[0].reduce((n, level) => n + (value.format === 'rgba8' ? level.width * level.height * 4 : level.data.length), 0);
    return concat([header, await writeChunkTable(chain.subarray(0, length), deflate)]);
  }
  const footer = value.bump ? [new Uint8Array([0x42, 0x55, 0x4d, 0x50])] : cwlib ? [new Uint8Array(4)] : [];
  const header = (cwlib ? cwlibDdsHeader : gameDdsHeader)(options.format, value.width, value.height, value.mipCount);
  const dds = concat([header, ...ddsLevels(value), ...footer]);
  return concat([new Uint8Array([0x54, 0x45, 0x58, 0x20]), await writeChunkTable(dds, deflate)]);
}
