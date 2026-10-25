/** `STICKERS`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef, vitaRevision } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  /** Versions 0x14e to 0x25b: the ARGB `i32` the file stores, which `color` packs into 16 bits. */
  readonly colorARGB?: number;
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
  let colorARGB: number | undefined;
  // ❗ Between 0x14e and 0x25b the colour is an ARGB `i32`, which cwlib packs into
  // the 16-bit form that came after; without it the LBP1 levels' stickers ran short.
  if (version >= 0x14e && version < 0x25c) {
    const argb = s.i32();
    colorARGB = argb;
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
    numMetadata, placedBy, localHitPoint, dontWantGammaCorrection, colorARGB,
  };
}

function writeDecal(w: Writer, d: Decal): void {
  const { version } = w.revision;
  w.ref(d.texture);
  w.f32(d.u);
  w.f32(d.v);
  w.f32(d.xvecu);
  w.f32(d.xvecv);
  w.f32(d.yvecu);
  w.f32(d.yvecv);
  if (version >= 0x14e && version < 0x25c) {
    // cwlib's widening of the 16-bit colour, where the file's own word is not kept.
    const c = d.color & 0xffff;
    w.i32(d.colorARGB ?? (((c << 5) & 0xfc00) | ((c << 8) & 0xf80000) | ((c & 0x1f) << 3) | 0xff000000));
  }
  if (version >= 0x260) w.i16(d.color);
  if (version >= 0x158) {
    w.u8(d.type);
    w.i16(d.metadataIndex);
    if (version <= 0x3ba) w.i16(d.numMetadata ?? 0);
  }
  if (version >= 0x214) w.i16(d.placedBy ?? 0);
  if (version >= 0x215) w.i32(d.playModeFrame);
  if (version >= 0x219) w.bool(d.scorchMark);
  if (version >= 0x34c) w.ref(d.plan, { descriptor: true });
  else if (version >= 0x25b) w.guid(d.planGUID);
  const vita = vitaRevision(w.revision);
  if (vita >= 0x3f) w.vector4(d.localHitPoint ?? [0, 0, 0, 0]);
  if (vita >= 0x7e) w.bool(d.dontWantGammaCorrection ?? false);
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
  /** Versions 0x3bc to 0x3cb: the descriptors the game's loader reads and drops (below). */
  readonly palettePlans?: readonly (ResourceRef | undefined)[];
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
  const palettePlans = version >= 0x3bc && version <= 0x3cb ? s.array((self) => self.resource(true)) : undefined;
  return { decals, costumeDecals, paintControl, eyetoyData, palettePlans };
}

/** `readStickers`' mirror. */
export function writeStickers(w: Writer, p: StickersPart, _ctx: PartWriteContext): void {
  const { version } = w.revision;
  w.i32(p.decals.length);
  for (const d of p.decals) writeDecal(w, d);
  w.i32(p.costumeDecals.length);
  for (const list of p.costumeDecals) {
    w.i32(list.length);
    for (const d of list) writeDecal(w, d);
  }
  if (version >= 0x158 && version <= 0x3ba) {
    const points = p.paintControl ?? [];
    w.i32(points.length);
    for (const point of points) {
      w.i8(point.x);
      w.i8(point.y);
      w.i8(point.startRadius);
      w.i8(point.endRadius);
    }
  }
  if (version >= 0x15d) {
    const photos = p.eyetoyData ?? [];
    w.i32(photos.length);
    for (const photo of photos) writeEyetoyData(w, photo);
  }
  if (version >= 0x3bc && version <= 0x3cb) {
    const plans = p.palettePlans ?? [];
    w.i32(plans.length);
    for (const plan of plans) w.ref(plan, { descriptor: true });
  }
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

function writeColorCorrection(w: Writer, c: ColorCorrection | undefined): void {
  w.f32(c?.saturation ?? 0);
  w.f32(c?.hueShift ?? 0);
  w.f32(c?.brightness ?? 0);
  w.f32(c?.contrast ?? 0);
  w.f32(c?.tintHue ?? 0);
  w.f32(c?.tintAmount ?? 0);
}

/** `readEyetoyData`'s mirror: nothing below version 0x15e. */
export function writeEyetoyData(w: Writer, e: EyetoyData): void {
  const { version } = w.revision;
  if (version < 0x15e) return;
  w.ref(e.frame);
  w.ref(e.alphaMask);
  w.matrix(e.colorCorrection ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  writeColorCorrection(w, e.colorCorrectionSrc);
  if (version > 0x39f) w.ref(e.outline);
}
