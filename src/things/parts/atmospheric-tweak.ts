/** `ATMOSPHERIC_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  readonly disableAudio?: boolean;
  readonly currentInput?: number;
  /**
   * subVersions 0xb9..0xd3: a u8 and an f32 cwlib writes as 0 and does not name.
   * Kept because the game's files hold other values there: `sack_town.bin` 0.5.
   */
  readonly legacyByte?: number;
  readonly legacyFloat?: number;
}

export function readAtmosphericTweak(s: Serializer): AtmosphericTweakPart {
  const { subVersion } = s.revision;
  let disableAudio: boolean | undefined;
  let currentInput: number | undefined;
  const atmosType = s.s32();
  const intensity = s.f32();
  const directionStrength = s.f32();
  const inputAction = s.s32();
  if (subVersion < 0x1a8) disableAudio = s.bool();
  // ❗ cwlib's gates (`PAtmosphericTweak.java`), measured 2026-10-22 on
  // `sack_town.bin` (subVersion 0xc8): no maxParticles, and the u8 and f32 pair
  // instead, the part's 22 bytes ending on that f32's 0.5.
  const maxParticles = subVersion > 0x135 ? s.f32() : 0;
  if (subVersion > 0xb3) currentInput = s.f32();
  let legacyByte: number | undefined;
  let legacyFloat: number | undefined;
  if (subVersion >= 0xb9 && subVersion < 0xd4) {
    legacyByte = s.u8();
    legacyFloat = s.f32();
  }
  let intensityOff = intensity;
  let directionStrengthOff = directionStrength;
  if (subVersion > 0x19b) {
    intensityOff = s.f32();
    directionStrengthOff = s.f32();
  }
  return {
    atmosType, intensity, directionStrength, inputAction, maxParticles, intensityOff,
    directionStrengthOff, disableAudio, currentInput, legacyByte, legacyFloat,
  };
}

/** `readAtmosphericTweak`'s mirror. */
export function writeAtmosphericTweak(w: Writer, v: AtmosphericTweakPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.s32(v.atmosType);
  w.f32(v.intensity);
  w.f32(v.directionStrength);
  w.s32(v.inputAction);
  if (subVersion < 0x1a8) w.bool(v.disableAudio ?? false);
  if (subVersion > 0x135) w.f32(v.maxParticles);
  if (subVersion > 0xb3) w.f32(v.currentInput ?? 0);
  if (subVersion >= 0xb9 && subVersion < 0xd4) {
    w.u8(v.legacyByte ?? 0);
    w.f32(v.legacyFloat ?? 0);
  }
  if (subVersion > 0x19b) {
    w.f32(v.intensityOff);
    w.f32(v.directionStrengthOff);
  }
}
