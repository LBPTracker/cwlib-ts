/** `BODY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `PBody`: velocities, a frozen flag and whoever is dragging it about. */
export function readBody(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  s.skipVector3(); // posVel
  s.f32(); // angVel
  s.i32(); // frozen
  // `(version >= 0x22c && subVersion < 0x84) || subVersion >= 0x8b` — true either
  // way for everything this reader accepts.
  readThingRef(s, readers); // editingPlayer
}
