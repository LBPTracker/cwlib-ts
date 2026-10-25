/** `ATMOSPHERIC_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PAtmosphericTweak`: an island's weather -- rain, snow and the like -- and how strong. */
export interface AtmosphericTweakPart {
  /** cwlib's `atmosType`; which number is which weather is not measured. */
  readonly atmosType: number;
  readonly intensity: number;
  readonly directionStrength: number;
  readonly inputAction: number;
  /** subVersion > 0x135; 0 before. */
  readonly maxParticles: number;
  /** subVersion > 0x19b, the values when the input is off; equal to the on ones before. */
  readonly intensityOff: number;
  readonly directionStrengthOff: number;
}

export function readAtmosphericTweak(s: Serializer): AtmosphericTweakPart {
  const { subVersion } = s.revision;
  const atmosType = s.s32();
  const intensity = s.f32();
  const directionStrength = s.f32();
  const inputAction = s.s32();
  if (subVersion < 0x1a8) s.bool(); // disableAudio
  // ❗ cwlib's gates (`PAtmosphericTweak.java`), measured 2026-10-22 on
  // `sack_town.bin` (subVersion 0xc8): no maxParticles, and the u8 and f32 pair
  // instead, the part's 22 bytes ending on that f32's 0.5.
  const maxParticles = subVersion > 0x135 ? s.f32() : 0;
  if (subVersion > 0xb3) s.f32(); // currentInput
  if (subVersion >= 0xb9 && subVersion < 0xd4) {
    s.u8();
    s.f32();
  }
  let intensityOff = intensity;
  let directionStrengthOff = directionStrength;
  if (subVersion > 0x19b) {
    intensityOff = s.f32();
    directionStrengthOff = s.f32();
  }
  return { atmosType, intensity, directionStrength, inputAction, maxParticles, intensityOff, directionStrengthOff };
}
