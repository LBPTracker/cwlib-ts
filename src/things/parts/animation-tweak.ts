/** `ANIMATION_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';

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
}

export function readAnimationTweak(s: Serializer): AnimationTweakPart {
  const { subVersion } = s.revision;
  const animSpeed = s.f32();
  const animPos = subVersion > 0x1d ? s.f32() : 0;
  const animBlendTime = subVersion >= 0x25 ? s.f32() : 0;
  const behavior = s.i32();
  if (subVersion >= 0x25) s.i32(); // blendAction
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
  if (subVersion > 0x26) s.bool(); // animResetOnInactive
  if (subVersion > 0x146 || (subVersion > 0x13e && subVersion < 0x143)) s.f32(); // rootRotationX
  if (subVersion > 0x39) {
    s.f32(); // rootRotationY
    s.bool(); // usesRootRotation
  }
  let type = 0;
  let animToOverride = 0;
  if (subVersion > 0x42) {
    type = s.i32();
    animToOverride = s.i32();
  }
  if (subVersion >= 0x5c && subVersion < 0x152) s.u8();
  const tweakMeshFile = subVersion > 0x66 ? s.guid() : 0;
  if (subVersion > 0x69) {
    s.i32(); // containerType
    s.i32(); // subContainerIndex
  }
  const actorName = subVersion > 0x6a ? s.wstr() : '';
  if (subVersion > 0x151) {
    s.f32(); // yawRate
    s.f32(); // pitchRate
    s.f32(); // rollRate
    s.f32(); // yawPosition
    s.f32(); // pitchPosition
    s.f32(); // rollPosition
    s.f32(); // rootRotationZ
  }
  return {
    animSpeed, animPos, animBlendTime, behavior, anim, animLoop, cachedMeshFile, containerFile, animStart, animEnd,
    animPlaying, type, animToOverride, tweakMeshFile, actorName,
  };
}
