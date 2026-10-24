/**
 * `RQuest` -- a story quest: magic `QSTb`, FileDB paths `gamedata/lbp3/…/quests/….qst`.
 * Its names and texts, a prize and the prize's icon, the objectives, the
 * levels that deactivate, activate and complete it, and its key.
 *
 * ❗ **Read off the game's own files, not off cwlib**, whose
 * `resources/RQuest.java` (ennuo/toolkit `d6a2ef8`) has an empty `serialize`
 * and a comment listing fields. That list gave the names and the order from
 * the prizes on; the five strings before them it does not have. The walk ends
 * on the payload's last byte in all 25 of the game's quests, and each field
 * below says whether its meaning is measured or only its width:
 * steering/level-files.md, *Quests* (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readSlotId, type SlotId } from '../structs/slot.ts';

/** A prize, or its icon: a reference after two integers. */
export interface QuestPrize {
  /**
   * ⚠️ Unmeasured: 0 and 3 in all 50 of the game's prize blocks, so nothing
   * says what either is.
   */
  readonly unknown: readonly [number, number];
  readonly resource: ResourceRef | undefined;
}

export interface QuestObjective {
  /** The LAMS key or the text of the objective (`ZIGGURAT_QUEST_TODO_30`). */
  readonly text: string;
  /** The objective's name (`ZIG_Blueprint`); `Objective ID` where it was never set. */
  readonly id: string;
  /**
   * ⚠️ cwlib's comment's `short count` and `short required`, the widths
   * measured, the meaning not: `count` is 101 on 13 of 35 and as far as 13352
   * and -15317 on others, which no count is; `required` is 0 on all 35.
   */
  readonly count: number;
  readonly required: number;
  readonly hidden: boolean;
  /** What a level's `PQuest` names in `objectiveKey` (`dev/quest-keys.ts`). */
  readonly key: number;
}

export interface Quest {
  readonly revision: RevisionInfo;
  /** The quest's name (`ZIG_Blueprint`); `Quest ID` where it was never set. */
  readonly name: string;
  /** LAMS keys or text: `ZIGGURAT_QUEST_TITLE_30`, `ZIGGURAT_QUEST_DESC_30`. */
  readonly title: string;
  readonly description: string;
  /** The world it belongs to: `THEME_ZIGGURAT`, `Bunkum Lagoon`, `Uncategorised`. */
  readonly area: string;
  /** `Independent!` in all 25. ⚠️ What else it can be is unmeasured. */
  readonly group: string;
  /** A costume plan where there is one: `cos_sack_boy_1.plan`. */
  readonly prize: QuestPrize;
  /** Its icon. ⚠️ No icon GUID of the game's is in the FileDB, so what it names is unmeasured. */
  readonly prizeIcon: QuestPrize;
  readonly objectives: readonly QuestObjective[];
  /**
   * ⚠️ The names from here to `key` are cwlib's comment's and fit the bytes;
   * the bytes do not prove them. `decals` and `decorations` are the counts of
   * two arrays empty in all 25, so their elements are not read.
   */
  readonly isPrimary: boolean;
  readonly isInvisible: boolean;
  /** Developer adventure slots (type 11) in every one the game has. */
  readonly deactivatedInLevels: readonly SlotId[];
  readonly activatedInLevels: readonly SlotId[];
  readonly completedInLevels: readonly SlotId[];
  /** True in all 25. */
  readonly stateUpdateViewed: boolean;
  /** ✔ What a level's `PQuest` names in `questKey`: 292 of the game's 299 non-zero ones (`dev/quest-keys.ts`). */
  readonly key: number;
  /**
   * ⚠️ **What follows the key, unnamed**: one integer at subVersion `0x154` and
   * `0x167`, three at `0x177`, four from `0x1a6`, all zero in all 25. A zero
   * reads alike as an integer, a boolean or an empty array, so only their
   * number is measured.
   */
  readonly trailing: readonly number[];
}

/** The last subVersion whose objectives carry two more bytes: `0x154` has them, `0x167` does not. */
const OBJECTIVE_EXTRA_BEFORE = 0x167;

/** How many integers follow the key, per subVersion as measured; a subVersion between two takes the lower. */
const TRAILING: readonly (readonly [number, number])[] = [[0x1a6, 4], [0x177, 3], [0, 1]];

function readPrize(s: Serializer): QuestPrize {
  return { unknown: [s.i32(), s.i32()], resource: s.resource() };
}

function readObjective(s: Serializer): QuestObjective {
  const text = s.wstr();
  const id = s.wstr();
  const count = s.i16();
  const required = s.i16();
  const hidden = s.bool();
  // ⚠️ Unmeasured: one objective in the game is below 0x167 (`pp01_bridge.qst`, 0x154), and it
  // has `00 00` here. Two bytes is all that is known, and where between 0x154 and 0x167 they go.
  if (s.revision.subVersion < OBJECTIVE_EXTRA_BEFORE && s.i16() !== 0) {
    throw new SerializerError('a quest objective below 0x167 with something in its two extra bytes: unmeasured');
  }
  return { text, id, count, required, hidden, key: s.u32() };
}

/** An array whose elements no file has: refused unless empty. */
function emptyArray(s: Serializer, what: string): void {
  const count = s.count();
  if (count !== 0) throw new SerializerError(`a quest with ${count} ${what}: unmeasured`);
}

/** Read a `QSTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readQuest(bytes: Uint8Array, inflate: Inflate): Promise<Quest> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'QSTb') throw new SerializerError(`not a quest: "${resource.magic}"`);
  const { subVersion } = revision;

  const name = s.wstr();
  const title = s.wstr();
  const description = s.wstr();
  const area = s.wstr();
  const group = s.wstr();
  const prize = readPrize(s);
  const prizeIcon = readPrize(s);
  // ⚠️ Unmeasured: an integer, 0 in all 25.
  if (s.i32() !== 0) throw new SerializerError('a quest with something between its prizes and objectives: unmeasured');
  const objectives = s.array(readObjective);
  emptyArray(s, 'decals');
  emptyArray(s, 'decorations');
  const isPrimary = s.bool();
  const isInvisible = s.bool();
  const deactivatedInLevels = s.array(readSlotId);
  const activatedInLevels = s.array(readSlotId);
  const completedInLevels = s.array(readSlotId);
  const stateUpdateViewed = s.bool();
  const key = s.u32();
  const trailing: number[] = [];
  const count = TRAILING.find(([from]) => subVersion >= from)![1];
  for (let i = 0; i < count; i += 1) trailing.push(s.i32());
  if (trailing.some((v) => v !== 0)) throw new SerializerError(`a quest whose fields after the key are not zero (${trailing.join(', ')}): unmeasured`);

  if (s.remaining !== 0) {
    throw new SerializerError(`QSTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, name, title, description, area, group, prize, prizeIcon, objectives, isPrimary, isInvisible,
    deactivatedInLevels, activatedInLevels, completedInLevels, stateUpdateViewed, key, trailing,
  };
}
