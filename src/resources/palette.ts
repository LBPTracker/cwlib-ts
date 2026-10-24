/**
 * `RPalette` -- a palette, a page of the popit: magic `PALb`, FileDB paths
 * `….pal` (`lbp3_sequencer_instruments.pal`). The plans it offers, its place,
 * its description, and from version `0x323` the plans converted from older
 * games' palettes.
 *
 * The walk is cwlib's `resources/RPalette.java` (ennuo/toolkit `d6a2ef8`);
 * steering/level-files.md, *Palettes*, has what the game's own files prove of
 * it (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';

export interface Palette {
  readonly revision: RevisionInfo;
  /** The plans on the page; `undefined` where the file holds a null reference. */
  readonly plans: readonly (ResourceRef | undefined)[];
  readonly location: number;
  /** A LAMS key. */
  readonly description: number;
  /**
   * Version `0x323` on (cwlib's `PALETTE_CONVERTED_PLANS`); empty before.
   *
   * ⚠️ **Each entry is two descriptors, not one as cwlib reads it**: a hash,
   * then a GUID. Measured on the one palette of the game's 178 whose list is
   * not empty (`pal_unthemed_toys_vehicles_palette.pal`, `0x3b4`): six pairs
   * fill the payload to its last byte, where six single descriptors leave 75
   * bytes. Which of the two is the converted plan is not known.
   */
  readonly convertedPlans: readonly (readonly [ResourceRef | undefined, ResourceRef | undefined])[];
}

/** Read a `PALb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readPalette(bytes: Uint8Array, inflate: Inflate): Promise<Palette> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'PALb') throw new SerializerError(`not a palette: "${resource.magic}"`);
  const plans = s.array((x) => x.resource());
  const location = s.i32();
  const description = s.i32();
  const convertedPlans = revision.version >= 0x323
    ? s.array((x) => [x.resource(true), x.resource(true)] as const)
    : [];
  if (s.remaining !== 0) {
    throw new SerializerError(`PALb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, plans, location, description, convertedPlans };
}
