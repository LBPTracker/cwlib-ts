/** `POWER_UP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `PPowerUp`: a power-up a player is holding, at subVersion >= 0x18d. */
export function readPowerUp(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  s.skipMatrix(); // spawnedRootMatrix
  s.skipMatrix(); // spawnedChipMatrix
  s.skipVector4(); // rootHandle
  s.resource(true); // plan
  readThingRef(s, readers); // powerUpThing
  readThingRef(s, readers); // powerUpHandle
  s.bool(); // flipped
  s.bool(); // justFlipped
  s.i32(); // fireStartTime
  s.f32(); // initialRotation
  s.skipVector3(); // deterministicPosition
  s.f32(); // deterministicRotation
  s.f32(); // offsetForEmitters
  s.f32(); // prevAngle
  s.f32(); // currAngle
}
