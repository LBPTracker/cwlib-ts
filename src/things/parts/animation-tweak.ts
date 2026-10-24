/** `ANIMATION_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

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
export function readAnimationTweak(s: Serializer): void {
  const { subVersion } = s.revision;
  s.f32(); // animSpeed
  if (subVersion > 0x1d) s.f32(); // animPos
  if (subVersion >= 0x25) s.f32(); // animBlendTime
  s.i32(); // behavior
  if (subVersion >= 0x25) s.i32(); // blendAction
  if (subVersion > 0x1d) {
    s.resource(); // anim
    s.bool(); // animLoop
  }
  if (subVersion > 0x1f) s.guid(); // cachedMeshFile
  if (subVersion > 0x20) {
    s.guid(); // containerFile
    s.f32(); // animStart
    s.f32(); // animEnd
  }
  if (subVersion > 0x25) s.bool(); // animPlaying
  if (subVersion > 0x26) s.bool(); // animResetOnInactive
  if (subVersion > 0x146 || (subVersion > 0x13e && subVersion < 0x143)) s.f32(); // rootRotationX
  if (subVersion > 0x39) {
    s.f32(); // rootRotationY
    s.bool(); // usesRootRotation
  }
  if (subVersion > 0x42) {
    s.i32(); // type
    s.i32(); // animToOverride
  }
  if (subVersion >= 0x5c && subVersion < 0x152) s.u8();
  if (subVersion > 0x66) s.guid(); // tweakMeshFile
  if (subVersion > 0x69) {
    s.i32(); // containerType
    s.i32(); // subContainerIndex
  }
  if (subVersion > 0x6a) s.wstr(); // actorName
  if (subVersion > 0x151) {
    s.f32(); // yawRate
    s.f32(); // pitchRate
    s.f32(); // rollRate
    s.f32(); // yawPosition
    s.f32(); // pitchPosition
    s.f32(); // rollPosition
    s.f32(); // rootRotationZ
  }
}
