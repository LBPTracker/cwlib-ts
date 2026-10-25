/** `POWER_UP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

/** `PPowerUp`: a power-up a player is holding, at subVersion >= 0x18d. */
/** `PPowerUp`, kept: the power-up a Thing gives, and the Things it spawned. */
export interface PowerUpPart {
  readonly plan?: ResourceRef;
  readonly powerUpThing?: Thing;
  readonly powerUpHandle?: Thing;
  readonly flipped: boolean;
}

export function readPowerUp(s: Serializer, readers: ReadonlyMap<string, PartReader>): PowerUpPart {
  s.skipMatrix(); // spawnedRootMatrix
  s.skipMatrix(); // spawnedChipMatrix
  s.skipVector4(); // rootHandle
  const plan = s.resource(true);
  const powerUpThing = readThingRef(s, readers);
  const powerUpHandle = readThingRef(s, readers);
  const flipped = s.bool();
  s.bool(); // justFlipped
  s.i32(); // fireStartTime
  s.f32(); // initialRotation
  s.skipVector3(); // deterministicPosition
  s.f32(); // deterministicRotation
  s.f32(); // offsetForEmitters
  s.f32(); // prevAngle
  s.f32(); // currAngle
  return { plan, powerUpThing, powerUpHandle, flipped };
}
