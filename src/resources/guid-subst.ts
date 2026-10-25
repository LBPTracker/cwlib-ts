/**
 * `RGuidSubst` as the game ships it: magic `GSBt`, text, FileDB paths
 * `….gsub` -- the dialogue's subtitles per language (`audio/dialogue_*.gsub`),
 * and swaps of one resource for another (`data/gmat.gsub`, the creatures'
 * costumes). Read by `TextResource`; what the files prove is
 * steering/level-files.md, *Text resources*.
 *
 * ```
 * GSBt
 * Substitutions	<count>
 * 	[i]
 * 		From.guid	<guid>
 * 		To.guid	<guid>
 * ```
 */

import { SerializerError } from '../io/serializer.ts';
import { TextResource } from '../io/text-resource.ts';

export interface GuidSubstitution {
  readonly from: number;
  readonly to: number;
}

/** Read a `GSBt`. Throws on anything else, and unless every line is read. */
export function readGuidSubst(bytes: Uint8Array): GuidSubstitution[] {
  const t = new TextResource(bytes);
  if (t.magic !== 'GSBt') throw new SerializerError(`not a text GUID substitution: "${t.magic}"`);
  const substitutions = t.array(0, 'Substitutions', () => ({
    from: t.int(2, 'From.guid'),
    to: t.int(2, 'To.guid'),
  }));
  t.end();
  return substitutions;
}
