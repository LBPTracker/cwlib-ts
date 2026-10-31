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
 * ❗ **At 0x3eb the Thing's parts revision says, not the version.** The game's
 * crossplay plans at 0x3eb (`gamedata/lbp2/dlc/crossplay/`) carry it on Things
 * of parts revision 0x3a -- 22 read only with it -- and the archive's 1,567 0x3eb
 * levels and plans that failed read only without it, on Things of parts
 * revision 0x2f: every switch from 0x3e2 to 0x3ec has 0x2f, every one from
 * 0x3ee 0x3a or more. Nothing at 0x3eb sits between the two
 * (steering/level-files.md, *`playerMode` at 0x3eb*).
 */
export function hasPlayerMode(version: number, partsRevision: number | undefined): boolean {
  return version > 0x3ec || (version === 0x3eb && (partsRevision ?? 0) >= PLAYER_MODE_PARTS);
}

/** The parts revision of the 0x3eb crossplay Things that carry `playerMode`. */
export const PLAYER_MODE_PARTS = 0x3a;

/**
 * `hasPlayerMode` for a writer, which has the part's value and not its Thing:
 * at 0x3eb the byte is written where the reader found one.
 */
export function writesPlayerMode(version: number, playerMode: number | undefined): boolean {
  return version > 0x3ec || (version === 0x3eb && playerMode !== undefined);
}

/** `thingArray`'s mirror: a count, then each Thing as a reference. */
export function writeThingArray(w: Writer, ctx: PartWriteContext, things: readonly (Thing | undefined)[] | undefined): void {
  w.i32(things?.length ?? 0);
  for (const thing of things ?? []) ctx.thing(w, thing);
}
