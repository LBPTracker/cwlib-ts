/** `WIND_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PWindTweak`: a wind volume's strength, shape and behaviour. */
/** `PWindTweak`, kept: a wind's strength, direction and reach. */
export interface WindTweakPart {
  readonly windStrength: number;
  readonly direction: readonly [number, number, number];
  readonly angle: number;
  readonly decay: number;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly angleRange: number;
  readonly maxSpeed: number;
  readonly affectsCharacters: boolean;
}

export function readWindTweak(s: Serializer): WindTweakPart {
  const { subVersion } = s.revision;
  const windStrength = s.f32();
  const direction = s.vector3();
  const angle = s.f32();
  const decay = s.f32();
  if (subVersion <= 0x2a) s.u8();
  s.f32(); // currentInput
  if (subVersion < 0xab) s.i32();
  if (subVersion <= 0x26) {
    s.i32();
    s.wstr();
  }
  const minRadius = s.f32();
  const maxRadius = s.f32();
  const angleRange = s.f32();
  if (subVersion > 0x2b) s.i32(); // behavior
  const maxSpeed = subVersion > 0x84 ? s.f32() : 0;
  const affectsCharacters = subVersion > 0x86 ? s.bool() : false;
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
  return { windStrength, direction, angle, decay, minRadius, maxRadius, angleRange, maxSpeed, affectsCharacters };
}
