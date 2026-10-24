/** Helpers more than one part reader uses: a Thing array; the PSN identity is `structs/network.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** An array of Thing references — cwlib's `thingarray`. */
export function things(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const count = s.count();
  for (let i = 0; i < count; i += 1) readThingRef(s, readers);
}
