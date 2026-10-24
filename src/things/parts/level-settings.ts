/** `LEVEL_SETTINGS`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef, vitaRevision } from '../../io/serializer.ts';

/**
 * One set of a level's lighting -- cwlib's `LevelSettings`, the superclass
 * `PLevelSettings` serialises first and its presets repeat. Colours are four
 * floats as stored; steering/level-files.md, *Level settings*, says what of
 * them is measured.
 */
export interface LevelLighting {
  readonly sunPosition: readonly [number, number, number];
  readonly sunPositionScale: number;
  readonly sunColor: readonly [number, number, number, number];
  readonly ambientColor: readonly [number, number, number, number];
  readonly sunMultiplier: number;
  readonly exposure: number;
  readonly fogColor: readonly [number, number, number, number];
  readonly fogNear: number;
  readonly fogFar: number;
  readonly rimColor: readonly [number, number, number, number];
  readonly rimColor2: readonly [number, number, number, number];
}

/** `PLevelSettings`: the lighting, its presets, and the backdrop. */
export interface LevelSettingsPart extends LevelLighting {
  readonly presets: LevelLighting[];
  readonly backdropAmbience: string;
  /** An `RStaticMesh`, version 0x2f3 on. */
  readonly backdropMesh?: ResourceRef;
  /** subVersion 0xaf on; 0 before. See steering/level-files.md, *Level settings*. */
  readonly backgroundRepeatFlags: number;
  readonly backgroundSkyHeight: number;
}

/**
 * `LevelSettings`: one lighting preset. `PLevelSettings` is one of these
 * inline, followed by a list of the presets a level can cross-fade between.
 */
function readLevelSettings(s: Serializer): LevelLighting {
  const { version, subVersion } = s.revision;
  const sunPosition = s.vector3();
  const sunPositionScale = s.f32();
  const sunColor = s.vector4();
  const ambientColor = s.vector4();
  const sunMultiplier = s.f32();
  const exposure = s.f32();
  const fogColor = s.vector4();
  const fogNear = s.f32();
  const fogFar = s.f32();
  const rimColor = s.vector4();
  const rimColor2 = s.vector4();
  if (version >= 0x325) {
    s.f32(); // bakedShadowAmount
    s.f32(); // bakedShadowBlur
    s.f32(); // bakedAOBias
    s.f32(); // bakedAOScale
    s.f32(); // dynamicAOAmount
    s.f32(); // dofNear
  }
  if (version >= 0x326) s.f32(); // dofFar
  if (version >= 0x331) {
    s.f32(); // zEffectAmount
    s.f32(); // zEffectBright
    s.f32(); // zEffectContrast
  }
  if (subVersion >= 0x7a) {
    s.f32(); // dofNear2
    s.f32(); // dofFar2
    if (subVersion >= 0xce) s.f32(); // dofFar3
  }
  return {
    sunPosition, sunPositionScale, sunColor, ambientColor, sunMultiplier, exposure,
    fogColor, fogNear, fogFar, rimColor, rimColor2,
  };
}

/** `PLevelSettings`: the lighting, inline, then the presets and the backdrop. */
export function readLevelSettingsPart(s: Serializer): LevelSettingsPart {
  const { version, subVersion } = s.revision;
  const lighting = readLevelSettings(s); // the superclass, serialised first
  const presets: LevelLighting[] = [];
  if (version >= 0x153) {
    const count = s.count();
    for (let i = 0; i < count; i += 1) presets.push(readLevelSettings(s));
  }
  if (vitaRevision(s.revision) >= 0x78) s.bool(); // nonLinearFog
  const backdropAmbience = s.str();
  const backdropMesh = version >= 0x2f3 ? s.resource() : undefined;
  let backgroundRepeatFlags = 0;
  let backgroundSkyHeight = 0;
  if (subVersion >= 0xaf) {
    backgroundRepeatFlags = s.i32();
    backgroundSkyHeight = s.f32();
  }
  return { ...lighting, presets, backdropAmbience, backdropMesh, backgroundRepeatFlags, backgroundSkyHeight };
}
