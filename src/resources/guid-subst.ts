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

/** cwlib's `Strings.getGUID`: decimal, `0x` hex, either behind a `g`; undefined where it is none. */
function parseGuid(text: string): number | undefined {
  let t = text.replace(/\s/g, '');
  if (t.startsWith('g')) t = t.slice(1);
  const value = /^0x/i.test(t) ? Number.parseInt(t.slice(2), 16) : /^-?\d+$/.test(t) ? Number(t) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * cwlib's other GUID substitution, `RGuidSubst.fromCSV` (ennuo/toolkit
 * `d6a2ef8`): a text of `from,to` lines, whitespace dropped, empty lines and
 * `#` comments skipped -- the form its toolkit ships (`poppet_lbp1.txt`,
 * `gmat_lbp1.txt`, LBP2 GUIDs to LBP1's). A GUID that does not parse is taken
 * as Java takes it, as nothing, and its row dropped. ⚠️ **Ported from Java and
 * proven on no file**: the game ships `GSBt` only.
 */
export function readGuidSubstCsv(text: string): GuidSubstitution[] {
  const out: GuidSubstitution[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s/g, '');
    if (line === '' || line.startsWith('#')) continue;
    const [from, to] = line.split(',').map(parseGuid);
    if (from !== undefined && to !== undefined) out.push({ from, to });
  }
  return out;
}
