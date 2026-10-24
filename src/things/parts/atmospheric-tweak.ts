/** `ATMOSPHERIC_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PAtmosphericTweak`: an island's weather. */
export function readAtmosphericTweak(s: Serializer): void {
  const { subVersion } = s.revision;
  s.s32(); // atmosType
  s.f32(); // intensity
  s.f32(); // directionStrength
  s.s32(); // inputAction
  if (subVersion < 0x1a8) s.bool(); // disableAudio
  // ❗ cwlib's gates (`PAtmosphericTweak.java`), measured 2026-10-22 on
  // `sack_town.bin` (subVersion 0xc8): no maxParticles, and the u8 and f32 pair
  // instead, the part's 22 bytes ending on that f32's 0.5.
  if (subVersion > 0x135) s.f32(); // maxParticles
  if (subVersion > 0xb3) s.f32(); // currentInput
  if (subVersion >= 0xb9 && subVersion < 0xd4) {
    s.u8();
    s.f32();
  }
  if (subVersion > 0x19b) {
    s.f32(); // intensityOff
    s.f32(); // directionStrengthOff
  }
}
