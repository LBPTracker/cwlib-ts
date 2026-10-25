/** `WIND_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  readonly currentInput: number;
  readonly occluders?: boolean;
  readonly effectType?: number;
  readonly horizontalSpeed?: number;
  readonly verticalSpeed?: number;
  readonly behavior?: number;
  readonly blowAtTag?: boolean;
  readonly blasterEffect?: boolean;
}

export function readWindTweak(s: Serializer): WindTweakPart {
  const { subVersion } = s.revision;
  let behavior: number | undefined;
  let blowAtTag: boolean | undefined;
  let blasterEffect: boolean | undefined;
  let occluders: boolean | undefined;
  let effectType: number | undefined;
  let horizontalSpeed: number | undefined;
  let verticalSpeed: number | undefined;
  const windStrength = s.f32();
  const direction = s.vector3();
  const angle = s.f32();
  const decay = s.f32();
  if (subVersion <= 0x2a) s.u8();
  const currentInput = s.f32();
  if (subVersion < 0xab) s.i32();
  if (subVersion <= 0x26) {
    s.i32();
    s.wstr();
  }
  const minRadius = s.f32();
  const maxRadius = s.f32();
  const angleRange = s.f32();
  if (subVersion > 0x2b) behavior = s.i32();
  const maxSpeed = subVersion > 0x84 ? s.f32() : 0;
  const affectsCharacters = subVersion > 0x86 ? s.bool() : false;
  if (subVersion > 0xaa) blowAtTag = s.bool();
  if (subVersion > 0xb3) blasterEffect = s.bool();
  // ⚠️ The gates are cwlib's, every one. This reader once took subVersion 0x172 for granted,
  // and the two game plans below it -- `sack_town_obj_pumpinator_2a_6.plan` (0xc8) and
  // `mat_base_wind.plan` (0x16b) -- read two bytes that are not theirs.
  if (subVersion > 0x171) {
    occluders = s.bool();
    effectType = s.i8();
  }
  if (subVersion > 0x211) {
    horizontalSpeed = s.i8();
    verticalSpeed = s.i8();
  }
  return {
    windStrength, direction, angle, decay, minRadius, maxRadius, angleRange, maxSpeed,
    affectsCharacters, currentInput, occluders, effectType, horizontalSpeed, verticalSpeed,
    behavior, blowAtTag, blasterEffect,
  };
}

/** `readWindTweak`'s mirror; the discarded values of old subVersions are written as 0. */
export function writeWindTweak(w: Writer, v: WindTweakPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.f32(v.windStrength);
  w.vector3(v.direction);
  w.f32(v.angle);
  w.f32(v.decay);
  if (subVersion <= 0x2a) w.u8(0);
  w.f32(v.currentInput);
  if (subVersion < 0xab) w.i32(0);
  if (subVersion <= 0x26) {
    w.i32(0);
    w.wstr('');
  }
  w.f32(v.minRadius);
  w.f32(v.maxRadius);
  w.f32(v.angleRange);
  if (subVersion > 0x2b) w.i32(v.behavior ?? 0);
  if (subVersion > 0x84) w.f32(v.maxSpeed);
  if (subVersion > 0x86) w.bool(v.affectsCharacters);
  if (subVersion > 0xaa) w.bool(v.blowAtTag ?? false);
  if (subVersion > 0xb3) w.bool(v.blasterEffect ?? false);
  if (subVersion > 0x171) {
    w.bool(v.occluders ?? false);
    w.i8(v.effectType ?? 0);
  }
  if (subVersion > 0x211) {
    w.i8(v.horizontalSpeed ?? 0);
    w.i8(v.verticalSpeed ?? 0);
  }
}
