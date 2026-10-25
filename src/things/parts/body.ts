/** `BODY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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

/** `readBody`'s mirror; below 0x13c the reads it discards are written as cwlib writes them, 0 or null. */
export function writeBody(w: Writer, v: BodyPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const old = version < 0x13c;
  if (old) w.vector3([0, 0, 0]);
  w.vector3(v.posVel);
  if (old) {
    w.f32(0);
    w.f32(0);
  }
  w.f32(v.angVel);
  if (old) {
    w.f32(0);
    w.vector3([0, 0, 0]);
    w.i32(0);
    w.ref(undefined);
    w.u8(0);
    w.f32(0);
    w.vector4([0, 0, 0, 0]);
    w.ref(undefined);
    w.f32(0);
    w.i32(0);
    w.i32(0);
    w.matrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    w.i32(0);
    w.f32(0);
  }
  if (version >= 0x147) w.i32(v.frozen);
  else w.bool(v.frozen !== 0);
  if ((version >= 0x22c && subVersion < 0x84) || subVersion >= 0x8b) ctx.thing(w, v.editingPlayer);
}
