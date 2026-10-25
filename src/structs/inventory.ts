/**
 * `InventoryItemDetails`: what the popit shows of an item -- its kind, its
 * icon, its name and who made it. A plan carries one after its Things, a
 * poppet power-up and `RLevel`'s tutorial inventory one per item. cwlib's
 * `structs/inventory/InventoryItemDetails.java` (ennuo/toolkit `d6a2ef8`).
 */

import { SerializerError, type ResourceRef, type Serializer, vitaRevision } from '../io/serializer.ts';
import { readEyetoyData } from '../things/parts/stickers.ts';
import { readNetworkPlayerId } from './network.ts';
import { readSlotId, type SlotId } from './slot.ts';

export interface InventoryItemDetails {
  /** An `s64` as stored; 0 in the game's own plans. */
  readonly dateAdded: bigint;
  readonly levelUnlockSlot: SlotId;
  readonly highlightSound: number;
  readonly colour: number;
  /** cwlib's `InventoryObjectType` flags as stored: `USER_OBJECT` is `1 << 7`. */
  readonly type: number;
  readonly subType: number;
  /** LAMS keys for the game's own items; 0 on a creator's, which names it in `name`. */
  readonly titleKey: number;
  readonly descriptionKey: number;
  readonly icon?: ResourceRef;
  /** `userCreatedDetails`: a creator's own title and description. */
  readonly name?: string;
  readonly description?: string;
  readonly locationIndex: number;
  readonly categoryIndex: number;
  readonly primaryIndex: number;
  /** The PSN id of whose item it is. */
  readonly creator?: string;
  /** cwlib's `ToolType`. */
  readonly toolType: number;
  readonly flags: number;
}

/**
 * `InventoryItemDetails` above version 0x37c, the layout `writeInventoryDetails`
 * in `sequencer/write-plan.ts` writes. The two older layouts are not ported,
 * and refuse.
 */
export function readInventoryItemDetails(s: Serializer): InventoryItemDetails {
  const { version } = s.revision;
  if (version <= 0x37c) {
    throw new SerializerError(`InventoryItemDetails at version 0x${version.toString(16)} is not ported`);
  }
  const dateAdded = s.u64Big();
  const levelUnlockSlot = readSlotId(s);
  const highlightSound = s.guid();
  const colour = s.i32();
  const type = s.i32();
  const subType = s.i32();
  const titleKey = s.u32();
  const descriptionKey = s.u32();
  s.reference((self) => {
    // creationHistory: fixed 20-byte names above 0x37c
    const count = self.count();
    for (let i = 0; i < count; i += 1) self.skip(0x14);
  });
  const icon = s.resource(true);
  const created = s.reference((self) => ({ name: self.wstr(), description: self.wstr() }));
  s.reference(readInventoryItemPhotoData); // photoData
  s.reference(readEyetoyData); // eyetoyData
  const locationIndex = s.i16();
  const categoryIndex = s.i16();
  const primaryIndex = s.i16();
  const creator = s.reference(readNetworkPlayerId);
  const toolType = s.i8();
  const flags = s.i8();
  if (vitaRevision(s.revision) >= 0x7d) s.bool(); // makeSizeProportional, the Vita's D1_DETAILS_PROPORTIONAL
  return {
    dateAdded, levelUnlockSlot, highlightSound, colour, type, subType, titleKey, descriptionKey, icon,
    name: created?.name, description: created?.description, locationIndex, categoryIndex, primaryIndex,
    creator, toolType, flags,
  };
}

/** `InventoryItemPhotoData` and its `PhotoMetadata`: cwlib's `structs/inventory/`. */
function readInventoryItemPhotoData(s: Serializer): void {
  s.resource(true); // icon
  s.resource(true); // sticker
  s.resource(true); // photoMetadata.photo
  s.i32(); // photoMetadata.level.slotType
  s.u32(); // photoMetadata.level.slotNumber
  s.wstr(); // photoMetadata.levelName
  s.sha1(); // photoMetadata.levelHash
  s.u64(); // photoMetadata.timestamp, an s64
  s.array((self) => {
    self.skip(0x14); // PSID
    self.wstr(); // user
    self.skipVector4(); // bounds
  });
  if (s.revision.version > 0x3c7) s.resource(true); // painting
}
