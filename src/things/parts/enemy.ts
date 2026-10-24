/** `ENEMY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `PEnemy`: one part of a creature. */
export function readEnemy(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version } = s.revision;
  const thing = () => readThingRef(s, readers);
  if (version >= 0x15d) s.i32(); // partType
  if (version >= 0x16d) s.f32(); // radius
  if (version >= 0x19f) s.i32(); // snapVertex
  if (version >= 0x1a9) {
    s.skipVector3(); // centerOffset
    thing(); // animThing
    s.f32(); // animSpeed
  }
  if (version >= 0x246) s.i32(); // sourcePlayerNumber
  if (version >= 0x265) s.bool(); // newWalkConstraintMass
  if (version >= 0x31e) s.i32(); // smokeColor
  if (version >= 0x39a) s.f32(); // smokeBrightness
}
