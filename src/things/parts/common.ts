/** Helpers more than one part reader uses: a Thing array, and a PSN identity. */

import { latin1, Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** An array of Thing references — cwlib's `thingarray`. */
export function things(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const count = s.count();
  for (let i = 0; i < count; i += 1) readThingRef(s, readers);
}

/**
 * `NetworkPlayerID`: who made this. 36 fixed bytes above version 0x234.
 *
 * `NetworkOnlineID` is 16 bytes of PSN id, a terminator and three of padding;
 * the outer struct adds two 8-byte blocks. Below 0x234 each block is length-
 * prefixed, which this reader never sees.
 */
export function readNetworkPlayerId(s: Serializer): string {
  const data = s.bytes(16); // handle.data
  s.u8(); // handle.term
  s.skip(3); // handle.dummy
  s.skip(8); // opt
  s.skip(8); // reserved
  // A PSN online ID: up to 16 ASCII characters, NUL-padded.
  return latin1(data, true);
}
