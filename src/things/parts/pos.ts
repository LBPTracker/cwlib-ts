/** `POS`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

/**
 * The rest of `PPos` (cwlib `PPos.java`): whose bone the Thing is, and which of
 * its skeleton's bones. Carried on the matrix rather than beside it -- see `PosPart`.
 */
export interface PosBone {
  /** The Thing whose skeleton this one rides as a bone, where it does. */
  readonly thingOfWhichIAmABone: Thing | undefined;
  /**
   * cwlib's `animHash`: which bone of `thingOfWhichIAmABone`'s mesh the Thing
   * rides, as `MeshBone.animHash` names it -- an `i32`, as there; 0 for none.
   * ❗ Not a GUID (steering/level-files.md, *Dependencies rewritten*).
   */
  readonly animHash: number;
}

/**
 * `thing.parts.get('POS')`: the world matrix, a `Float32Array` of 16 as it
 * always was, with `PosBone`'s two fields on it as **non-enumerable**
 * properties -- so every renderer, comparison and JSON dump that reads the
 * matrix sees the same 16 floats, and a reader that wants the bone has it.
 */
export type PosPart = Float32Array & PosBone;

/** Put a bone on a matrix, as `readPos` does: what `setWorldPosition` keeps when it moves a Thing. */
export function withBone(matrix: Float32Array, bone: PosBone): PosPart {
  return Object.defineProperties(matrix, {
    thingOfWhichIAmABone: { value: bone.thingOfWhichIAmABone, enumerable: false },
    animHash: { value: bone.animHash, enumerable: false },
  }) as PosPart;
}

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
export function readPos(s: Serializer, readers: ReadonlyMap<string, PartReader>): PosPart {
  const thingOfWhichIAmABone = readThingRef(s, readers);
  const animHash = s.i32();
  // Below 0x341 the local matrix is STORED as well; from 0x341 the game keeps
  // only the world one and regenerates the local. The old comment here said
  // "localPosition is regenerated above 0x341", which is true and was written as
  // if it were true everywhere -- so every pre-0x341 Thing was read 64 bytes
  // short. cwlib `PPos.serialize`.
  if (s.revision.version < 0x341) s.skipMatrix(); // localPosition
  return withBone(s.mark('worldPosition', (self) => self.matrix()), { thingOfWhichIAmABone, animHash });
}
