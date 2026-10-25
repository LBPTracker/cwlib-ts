/**
 * `RQuest` -- a story quest: magic `QSTb`, FileDB paths `gamedata/lbp3/…/quests/….qst`.
 * Its names and texts, its prizes and their icons, the objectives, the levels
 * that deactivate, activate and complete it, and its key.
 *
 * ❗ **Read as the game's own loader reads it: `v0xdbd490` in `eboot-v128.bin`**
 * (an objective `v0xdbc520`, a descriptor `v0xbadab0`), every gate on the head
 * word. cwlib's `resources/RQuest.java` (ennuo/toolkit `d6a2ef8`) has an empty
 * `serialize`; its comment's field names are the game's own -- the eboot's
 * reflective serialiser `v0xdbe720` names the same fields in the same order --
 * and the five strings before them have no name there. All 25 of the game's
 * quests read to the payload's last byte: steering/level-files.md, *Quests*.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readSlotId, writeSlotId, type SlotId } from '../structs/slot.ts';
import { Writer } from '../io/writer.ts';

export interface QuestObjective {
  /** The LAMS key or the text of the objective (`ZIGGURAT_QUEST_TODO_30`). */
  readonly text: string;
  /** The objective's name (`ZIG_Blueprint`); `Objective ID` where it was never set. */
  readonly id: string;
  /**
   * Two raw `u16`s and a byte, as the loader reads them. `required` and `hidden`
   * are the eboot's names; ⚠️ the first has none there, and its values -- 101 on
   * 13 of the game's 35, and as far as 13352 and -15317 -- are no count.
   */
  readonly count: number;
  readonly required: number;
  readonly hidden: boolean;
  /** What a level's `PQuest` names in `objectiveKey` (`dev/quest-keys.ts`); from subVersion 0x141. */
  readonly key: number;
  /** Subversions 0x157--0x158: a string and a byte the game reads and drops. Kept to be written back. */
  readonly dropped157?: { readonly text: string; readonly byte: number };
  /** Subversions 0x9c--0x161: the two bytes the game reads and drops. Kept to be written back. */
  readonly dropped161?: readonly [number, number];
}

export interface Quest {
  readonly revision: RevisionInfo;
  /** The quest's name (`ZIG_Blueprint`); `Quest ID` where it was never set. */
  readonly name: string;
  /** LAMS keys or text: `ZIGGURAT_QUEST_TITLE_30`, `ZIGGURAT_QUEST_DESC_30`. */
  readonly title: string;
  readonly description: string;
  /** The world it belongs to (`THEME_ZIGGURAT`, `Bunkum Lagoon`, `Uncategorised`); from subVersion 0xeb. */
  readonly area: string;
  /** `Independent!` in all 25; from subVersion 0x112. */
  readonly group: string;
  /** From subVersion 0xa0; 0 in all 25. */
  readonly state: number;
  /**
   * From subVersion 0xb5. **Three each in every one of the game's 25**, and only
   * the middle one ever set: a costume plan where there is one
   * (`cos_sack_boy_1.plan`), and its icon, whose GUID is not in the FileDB.
   */
  readonly prizes: readonly (ResourceRef | undefined)[];
  readonly prizeIcons: readonly (ResourceRef | undefined)[];
  readonly objectives: readonly QuestObjective[];
  /** From subVersion 0x9c. */
  readonly isPrimary: boolean;
  /** From subVersion 0x144. */
  readonly isInvisible: boolean;
  /** Developer adventure slots (type 11) in every one the game has; from 0xd0, 0x10d and 0x11e. */
  readonly deactivatedInLevels: readonly SlotId[];
  readonly activatedInLevels: readonly SlotId[];
  readonly completedInLevels: readonly SlotId[];
  /** From subVersion 0xf6; true in all 25. */
  readonly stateUpdateViewed: boolean;
  /** ✔ What a level's `PQuest` names in `questKey`: 292 of the game's 299 non-zero ones (`dev/quest-keys.ts`). */
  readonly key: number;
  /** From subVersion 0x141; 0 in all 25. */
  readonly availabilityDependsUponKey: number;
  /** Subversions 0x157--0x158: two strings and a byte the game reads and drops. Kept to be written back. */
  readonly dropped157?: { readonly first: string; readonly second: string; readonly byte: number };
}

/** An array whose elements no file here has: refused unless empty. */
function emptyArray(s: Serializer, what: string): void {
  const count = s.count();
  if (count !== 0) throw new SerializerError(`a quest with ${count} ${what}: not read`);
}

function readObjective(s: Serializer): QuestObjective {
  const { subVersion } = s.revision;
  const text = subVersion >= 0x9c ? s.wstr() : '';
  const id = subVersion >= 0x9c ? s.wstr() : '';
  const droppedText = subVersion >= 0x157 && subVersion <= 0x158 ? s.wstr() : undefined; // read and dropped by the game
  const count = subVersion >= 0x9c ? s.i16() : 0;
  const required = subVersion >= 0x9c ? s.i16() : 0;
  const hidden = subVersion >= 0x9c ? s.bool() : false;
  // Two bytes the game reads and drops: `pp01_bridge.qst` (0x154) has them, zero.
  const dropped161: [number, number] | undefined = subVersion >= 0x9c && subVersion <= 0x161 ? [s.u8(), s.u8()] : undefined;
  const key = subVersion >= 0x141 ? s.u32() : 0;
  const droppedByte = subVersion >= 0x157 && subVersion <= 0x158 ? s.u8() : undefined;
  return {
    text, id, count, required, hidden, key,
    ...(droppedText !== undefined ? { dropped157: { text: droppedText, byte: droppedByte ?? 0 } } : {}),
    ...(dropped161 ? { dropped161 } : {}),
  };
}

/** Read a `QSTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readQuest(bytes: Uint8Array, inflate: Inflate): Promise<Quest> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'QSTb') throw new SerializerError(`not a quest: "${resource.magic}"`);
  const { subVersion } = revision;
  const from = (sub: number, read: () => string): string => (subVersion >= sub ? read() : '');

  const name = from(0x9c, () => s.wstr());
  const title = from(0x9c, () => s.wstr());
  const description = from(0x9c, () => s.wstr());
  const area = from(0xeb, () => s.wstr());
  const group = from(0x112, () => s.wstr());
  const dropped = subVersion >= 0x157 && subVersion <= 0x158 ? [s.wstr(), s.wstr()] : undefined; // two strings the game reads and drops
  const state = subVersion >= 0xa0 ? s.u32() : 0;
  const descriptors = (): (ResourceRef | undefined)[] => (subVersion >= 0xb5 ? s.array((x) => x.resource(true)) : []);
  const prizes = descriptors();
  const prizeIcons = descriptors();
  const objectives = subVersion >= 0x9c ? s.array(readObjective) : [];
  if (subVersion >= 0xc0) emptyArray(s, 'decals');
  if (subVersion >= 0xc2) emptyArray(s, 'decorations');
  const isPrimary = subVersion >= 0x9c ? s.bool() : false;
  const isInvisible = subVersion >= 0x144 ? s.bool() : false;
  const deactivatedInLevels = subVersion >= 0xd0 ? s.array(readSlotId) : [];
  const activatedInLevels = subVersion >= 0x10d ? s.array(readSlotId) : [];
  const completedInLevels = subVersion >= 0x11e ? s.array(readSlotId) : [];
  const stateUpdateViewed = subVersion >= 0xf6 ? s.bool() : false;
  const key = subVersion >= 0x141 ? s.u32() : 0;
  const availabilityDependsUponKey = subVersion >= 0x141 ? s.u32() : 0;
  if (subVersion >= 0x168) {
    emptyArray(s, 'new decorations');
    emptyArray(s, 'new stickers');
  }
  const droppedByte = subVersion >= 0x157 && subVersion <= 0x158 ? s.u8() : undefined;
  if (subVersion >= 0x17b) emptyArray(s, 'potentially completed objectives');

  if (s.remaining !== 0) {
    throw new SerializerError(`QSTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, name, title, description, area, group, state, prizes, prizeIcons, objectives, isPrimary,
    isInvisible, deactivatedInLevels, activatedInLevels, completedInLevels, stateUpdateViewed, key,
    availabilityDependsUponKey,
    ...(dropped ? { dropped157: { first: dropped[0], second: dropped[1], byte: droppedByte ?? 0 } } : {}),
  };
}

function writeObjective(w: Writer, o: QuestObjective): void {
  const { subVersion } = w.revision;
  const in157 = subVersion >= 0x157 && subVersion <= 0x158;
  if (subVersion >= 0x9c) {
    w.wstr(o.text);
    w.wstr(o.id);
  }
  if (in157) w.wstr(o.dropped157?.text ?? '');
  if (subVersion >= 0x9c) {
    w.i16(o.count);
    w.i16(o.required);
    w.bool(o.hidden);
  }
  if (subVersion >= 0x9c && subVersion <= 0x161) {
    w.u8(o.dropped161?.[0] ?? 0);
    w.u8(o.dropped161?.[1] ?? 0);
  }
  if (subVersion >= 0x141) w.u32(o.key);
  if (in157) w.u8(o.dropped157?.byte ?? 0);
}

/** `readQuest`'s mirror: the payload, byte for byte, from the value. */
export function encodeQuest(value: Quest, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const { subVersion } = header.revision;
  const in157 = subVersion >= 0x157 && subVersion <= 0x158;
  if (subVersion >= 0x9c) {
    w.wstr(value.name);
    w.wstr(value.title);
    w.wstr(value.description);
  }
  if (subVersion >= 0xeb) w.wstr(value.area);
  if (subVersion >= 0x112) w.wstr(value.group);
  if (in157) {
    w.wstr(value.dropped157?.first ?? '');
    w.wstr(value.dropped157?.second ?? '');
  }
  if (subVersion >= 0xa0) w.u32(value.state);
  if (subVersion >= 0xb5) {
    for (const list of [value.prizes, value.prizeIcons]) {
      w.i32(list.length);
      for (const ref of list) w.ref(ref, { descriptor: true });
    }
  }
  if (subVersion >= 0x9c) {
    w.i32(value.objectives.length);
    for (const o of value.objectives) writeObjective(w, o);
  }
  if (subVersion >= 0xc0) w.i32(0); // decals
  if (subVersion >= 0xc2) w.i32(0); // decorations
  if (subVersion >= 0x9c) w.bool(value.isPrimary);
  if (subVersion >= 0x144) w.bool(value.isInvisible);
  const slots = (list: readonly SlotId[]): void => {
    w.i32(list.length);
    for (const id of list) writeSlotId(w, id);
  };
  if (subVersion >= 0xd0) slots(value.deactivatedInLevels);
  if (subVersion >= 0x10d) slots(value.activatedInLevels);
  if (subVersion >= 0x11e) slots(value.completedInLevels);
  if (subVersion >= 0xf6) w.bool(value.stateUpdateViewed);
  if (subVersion >= 0x141) {
    w.u32(value.key);
    w.u32(value.availabilityDependsUponKey);
  }
  if (subVersion >= 0x168) {
    w.i32(0); // new decorations
    w.i32(0); // new stickers
  }
  if (in157) w.u8(value.dropped157?.byte ?? 0);
  if (subVersion >= 0x17b) w.i32(0); // potentially completed objectives
  return w.done();
}
