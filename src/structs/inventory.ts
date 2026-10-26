/**
 * `InventoryItemDetails`: what the popit shows of an item -- its kind, its
 * icon, its name and who made it. A plan carries one after its Things, a
 * poppet power-up and `RLevel`'s tutorial inventory one per item. cwlib's
 * `structs/inventory/InventoryItemDetails.java` (ennuo/toolkit `d6a2ef8`).
 */

import { latin1, referenceIdOf, type ResourceRef, type Serializer, vitaRevision } from '../io/serializer.ts';
import { onLeerdammer } from '../things/thing.ts';
import { readEyetoyData, writeEyetoyData, type EyetoyData } from '../things/parts/stickers.ts';
import type { Writer } from '../io/writer.ts';
import { readNetworkPlayerIdKept, writeNetworkPlayerId } from './network.ts';
import { readSlotId, writeSlotId, type SlotId } from './slot.ts';

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
  /** `creator`'s `NetworkPlayerID` as stored, where it holds more than the handle (`network.ts`). */
  readonly creatorBytes?: Uint8Array;
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
  /** The photo the item was made from, where it has one (cwlib `photoData`). */
  readonly photoData?: InventoryItemPhotoData;
  /** cwlib `eyetoyData`. */
  readonly eyetoyData?: EyetoyData;
  /** The Vita's `makeSizeProportional`, from its revision 0x7d. */
  readonly makeSizeProportional?: boolean;
  /**
   * Below version 0x37d, the location, category and primary indices' `i32`s as
   * stored, where one holds more than the 16 bits cwlib keeps of it: written back
   * while the index is the one they hold.
   */
  readonly indexWords?: readonly [number, number, number];
  /** Below version 0x37d, the `i32` cwlib reads as padding after the indices, where it is not 0. */
  readonly pad?: number;
  /**
   * The stream ids of the two references above version 0x37c whose values are
   * no objects of their own -- the user-created details, flattened into `name`
   * and `description`, and the creator, a handle -- so a writer names them as the
   * file did (`Writer.reference` takes every other id from its object).
   */
  readonly referenceIds?: InventoryReferenceIds;
}

/** `InventoryItemDetails.referenceIds`. */
export interface InventoryReferenceIds {
  readonly created?: number;
  readonly creator?: number;
}

/** Three 16-bit indices read as `i32`s, and the words themselves where any holds more. */
function readIndices(s: Serializer, primary: boolean): { indices: [number, number, number]; indexWords?: [number, number, number] } {
  const words: [number, number, number] = [s.i32(true), s.i32(true), primary ? s.i32(true) : 0];
  const indices = words.map((word) => (word << 16) >> 16) as [number, number, number];
  return words.some((word, i) => word !== indices[i]) ? { indices, indexWords: words } : { indices };
}

/** An index's `i32`: its kept word while that holds it, else the index. */
function indexWord(d: InventoryItemDetails, i: number, index: number): number {
  const word = d.indexWords?.[i];
  return word !== undefined && (word << 16) >> 16 === index ? word : index;
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
  const { indices: [locationIndex, categoryIndex, primaryIndex], indexWords } = readIndices(s, head > 0x194);
  const pad = s.i32(true);
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
  const eyetoyData = head > 0x161 ? s.reference(readEyetoyData) : undefined;
  const photoData = head > 0x17a ? s.reference(readInventoryItemPhotoData) : undefined;
  let levelUnlockSlot = { type: 0, number: 0 };
  if (head > 0x176) levelUnlockSlot = { type: s.i32(), number: s.u32(true) };
  let copyright: boolean | undefined;
  let creator: string | undefined;
  let creatorBytes: Uint8Array | undefined;
  if (head > 0x181) {
    copyright = s.bool();
    const id = readNetworkPlayerIdKept(s);
    creator = id.handle;
    creatorBytes = id.bytes;
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
    eyetoyData, photoData,
    ...(creatorBytes ? { creatorBytes } : {}),
    ...(indexWords ? { indexWords } : {}),
    ...(pad !== 0 ? { pad } : {}),
  };
}

/** Versions 0x233 to 0x37c: cwlib's middle layout, its integers forced to 32 bits but for the slot's type. */
function readBefore37d(s: Serializer): InventoryItemDetails {
  const head = s.revision.version;
  const highlightSound = s.u32(true);
  const levelUnlockSlot = { type: s.i32(true), number: s.u32(true) };
  const { indices: [locationIndex, categoryIndex, primaryIndex], indexWords } = readIndices(s, true);
  const lastUsed = s.i32(true);
  const numUses = s.i32(true);
  const pad = head > 0x234 ? s.i32(true) : 0;
  const dateAdded = forcedS64(s);
  const fluffCost = s.i32(true);
  const colour = s.i32(true);
  const type = s.i32(true);
  const subType = s.i32(true);
  const toolType = (s.i32(true) << 24) >> 24;
  const { handle: creator, bytes: creatorBytes } = readNetworkPlayerIdKept(s);
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
  const photoData = s.reference(readInventoryItemPhotoData);
  const eyetoyData = s.reference(readEyetoyData);
  if (head > 0x358) s.u8(); // cwlib writes 0
  return {
    dateAdded, levelUnlockSlot, highlightSound, colour, type, subType, titleKey, descriptionKey, icon,
    name: created?.name, description: created?.description, locationIndex, categoryIndex, primaryIndex, creator,
    toolType, flags, creationHistory, translationTag, numUses, lastUsed, fluffCost, allowEmit, shareable, copyright,
    photoData, eyetoyData,
    ...(creatorBytes ? { creatorBytes } : {}),
    ...(indexWords ? { indexWords } : {}),
    ...(pad !== 0 ? { pad } : {}),
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
  const photoData = s.reference(readInventoryItemPhotoData);
  const eyetoyData = s.reference(readEyetoyData);
  const locationIndex = s.i16();
  const categoryIndex = s.i16();
  const primaryIndex = s.i16();
  const creatorId = s.reference(readNetworkPlayerIdKept);
  const creator = creatorId?.handle;
  const creatorBytes = creatorId?.bytes;
  const referenceIds: InventoryReferenceIds = { created: referenceIdOf(created) ?? 0, creator: referenceIdOf(creatorId) ?? 0 };
  const toolType = s.i8();
  const flags = s.i8();
  // The Vita's D1_DETAILS_PROPORTIONAL.
  const makeSizeProportional = vitaRevision(s.revision) >= 0x7d ? s.bool() : undefined;
  return {
    dateAdded, levelUnlockSlot, highlightSound, colour, type, subType, titleKey, descriptionKey, icon,
    name: created?.name, description: created?.description, locationIndex, categoryIndex, primaryIndex,
    creator, toolType, flags, creationHistory, photoData, eyetoyData, makeSizeProportional, referenceIds,
    ...(creatorBytes ? { creatorBytes } : {}),
  };
}

/** `readCreationHistory`'s mirror: 20-byte NUL-padded names above version 0x37c, `wstr`s at and below. */
function writeCreationHistory(w: Writer, names: readonly string[]): void {
  const fixed = w.revision.version > 0x37c;
  w.i32(names.length);
  for (const name of names) {
    if (!fixed) {
      w.wstr(name);
      continue;
    }
    const bytes = new Uint8Array(0x14);
    for (let i = 0; i < Math.min(0x14, name.length); i += 1) bytes[i] = name.charCodeAt(i) & 0xff;
    w.bytes(bytes);
  }
}

/** A forced 64-bit `s64`'s mirror. */
const writeForcedS64 = (w: Writer, value: bigint): void => w.u64Big(BigInt.asUintN(64, value), true);

/** `readBefore233`'s mirror; what it reads and drops is written as cwlib writes it, empty and 0. */
function writeBefore233(w: Writer, d: InventoryItemDetails): void {
  const head = w.revision.version;
  if (head < 0x174) {
    w.wstr('');
    w.wstr('');
  } else w.str(d.translationTag ?? '');
  w.i32(indexWord(d, 0, d.locationIndex), true);
  w.i32(indexWord(d, 1, d.categoryIndex), true);
  if (head > 0x194) w.i32(indexWord(d, 2, d.primaryIndex), true);
  w.i32(d.pad ?? 0, true);
  w.i32(d.type, true);
  w.i32(d.subType, true);
  if (head > 0x196) w.i32(d.toolType, true);
  w.ref(d.icon, { descriptor: true });
  if (head > 0x1c0) {
    w.i32(d.numUses ?? 0, true);
    w.i32(d.lastUsed ?? 0, true);
  }
  if (head > 0x14e) w.u32(d.highlightSound, true);
  else w.str('');
  if (head > 0x156) w.i32(d.colour, true);
  if (head > 0x161) w.reference(d.eyetoyData, writeEyetoyData);
  if (head > 0x17a) w.reference(d.photoData, writeInventoryItemPhotoData);
  if (head > 0x176) {
    w.i32(d.levelUnlockSlot.type);
    w.u32(d.levelUnlockSlot.number, true);
  }
  if (head > 0x181) {
    w.bool(d.copyright ?? false);
    writeNetworkPlayerId(w, d.creator ?? '', d.creatorBytes);
  }
  if (head > 0x1aa) {
    w.wstr(d.name ?? '');
    w.wstr(d.description ?? '');
  }
  if (head > 0x1b0) writeCreationHistory(w, d.creationHistory ?? []);
  if (head > 0x204) w.bool(d.allowEmit ?? false);
  if (head > 0x221) writeForcedS64(w, d.dateAdded);
  if (head > 0x222) w.bool(d.shareable ?? false);
}

/** `readBefore37d`'s mirror. */
function writeBefore37d(w: Writer, d: InventoryItemDetails): void {
  const head = w.revision.version;
  w.u32(d.highlightSound, true);
  w.i32(d.levelUnlockSlot.type, true);
  w.u32(d.levelUnlockSlot.number, true);
  w.i32(indexWord(d, 0, d.locationIndex), true);
  w.i32(indexWord(d, 1, d.categoryIndex), true);
  w.i32(indexWord(d, 2, d.primaryIndex), true);
  w.i32(d.lastUsed ?? 0, true);
  w.i32(d.numUses ?? 0, true);
  if (head > 0x234) w.i32(d.pad ?? 0, true);
  writeForcedS64(w, d.dateAdded);
  w.i32(d.fluffCost ?? 0, true);
  w.i32(d.colour, true);
  w.i32(d.type, true);
  w.i32(d.subType, true);
  w.i32(d.toolType, true);
  writeNetworkPlayerId(w, d.creator ?? '', d.creatorBytes);
  w.bool(d.allowEmit ?? false);
  w.bool(d.shareable ?? false);
  w.bool(d.copyright ?? false);
  if (head > 0x334) w.i8(d.flags);
  if (onLeerdammer(w.revision, LD_LAMS_KEYS) || head > 0x2ba) {
    w.u32(d.titleKey);
    w.u32(d.descriptionKey);
  } else w.str(d.translationTag ?? '');
  w.wstr(d.name ?? '');
  w.wstr(d.description ?? '');
  writeCreationHistory(w, d.creationHistory ?? []);
  w.ref(d.icon, { descriptor: true });
  w.reference(d.photoData, writeInventoryItemPhotoData);
  w.reference(d.eyetoyData, writeEyetoyData);
  if (head > 0x358) w.u8(0);
}

/**
 * The one object a writer keeps per reference id of `kind`: the creator and the
 * user-created details are read as values (a string, two strings), so nothing
 * of theirs is shared by identity -- but the game names one creator from every
 * item of a powerup (`MM_Studio` under one id, measured in
 * `chunk1_001.farc` c8b843c7), and the writer has to see the second mention as
 * the same object to write it as a back-reference.
 */
const sharedByWriter = new WeakMap<Writer, Map<string, object>>();
function shared<T extends object>(w: Writer, kind: string, id: number | undefined, value: T): T {
  if (!id) return value;
  let table = sharedByWriter.get(w);
  if (!table) sharedByWriter.set(w, (table = new Map()));
  const key = `${kind}:${id}`;
  const seen = table.get(key) as T | undefined;
  if (seen) return seen;
  table.set(key, value);
  return value;
}

/** `readInventoryItemDetails`' mirror, in the layout of the writer's revision. */
export function writeInventoryItemDetails(w: Writer, d: InventoryItemDetails): void {
  const { version } = w.revision;
  if (version < 0x233) return writeBefore233(w, d);
  if (version <= 0x37c) return writeBefore37d(w, d);
  const ids = d.referenceIds;
  w.s64Big(d.dateAdded);
  writeSlotId(w, d.levelUnlockSlot);
  w.guid(d.highlightSound);
  w.i32(d.colour);
  w.i32(d.type);
  w.i32(d.subType);
  w.u32(d.titleKey);
  w.u32(d.descriptionKey);
  w.reference(d.creationHistory, writeCreationHistory);
  w.ref(d.icon, { descriptor: true });
  const created = d.name === undefined && d.description === undefined
    ? undefined
    : shared(w, 'created', ids?.created, { name: d.name ?? '', description: d.description ?? '' });
  w.reference(created, (self, c) => {
    self.wstr(c.name);
    self.wstr(c.description);
  }, ids?.created);
  w.reference(d.photoData, writeInventoryItemPhotoData);
  w.reference(d.eyetoyData, writeEyetoyData);
  w.i16(d.locationIndex);
  w.i16(d.categoryIndex);
  w.i16(d.primaryIndex);
  const creator = d.creator === undefined ? undefined : shared(w, 'creator', ids?.creator, { handle: d.creator });
  w.reference(creator, (self, c) => writeNetworkPlayerId(self, c.handle, d.creatorBytes), ids?.creator);
  w.i8(d.toolType);
  w.i8(d.flags);
  if (vitaRevision(w.revision) >= 0x7d) w.bool(d.makeSizeProportional ?? false);
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

/** `readPhotoMetadata`'s mirror. */
export function writePhotoMetadata(w: Writer, m: PhotoMetadata): void {
  w.ref(m.photo, { descriptor: true });
  writeSlotId(w, m.level);
  w.wstr(m.levelName);
  w.sha1(m.levelHash);
  w.s64Big(m.timestamp);
  w.i32(m.users.length);
  for (const user of m.users) {
    const psid = new Uint8Array(0x14);
    for (let i = 0; i < Math.min(0x14, user.psid.length); i += 1) psid[i] = user.psid.charCodeAt(i) & 0xff;
    w.bytes(psid);
    w.wstr(user.user);
    w.vector4(user.bounds);
  }
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

/** `InventoryItemPhotoData`: cwlib's `structs/inventory/InventoryItemPhotoData.java`. */
export interface InventoryItemPhotoData {
  readonly icon?: ResourceRef;
  readonly sticker?: ResourceRef;
  readonly photoMetadata: PhotoMetadata;
  /** Version 0x3c8 on. */
  readonly painting?: ResourceRef;
}

function readInventoryItemPhotoData(s: Serializer): InventoryItemPhotoData {
  const icon = s.resource(true);
  const sticker = s.resource(true);
  const photoMetadata = readPhotoMetadata(s);
  const painting = s.revision.version > 0x3c7 ? s.resource(true) : undefined;
  return { icon, sticker, photoMetadata, painting };
}

/** `readInventoryItemPhotoData`'s mirror. */
export function writeInventoryItemPhotoData(w: Writer, p: InventoryItemPhotoData): void {
  w.ref(p.icon, { descriptor: true });
  w.ref(p.sticker, { descriptor: true });
  writePhotoMetadata(w, p.photoMetadata);
  if (w.revision.version > 0x3c7) w.ref(p.painting, { descriptor: true });
}
