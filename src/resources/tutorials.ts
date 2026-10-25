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
  const tutorials = s.array((self) => self.reference(readTutorial));
  return { nameKey, tutorials };
}

/** Read a `TUTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readTutorials(bytes: Uint8Array, inflate: Inflate): Promise<Tutorials> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'TUTb') throw new SerializerError(`not a tutorial list: "${resource.magic}"`);
  const list = s.reference((self) => self.array((x) => x.reference(readGroup)));
  if (s.remaining !== 0) throw new SerializerError(`TUTb read ended ${s.remaining} bytes before the end of its payload`);
  return { revision, groups: list ?? [] };
}
