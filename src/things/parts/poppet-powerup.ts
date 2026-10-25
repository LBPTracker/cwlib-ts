/** `POPPET_POWERUP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, type ResourceRef } from '../../io/serializer.ts';
import { readInventoryItemDetails, writeInventoryItemDetails, type InventoryItemDetails } from '../../structs/inventory.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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

/** `readInventoryItem`'s mirror, its integers forced to 32 bits as there. */
export function writeInventoryItem(w: Writer, item: InventoryItem): void {
  const { version, subVersion } = w.revision;
  if (version < 0x235) {
    throw new SerializerError(`InventoryItem at version 0x${version.toString(16)} is not ported`);
  }
  w.ref(item.plan, { descriptor: true });
  if (subVersion >= 0x106) w.guid(item.guid ?? 0);
  writeInventoryItemDetails(w, item.details);
  w.i32(item.uid, true);
  if (version < 0x36c) {
    w.i32(item.tutorialLevel ?? 0, true);
    w.i32(item.tutorialVideo ?? 0, true);
  }
  w.i32(item.flags, true);
  if (version >= 0x34a) w.i32(item.userCategoryIndex ?? 0, true);
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
  /** subVersions 0x7 to 0x123: the popit's items in full, before they became plan descriptors. */
  readonly inventory?: readonly InventoryItem[];
  /** subVersions 0xb to 0x122: a list of `i32` pairs cwlib does not name. */
  readonly pairs?: readonly (readonly [number, number])[];
  /** subVersions 0x8 to 0x173: the byte after `goodies`, cwlib's old `tools`. */
  readonly oldTools?: number;
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
  let inventory: InventoryItem[] | undefined;
  let pairs: [number, number][] | undefined;
  let oldTools: number | undefined;
  if (subVersion > 0x124) {
    tools = s.u64();
    const items = s.count();
    for (let i = 0; i < items; i += 1) plans.push(s.resource(true)); // a plan descriptor
  }
  if (subVersion >= 0x7 && subVersion < 0x124) {
    // Measured 2026-10-22: `sack_town.bin` (subVersion 0xc8) has powerups
    // holding 0 and 3 items, and the level reads to its end through both.
    inventory = s.array(readInventoryItem);
  }
  if (subVersion >= 0xb && subVersion < 0x123) {
    const count = s.count();
    pairs = [];
    for (let i = 0; i < count; i += 1) pairs.push([s.i32(), s.i32()]);
  }
  if (subVersion >= 0x8 && subVersion < 0x174) {
    goodies = s.u8();
    oldTools = s.u8();
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
    allowCursorToCopy, sackFreeze, vcrBackupTriggered, filterContents, tools, inventory, pairs, oldTools,
  };
}

/** `readPoppetPowerup`'s mirror. */
export function writePoppetPowerup(w: Writer, p: PoppetPowerupPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  if (subVersion > 0x124) {
    w.u64Big(BigInt(p.tools ?? 0));
    w.i32(p.plans.length);
    for (const plan of p.plans) w.ref(plan, { descriptor: true });
  }
  if (subVersion >= 0x7 && subVersion < 0x124) {
    const items = p.inventory ?? [];
    w.i32(items.length);
    for (const item of items) writeInventoryItem(w, item);
  }
  if (subVersion >= 0xb && subVersion < 0x123) {
    const pairs = p.pairs ?? [];
    w.i32(pairs.length);
    for (const [a, b] of pairs) {
      w.i32(a);
      w.i32(b);
    }
  }
  if (subVersion >= 0x8 && subVersion < 0x174) {
    w.u8(p.goodies ?? 0);
    w.u8(p.oldTools ?? 0);
  }
  if (subVersion >= 0xb && subVersion < 0x174) w.s32(p.nextUid ?? 0);
  if (subVersion > 0x8b) w.bool(p.vcrControlsEnabled ?? false);
  if (subVersion > 0xa1) w.s32(p.gridSnapMode ?? 0);
  if (subVersion >= 0xc1 && subVersion < 0x174) w.u8(p.allowCursorToCopy ?? 0);
  if (subVersion > 0x12d) w.bool(p.sackFreeze ?? false);
  if (subVersion > 0x12e) {
    w.s32(p.minLayer ?? 0);
    w.s32(p.maxLayer ?? 0);
  }
  if (subVersion > 0x14a) w.bool(p.vcrBackupTriggered ?? false);
  if (subVersion > 0x166) w.bool(p.filterContents ?? false);
}
