/** `GENERATED_MESH`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef, vitaRevision } from '../../io/serializer.ts';

/** `PGeneratedMesh`: how a shape is drawn. */
export interface GeneratedMeshPart {
  /** The `RGfxMaterial` (`GMTb`, type 7) the extruded shape is drawn with. */
  readonly gfxMaterial?: ResourceRef;
  /** The `RBevel` (`BEVb`, type 24). */
  readonly bevel?: ResourceRef;
  readonly uvOffset: readonly [number, number, number, number];
  readonly planGUID: number;
  /** cwlib's bit 0 play mode, bit 1 edit mode; -1 when the revision has no field. */
  readonly visibilityFlags: number;
  readonly noBevel: boolean;
  readonly includeSides: boolean;
  readonly textureAnimationSpeed?: number;
  readonly textureAnimationSpeedOff?: number;
  readonly slideSteer?: number;
  readonly slideSpeed?: number;
  readonly uvMode?: number;
  /** The Vita's, at its revision 0x76 alone (cwlib `PGeneratedMesh`). */
  readonly textureScale?: number;
  readonly sharded?: boolean;
  readonly slideImpactDamping?: number;
}

/**
 * `PGeneratedMesh`: the extruded mesh a shape gets its look from.
 *
 * ⚠️ The visibility flag is a `bool` while `subVersion < 0xfb` and an `i8` at or
 * above it — the same byte either way, but the *gate* differs, so a file with a
 * subVersion in between would read neither. Both branches are here.
 */
export function readGeneratedMesh(s: Serializer): GeneratedMeshPart {
  const { version, subVersion } = s.revision;
  let uvMode: number | undefined;
  let textureScale: number | undefined;
  let sharded: boolean | undefined;
  let slideImpactDamping: number | undefined;
  let textureAnimationSpeed: number | undefined;
  let textureAnimationSpeedOff: number | undefined;
  let slideSteer: number | undefined;
  let slideSpeed: number | undefined;
  const gfxMaterial = s.resource();
  const bevel = s.resource();
  const uvOffset = s.vector4();
  const planGUID = version >= 0x258 ? s.guid() : 0;
  let visibilityFlags = -1;
  if (version >= 0x27c && subVersion < 0xfb) visibilityFlags = s.bool() ? 3 : 0;
  if (subVersion >= 0xfb) visibilityFlags = s.u8();
  if (version >= 0x305) {
    textureAnimationSpeed = s.f32();
    textureAnimationSpeedOff = s.f32();
  }
  const vita = vitaRevision(s.revision);
  if (vita >= 0x6b) uvMode = s.i32();
  if (vita === 0x76) textureScale = s.f32();
  const noBevel = subVersion >= 0x34 ? s.bool() : false;
  if (subVersion >= 0x97) sharded = s.bool();
  const includeSides = subVersion >= 0x13d ? s.bool() : true;
  if (subVersion >= 0x155) slideImpactDamping = s.u8();
  if (subVersion >= 0x13d) {
    slideSteer = s.u8();
    slideSpeed = s.u8();
  }
  return {
    gfxMaterial, bevel, uvOffset, planGUID, visibilityFlags, noBevel, includeSides,
    textureAnimationSpeed, textureAnimationSpeedOff, slideSteer, slideSpeed, uvMode, textureScale, sharded,
    slideImpactDamping,
  };
}
