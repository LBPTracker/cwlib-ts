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
  const color = version >= 0x260 ? s.i16() : -1;
  let type = -1;
  let metadataIndex = -1;
  if (version >= 0x158) {
    type = s.u8(); // enum8
    metadataIndex = s.i16();
    // ⚠️ Version-dependent *inside* the corpus: 0x3b8 and 0x3ba have this, the
    // rest do not.
    if (version <= 0x3ba) s.i16(); // numMetadata
  }
  if (version >= 0x214) s.i16(); // placedBy
  const playModeFrame = version >= 0x215 ? s.i32() : -1;
  const scorchMark = version >= 0x219 ? s.bool() : false;
  let plan: ResourceRef | undefined;
  let planGUID = 0;
  if (version >= 0x34c) plan = s.resource(true); // a descriptor
  else if (version >= 0x25b) planGUID = s.guid();
  const vita = vitaRevision(s.revision);
  if (vita >= 0x3f) s.skipVector4(); // localHitPoint
  if (vita >= 0x7e) s.bool(); // dontWantGammaCorrection
  return { texture, u, v, xvecu, xvecv, yvecu, yvecv, color, type, metadataIndex, playModeFrame, scorchMark, plan, planGUID };
}

/** `PStickers`: the decals on a Thing, and its costume pieces' own. */
export interface StickersPart {
  readonly decals: Decal[];
  /** One list per costume piece. */
  readonly costumeDecals: Decal[][];
}

/** `PStickers`: the decals on a Thing, plus the costume and eyetoy lists (eyetoy walked, discarded). */
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
  if (version >= 0x158 && version <= 0x3ba) {
    const n = s.count();
    for (let i = 0; i < n; i += 1) s.skip(4); // x, y, startRadius, endRadius
  }
  if (version >= 0x15d) {
    const n = s.count();
    for (let i = 0; i < n; i += 1) readEyetoyData(s);
  }
  // ❗ An array of descriptors for versions 0x3bc–0x3cb only, which the game's
  // loader (`v0xcfff80` in `eboot-v128.bin`, the array `v0xd77400`) reads and
  // drops and cwlib does not have: the five Move DLC palette plans at 0x3c1 and
  // 0x3c7, one hash each. steering/level-files.md, *`playerMode` at 0x3eb*.
  if (version >= 0x3bc && version <= 0x3cb) s.array((self) => self.resource(true));
  return { decals, costumeDecals };
}

/** `ColorCorrection`: six floats. */
function readColorCorrection(s: Serializer): void {
  for (let i = 0; i < 6; i += 1) s.f32();
}

/** `EyetoyData`: a photo stuck to a Thing. */
export function readEyetoyData(s: Serializer): void {
  const { version } = s.revision;
  if (version < 0x15e) return;
  s.resource(); // frame
  s.resource(); // alphaMask
  s.skipMatrix(); // colorCorrection
  readColorCorrection(s);
  if (version > 0x39f) s.resource(); // outline
}
