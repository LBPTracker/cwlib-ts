/** `POPPET_POWERUP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, type ResourceRef } from '../../io/serializer.ts';
import { readInventoryItemDetails, type InventoryItemDetails } from '../../structs/inventory.ts';

/**
 * `InventoryItem`: cwlib's `structs/profile/InventoryItem.java`, from version
 * 0x235 (`ITEM_FLAGS`). Its integers are fixed-width even in a compressed
 * stream, as cwlib forces them.
 */
export interface InventoryItem {
  /** A descriptor. */
  readonly plan?: ResourceRef;
  /** subVersion `0x106` on. */
  readonly guid?: number;
  readonly details: InventoryItemDetails;
  readonly uid: number;
  /** Below version `0x36c`. */
  readonly tutorialLevel?: number;
  readonly tutorialVideo?: number;
  readonly flags: number;
  /** Version `0x34a` on. */
  readonly userCategoryIndex?: number;
}

export function readInventoryItem(s: Serializer): InventoryItem {
  const { version, subVersion } = s.revision;
  if (version < 0x235) {
    throw new SerializerError(`InventoryItem at version 0x${version.toString(16)} is not ported`);
  }
  const plan = s.resource(true);
  const guid = subVersion >= 0x106 ? s.guid() : undefined;
  const details = readInventoryItemDetails(s);
  const uid = s.i32(true);
  let tutorialLevel: number | undefined;
  let tutorialVideo: number | undefined;
  if (version < 0x36c) {
    tutorialLevel = s.i32(true);
    tutorialVideo = s.i32(true);
  }
  const flags = s.i32(true);
  const userCategoryIndex = version >= 0x34a ? s.i32(true) : undefined;
  return { plan, guid, details, uid, tutorialLevel, tutorialVideo, flags, userCategoryIndex };
}

/**
 * `PPoppetPowerup` -- the popit a Thing hands the player, as in the game's
 * popit puzzles. cwlib's `PPoppetPowerup.java`; every gate is on subVersion,
 * so a subVersion-0 file (the crossplay levels) holds nothing at all.
 */
/** `PPoppetPowerup`, kept: the plans a popit puzzle hands the player. */
export interface PoppetPowerupPart {
  readonly plans: readonly (ResourceRef | undefined)[];
  readonly goodies?: number;
  readonly minLayer?: number;
  readonly maxLayer?: number;
  readonly nextUid?: number;
  readonly vcrControlsEnabled?: boolean;
  readonly gridSnapMode?: number;
  readonly allowCursorToCopy?: number;
  readonly sackFreeze?: boolean;
  readonly vcrBackupTriggered?: boolean;
  readonly filterContents?: boolean;
  /** The tools the popit offers, a bit set; subVersion `0x125` on. A u64, read as a number: exact to 2^53. */
  readonly tools?: number;
}

export function readPoppetPowerup(s: Serializer): PoppetPowerupPart {
  const { subVersion } = s.revision;
  let nextUid: number | undefined;
  let vcrControlsEnabled: boolean | undefined;
  let gridSnapMode: number | undefined;
  let allowCursorToCopy: number | undefined;
  let sackFreeze: boolean | undefined;
  let vcrBackupTriggered: boolean | undefined;
  let filterContents: boolean | undefined;
  let goodies: number | undefined;
  let minLayer: number | undefined;
  let maxLayer: number | undefined;
  const plans: (ResourceRef | undefined)[] = [];
  let tools: number | undefined;
  if (subVersion > 0x124) {
    tools = s.u64();
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
    goodies = s.u8();
    s.u8(); // tools
  }
  if (subVersion >= 0xb && subVersion < 0x174) nextUid = s.s32();
  if (subVersion > 0x8b) vcrControlsEnabled = s.bool();
  if (subVersion > 0xa1) gridSnapMode = s.s32();
  if (subVersion >= 0xc1 && subVersion < 0x174) allowCursorToCopy = s.u8();
  if (subVersion > 0x12d) sackFreeze = s.bool();
  if (subVersion > 0x12e) {
    minLayer = s.s32();
    maxLayer = s.s32();
  }
  if (subVersion > 0x14a) vcrBackupTriggered = s.bool();
  if (subVersion > 0x166) filterContents = s.bool();
  return {
    plans, goodies, minLayer, maxLayer, nextUid, vcrControlsEnabled, gridSnapMode,
    allowCursorToCopy, sackFreeze, vcrBackupTriggered, filterContents, tools,
  };
}
