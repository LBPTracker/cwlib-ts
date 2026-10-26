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
import { readNetworkOnlineIdKept, writeNetworkOnlineId } from './network.ts';
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
  /** `author`'s `NetworkOnlineID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly authorBytes?: Uint8Array;
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
  /**
   * Below version `0x188`, a byte cwlib leaves unnamed; at `0x1de` and below a
   * bool cwlib guesses is `sideMission`; between `0x1ad` and `0x1b9` another
   * unnamed byte. Read and kept so `writeSlot` writes them back.
   */
  readonly unknown188?: number;
  readonly sideMission?: boolean;
  readonly unknown1b9?: number;
}

export function readSlotId(s: Serializer): SlotId {
  return { type: s.i32(), number: s.u32() };
}

function readCollectabubble(s: Serializer): Collectabubble {
  return { plan: s.resource(true), count: s.i32() };
}

/** cwlib's `Branch.DOUBLE11`, the Vita's: a slot there has fields no file here has shown. */
const DOUBLE11 = 0x4431;

/**
 * A bool the file stores as a byte other than 0 or 1 -- `initiallyLocked` is
 * 0x18 in one of the game's slot lists -- by its field's name, so `writeSlot`
 * writes the byte back. Kept beside the slot rather than on it: the field stays
 * a boolean.
 */
const BOOL_BYTES = new WeakMap<object, Record<string, number>>();

export function readSlot(s: Serializer): Slot {
  const { version, subVersion, branchId } = s.revision;
  if (branchId === DOUBLE11 && version >= 0x3c1 && version <= 0x3e2) {
    throw new SerializerError('a Vita slot: its reward and download fields are cwlib\'s and unmeasured here');
  }
  const bytes: Record<string, number> = {};
  const bool = (name: string): boolean => {
    const byte = s.u8();
    if (byte > 1) bytes[name] = byte;
    return byte !== 0;
  };
  const id = readSlotId(s);
  const root = s.resource(true);
  const adventure = subVersion >= 0x145 ? s.resource(true) : undefined;
  const icon = s.resource(true);
  const location = s.vector4();
  const { handle: author, bytes: authorBytes } = readNetworkOnlineIdKept(s);
  const authorName = version >= 0x13b ? s.wstr() : '';
  const translationTag = version >= 0x183 ? s.str() : '';
  const name = s.wstr();
  const description = s.wstr();
  const primaryLinkLevel = readSlotId(s);
  const group = version >= 0x134 ? readSlotId(s) : undefined;
  const initiallyLocked = bool('initiallyLocked');
  let shareable = false;
  let backgroundGuid = 0;
  if (version > 0x237) {
    shareable = bool('shareable');
    backgroundGuid = s.guid();
  }
  const planetDecorations = version >= 0x333 ? s.resource(true) : undefined;
  const unknown188 = version < 0x188 ? s.u8() : undefined; // unnamed in cwlib
  let developerLevelType = 0;
  let sideMission: boolean | undefined;
  if (version > 0x1de) developerLevelType = s.i32();
  else sideMission = bool('sideMission'); // cwlib's guess: sideMission
  const unknown1b9 = version > 0x1ad && version < 0x1b9 ? s.u8() : undefined; // unnamed in cwlib
  const gameProgressionState = version > 0x1b8 && version < 0x36c ? s.i32() : 0;

  const slot = {
    id, root, adventure, icon, location, author, ...(authorBytes ? { authorBytes } : {}), authorName, translationTag, name, description,
    primaryLinkLevel, group, initiallyLocked, shareable, backgroundGuid, planetDecorations,
    developerLevelType, gameProgressionState,
    labels: [] as SlotLabel[], collectabubblesRequired: [] as Collectabubble[],
    collectabubblesContained: [] as Collectabubble[], isSubLevel: false,
    minPlayers: 0, maxPlayers: 0, enforceMinMaxPlayers: false, moveRecommended: false,
    crossCompatible: false, showOnPlanet: false, livesOverride: 0,
    gameMode: 0, isGameKit: false, entranceName: '', originalSlotId: undefined as SlotId | undefined,
    customBadgeSize: 0, localPath: '', thumbPath: '',
    ...(unknown188 !== undefined ? { unknown188 } : {}),
    ...(sideMission !== undefined ? { sideMission } : {}),
    ...(unknown1b9 !== undefined ? { unknown1b9 } : {}),
  };
  BOOL_BYTES.set(slot, bytes);
  if (version <= 0x2c3) return slot;

  if (version >= 0x33c) slot.labels = s.array((x) => ({ key: x.i32(), order: x.i32() }));
  if (version >= 0x2ea) slot.collectabubblesRequired = s.array(readCollectabubble);
  if (version >= 0x2f4) slot.collectabubblesContained = s.array(readCollectabubble);
  if (version >= 0x352) slot.isSubLevel = bool('isSubLevel');
  if (version < 0x3d0) return slot;

  slot.minPlayers = s.i8();
  slot.maxPlayers = s.i8();
  if (subVersion >= 0x215) slot.enforceMinMaxPlayers = bool('enforceMinMaxPlayers');
  slot.moveRecommended = bool('moveRecommended');
  if (version >= 0x3e9) slot.crossCompatible = bool('crossCompatible');
  if (version >= 0x3d1) slot.showOnPlanet = bool('showOnPlanet');
  if (version >= 0x3d2) slot.livesOverride = s.i8();

  if (subVersion === 0) return slot; // the rest is LBP3's
  if (subVersion >= 0x12) slot.gameMode = s.u8();
  if (subVersion >= 0xd2) slot.isGameKit = bool('isGameKit');
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

function writeCollectabubble(w: Writer, c: Collectabubble): void {
  w.ref(c.plan, { descriptor: true });
  w.i32(c.count);
}

/** `readSlot`'s mirror, field for field under the same gates. */
export function writeSlot(w: Writer, slot: Slot): void {
  const { version, subVersion, branchId } = w.revision;
  if (branchId === DOUBLE11 && version >= 0x3c1 && version <= 0x3e2) {
    throw new SerializerError('a Vita slot: its reward and download fields are unmeasured here');
  }
  const bytes = BOOL_BYTES.get(slot);
  const bool = (name: string, value: boolean): void => {
    const byte = bytes?.[name];
    w.u8(byte !== undefined && value ? byte : value ? 1 : 0);
  };
  writeSlotId(w, slot.id);
  w.ref(slot.root, { descriptor: true });
  if (subVersion >= 0x145) w.ref(slot.adventure, { descriptor: true });
  w.ref(slot.icon, { descriptor: true });
  w.vector4(slot.location);
  writeNetworkOnlineId(w, slot.author, slot.authorBytes);
  if (version >= 0x13b) w.wstr(slot.authorName);
  if (version >= 0x183) w.str(slot.translationTag);
  w.wstr(slot.name);
  w.wstr(slot.description);
  writeSlotId(w, slot.primaryLinkLevel);
  if (version >= 0x134) writeSlotId(w, slot.group ?? { type: 0, number: 0 });
  bool('initiallyLocked', slot.initiallyLocked);
  if (version > 0x237) {
    bool('shareable', slot.shareable);
    w.guid(slot.backgroundGuid);
  }
  if (version >= 0x333) w.ref(slot.planetDecorations, { descriptor: true });
  if (version < 0x188) w.u8(slot.unknown188 ?? 0);
  if (version > 0x1de) w.i32(slot.developerLevelType);
  else bool('sideMission', slot.sideMission ?? false);
  if (version > 0x1ad && version < 0x1b9) w.u8(slot.unknown1b9 ?? 0);
  if (version > 0x1b8 && version < 0x36c) w.i32(slot.gameProgressionState);
  if (version <= 0x2c3) return;

  if (version >= 0x33c) {
    w.i32(slot.labels.length);
    for (const label of slot.labels) {
      w.i32(label.key);
      w.i32(label.order);
    }
  }
  if (version >= 0x2ea) {
    w.i32(slot.collectabubblesRequired.length);
    for (const c of slot.collectabubblesRequired) writeCollectabubble(w, c);
  }
  if (version >= 0x2f4) {
    w.i32(slot.collectabubblesContained.length);
    for (const c of slot.collectabubblesContained) writeCollectabubble(w, c);
  }
  if (version >= 0x352) bool('isSubLevel', slot.isSubLevel);
  if (version < 0x3d0) return;

  w.i8(slot.minPlayers);
  w.i8(slot.maxPlayers);
  if (subVersion >= 0x215) bool('enforceMinMaxPlayers', slot.enforceMinMaxPlayers);
  bool('moveRecommended', slot.moveRecommended);
  if (version >= 0x3e9) bool('crossCompatible', slot.crossCompatible);
  if (version >= 0x3d1) bool('showOnPlanet', slot.showOnPlanet);
  if (version >= 0x3d2) w.i8(slot.livesOverride);

  if (subVersion === 0) return;
  if (subVersion >= 0x12) w.u8(slot.gameMode);
  if (subVersion >= 0xd2) bool('isGameKit', slot.isGameKit);
  if (subVersion >= 0x11b) {
    w.wstr(slot.entranceName);
    writeSlotId(w, slot.originalSlotId ?? { type: 0, number: 0 });
  }
  if (subVersion >= 0x153) w.i8(slot.customBadgeSize);
  if (subVersion >= 0x192) {
    w.str(slot.localPath);
    if (subVersion >= 0x206) w.str(slot.thumbPath);
  }
}
