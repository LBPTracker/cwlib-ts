/**
 * `RSlotList` -- a list of slots: magic `SLTb`, FileDB paths `….slt`
 * (`lbp2psndemo_move_slots.slt`), and from version `0x3b6` whether it came
 * from a production build.
 *
 * The walk is cwlib's `resources/RSlotList.java` (ennuo/toolkit `d6a2ef8`) over
 * `structs/slot.ts`; steering/level-files.md, *Slots*, has what the game's own
 * files prove of it (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo } from '../io/serializer.ts';
import { readSlot, type Slot } from '../structs/slot.ts';

export interface SlotList {
  readonly revision: RevisionInfo;
  readonly slots: readonly Slot[];
  /** Version `0x3b6` on (cwlib's `PRODUCTION_BUILD`). */
  readonly fromProductionBuild: boolean;
}

/** Read an `SLTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readSlotList(bytes: Uint8Array, inflate: Inflate): Promise<SlotList> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'SLTb') throw new SerializerError(`not a slot list: "${resource.magic}"`);
  const slots = s.array(readSlot);
  const fromProductionBuild = revision.version >= 0x3b6 ? s.bool() : false;
  if (s.remaining !== 0) {
    throw new SerializerError(`SLTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, slots, fromProductionBuild };
}
