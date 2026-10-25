/** `POPPET_POWERUP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, vitaRevision } from '../../io/serializer.ts';
import { readNetworkPlayerId } from '../../structs/network.ts';
import { readEyetoyData } from './stickers.ts';

/**
 * `InventoryItemDetails` above version 0x37c: cwlib's `InventoryItemDetails.java`,
 * the same layout `writeInventoryDetails` in `write-plan.ts` writes. The two
 * older layouts are not ported, and refuse.
 */
function readInventoryItemDetails(s: Serializer): void {
  const { version } = s.revision;
  if (version <= 0x37c) {
    throw new SerializerError(`InventoryItemDetails at version 0x${version.toString(16)} is not ported`);
  }
  s.u64(); // dateAdded, an s64
  s.i32(); // levelUnlockSlotID.slotType
  s.u32(); // levelUnlockSlotID.slotNumber
  s.guid(); // highlightSound
  s.i32(); // colour
  s.i32(); // type
  s.i32(); // subType
  s.u32(); // titleKey
  s.u32(); // descriptionKey
  s.reference((self) => {
    // creationHistory: fixed 20-byte names above 0x37c
    const count = self.count();
    for (let i = 0; i < count; i += 1) self.skip(0x14);
  });
  s.resource(true); // icon
  s.reference((self) => {
    self.wstr(); // userCreatedDetails.name
    self.wstr(); // userCreatedDetails.description
  });
  s.reference(readInventoryItemPhotoData); // photoData
  s.reference(readEyetoyData); // eyetoyData
  s.i16(); // locationIndex
  s.i16(); // categoryIndex
  s.i16(); // primaryIndex
  s.reference(readNetworkPlayerId); // creator
  s.i8(); // toolType
  s.i8(); // flags
  if (vitaRevision(s.revision) >= 0x7d) s.bool(); // makeSizeProportional, the Vita's D1_DETAILS_PROPORTIONAL
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

/**
 * `InventoryItem`: cwlib's `structs/profile/InventoryItem.java`, from version
 * 0x235 (`ITEM_FLAGS`). Its integers are fixed-width even in a compressed
 * stream, as cwlib forces them.
 */
export function readInventoryItem(s: Serializer): void {
  const { version, subVersion } = s.revision;
  if (version < 0x235) {
    throw new SerializerError(`InventoryItem at version 0x${version.toString(16)} is not ported`);
  }
  s.resource(true); // plan
  if (subVersion >= 0x106) s.guid(); // guid
  readInventoryItemDetails(s);
  s.i32(true); // UID
  if (version < 0x36c) {
    s.i32(true); // tutorialLevel
    s.i32(true); // tutorialVideo
  }
  s.i32(true); // flags
  if (version >= 0x34a) s.i32(true); // userCategoryIndex
}

/**
 * `PPoppetPowerup` -- the popit a Thing hands the player, as in the game's
 * popit puzzles. cwlib's `PPoppetPowerup.java`; every gate is on subVersion,
 * so a subVersion-0 file (the crossplay levels) holds nothing at all.
 */
export function readPoppetPowerup(s: Serializer): void {
  const { subVersion } = s.revision;
  if (subVersion > 0x124) {
    s.u64(); // tools
    const items = s.count();
    for (let i = 0; i < items; i += 1) s.resource(true); // a plan descriptor
  }
  if (subVersion >= 0x7 && subVersion < 0x124) {
    // Measured 2026-10-22: `sack_town.bin` (subVersion 0xc8) has powerups
    // holding 0 and 3 items, and the level reads to its end through both.
    s.array(readInventoryItem);
  }
  if (subVersion >= 0xb && subVersion < 0x123) {
    const count = s.count();
    for (let i = 0; i < count; i += 1) {
      s.i32();
      s.i32();
    }
  }
  if (subVersion >= 0x8 && subVersion < 0x174) {
    s.u8(); // goodies
    s.u8(); // tools
  }
  if (subVersion >= 0xb && subVersion < 0x174) s.s32(); // nextUid
  if (subVersion > 0x8b) s.bool(); // vcrControlsEnabled
  if (subVersion > 0xa1) s.s32(); // gridSnapMode
  if (subVersion >= 0xc1 && subVersion < 0x174) s.u8(); // allowCursorToCopy
  if (subVersion > 0x12d) s.bool(); // sackFreeze
  if (subVersion > 0x12e) {
    s.s32(); // minLayer
    s.s32(); // maxLayer
  }
  if (subVersion > 0x14a) s.bool(); // vcrBackupTriggered
  if (subVersion > 0x166) s.bool(); // filterContents
}
