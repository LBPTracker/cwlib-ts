/**
 * `RPins` -- the game's pin definitions: magic `PINb`, `gamedata/data/pins.pin`.
 * One record per pin (LBP's in-game achievements): what it counts, the target
 * that awards it, its title, description and icon, and the trophy it unlocks.
 *
 * The walk is cwlib's `resources/RPins.java` and `structs/profile/Pin.java`
 * (ennuo/toolkit `d6a2ef8`); steering/level-files.md, *Pins*, has what the
 * game's own file proves of it (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

export interface Pin {
  readonly id: number;
  readonly progressType: number;
  readonly category: number;
  /** LAMS keys into the game's translation tables. */
  readonly titleLamsKey: number;
  readonly descriptionLamsKey: number;
  readonly icon?: ResourceRef;
  readonly initialProgressValue: number;
  readonly targetValue: number;
  readonly trophyToUnlock: number;
  readonly behaviourFlags: number;
  /** Version `0x3f7` on; 0 before. */
  readonly trophyToUnlockLBP1: number;
}

export interface Pins {
  readonly revision: RevisionInfo;
  readonly pins: readonly Pin[];
}

function readPin(s: Serializer): Pin {
  return {
    id: s.u32(),
    progressType: s.u32(),
    category: s.u32(),
    titleLamsKey: s.u32(),
    descriptionLamsKey: s.u32(),
    icon: s.resource(true),
    initialProgressValue: s.u32(),
    targetValue: s.u32(),
    trophyToUnlock: s.i8(),
    behaviourFlags: s.i16(),
    trophyToUnlockLBP1: s.revision.version >= 0x3f7 ? s.i8() : 0,
  };
}

/** Read a `PINb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readPins(bytes: Uint8Array, inflate: Inflate): Promise<Pins> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'PINb') throw new SerializerError(`not pins: "${resource.magic}"`);
  const pins = s.array(readPin);
  if (s.remaining !== 0) {
    throw new SerializerError(`PINb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, pins };
}

/** `readPins`'s mirror: the payload, from the value. */
export function encodePins(value: Pins, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  w.i32(value.pins.length);
  for (const pin of value.pins) {
    w.u32(pin.id);
    w.u32(pin.progressType);
    w.u32(pin.category);
    w.u32(pin.titleLamsKey);
    w.u32(pin.descriptionLamsKey);
    w.ref(pin.icon, { descriptor: true });
    w.u32(pin.initialProgressValue);
    w.u32(pin.targetValue);
    w.i8(pin.trophyToUnlock);
    w.i16(pin.behaviourFlags);
    if (header.revision.version >= 0x3f7) w.i8(pin.trophyToUnlockLBP1);
  }
  return w.done();
}
