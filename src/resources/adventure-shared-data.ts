/**
 * The adventure shared data -- magic `ADSb`, FileDB paths `….ads`, beside each
 * `.adc` (`popit_puzzle_planet.ads`), which names it in `sharedData`: the
 * adventure's items, its quests and its levels' start points.
 *
 * ❗ cwlib has a resource type for it (`ADVENTURE_SHARED_DATA`) and no class:
 * **the payload is one `AdventureData`**, the struct `RLevel` carries at its
 * end and `RAdventureCreateProfile` inline below subVersion 0x140 -- measured,
 * since all three of the game's end on their last byte with it alone
 * (steering/level-files.md, *Profiles*).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, requireLbp3, type RevisionInfo } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';
import { readAdventureData, writeAdventureData, type AdventureData } from '../things/level.ts';

export interface AdventureSharedData extends AdventureData {
  readonly revision: RevisionInfo;
}

/** Read an `ADSb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readAdventureSharedData(bytes: Uint8Array, inflate: Inflate): Promise<AdventureSharedData> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'ADSb') throw new SerializerError(`not adventure shared data: "${resource.magic}"`);
  requireLbp3(revision);
  const data = readAdventureData(s);
  if (s.remaining !== 0) {
    throw new SerializerError(`ADSb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, ...data };
}

/** `readAdventureData`'s mirror, beside its reader in `things/level.ts`. */
export { writeAdventureData };

/** `readAdventureSharedData`'s mirror: the payload, byte for byte, from the value. */
export function encodeAdventureSharedData(value: AdventureSharedData, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  writeAdventureData(w, value);
  return w.done();
}
