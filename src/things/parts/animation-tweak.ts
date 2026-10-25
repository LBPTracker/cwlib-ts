/** `ANIMATION_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * `PAnimationTweak`: an animated mesh's playback settings.
 *
 * ❗ **Every field keeps cwlib's `subVersion` gate (`PAnimationTweak.java`).**
 * `rootRotationX` used to be read always, with its gate only in a comment, which
 * holds from subVersion 0x147 but not below it. Measured 2026-10-22 on the two
 * LBP3 levels stored whole in one `.bin`: `sack_town.bin` (subVersion 0xc8)
 * read `rootRotationY` as 2.35e-38 and failed on the next `0xAA` marker, at
 * byte 14869; `fickle_mistress.bin` (0x144) failed at 569855 and, without the
 * field, reads to its end. See answered question 56.
 */
/** `PAnimationTweak`, kept: the animation an animation tweaker plays, and how. */
export interface AnimationTweakPart {
  readonly animSpeed: number;
  readonly animPos: number;
  readonly animBlendTime: number;
  readonly behavior: number;
  /** The `RAnimation` (`ANMb`) it plays. */
  readonly anim?: ResourceRef;
  readonly animLoop: boolean;
  readonly cachedMeshFile: number;
  readonly containerFile: number;
  readonly animStart: number;
  readonly animEnd: number;
  readonly animPlaying: boolean;
  readonly type: number;
  readonly animToOverride: number;
  readonly tweakMeshFile: number;
  readonly actorName: string;
  readonly rootRotationY?: number;
  readonly usesRootRotation?: boolean;
  readonly containerType?: number;
  readonly subContainerIndex?: number;
  readonly yawRate?: number;
  readonly pitchRate?: number;
  readonly rollRate?: number;
  readonly yawPosition?: number;
  readonly pitchPosition?: number;
  readonly rollPosition?: number;
  readonly rootRotationZ?: number;
  readonly blendAction?: number;
  readonly animResetOnInactive?: boolean;
  readonly rootRotationX?: number;
  /**
   * A byte from subVersion 0x5c to 0x151 that cwlib reads and writes as 0 and does
   * not name. Not always 0 in the game's files: 40 of the 772 `ANIMATION_TWEAK`s in
   * the FARCs hold something else (`dev/part-census.ts`, 2026-10-25).
   */
  readonly legacyByte?: number;
}

export function readAnimationTweak(s: Serializer): AnimationTweakPart {
  const { subVersion } = s.revision;
  let blendAction: number | undefined;
  let animResetOnInactive: boolean | undefined;
  let rootRotationX: number | undefined;
  let rootRotationY: number | undefined;
  let usesRootRotation: boolean | undefined;
  let containerType: number | undefined;
  let subContainerIndex: number | undefined;
  let yawRate: number | undefined;
  let pitchRate: number | undefined;
  let rollRate: number | undefined;
  let yawPosition: number | undefined;
  let pitchPosition: number | undefined;
  let rollPosition: number | undefined;
  let rootRotationZ: number | undefined;
  let legacyByte: number | undefined;
  const animSpeed = s.f32();
  const animPos = subVersion > 0x1d ? s.f32() : 0;
  const animBlendTime = subVersion >= 0x25 ? s.f32() : 0;
  const behavior = s.i32();
  if (subVersion >= 0x25) blendAction = s.i32();
  let anim: ResourceRef | undefined;
  let animLoop = false;
  if (subVersion > 0x1d) {
    anim = s.resource();
    animLoop = s.bool();
  }
  const cachedMeshFile = subVersion > 0x1f ? s.guid() : 0;
  let containerFile = 0;
  let animStart = 0;
  let animEnd = 0;
  if (subVersion > 0x20) {
    containerFile = s.guid();
    animStart = s.f32();
    animEnd = s.f32();
  }
  const animPlaying = subVersion > 0x25 ? s.bool() : false;
  if (subVersion > 0x26) animResetOnInactive = s.bool();
  if (subVersion > 0x146 || (subVersion > 0x13e && subVersion < 0x143)) rootRotationX = s.f32();
  if (subVersion > 0x39) {
    rootRotationY = s.f32();
    usesRootRotation = s.bool();
  }
  let type = 0;
  let animToOverride = 0;
  if (subVersion > 0x42) {
    type = s.i32();
    animToOverride = s.i32();
  }
  if (subVersion >= 0x5c && subVersion < 0x152) legacyByte = s.u8();
  const tweakMeshFile = subVersion > 0x66 ? s.guid() : 0;
  if (subVersion > 0x69) {
    containerType = s.i32();
    subContainerIndex = s.i32();
  }
  const actorName = subVersion > 0x6a ? s.wstr() : '';
  if (subVersion > 0x151) {
    yawRate = s.f32();
    pitchRate = s.f32();
    rollRate = s.f32();
    yawPosition = s.f32();
    pitchPosition = s.f32();
    rollPosition = s.f32();
    rootRotationZ = s.f32();
  }
  return {
    animSpeed, animPos, animBlendTime, behavior, anim, animLoop, cachedMeshFile, containerFile,
    animStart, animEnd,
    animPlaying, type, animToOverride, tweakMeshFile, actorName,
  rootRotationY, usesRootRotation, containerType, subContainerIndex, yawRate, pitchRate, rollRate,
  yawPosition, pitchPosition, rollPosition, rootRotationZ,
    blendAction, animResetOnInactive, rootRotationX, legacyByte,
  };
}

/** `readAnimationTweak`'s mirror, under the same `subVersion` gates. */
export function writeAnimationTweak(w: Writer, value: AnimationTweakPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.f32(value.animSpeed);
  if (subVersion > 0x1d) w.f32(value.animPos);
  if (subVersion >= 0x25) w.f32(value.animBlendTime);
  w.i32(value.behavior);
  if (subVersion >= 0x25) w.i32(value.blendAction ?? 0);
  if (subVersion > 0x1d) {
    w.ref(value.anim);
    w.bool(value.animLoop);
  }
  if (subVersion > 0x1f) w.guid(value.cachedMeshFile);
  if (subVersion > 0x20) {
    w.guid(value.containerFile);
    w.f32(value.animStart);
    w.f32(value.animEnd);
  }
  if (subVersion > 0x25) w.bool(value.animPlaying);
  if (subVersion > 0x26) w.bool(value.animResetOnInactive ?? false);
  if (subVersion > 0x146 || (subVersion > 0x13e && subVersion < 0x143)) w.f32(value.rootRotationX ?? 0);
  if (subVersion > 0x39) {
    w.f32(value.rootRotationY ?? 0);
    w.bool(value.usesRootRotation ?? false);
  }
  if (subVersion > 0x42) {
    w.i32(value.type);
    w.i32(value.animToOverride);
  }
  if (subVersion >= 0x5c && subVersion < 0x152) w.u8(value.legacyByte ?? 0);
  if (subVersion > 0x66) w.guid(value.tweakMeshFile);
  if (subVersion > 0x69) {
    w.i32(value.containerType ?? 0);
    w.i32(value.subContainerIndex ?? 0);
  }
  if (subVersion > 0x6a) w.wstr(value.actorName);
  if (subVersion > 0x151) {
    w.f32(value.yawRate ?? 0);
    w.f32(value.pitchRate ?? 0);
    w.f32(value.rollRate ?? 0);
    w.f32(value.yawPosition ?? 0);
    w.f32(value.pitchPosition ?? 0);
    w.f32(value.rollPosition ?? 0);
    w.f32(value.rootRotationZ ?? 0);
  }
}
