/**
 * `TUTORIALS` -- the tutorial videos the game lists: magic `TUTb`, FileDB paths
 * `gamedata/data/tutorials_beta.tut` and `gamedata_orbis/data/tutorials.tut`.
 * Groups of tutorials, each a video with its title and description.
 *
 * ❗ cwlib has the type and no class. The fields and their order are the eboot's
 * reflective serialisers' -- `RTutorials` `v0xc88960` (`TutorialGroupList`),
 * the group list `v0xcd8130` (`TutorialGroups`), a group `v0xcd84e0`
 * (`NameKey`, `Tutorials`), a tutorial `v0xcd88c0` -- and every object is a
 * reference: an id, then, the first time, the object (steering/level-files.md,
 * *Small resources*).
 *
 * ```
 * ref TutorialGroupList   TutorialGroup[] (refs)
 * ref TutorialGroup       u32 NameKey, Tutorial[] (refs)
 * ref Tutorial            guid LevelGUID, guid VideoGUID, u32 NameKey,
 *                         u32 DescriptionKey, descriptor Image,
 *                         Prerequisites[], Rewards[], guid RewardsGUID, BonusRewards[]
 * ```
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

/**
 * The id each reference read here had in its file, so `encodeTutorials` names
 * it the same (`Writer.reference`): the game does not number in first-mention
 * order. A null group list is kept as id 0 on the empty array returned for it.
 */
const IDS = new WeakMap<object, number>();

/** Read a reference and remember its id: the next `i32`, peeked without consuming it. */
function keepId<T>(s: Serializer, read: () => T | undefined): T | undefined {
  const at = s.position;
  const id = s.i32();
  s.position = at;
  const value = read();
  if (value && typeof value === 'object' && !IDS.has(value)) IDS.set(value, id);
  return value;
}

export interface Tutorial {
  readonly levelGuid: number;
  /** The `.bik` the tutorial plays. */
  readonly videoGuid: number;
  /** LAMS keys: `translate` them with an `RTranslationTable`. */
  readonly nameKey: number;
  readonly descriptionKey: number;
  readonly image?: ResourceRef;
  readonly rewardsGuid: number;
}

export interface TutorialGroup {
  readonly nameKey: number;
  readonly tutorials: readonly (Tutorial | undefined)[];
}

export interface Tutorials {
  readonly revision: RevisionInfo;
  readonly groups: readonly (TutorialGroup | undefined)[];
}

/** An array whose elements no file of the game's has: refused unless empty. */
function emptyArray(s: Serializer, what: string): void {
  const count = s.count();
  if (count !== 0) throw new SerializerError(`a tutorial with ${count} ${what}: not read`);
}

function readTutorial(s: Serializer): Tutorial {
  const levelGuid = s.guid();
  const videoGuid = s.guid();
  const nameKey = s.u32();
  const descriptionKey = s.u32();
  const image = s.resource(true);
  emptyArray(s, 'prerequisites');
  emptyArray(s, 'rewards');
  const rewardsGuid = s.guid();
  emptyArray(s, 'bonus rewards');
  return { levelGuid, videoGuid, nameKey, descriptionKey, image, rewardsGuid };
}

function readGroup(s: Serializer): TutorialGroup {
  const nameKey = s.u32();
  const tutorials = s.array((self) => keepId(self, () => self.reference(readTutorial)));
  return { nameKey, tutorials };
}

/** Read a `TUTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readTutorials(bytes: Uint8Array, inflate: Inflate): Promise<Tutorials> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'TUTb') throw new SerializerError(`not a tutorial list: "${resource.magic}"`);
  const list = keepId(s, () => s.reference((self) => self.array((x) => keepId(x, () => x.reference(readGroup)))));
  if (s.remaining !== 0) throw new SerializerError(`TUTb read ended ${s.remaining} bytes before the end of its payload`);
  if (list) return { revision, groups: list };
  const groups: TutorialGroup[] = [];
  IDS.set(groups, 0);
  return { revision, groups };
}

function writeTutorial(w: Writer, t: Tutorial): void {
  w.guid(t.levelGuid);
  w.guid(t.videoGuid);
  w.u32(t.nameKey);
  w.u32(t.descriptionKey);
  w.ref(t.image, { descriptor: true });
  w.i32(0); // prerequisites
  w.i32(0); // rewards
  w.guid(t.rewardsGuid);
  w.i32(0); // bonus rewards
}

function writeGroup(w: Writer, g: TutorialGroup): void {
  w.u32(g.nameKey);
  w.i32(g.tutorials.length);
  for (const t of g.tutorials) w.reference(t, writeTutorial, t && IDS.get(t));
}

/** `readTutorials`'s mirror: the payload, byte for byte, from the value. */
export function encodeTutorials(value: Tutorials, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const listId = IDS.get(value.groups);
  w.reference(listId === 0 ? undefined : (value.groups as object[]), (x, groups) => {
    x.i32(groups.length);
    for (const g of groups as (TutorialGroup | undefined)[]) x.reference(g, writeGroup, g && IDS.get(g));
  }, listId);
  return w.done();
}
