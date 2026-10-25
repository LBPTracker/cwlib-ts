/** `STREAMING_HINT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray } from './common.ts';

/**
 * `PStreamingHint`: the volume that asks for a chunk to be streamed in.
 *
 * ⚠️ **`connected` is `things`, not `references(readThingRef)`.** The second
 * reads a reference id and then calls a builder that reads *another* one, so
 * every element cost two ids instead of one -- and the whole corpus missed it
 * because `connected` is empty in every file of it, so the loop never ran. It
 * took a level out of the public archive with a single connected Thing to
 * expose it: measured on `8b904be1`, the array's count is 1 at byte 120322, its
 * one id is read at 120323, and the extra read then ate the next Thing's `0xaa`.
 */
/** `PStreamingHint`, kept: a box the streamer loads ahead of, and what it is tied to. */
export interface StreamingHintPart {
  readonly type: number;
  readonly offset: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly relativeToThing?: Thing;
  readonly connected: readonly (Thing | undefined)[];
}

export function readStreamingHint(s: Serializer, readers: ReadonlyMap<string, PartReader>): StreamingHintPart {
  const type = s.i32();
  const offset = s.vector3();
  const size = s.vector3();
  const relativeToThing = readThingRef(s, readers);
  const connected = thingArray(s, readers);
  return { type, offset, size, relativeToThing, connected };
}
