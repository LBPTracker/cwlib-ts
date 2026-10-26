/** `GROUP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { readNetworkPlayerIdKept, writeNetworkPlayerId } from '../../structs/network.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';
import { writeThingArray } from './common.ts';

/**
 * `PGroup`: the sticker-panel grouping, its creator and the plan it came from.
 *
 * ⚠️ `planDescriptor` is a **descriptor** resource, not a live one: it omits the
 * leading flags word that `resource()` reads by default. Getting that wrong
 * costs four bytes and desynchronises at the next Thing.
 */
export interface GroupPart {
  /** `PGroup.creator`'s PSN handle, or '' when the group names nobody. */
  /** The PSN id of the group's maker; empty below version 0x18e, which has none. */
  readonly creator: string;
  /** `creator`'s `NetworkPlayerID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly creatorBytes?: Uint8Array;
  /** Between versions 0x18e and 0x1b0, the Things in the group (cwlib `PGroup.things`). */
  readonly things?: readonly (Thing | undefined)[];
  /** The plan the group was placed from, or 0. */
  readonly planGuid: number;
  readonly lifetime?: number;
  readonly aliveFrames?: number;
  readonly COPYRIGHT?: boolean;
  readonly EDITABLE?: boolean;
  readonly PICKUP_ALL_MEMBERS?: boolean;
  readonly mainSelectableObject?: boolean;
  readonly flags?: number;
  /** From version 0x267, the emitter that made the group (cwlib `PGroup.emitter`). */
  readonly emitter?: Thing;
  /** The plan descriptor itself, of which `planGuid` is the GUID: a plan named by hash has one too. */
  readonly plan?: ResourceRef;
}


export function readGroup(s: Serializer, readers: ReadonlyMap<string, PartReader>): GroupPart {
  const { version } = s.revision;
  let COPYRIGHT: boolean | undefined;
  let EDITABLE: boolean | undefined;
  let PICKUP_ALL_MEMBERS: boolean | undefined;
  let mainSelectableObject: boolean | undefined;
  let flags: number | undefined;
  let lifetime: number | undefined;
  let aliveFrames: number | undefined;
  // ❗ Below 0x341 the flags byte does not exist; three separate bools carry
  // COPYRIGHT, EDITABLE and PICKUP_ALL_MEMBERS instead, each at its own gate.
  // ❗ Between 0x18e and 0x1b0 the group lists its Things; the creator is there from
  // 0x18e and the plan from 0x25e (and at 0x252 alone): cwlib's `PGroup`. Read
  // always, the LBP1 levels at 0x22c..0x259 ran one byte on.
  const things = version >= 0x18e && version <= 0x1b0 ? s.array((self) => readThingRef(self, readers)) : undefined;
  if (version >= 0x18e && version < 0x341) COPYRIGHT = s.bool();
  const { handle: creator, bytes: creatorBytes } = version >= 0x18e ? readNetworkPlayerIdKept(s) : { handle: '', bytes: undefined };
  const plan = version >= 0x25e || version === 0x252 ? s.resource(true) : undefined; // planDescriptor
  if (version >= 0x25e && version < 0x341) EDITABLE = s.bool();
  let emitter: Thing | undefined;
  if (version >= 0x267) {
    emitter = readThingRef(s, readers);
    lifetime = s.i32();
    aliveFrames = s.i32();
  }
  if (version >= 0x26e && version < 0x341) PICKUP_ALL_MEMBERS = s.bool();
  if (version >= 0x30f && version < 0x341) mainSelectableObject = s.bool();
  if (version >= 0x341) flags = s.u8();
  return {
    creator, ...(creatorBytes ? { creatorBytes } : {}), planGuid: plan?.guid ?? 0, lifetime, aliveFrames, COPYRIGHT, EDITABLE,
    PICKUP_ALL_MEMBERS, mainSelectableObject, flags, things, emitter, plan,
  };
}

/** `readGroup`'s mirror. */
export function writeGroup(w: Writer, group: GroupPart, ctx: PartWriteContext): void {
  const { version } = w.revision;
  if (version >= 0x18e && version <= 0x1b0) writeThingArray(w, ctx, group.things);
  if (version >= 0x18e && version < 0x341) w.bool(group.COPYRIGHT ?? false);
  if (version >= 0x18e) writeNetworkPlayerId(w, group.creator, group.creatorBytes);
  if (version >= 0x25e || version === 0x252) {
    w.ref(group.plan ?? (group.planGuid ? { guid: group.planGuid } : undefined), { descriptor: true });
  }
  if (version >= 0x25e && version < 0x341) w.bool(group.EDITABLE ?? false);
  if (version >= 0x267) {
    ctx.thing(w, group.emitter);
    w.i32(group.lifetime ?? 0);
    w.i32(group.aliveFrames ?? 0);
  }
  if (version >= 0x26e && version < 0x341) w.bool(group.PICKUP_ALL_MEMBERS ?? false);
  if (version >= 0x30f && version < 0x341) w.bool(group.mainSelectableObject ?? false);
  if (version >= 0x341) w.u8(group.flags ?? 0);
}
