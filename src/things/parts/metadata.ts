/** `METADATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readPhotoMetadata, type PhotoMetadata } from '../../structs/inventory.ts';
import { readSlotId, type SlotId } from '../../structs/slot.ts';

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
  const photoMetadata = s.reference(readPhotoMetadata);
  if (version >= 0x15f) referencable = s.bool();
  if (version >= 0x205) allowEmit = s.bool();
  return {
    titleKey, descriptionKey, location, category, nameTag, fluffCost, type, subType, icon,
    locationTag, categoryTag, creationDate, descTranslationTag, primaryIndex, referencable,
    allowEmit, value, photoMetadata,
  };
}
