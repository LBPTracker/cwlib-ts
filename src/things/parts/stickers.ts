/** `STICKERS`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef, vitaRevision } from '../../io/serializer.ts';

/**
 * One sticker: a texture laid on a Thing's surface. cwlib's `Decal.java`;
 * steering/level-files.md, *Stickers*, says what of it is measured.
 */
export interface Decal {
  /** The sticker's texture (`TEX `, dependency type 1): a GUID for the game's, a hash for a user's. */
  readonly texture?: ResourceRef;
  /** Where the sticker's centre sits, in the surface's decal space (*Stickers*). */
  readonly u: number;
  readonly v: number;
  /** The sticker's x and y axes in the same space: their lengths are its size, their angle its rotation. */
  readonly xvecu: number;
  readonly xvecv: number;
  readonly yvecu: number;
  readonly yvecv: number;
  /** A 16-bit colour as stored; -1 when the revision has none. */
  readonly color: number;
  /** cwlib's `DecalType`, an enum8; -1 when the revision has none. */
  readonly type: number;
  readonly metadataIndex: number;
  /** -1 when the revision has none. */
  readonly playModeFrame: number;
  readonly scorchMark: boolean;
  readonly plan?: ResourceRef;
  readonly planGUID: number;
  /** Versions `0x158` to `0x3ba`. */
  readonly numMetadata?: number;
  /** Version `0x214` on. */
  readonly placedBy?: number;
  /** The Vita's, from its revisions `0x3f` and `0x7e`. */
  readonly localHitPoint?: readonly [number, number, number, number];
  readonly dontWantGammaCorrection?: boolean;
}

/** `Decal`: one sticker. */
function readDecal(s: Serializer): Decal {
  const { version } = s.revision;
  const texture = s.resource();
  const u = s.f32();
  const v = s.f32();
  const xvecu = s.f32();
  const xvecv = s.f32();
  const yvecu = s.f32();
  const yvecv = s.f32();
  let color = -1;
  // ❗ Between 0x14e and 0x25b the colour is an ARGB `i32`, which cwlib packs into
  // the 16-bit form that came after; without it the LBP1 levels' stickers ran short.
  if (version >= 0x14e && version < 0x25c) {
    const argb = s.i32();
    color = (((((argb >>> 10) & 0x3f) << 5) | (((argb >>> 0x13) & 0x1f) << 0xb) | ((argb >>> 3) & 0x1f)) << 16) >> 16;
  }
  if (version >= 0x260) color = s.i16();
  let type = -1;
  let metadataIndex = -1;
  let numMetadata: number | undefined;
  if (version >= 0x158) {
    type = s.u8(); // enum8
    metadataIndex = s.i16();
    // ⚠️ Version-dependent *inside* the corpus: 0x3b8 and 0x3ba have this, the
    // rest do not.
    if (version <= 0x3ba) numMetadata = s.i16();
  }
  const placedBy = version >= 0x214 ? s.i16() : undefined;
  const playModeFrame = version >= 0x215 ? s.i32() : -1;
  const scorchMark = version >= 0x219 ? s.bool() : false;
  let plan: ResourceRef | undefined;
  let planGUID = 0;
  if (version >= 0x34c) plan = s.resource(true); // a descriptor
  else if (version >= 0x25b) planGUID = s.guid();
  const vita = vitaRevision(s.revision);
  const localHitPoint = vita >= 0x3f ? s.vector4() : undefined;
  const dontWantGammaCorrection = vita >= 0x7e ? s.bool() : undefined;
  return {
    texture, u, v, xvecu, xvecv, yvecu, yvecv, color, type, metadataIndex, playModeFrame, scorchMark, plan, planGUID,
    numMetadata, placedBy, localHitPoint, dontWantGammaCorrection,
  };
}

/** `PaintControlPoint`: four signed bytes. */
export interface PaintControlPoint {
  readonly x: number;
  readonly y: number;
  readonly startRadius: number;
  readonly endRadius: number;
}

/** `PStickers`: the decals on a Thing, and its costume pieces' own. */
export interface StickersPart {
  readonly decals: Decal[];
  /** One list per costume piece. */
  readonly costumeDecals: Decal[][];
  /** Versions 0x158 to 0x3ba: where the paint was laid, in points. */
  readonly paintControl?: readonly PaintControlPoint[];
  /** Version 0x15d on: the photos stuck to the Thing. */
  readonly eyetoyData?: readonly EyetoyData[];
}

/** `PStickers`: the decals on a Thing, plus the costume, paint and eyetoy lists. */
export function readStickers(s: Serializer): StickersPart {
  const { version } = s.revision;
  const decals: Decal[] = [];
  const count = s.count();
  for (let i = 0; i < count; i += 1) decals.push(readDecal(s));
  const costumeDecals: Decal[][] = [];
  const costumes = s.count();
  for (let i = 0; i < costumes; i += 1) {
    const list: Decal[] = [];
    const n = s.count();
    for (let j = 0; j < n; j += 1) list.push(readDecal(s));
    costumeDecals.push(list);
  }
  // ⚠️ `paintControl` exists only up to 0x3ba, and the corpus starts at 0x3b8.
  const paintControl = version >= 0x158 && version <= 0x3ba
    ? s.array((x) => ({ x: x.i8(), y: x.i8(), startRadius: x.i8(), endRadius: x.i8() }))
    : undefined;
  const eyetoyData = version >= 0x15d ? s.array(readEyetoyData) : undefined;
  // ❗ An array of descriptors for versions 0x3bc–0x3cb only, which the game's
  // loader (`v0xcfff80` in `eboot-v128.bin`, the array `v0xd77400`) reads and
  // drops and cwlib does not have: the five Move DLC palette plans at 0x3c1 and
  // 0x3c7, one hash each. steering/level-files.md, *`playerMode` at 0x3eb*.
  if (version >= 0x3bc && version <= 0x3cb) s.array((self) => self.resource(true));
  return { decals, costumeDecals, paintControl, eyetoyData };
}

/** `ColorCorrection`: six floats. */
export interface ColorCorrection {
  readonly saturation: number;
  readonly hueShift: number;
  readonly brightness: number;
  readonly contrast: number;
  readonly tintHue: number;
  readonly tintAmount: number;
}

function readColorCorrection(s: Serializer): ColorCorrection {
  return {
    saturation: s.f32(), hueShift: s.f32(), brightness: s.f32(),
    contrast: s.f32(), tintHue: s.f32(), tintAmount: s.f32(),
  };
}

/** `EyetoyData`: a photo stuck to a Thing; nothing below version `0x15e`. */
export interface EyetoyData {
  readonly frame?: ResourceRef;
  readonly alphaMask?: ResourceRef;
  readonly colorCorrection?: Float32Array;
  readonly colorCorrectionSrc?: ColorCorrection;
  readonly outline?: ResourceRef;
}

export function readEyetoyData(s: Serializer): EyetoyData {
  const { version } = s.revision;
  if (version < 0x15e) return {};
  return {
    frame: s.resource(),
    alphaMask: s.resource(),
    colorCorrection: s.matrix(),
    colorCorrectionSrc: readColorCorrection(s),
    outline: version > 0x39f ? s.resource() : undefined,
  };
}
