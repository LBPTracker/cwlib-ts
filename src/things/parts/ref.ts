/** `REF`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readNetworkPlayerId } from '../../structs/network.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `PRef`: a Thing standing in for a plan that has not been instanced. */
/** `PRef`, kept: the plan this Thing is a placed copy of. */
export interface RefPart {
  readonly plan?: ResourceRef;
  readonly oldLifetime: number;
  readonly oldAliveFrames: number;
  readonly childrenSelectable?: boolean;
  readonly stripChildren?: boolean;
}

export function readRef(s: Serializer, readers: ReadonlyMap<string, PartReader>): RefPart {
  const { version } = s.revision;
  let childrenSelectable: boolean | undefined;
  let stripChildren: boolean | undefined;
  // Below 0x160 a `GlobalThingDescriptor`: the level, and a Thing's UID in it.
  const plan = s.resource(true, false, false);
  if (version < 0x160) s.i32(); // the UID
  const oldLifetime = s.i32();
  const oldAliveFrames = version >= 0x1c9 ? s.i32() : 0;
  // Both of these went away at 0x321, which is why LBP3 never sees them.
  if (version < 0x321) childrenSelectable = s.bool();
  if (version < 0x19e) s.array((self) => readThingRef(self, readers));
  if (version >= 0x13d && version < 0x321) stripChildren = s.bool();
  if (version > 0x171 && version < 0x180) s.u8();
  if (version > 0x17f && version < 0x19e) {
    s.u8();
    readNetworkPlayerId(s);
  }
  return { plan, oldLifetime, oldAliveFrames, childrenSelectable, stripChildren };
}
