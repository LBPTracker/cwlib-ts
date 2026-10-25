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
  const { version, subVersion } = s.revision;
  // Below version 0x13c, fields cwlib's `PBody` reads and cannot name either.
  const old = version < 0x13c;
  if (old) s.skipVector3();
  const posVel = s.vector3();
  if (old) {
    s.f32();
    s.f32();
  }
  const angVel = s.f32();
  if (old) {
    s.f32();
    s.skipVector3();
    s.array((self) => self.skipVector3());
    s.resource(); // a material
    s.u8();
    s.f32();
    s.skipVector4();
    s.resource(); // a texture
    s.f32();
    s.i32();
    s.i32();
    s.skipMatrix();
    s.i32();
    s.f32();
  }
  // Below 0x147 a bool stands where the frozen state is.
  const frozen = version >= 0x147 ? s.i32() : Number(s.bool());
  // ❗ The editing player is only there from 0x22c below subVersion 0x84, and from
  // subVersion 0x8b: read always, the LBP1 levels at 0x207..0x22a ran 4 bytes on.
  const editingPlayer = (version >= 0x22c && subVersion < 0x84) || subVersion >= 0x8b ? readThingRef(s, readers) : undefined;
  return { posVel, angVel, frozen, editingPlayer };
}
