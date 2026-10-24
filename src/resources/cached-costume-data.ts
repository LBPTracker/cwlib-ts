/**
 * `RCachedCostumeData` -- the game's costume index: magic `CCDb`,
 * `gamedata/data/cached_costume_data.ccd`. One row per costume piece: its
 * plan, title and description keys, type, colour, icon and value.
 *
 * The walk is cwlib's `resources/RCachedCostumeData.java` (ennuo/toolkit
 * `d6a2ef8`) and a string array it does not read; steering/level-files.md,
 * *The costume index*, has what the game's own file proves of it
 * (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo, type Serializer } from '../io/serializer.ts';

export interface CachedCostume {
  /** The costume piece's plan GUID. */
  readonly plan: number;
  /** LAMS keys. */
  readonly titleKey: number;
  readonly descriptionKey: number;
  readonly type: number;
  readonly subType: number;
  readonly colour: number;
  /** The icon texture's GUID. */
  readonly icon: number;
  readonly value: number;
}

export interface CachedCostumeData {
  readonly revision: RevisionInfo;
  readonly costumes: readonly CachedCostume[];
  /**
   * ⚠️ **Not in cwlib, which stops after `costumes`**: a second array follows,
   * 485 distinct strings of 16 characters in the game's file -- DLC content
   * ids: 478 of them are the `contentId` of a pack in the game's `PCKb`s
   * (`packs.ts`). Without them the payload ends 8,247 bytes early.
   */
  readonly contentIds: readonly string[];
}

function readCostume(s: Serializer): CachedCostume {
  return {
    plan: s.guid(),
    titleKey: s.i32(),
    descriptionKey: s.i32(),
    type: s.i32(),
    subType: s.i32(),
    colour: s.i32(),
    icon: s.guid(),
    value: s.i32(),
  };
}

/** Read a `CCDb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readCachedCostumeData(bytes: Uint8Array, inflate: Inflate): Promise<CachedCostumeData> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'CCDb') throw new SerializerError(`not cached costume data: "${resource.magic}"`);
  const costumes = s.array(readCostume);
  const contentIds = s.array((x) => x.str());
  if (s.remaining !== 0) {
    throw new SerializerError(`CCDb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, costumes, contentIds };
}
