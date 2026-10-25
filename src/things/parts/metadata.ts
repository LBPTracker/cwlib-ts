/** `METADATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readPhotoMetadata, type PhotoMetadata } from '../../structs/inventory.ts';
import { readSlotId, writeSlotId, type SlotId } from '../../structs/slot.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** The reference id each `PhotoMetadata` had in its file, so a writer names it the same. */
const IDS = new WeakMap<object, number>();
/** And its tape object, where read onto a tape: the key the tape writes it under (see `script.ts`, `TAPED`). */
const TAPED = new WeakMap<object, object>();

/**
 * `PMetadata`: what an inventory item calls itself.
 *
 * Below version 0x297 (LEERDAMMER's revision 2) it starts with the deprecated
 * `CValue` and has an `i32` after its fluff cost; below 0x2bb (LEERDAMMER's 8)
 * it names itself by translation *tags*, four strings, where the four LAMS keys
 * came later. cwlib's `PMetadata.java` and `components/Value.java` at `d6a2ef8`.
 */
/** `PMetadata`, kept: what a Thing is called and shown as in the popit, as `InventoryItemDetails` is for a plan. */
export interface MetadataPart {
  /** LAMS keys from version 0x2bb; `translate` them with an `RTranslationTable`. */
  readonly titleKey: number;
  readonly descriptionKey: number;
  readonly location: number;
  readonly category: number;
  /** Below 0x2bb, the tags the keys hash from. */
  readonly nameTag?: string;
  readonly fluffCost: number;
  /** cwlib's `InventoryObjectType` flags, as on a plan. */
  readonly type: number;
  readonly subType: number;
  readonly icon?: ResourceRef;
  readonly locationTag?: string;
  readonly categoryTag?: string;
  readonly creationDate: number;
  readonly descTranslationTag?: string;
  readonly primaryIndex?: number;
  readonly referencable?: boolean;
  /** The byte `referencable` was read from, where it is neither 0 nor 1. */
  readonly referencableByte?: number;
  readonly allowEmit?: boolean;
  /** The deprecated `CValue`, below version 0x297. */
  readonly value?: MetadataValue;
  readonly photoMetadata?: PhotoMetadata;
}

/** cwlib's `components/Value`: the deprecated `CValue`, an item's old inventory record. */
export interface MetadataValue {
  readonly fluff: number;
  readonly icon?: ResourceRef;
  readonly type: number;
  readonly subType: number;
  /** `GlobalThingDescriptor`: a level, and a Thing's UID in it. */
  readonly linkTo: { readonly level?: ResourceRef; readonly uid: number };
  readonly linkSlot: SlotId;
  readonly linkType: number;
  readonly lastUsed: number;
  readonly numUses: number;
  readonly name: string;
  readonly location: string;
  readonly category: string;
  readonly color: number;
  readonly size: number;
}

function readValue(s: Serializer): MetadataValue {
  return {
    fluff: s.i32(),
    icon: s.resource(),
    type: s.i32(),
    subType: s.i32(),
    linkTo: { level: s.resource(true, false, false), uid: s.i32() },
    linkSlot: readSlotId(s),
    linkType: s.i32(),
    lastUsed: s.i32(),
    numUses: s.i32(),
    name: s.str(),
    location: s.str(),
    category: s.str(),
    color: s.i8(),
    size: s.i8(),
  };
}

export function readMetadata(s: Serializer): MetadataPart {
  const { version, branchId, branchRevision } = s.revision;
  let descTranslationTag: string | undefined;
  let primaryIndex: number | undefined;
  let referencable: boolean | undefined;
  let allowEmit: boolean | undefined;
  let locationTag: string | undefined;
  let categoryTag: string | undefined;
  const leerdammer = branchId === 0x4c44;
  // cwlib `hasDepreciatedValue`: a `CValue` struct that LEERDAMMER dropped at
  // its revision 2 and everyone else at 0x297.
  const deprecatedValue = leerdammer
    ? branchRevision < 0x2
    : version < 0x297;
  const value = deprecatedValue ? readValue(s) : undefined;
  let titleKey = 0;
  let descriptionKey = 0;
  let location = 0;
  let category = 0;
  let nameTag: string | undefined;
  if ((leerdammer && branchRevision >= 0x8) || version > 0x2ba) {
    titleKey = s.u32();
    descriptionKey = s.u32();
    location = s.u32();
    category = s.u32();
  } else {
    // ❗ The older files carry LAMS **tags** — strings — rather than the four
    // hashed keys. `descTranslationTag` is only stored below 0x159; above it
    // cwlib derives it as `name + "_DESC"` and reads nothing.
    nameTag = s.str();
    if (version < 0x159) descTranslationTag = s.str();
    locationTag = s.str();
    categoryTag = s.str();
  }
  if (version >= 0x195) primaryIndex = s.i32();
  const fluffCost = s.i32();
  if (deprecatedValue) s.i32(); // cwlib writes 0
  const type = s.i32(); // a flags word
  const subType = s.i32();
  const creationDate = s.u32();
  const icon = s.resource();
  const at = s.position;
  const photoId = s.i32();
  s.position = at;
  const photoMetadata = s.reference(readPhotoMetadata);
  if (photoMetadata) {
    IDS.set(photoMetadata, photoId);
    const taped = s.tape?.objectOf(photoMetadata);
    if (taped) TAPED.set(photoMetadata, taped);
  }
  let referencableByte: number | undefined;
  if (version >= 0x15f) {
    // A bool, but one LBP1 plan stores 0x0d there: the byte is kept where it is neither 0 nor 1.
    const byte = s.u8();
    referencable = byte !== 0;
    if (byte > 1) referencableByte = byte;
  }
  if (version >= 0x205) allowEmit = s.bool();
  return {
    titleKey, descriptionKey, location, category, nameTag, fluffCost, type, subType, icon,
    locationTag, categoryTag, creationDate, descTranslationTag, primaryIndex, referencable,
    allowEmit, value, photoMetadata, referencableByte,
  };
}

/** `readValue`'s mirror. */
function writeValue(w: Writer, v: MetadataValue): void {
  w.i32(v.fluff);
  w.ref(v.icon);
  w.i32(v.type);
  w.i32(v.subType);
  w.ref(v.linkTo.level, { descriptor: true, classPointer: false });
  w.i32(v.linkTo.uid);
  writeSlotId(w, v.linkSlot);
  w.i32(v.linkType);
  w.i32(v.lastUsed);
  w.i32(v.numUses);
  w.str(v.name);
  w.str(v.location);
  w.str(v.category);
  w.i8(v.color);
  w.i8(v.size);
}

/** `readPhotoMetadata`'s mirror (`structs/inventory.ts`), kept here beside its one writer. */
function writePhotoMetadata(w: Writer, photo: PhotoMetadata): void {
  w.ref(photo.photo, { descriptor: true });
  writeSlotId(w, photo.level);
  w.wstr(photo.levelName);
  w.sha1(photo.levelHash);
  w.s64Big(photo.timestamp);
  w.i32(photo.users.length);
  for (const user of photo.users) {
    const psid = new Uint8Array(0x14);
    for (let i = 0; i < Math.min(0x14, user.psid.length); i += 1) psid[i] = user.psid.charCodeAt(i) & 0xff;
    w.bytes(psid);
    w.wstr(user.user);
    w.vector4(user.bounds);
  }
}

/** `readMetadata`'s mirror; the `i32` cwlib writes 0 after the fluff cost of an old file is written so. */
export function writeMetadata(w: Writer, m: MetadataPart, _ctx: PartWriteContext): void {
  const { version, branchId, branchRevision } = w.revision;
  const leerdammer = branchId === 0x4c44;
  const deprecatedValue = leerdammer ? branchRevision < 0x2 : version < 0x297;
  if (deprecatedValue) writeValue(w, m.value!);
  if ((leerdammer && branchRevision >= 0x8) || version > 0x2ba) {
    w.u32(m.titleKey);
    w.u32(m.descriptionKey);
    w.u32(m.location);
    w.u32(m.category);
  } else {
    w.str(m.nameTag ?? '');
    if (version < 0x159) w.str(m.descTranslationTag ?? '');
    w.str(m.locationTag ?? '');
    w.str(m.categoryTag ?? '');
  }
  if (version >= 0x195) w.i32(m.primaryIndex ?? 0);
  w.i32(m.fluffCost);
  if (deprecatedValue) w.i32(0);
  w.i32(m.type);
  w.i32(m.subType);
  w.u32(m.creationDate);
  w.ref(m.icon);
  const photo = m.photoMetadata;
  if (!photo) w.reference(undefined, () => {});
  else w.reference<object>(TAPED.get(photo) ?? photo, (self) => writePhotoMetadata(self, photo), IDS.get(photo));
  if (version >= 0x15f) w.u8(m.referencable ? m.referencableByte ?? 1 : 0);
  if (version >= 0x205) w.bool(m.allowEmit ?? false);
}
