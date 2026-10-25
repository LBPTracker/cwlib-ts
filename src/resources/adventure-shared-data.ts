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
import { writeSlotId } from '../structs/slot.ts';
import { readAdventureData, type AdventureData } from '../things/level.ts';

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

/**
 * `readAdventureData`'s mirror (its reader is `things/level.ts`'s). ⚠️ Below
 * subVersion 0xae an item carries four values that reader drops; they are
 * written 0, as cwlib writes them -- none of the game's files is that old.
 */
export function writeAdventureData(w: Writer, data: AdventureData): void {
  const { subVersion } = w.revision;
  if (subVersion > 0xaf) w.i32(data.fixedId);
  if (subVersion > 0x93) {
    w.i32(data.itemPuidCounter);
    w.i32(data.items.length);
    for (const item of data.items) {
      w.i32(item.puid);
      w.ref(item.plan, { descriptor: true });
      if (subVersion < 0xae) {
        w.u16(0);
        w.u8(0);
        w.f32(0);
        w.i32(0);
      }
      if (subVersion > 0xbe) w.i32(item.flags);
      if (subVersion > 0xe0) w.i32(item.iconPuid);
    }
  }
  if (subVersion > 0xa6) {
    w.i32(data.quests.length);
    for (const quest of data.quests) w.ref(quest, { descriptor: true });
  }
  if (subVersion >= 0xd1) {
    w.i32(data.startPoints.length);
    for (const point of data.startPoints) {
      writeSlotId(w, point.slot);
      w.i32(point.ids.length);
      for (const id of point.ids) {
        w.wstr(id.name);
        w.i32(id.id);
      }
    }
  }
}

/** `readAdventureSharedData`'s mirror: the payload, byte for byte, from the value. */
export function encodeAdventureSharedData(value: AdventureSharedData, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  writeAdventureData(w, value);
  return w.done();
}
