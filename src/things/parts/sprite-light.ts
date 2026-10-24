/** `SPRITE_LIGHT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

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
}

export function readSpriteLight(s: Serializer, readers: ReadonlyMap<string, PartReader>): SpriteLightPart {
  const { version, subVersion } = s.revision;
  const color = s.vector4();
  if (version >= 0x2fd) s.skipVector4(); // colorOff
  const multiplier = s.f32();
  if (version >= 0x30a) s.f32(); // multiplierOff
  const glowRadius = s.f32();
  const farDist = s.f32();
  const sourceSize = s.f32();
  s.resource(); // falloffTexture
  readThingRef(s, readers); // lookAt
  const spotlight = s.bool();
  if (version < 0x337) {
    s.bool(); // enableFogShadows
    s.bool(); // enableFog
  }
  if (version >= 0x139) s.f32(); // fogAmount
  if (version >= 0x13a) {
    if (version < 0x2c4) s.f32(); // onDest
    s.f32(); // onSpeed
    s.f32(); // offSpeed
    s.f32(); // flickerProb
    s.f32(); // flickerAmount
  }
  if (version >= 0x2c4) s.i32(); // behavior
  if (subVersion >= 0x113) s.bool(); // highBeam
  if (subVersion >= 0x146) s.bool(); // tracker
  if (subVersion >= 0x14a) s.u8(); // trackerType
  if (subVersion >= 0x151) {
    s.f32(); // causticStrength
    s.f32(); // causticWidth
  }
  if (subVersion >= 0x16f) {
    s.f32(); // trackingLimit
    s.f32(); // trackingAccel
    s.f32(); // trackingSpeed
    s.s32(); // movementInput
    s.s32(); // lightingInput
    s.skipVector3(); // beamDir
    s.skipVector3(); // azimuth
  }
  return { color, multiplier, glowRadius, farDist, sourceSize, spotlight };
}
