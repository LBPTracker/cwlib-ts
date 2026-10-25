/**
 * `ROutfitList` -- a list of outfits: magic `OUTb`, FileDB paths `….oft`
 * (`pal_thug_costumes.oft`). Each outfit is the costume pieces it is made of,
 * by GUID, and the plan that puts it on.
 *
 * The walk is cwlib's `resources/ROutfitList.java` and
 * `structs/inventory/Outfit.java` (ennuo/toolkit `d6a2ef8`); steering/
 * level-files.md, *Outfit lists*, has what the game's own files prove of it
 * (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

export interface Outfit {
  /** The costume pieces' GUIDs. */
  readonly components: readonly number[];
  readonly outfit?: ResourceRef;
}

export interface OutfitList {
  readonly revision: RevisionInfo;
  readonly outfits: readonly Outfit[];
}

function readOutfit(s: Serializer): Outfit {
  return { components: s.array((x) => x.guid()), outfit: s.resource(true) };
}

/** Read an `OUTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readOutfitList(bytes: Uint8Array, inflate: Inflate): Promise<OutfitList> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'OUTb') throw new SerializerError(`not an outfit list: "${resource.magic}"`);
  const outfits = s.array(readOutfit);
  if (s.remaining !== 0) {
    throw new SerializerError(`OUTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, outfits };
}

/** `readOutfitList`'s mirror: the payload, from the value. */
export function encodeOutfitList(value: OutfitList, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  w.i32(value.outfits.length);
  for (const outfit of value.outfits) {
    w.i32(outfit.components.length);
    for (const guid of outfit.components) w.guid(guid);
    w.ref(outfit.outfit, { descriptor: true });
  }
  return w.done();
}
