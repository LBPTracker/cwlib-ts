/**
 * A slot: a level's place on a planet or in a list -- its id, its root level,
 * icon, name and description, its author, and from LBP2 on its labels,
 * collectabubbles and player counts. In a slot list (`RSlotList`), a DLC pack
 * (`RPacks`), and the profiles.
 *
 * cwlib's `structs/slot/Slot.java`, `SlotID.java`, `Label.java` and
 * `Collectabubble.java` (ennuo/toolkit `d6a2ef8`); what the game's own files
 * prove of it is steering/level-files.md, *Slots*.
 */

import { SerializerError, type ResourceRef, type Serializer } from '../io/serializer.ts';
import { readNetworkOnlineId } from './network.ts';
import type { Writer } from '../io/writer.ts';

/** cwlib's `SlotID`: a `SlotType` and a number. */
export interface SlotId {
  /** cwlib's `SlotType`: 0 developer, 1 user created on the server, … 17 adventure area level. */
  readonly type: number;
  readonly number: number;
}

export interface SlotLabel {
  /** A LAMS key. */
  readonly key: number;
  readonly order: number;
}

export interface Collectabubble {
  readonly plan?: ResourceRef;
  readonly count: number;
}

export interface Slot {
  readonly id: SlotId;
  readonly root?: ResourceRef;
  /** LBP3, subVersion `0x145` on. */
  readonly adventure?: ResourceRef;
  readonly icon?: ResourceRef;
  /** Where the slot sits on its planet. */
  readonly location: readonly [number, number, number, number];
  /** The author's PSN id. */
  readonly author: string;
  /** Version `0x13b` on. */
  readonly authorName: string;
  /** Version `0x183` on: the LAMS tag a developer slot's text comes from. */
  readonly translationTag: string;
  readonly name: string;
  readonly description: string;
  readonly primaryLinkLevel: SlotId;
  /** Version `0x134` on. */
  readonly group?: SlotId;
  readonly initiallyLocked: boolean;
  /** Above version `0x237`. */
  readonly shareable: boolean;
  readonly backgroundGuid: number;
  /** Version `0x333` on. */
  readonly planetDecorations?: ResourceRef;
  /** Above version `0x1de`: cwlib's `LevelType`. */
  readonly developerLevelType: number;
  /** Versions `0x1b9`--`0x36b`. */
  readonly gameProgressionState: number;
  /** Version `0x33c` on. */
  readonly labels: readonly SlotLabel[];
  /** Version `0x2ea` on. */
  readonly collectabubblesRequired: readonly Collectabubble[];
  /** Version `0x2f4` on. */
  readonly collectabubblesContained: readonly Collectabubble[];
  /** Version `0x352` on. */
  readonly isSubLevel: boolean;
  /** Version `0x3d0` on, and the rest with them. */
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** LBP3, subVersion `0x215` on. */
  readonly enforceMinMaxPlayers: boolean;
  readonly moveRecommended: boolean;
  /** Version `0x3e9` on. */
  readonly crossCompatible: boolean;
  /** Version `0x3d1` on. */
  readonly showOnPlanet: boolean;
  /** Version `0x3d2` on. */
  readonly livesOverride: number;
  /** LBP3 (a non-zero subVersion), and each from its subVersion: `0x12`, `0xd2`, `0x11b`, `0x153`, `0x192`, `0x206`. */
  readonly gameMode: number;
  readonly isGameKit: boolean;
  readonly entranceName: string;
  readonly originalSlotId?: SlotId;
  readonly customBadgeSize: number;
  readonly localPath: string;
  readonly thumbPath: string;
}

export function readSlotId(s: Serializer): SlotId {
  return { type: s.i32(), number: s.u32() };
}

function readCollectabubble(s: Serializer): Collectabubble {
  return { plan: s.resource(true), count: s.i32() };
}

/** cwlib's `Branch.DOUBLE11`, the Vita's: a slot there has fields no file here has shown. */
const DOUBLE11 = 0x4431;

export function readSlot(s: Serializer): Slot {
  const { version, subVersion, branchId } = s.revision;
  if (branchId === DOUBLE11 && version >= 0x3c1 && version <= 0x3e2) {
    throw new SerializerError('a Vita slot: its reward and download fields are cwlib\'s and unmeasured here');
  }
  const id = readSlotId(s);
  const root = s.resource(true);
  const adventure = subVersion >= 0x145 ? s.resource(true) : undefined;
  const icon = s.resource(true);
  const location = s.vector4();
  const author = readNetworkOnlineId(s);
  const authorName = version >= 0x13b ? s.wstr() : '';
  const translationTag = version >= 0x183 ? s.str() : '';
  const name = s.wstr();
  const description = s.wstr();
  const primaryLinkLevel = readSlotId(s);
  const group = version >= 0x134 ? readSlotId(s) : undefined;
  const initiallyLocked = s.bool();
  let shareable = false;
  let backgroundGuid = 0;
  if (version > 0x237) {
    shareable = s.bool();
    backgroundGuid = s.guid();
  }
  const planetDecorations = version >= 0x333 ? s.resource(true) : undefined;
  if (version < 0x188) s.u8(); // unnamed in cwlib
  let developerLevelType = 0;
  if (version > 0x1de) developerLevelType = s.i32();
  else s.bool(); // cwlib's guess: sideMission
  if (version > 0x1ad && version < 0x1b9) s.u8(); // unnamed in cwlib
  const gameProgressionState = version > 0x1b8 && version < 0x36c ? s.i32() : 0;

  const slot = {
    id, root, adventure, icon, location, author, authorName, translationTag, name, description,
    primaryLinkLevel, group, initiallyLocked, shareable, backgroundGuid, planetDecorations,
    developerLevelType, gameProgressionState,
    labels: [] as SlotLabel[], collectabubblesRequired: [] as Collectabubble[],
    collectabubblesContained: [] as Collectabubble[], isSubLevel: false,
    minPlayers: 0, maxPlayers: 0, enforceMinMaxPlayers: false, moveRecommended: false,
    crossCompatible: false, showOnPlanet: false, livesOverride: 0,
    gameMode: 0, isGameKit: false, entranceName: '', originalSlotId: undefined as SlotId | undefined,
    customBadgeSize: 0, localPath: '', thumbPath: '',
  };
  if (version <= 0x2c3) return slot;

  if (version >= 0x33c) slot.labels = s.array((x) => ({ key: x.i32(), order: x.i32() }));
  if (version >= 0x2ea) slot.collectabubblesRequired = s.array(readCollectabubble);
  if (version >= 0x2f4) slot.collectabubblesContained = s.array(readCollectabubble);
  if (version >= 0x352) slot.isSubLevel = s.bool();
  if (version < 0x3d0) return slot;

  slot.minPlayers = s.i8();
  slot.maxPlayers = s.i8();
  if (subVersion >= 0x215) slot.enforceMinMaxPlayers = s.bool();
  slot.moveRecommended = s.bool();
  if (version >= 0x3e9) slot.crossCompatible = s.bool();
  if (version >= 0x3d1) slot.showOnPlanet = s.bool();
  if (version >= 0x3d2) slot.livesOverride = s.i8();

  if (subVersion === 0) return slot; // the rest is LBP3's
  if (subVersion >= 0x12) slot.gameMode = s.u8();
  if (subVersion >= 0xd2) slot.isGameKit = s.bool();
  if (subVersion >= 0x11b) {
    slot.entranceName = s.wstr();
    slot.originalSlotId = readSlotId(s);
  }
  if (subVersion >= 0x153) slot.customBadgeSize = s.i8();
  if (subVersion >= 0x192) {
    slot.localPath = s.str();
    if (subVersion >= 0x206) slot.thumbPath = s.str();
  }
  return slot;
}

/** `readSlotId`'s mirror. */
export function writeSlotId(w: Writer, slot: SlotId): void {
  w.i32(slot.type);
  w.u32(slot.number);
}
