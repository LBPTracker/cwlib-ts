/** `GROUP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';
import { readNetworkPlayerId } from '../../structs/network.ts';

/**
 * `PGroup`: the sticker-panel grouping, its creator and the plan it came from.
 *
 * ⚠️ `planDescriptor` is a **descriptor** resource, not a live one: it omits the
 * leading flags word that `resource()` reads by default. Getting that wrong
 * costs four bytes and desynchronises at the next Thing.
 */
export interface GroupPart {
  /** `PGroup.creator`'s PSN handle, or '' when the group names nobody. */
  readonly creator: string;
  /** The plan the group was placed from, or 0. */
  readonly planGuid: number;
}

export function readGroup(s: Serializer, readers: ReadonlyMap<string, PartReader>): GroupPart {
  const { version } = s.revision;
  // ❗ Below 0x341 the flags byte does not exist; three separate bools carry
  // COPYRIGHT, EDITABLE and PICKUP_ALL_MEMBERS instead, each at its own gate.
  if (version >= 0x18e && version < 0x341) s.bool(); // COPYRIGHT
  const creator = readNetworkPlayerId(s);
  const plan = s.resource(true); // planDescriptor, a descriptor
  if (version >= 0x25e && version < 0x341) s.bool(); // EDITABLE
  if (version >= 0x267) {
    readThingRef(s, readers); // emitter
    s.i32(); // lifetime
    s.i32(); // aliveFrames
  }
  if (version >= 0x26e && version < 0x341) s.bool(); // PICKUP_ALL_MEMBERS
  if (version >= 0x30f && version < 0x341) s.bool(); // mainSelectableObject
  if (version >= 0x341) s.u8(); // flags
  return { creator, planGuid: plan?.guid ?? 0 };
}
