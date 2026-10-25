/**
 * `InventoryItemDetails`: what the popit shows of an item -- its kind, its
 * icon, its name and who made it. A plan carries one after its Things, a
 * poppet power-up and `RLevel`'s tutorial inventory one per item. cwlib's
 * `structs/inventory/InventoryItemDetails.java` (ennuo/toolkit `d6a2ef8`).
 */

import { latin1, type ResourceRef, type Serializer, vitaRevision } from '../io/serializer.ts';
import { onLeerdammer } from '../things/thing.ts';
import { readEyetoyData } from '../things/parts/stickers.ts';
import { readNetworkPlayerId } from './network.ts';
import { readSlotId, type SlotId } from './slot.ts';

export interface InventoryItemDetails {
  /** An `s64`; 0 in the game's own plans. */
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
  /** `CreationHistory`: who edited the item, oldest first. */
  readonly creationHistory?: readonly string[];
  /** Below version 0x2bb (LEERDAMMER's `LD_LAMS_KEYS` aside), a translation tag where the keys came later. */
  readonly translationTag?: string;
  /** The older layouts' own: at and below version 0x37c. */
  readonly numUses?: number;
  readonly lastUsed?: number;
  readonly fluffCost?: number;
  readonly allowEmit?: boolean;
  readonly shareable?: boolean;
  readonly copyright?: boolean;
}

/** `CreationHistory`: a count, then 20-byte names above version 0x37c and `wstr`s at and below. */
function readCreationHistory(s: Serializer): string[] {
  const fixed = s.revision.version > 0x37c;
  const count = s.count();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(fixed ? latin1(s.bytes(0x14), true) : s.wstr());
  return out;
}

/** `UserCreatedDetails`, which the older layouts hold inline and drop when both are empty, as cwlib does. */
function readUserCreatedDetails(s: Serializer): { name: string; description: string } | undefined {
  const name = s.wstr();
  const description = s.wstr();
  return name === '' && description === '' ? undefined : { name, description };
}

/** A forced 64-bit `s64`: the older layouts' 32- and 64-bit fields ignore compression. */
const forcedS64 = (s: Serializer): bigint => BigInt.asIntN(64, s.u64Big(true));

/** Below version 0x233: cwlib's oldest layout, its integers forced to 32 bits. */
function readBefore233(s: Serializer): InventoryItemDetails {
  const head = s.revision.version;
  let translationTag: string | undefined;
  if (head < 0x174) {
    s.wstr(); // nameTranslationTag
    s.wstr(); // descTranslationTag
  } else translationTag = s.str();
  const locationIndex = (s.i32(true) << 16) >> 16;
  const categoryIndex = (s.i32(true) << 16) >> 16;
  const primaryIndex = head > 0x194 ? (s.i32(true) << 16) >> 16 : 0;
  s.i32(true); // pad
  const type = s.i32(true);
  const subType = s.i32(true);
  const toolType = head > 0x196 ? (s.i32(true) << 24) >> 24 : 0;
  const icon = s.resource(true);
  let numUses: number | undefined;
  let lastUsed: number | undefined;
  if (head > 0x1c0) {
    numUses = s.i32(true);
    lastUsed = s.i32(true);
  }
  let highlightSound = 0;
  if (head > 0x14e) highlightSound = s.u32(true);
  else s.str(); // a path to the highlight sound, cwlib thinks
  const colour = head > 0x156 ? s.i32(true) : 0;
  if (head > 0x161) s.reference(readEyetoyData); // eyetoyData
  if (head > 0x17a) s.reference(readInventoryItemPhotoData); // photoData
  let levelUnlockSlot = { type: 0, number: 0 };
  if (head > 0x176) levelUnlockSlot = { type: s.i32(), number: s.u32(true) };
  let copyright: boolean | undefined;
  let creator: string | undefined;
  if (head > 0x181) {
    copyright = s.bool();
    creator = readNetworkPlayerId(s);
  }
  const created = head > 0x1aa ? readUserCreatedDetails(s) : undefined;
  const creationHistory = head > 0x1b0 ? readCreationHistory(s) : undefined;
  const allowEmit = head > 0x204 ? s.bool() : undefined;
  const dateAdded = head > 0x221 ? forcedS64(s) : 0n;
  const shareable = head > 0x222 ? s.bool() : undefined;
  return {
    dateAdded, levelUnlockSlot, highlightSound, colour, type, subType, titleKey: 0, descriptionKey: 0, icon,
    name: created?.name, description: created?.description, locationIndex, categoryIndex, primaryIndex, creator,
    toolType, flags: 0, creationHistory, translationTag, numUses, lastUsed, allowEmit, shareable, copyright,
  };
}

/** Versions 0x233 to 0x37c: cwlib's middle layout, its integers forced to 32 bits but for the slot's type. */
function readBefore37d(s: Serializer): InventoryItemDetails {
  const head = s.revision.version;
  const highlightSound = s.u32(true);
  const levelUnlockSlot = { type: s.i32(true), number: s.u32(true) };
  const locationIndex = (s.i32(true) << 16) >> 16;
  const categoryIndex = (s.i32(true) << 16) >> 16;
  const primaryIndex = (s.i32(true) << 16) >> 16;
  const lastUsed = s.i32(true);
  const numUses = s.i32(true);
  if (head > 0x234) s.i32(true); // pad
  const dateAdded = forcedS64(s);
  const fluffCost = s.i32(true);
  const colour = s.i32(true);
  const type = s.i32(true);
  const subType = s.i32(true);
  const toolType = (s.i32(true) << 24) >> 24;
  const creator = readNetworkPlayerId(s);
  const allowEmit = s.bool();
  const shareable = s.bool();
  const copyright = s.bool();
  const flags = head > 0x334 ? s.i8() : 0;
  let titleKey = 0;
  let descriptionKey = 0;
  let translationTag: string | undefined;
  if (onLeerdammer(s.revision, LD_LAMS_KEYS) || head > 0x2ba) {
    titleKey = s.u32();
    descriptionKey = s.u32();
  } else translationTag = s.str();
  const created = readUserCreatedDetails(s);
  const creationHistory = readCreationHistory(s);
  const icon = s.resource(true);
  s.reference(readInventoryItemPhotoData); // photoData
  s.reference(readEyetoyData); // eyetoyData
  if (head > 0x358) s.u8(); // cwlib writes 0
  return {
    dateAdded, levelUnlockSlot, highlightSound, colour, type, subType, titleKey, descriptionKey, icon,
    name: created?.name, description: created?.description, locationIndex, categoryIndex, primaryIndex, creator,
    toolType, flags, creationHistory, translationTag, numUses, lastUsed, fluffCost, allowEmit, shareable, copyright,
  };
}

/** cwlib's `Revisions.LD_LAMS_KEYS`: LEERDAMMER had LAMS keys before 0x2bb. */
const LD_LAMS_KEYS = 0x8;

/**
 * `InventoryItemDetails`: above version 0x37c the layout `writeInventoryDetails`
 * in `sequencer/write-plan.ts` writes; at and below it cwlib's two older ones,
 * split at 0x233, whose integers are forced to 32 bits in a compressed stream.
 */
export function readInventoryItemDetails(s: Serializer): InventoryItemDetails {
  const { version } = s.revision;
  if (version < 0x233) return readBefore233(s);
  if (version <= 0x37c) return readBefore37d(s);
  const dateAdded = s.s64Big();
  const levelUnlockSlot = readSlotId(s);
  const highlightSound = s.guid();
  const colour = s.i32();
  const type = s.i32();
  const subType = s.i32();
  const titleKey = s.u32();
  const descriptionKey = s.u32();
  const creationHistory = s.reference(readCreationHistory);
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
    creator, toolType, flags, creationHistory,
  };
}

/** `PhotoMetadata`: a photo, where it was taken and of whom. cwlib's `structs/inventory/PhotoMetadata.java`. */
export interface PhotoMetadata {
  readonly photo?: ResourceRef;
  readonly level: SlotId;
  readonly levelName: string;
  readonly levelHash: Uint8Array;
  readonly timestamp: bigint;
  readonly users: readonly { readonly psid: string; readonly user: string; readonly bounds: readonly [number, number, number, number] }[];
}

export function readPhotoMetadata(s: Serializer): PhotoMetadata {
  return {
    photo: s.resource(true),
    level: readSlotId(s),
    levelName: s.wstr(),
    levelHash: s.sha1(),
    timestamp: s.s64Big(),
    users: s.array((self) => ({ psid: latin1(self.bytes(0x14), true), user: self.wstr(), bounds: self.vector4() })),
  };
}

/** `InventoryItemPhotoData` and its `PhotoMetadata`: cwlib's `structs/inventory/`. */
function readInventoryItemPhotoData(s: Serializer): void {
  s.resource(true); // icon
  s.resource(true); // sticker
  readPhotoMetadata(s);
  if (s.revision.version > 0x3c7) s.resource(true); // painting
}
