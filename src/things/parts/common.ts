/** Helpers more than one part reader uses: a Thing array; the PSN identity is `structs/network.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** An array of Thing references — cwlib's `thingarray`. */
export function things(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const count = s.count();
  for (let i = 0; i < count; i += 1) readThingRef(s, readers);
}

/**
 * Whether `playerMode` -- the last byte of `PSwitch`, `PSwitchInput` and
 * `PControlinator` -- is in the stream. cwlib has it from version 0x3ed.
 *
 * ⚠️ **Measured, and not monotonic**: the game's 27 crossplay plans at 0x3eb
 * (`gamedata/lbp2/dlc/crossplay/`) carry it -- 22 of them read only with it --
 * and the 11 plans at 0x3ec in the PS3 saves read only without it. Every 0x3eb
 * resource there is that carries one of these parts is crossplay, so whether
 * it is the version or the crossplay build is not known
 * (steering/level-files.md, *`playerMode` at 0x3eb*).
 */
export function hasPlayerMode(version: number): boolean {
  return version > 0x3ec || version === 0x3eb;
}
