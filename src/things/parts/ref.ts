/** `REF`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readNetworkPlayerId, writeNetworkPlayerId } from '../../structs/network.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';
import { writeThingArray } from './common.ts';

/** `PRef`: a Thing standing in for a plan that has not been instanced. */
/** `PRef`, kept: the plan this Thing is a placed copy of. */
export interface RefPart {
  readonly plan?: ResourceRef;
  readonly oldLifetime: number;
  readonly oldAliveFrames: number;
  readonly childrenSelectable?: boolean;
  readonly stripChildren?: boolean;
  /** Below version 0x160, the Thing's UID in the level (cwlib's `GlobalThingDescriptor`). */
  readonly uid?: number;
  /** Below version 0x19e, a Thing list cwlib reads and writes empty. */
  readonly things?: readonly (Thing | undefined)[];
}

export function readRef(s: Serializer, readers: ReadonlyMap<string, PartReader>): RefPart {
  const { version } = s.revision;
  let childrenSelectable: boolean | undefined;
  let stripChildren: boolean | undefined;
  // Below 0x160 a `GlobalThingDescriptor`: the level, and a Thing's UID in it.
  const plan = s.resource(true, false, false);
  const uid = version < 0x160 ? s.i32() : undefined; // the UID
  const oldLifetime = s.i32();
  const oldAliveFrames = version >= 0x1c9 ? s.i32() : 0;
  // Both of these went away at 0x321, which is why LBP3 never sees them.
  if (version < 0x321) childrenSelectable = s.bool();
  const things = version < 0x19e ? s.array((self) => readThingRef(self, readers)) : undefined;
  if (version >= 0x13d && version < 0x321) stripChildren = s.bool();
  if (version > 0x171 && version < 0x180) s.u8();
  if (version > 0x17f && version < 0x19e) {
    s.u8();
    readNetworkPlayerId(s);
  }
  return { plan, oldLifetime, oldAliveFrames, childrenSelectable, stripChildren, uid, things };
}

/** `readRef`'s mirror; the bytes cwlib writes 0 and the player id it leaves null are written so. */
export function writeRef(w: Writer, ref: RefPart, ctx: PartWriteContext): void {
  const { version } = w.revision;
  w.ref(ref.plan, { descriptor: true, classPointer: false });
  if (version < 0x160) w.i32(ref.uid ?? 0);
  w.i32(ref.oldLifetime);
  if (version >= 0x1c9) w.i32(ref.oldAliveFrames);
  if (version < 0x321) w.bool(ref.childrenSelectable ?? false);
  if (version < 0x19e) writeThingArray(w, ctx, ref.things);
  if (version >= 0x13d && version < 0x321) w.bool(ref.stripChildren ?? false);
  if (version > 0x171 && version < 0x180) w.u8(0);
  if (version > 0x17f && version < 0x19e) {
    w.u8(0);
    writeNetworkPlayerId(w, '');
  }
}
