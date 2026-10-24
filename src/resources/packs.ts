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
import { readSlot, type Slot } from '../structs/slot.ts';

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
