/** `POPPET_POWERUP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, type ResourceRef } from '../../io/serializer.ts';
import { readInventoryItemDetails } from '../../structs/inventory.ts';

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
/** `PPoppetPowerup`, kept: the plans a popit puzzle hands the player. */
export interface PoppetPowerupPart {
  readonly plans: readonly (ResourceRef | undefined)[];
}

export function readPoppetPowerup(s: Serializer): PoppetPowerupPart {
  const { subVersion } = s.revision;
  const plans: (ResourceRef | undefined)[] = [];
  if (subVersion > 0x124) {
    s.u64(); // tools
    const items = s.count();
    for (let i = 0; i < items; i += 1) plans.push(s.resource(true)); // a plan descriptor
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
  return { plans };
}
