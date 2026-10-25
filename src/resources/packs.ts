/**
 * `RPacks` -- the packs a hub offers, DLC among them: magic `PCKb`, FileDB
 * paths `….pck` (`lbp2_hub_story_themes.pck`). Each pack is what it holds, its
 * badge mesh, its slot, its store content id and a timestamp.
 *
 * The walk is cwlib's `resources/RPacks.java` and `structs/slot/Pack.java`
 * (ennuo/toolkit `d6a2ef8`) over `structs/slot.ts`; steering/level-files.md,
 * *Slots*, has what the game's own files prove of it
 * (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readSlot, writeSlotId, type Slot } from '../structs/slot.ts';
import { writeNetworkOnlineId } from '../structs/network.ts';
import { Writer } from '../io/writer.ts';

export interface Pack {
  /** cwlib's `ContentsType`: 0 group, 1 plans, 2 level, 3 costume, 5 adventure. */
  readonly contentsType: number;
  readonly mesh?: ResourceRef;
  readonly slot: Slot;
  readonly contentId: string;
  /** A signed 64-bit value, exact; cwlib sorts the packs by it. */
  readonly timestamp: bigint;
}

export interface Packs {
  readonly revision: RevisionInfo;
  /** In the file's order; cwlib's reader sorts them by `timestamp`, which this does not. */
  readonly packs: readonly Pack[];
}

function readPack(s: Serializer): Pack {
  // A Vita pack ends in a cross-buy bool; `readSlot` refuses a Vita revision first.
  return {
    contentsType: s.i32(),
    mesh: s.resource(true),
    slot: readSlot(s),
    contentId: s.str(),
    timestamp: s.s64Big(),
  };
}

/** Read a `PCKb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readPacks(bytes: Uint8Array, inflate: Inflate): Promise<Packs> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'PCKb') throw new SerializerError(`not packs: "${resource.magic}"`);
  const packs = s.array(readPack);
  if (s.remaining !== 0) {
    throw new SerializerError(`PCKb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, packs };
}

/**
 * `readSlot`'s mirror, private to the packs until `structs/slot.ts` has one.
 * The bytes the reader discards -- the online id's terminator and padding, the
 * unnamed bytes of old revisions, the `sideMission` bool -- are written 0.
 */
function writeSlot(w: Writer, slot: Slot): void {
  const { version, subVersion } = w.revision;
  writeSlotId(w, slot.id);
  w.ref(slot.root, { descriptor: true });
  if (subVersion >= 0x145) w.ref(slot.adventure, { descriptor: true });
  w.ref(slot.icon, { descriptor: true });
  w.vector4(slot.location);
  writeNetworkOnlineId(w, slot.author);
  if (version >= 0x13b) w.wstr(slot.authorName);
  if (version >= 0x183) w.str(slot.translationTag);
  w.wstr(slot.name);
  w.wstr(slot.description);
  writeSlotId(w, slot.primaryLinkLevel);
  if (version >= 0x134) writeSlotId(w, slot.group ?? { type: 0, number: 0 });
  w.bool(slot.initiallyLocked);
  if (version > 0x237) {
    w.bool(slot.shareable);
    w.guid(slot.backgroundGuid);
  }
  if (version >= 0x333) w.ref(slot.planetDecorations, { descriptor: true });
  if (version < 0x188) w.u8(0);
  if (version > 0x1de) w.i32(slot.developerLevelType);
  else w.bool(false);
  if (version > 0x1ad && version < 0x1b9) w.u8(0);
  if (version > 0x1b8 && version < 0x36c) w.i32(slot.gameProgressionState);
  if (version <= 0x2c3) return;

  const bubbles = (list: Slot['collectabubblesRequired']): void => {
    w.i32(list.length);
    for (const bubble of list) {
      w.ref(bubble.plan, { descriptor: true });
      w.i32(bubble.count);
    }
  };
  if (version >= 0x33c) {
    w.i32(slot.labels.length);
    for (const label of slot.labels) {
      w.i32(label.key);
      w.i32(label.order);
    }
  }
  if (version >= 0x2ea) bubbles(slot.collectabubblesRequired);
  if (version >= 0x2f4) bubbles(slot.collectabubblesContained);
  if (version >= 0x352) w.bool(slot.isSubLevel);
  if (version < 0x3d0) return;

  w.i8(slot.minPlayers);
  w.i8(slot.maxPlayers);
  if (subVersion >= 0x215) w.bool(slot.enforceMinMaxPlayers);
  w.bool(slot.moveRecommended);
  if (version >= 0x3e9) w.bool(slot.crossCompatible);
  if (version >= 0x3d1) w.bool(slot.showOnPlanet);
  if (version >= 0x3d2) w.i8(slot.livesOverride);

  if (subVersion === 0) return;
  if (subVersion >= 0x12) w.u8(slot.gameMode);
  if (subVersion >= 0xd2) w.bool(slot.isGameKit);
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

/** `readPacks`'s mirror: the payload, from the value, the packs in the order they hold. */
export function encodePacks(value: Packs, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  w.i32(value.packs.length);
  for (const pack of value.packs) {
    w.i32(pack.contentsType);
    w.ref(pack.mesh, { descriptor: true });
    writeSlot(w, pack.slot);
    w.str(pack.contentId);
    w.s64Big(pack.timestamp);
  }
  return w.done();
}
