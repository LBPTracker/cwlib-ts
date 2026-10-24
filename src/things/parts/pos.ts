/** `POS`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/**
 * `PPos`: where the Thing is, and whose bone it is.
 *
 * Returns `worldPosition`, so `thing.parts.get('POS')` is the 4x4 itself. It is
 * kept rather than stepped over because a component on an **open** circuit board
 * has no stored board cell -- see `boardCell` below, which is how one is
 * recovered.
 *
 * Column-major, as cwlib's `m44` hands the 16 floats straight to JOML's
 * `Matrix4f.set(float[])`: element 12..14 is the translation, and 0..2 / 4..6 /
 * 8..10 are the basis columns.
 */
export function readPos(s: Serializer, readers: ReadonlyMap<string, PartReader>): Float32Array {
  readThingRef(s, readers); // thingOfWhichIAmABone
  s.i32(); // animHash
  // Below 0x341 the local matrix is STORED as well; from 0x341 the game keeps
  // only the world one and regenerates the local. The old comment here said
  // "localPosition is regenerated above 0x341", which is true and was written as
  // if it were true everywhere -- so every pre-0x341 Thing was read 64 bytes
  // short. cwlib `PPos.serialize`.
  if (s.revision.version < 0x341) s.skipMatrix(); // localPosition
  return s.matrix(); // worldPosition
}
