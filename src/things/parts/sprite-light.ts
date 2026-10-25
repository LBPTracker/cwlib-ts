/** `SPRITE_LIGHT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PSpriteLight`: a light placed in the level. steering/level-files.md, *Lights*. */
export interface SpriteLightPart {
  /** Four floats as stored: the light's colour when on. */
  readonly color: readonly [number, number, number, number];
  readonly multiplier: number;
  readonly glowRadius: number;
  /** How far the light reaches, in world units. */
  readonly farDist: number;
  readonly sourceSize: number;
  readonly spotlight: boolean;
  readonly falloffTexture: ResourceRef | undefined;
  /** cwlib's `lookAt`: the Thing the light is aimed at, where it names one. */
  readonly lookAt?: Thing;
  readonly enableFogShadows?: boolean;
  readonly enableFog?: boolean;
  readonly onSpeed?: number;
  readonly offSpeed?: number;
  readonly flickerProb?: number;
  readonly flickerAmount?: number;
  readonly causticStrength?: number;
  readonly causticWidth?: number;
  readonly trackingLimit?: number;
  readonly trackingAccel?: number;
  readonly trackingSpeed?: number;
  readonly movementInput?: number;
  readonly lightingInput?: number;
  readonly beamDir?: readonly [number, number, number];
  readonly azimuth?: readonly [number, number, number];
  readonly colorOff?: readonly [number, number, number, number];
  readonly multiplierOff?: number;
  readonly fogAmount?: number;
  readonly onDest?: number;
  readonly behavior?: number;
  readonly highBeam?: boolean;
  readonly tracker?: boolean;
  readonly trackerType?: number;
}

export function readSpriteLight(s: Serializer, readers: ReadonlyMap<string, PartReader>): SpriteLightPart {
  const { version, subVersion } = s.revision;
  let colorOff: readonly [number, number, number, number] | undefined;
  let multiplierOff: number | undefined;
  let fogAmount: number | undefined;
  let onDest: number | undefined;
  let behavior: number | undefined;
  let highBeam: boolean | undefined;
  let tracker: boolean | undefined;
  let trackerType: number | undefined;
  let enableFogShadows: boolean | undefined;
  let enableFog: boolean | undefined;
  let onSpeed: number | undefined;
  let offSpeed: number | undefined;
  let flickerProb: number | undefined;
  let flickerAmount: number | undefined;
  let causticStrength: number | undefined;
  let causticWidth: number | undefined;
  let trackingLimit: number | undefined;
  let trackingAccel: number | undefined;
  let trackingSpeed: number | undefined;
  let movementInput: number | undefined;
  let lightingInput: number | undefined;
  let beamDir: readonly [number, number, number] | undefined;
  let azimuth: readonly [number, number, number] | undefined;
  const color = s.vector4();
  if (version >= 0x2fd) colorOff = s.vector4();
  const multiplier = s.f32();
  if (version >= 0x30a) multiplierOff = s.f32();
  const glowRadius = s.f32();
  const farDist = s.f32();
  const sourceSize = s.f32();
  const falloffTexture = s.resource();
  const lookAt = readThingRef(s, readers);
  const spotlight = s.bool();
  if (version < 0x337) {
    enableFogShadows = s.bool();
    enableFog = s.bool();
  }
  if (version >= 0x139) fogAmount = s.f32();
  if (version >= 0x13a) {
    if (version < 0x2c4) onDest = s.f32();
    onSpeed = s.f32();
    offSpeed = s.f32();
    flickerProb = s.f32();
    flickerAmount = s.f32();
  }
  if (version >= 0x2c4) behavior = s.i32();
  if (subVersion >= 0x113) highBeam = s.bool();
  if (subVersion >= 0x146) tracker = s.bool();
  if (subVersion >= 0x14a) trackerType = s.u8();
  if (subVersion >= 0x151) {
    causticStrength = s.f32();
    causticWidth = s.f32();
  }
  if (subVersion >= 0x16f) {
    trackingLimit = s.f32();
    trackingAccel = s.f32();
    trackingSpeed = s.f32();
    movementInput = s.s32();
    lightingInput = s.s32();
    beamDir = s.vector3();
    azimuth = s.vector3();
  }
  return {
    color, multiplier, glowRadius, farDist, sourceSize, spotlight, falloffTexture, lookAt, enableFogShadows,
    enableFog, onSpeed, offSpeed, flickerProb, flickerAmount, causticStrength, causticWidth,
    trackingLimit, trackingAccel, trackingSpeed, movementInput, lightingInput, beamDir, azimuth,
    colorOff, multiplierOff, fogAmount, onDest, behavior, highBeam, tracker, trackerType,
  };
}

/** `readSpriteLight`'s mirror. */
export function writeSpriteLight(w: Writer, v: SpriteLightPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  w.vector4(v.color);
  if (version >= 0x2fd) w.vector4(v.colorOff ?? [0, 0, 0, 0]);
  w.f32(v.multiplier);
  if (version >= 0x30a) w.f32(v.multiplierOff ?? 0);
  w.f32(v.glowRadius);
  w.f32(v.farDist);
  w.f32(v.sourceSize);
  w.ref(v.falloffTexture);
  ctx.thing(w, v.lookAt);
  w.bool(v.spotlight);
  if (version < 0x337) {
    w.bool(v.enableFogShadows ?? false);
    w.bool(v.enableFog ?? false);
  }
  if (version >= 0x139) w.f32(v.fogAmount ?? 0);
  if (version >= 0x13a) {
    if (version < 0x2c4) w.f32(v.onDest ?? 0);
    w.f32(v.onSpeed ?? 0);
    w.f32(v.offSpeed ?? 0);
    w.f32(v.flickerProb ?? 0);
    w.f32(v.flickerAmount ?? 0);
  }
  if (version >= 0x2c4) w.i32(v.behavior ?? 0);
  if (subVersion >= 0x113) w.bool(v.highBeam ?? false);
  if (subVersion >= 0x146) w.bool(v.tracker ?? false);
  if (subVersion >= 0x14a) w.u8(v.trackerType ?? 0);
  if (subVersion >= 0x151) {
    w.f32(v.causticStrength ?? 0);
    w.f32(v.causticWidth ?? 0);
  }
  if (subVersion >= 0x16f) {
    w.f32(v.trackingLimit ?? 0);
    w.f32(v.trackingAccel ?? 0);
    w.f32(v.trackingSpeed ?? 0);
    w.s32(v.movementInput ?? 0);
    w.s32(v.lightingInput ?? 0);
    w.vector3(v.beamDir ?? [0, 0, 0]);
    w.vector3(v.azimuth ?? [0, 0, 0]);
  }
}
