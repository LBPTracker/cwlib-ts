/** Helpers more than one part reader uses: a Thing array; the PSN identity is `structs/network.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** An array of Thing references — cwlib's `thingarray`. */
export function things(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  thingArray(s, readers);
}

/** A Thing array, as references: what `things` reads, kept. */
export function thingArray(s: Serializer, readers: ReadonlyMap<string, PartReader>): (Thing | undefined)[] {
  const count = s.count();
  const out: (Thing | undefined)[] = [];
  for (let i = 0; i < count; i += 1) out.push(readThingRef(s, readers));
  return out;
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

/** `thingArray`'s mirror: a count, then each Thing as a reference. */
export function writeThingArray(w: Writer, ctx: PartWriteContext, things: readonly (Thing | undefined)[] | undefined): void {
  w.i32(things?.length ?? 0);
  for (const thing of things ?? []) ctx.thing(w, thing);
}
