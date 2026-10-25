/** `WIND_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PWindTweak`: a wind volume's strength, shape and behaviour. */
export function readWindTweak(s: Serializer): void {
  const { subVersion } = s.revision;
  s.f32(); // windStrength
  s.skipVector3(); // direction
  s.f32(); // angle
  s.f32(); // decay
  if (subVersion <= 0x2a) s.u8();
  s.f32(); // currentInput
  if (subVersion < 0xab) s.i32();
  if (subVersion <= 0x26) {
    s.i32();
    s.wstr();
  }
  s.f32(); // minRadius
  s.f32(); // maxRadius
  s.f32(); // angleRange
  if (subVersion > 0x2b) s.i32(); // behavior
  if (subVersion > 0x84) s.f32(); // maxSpeed
  if (subVersion > 0x86) s.bool(); // affectsCharacters
  if (subVersion > 0xaa) s.bool(); // blowAtTag
  if (subVersion > 0xb3) s.bool(); // blasterEffect
  // ⚠️ The gates are cwlib's, every one. This reader once took subVersion 0x172 for granted,
  // and the two game plans below it -- `sack_town_obj_pumpinator_2a_6.plan` (0xc8) and
  // `mat_base_wind.plan` (0x16b) -- read two bytes that are not theirs.
  if (subVersion > 0x171) {
    s.bool(); // occluders
    s.i8(); // effectType
  }
  if (subVersion > 0x211) {
    s.i8(); // horizontalSpeed
    s.i8(); // verticalSpeed
  }
}
