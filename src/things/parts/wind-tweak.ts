/** `WIND_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PWindTweak`: a wind volume's strength, shape and behaviour. */
export function readWindTweak(s: Serializer): void {
  const { subVersion } = s.revision;
  s.f32(); // windStrength
  s.skipVector3(); // direction
  s.f32(); // angle
  s.f32(); // decay
  s.f32(); // currentInput
  s.f32(); // minRadius
  s.f32(); // maxRadius
  s.f32(); // angleRange
  s.i32(); // behavior
  s.f32(); // maxSpeed
  s.bool(); // affectsCharacters
  s.bool(); // blowAtTag
  s.bool(); // blasterEffect
  s.bool(); // occluders, subVersion > 0x171
  s.i8(); // effectType
  if (subVersion > 0x211) {
    s.i8(); // horizontalSpeed
    s.i8(); // verticalSpeed
  }
}
