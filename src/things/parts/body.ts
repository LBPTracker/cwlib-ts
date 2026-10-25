/** `BODY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

/** `PBody`: velocities, a frozen flag and whoever is dragging it about. */
/** `PBody`, kept: how the Thing was moving when the level was saved. */
export interface BodyPart {
  readonly posVel: readonly [number, number, number];
  readonly angVel: number;
  readonly frozen: number;
  /** The player editing it, when one was. */
  readonly editingPlayer?: Thing;
}

export function readBody(s: Serializer, readers: ReadonlyMap<string, PartReader>): BodyPart {
  const posVel = s.vector3();
  const angVel = s.f32();
  const frozen = s.i32();
  // `(version >= 0x22c && subVersion < 0x84) || subVersion >= 0x8b` — true either
  // way for everything this reader accepts.
  const editingPlayer = readThingRef(s, readers);
  return { posVel, angVel, frozen, editingPlayer };
}
