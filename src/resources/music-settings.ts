/**
 * Interactive music settings: magic `MUSt`, text, FileDB paths
 * `gamedata/audio/…/music/*.mus` -- how a track's stems are mixed and faded.
 * Twenty of them, all in the 01.28 update's `patch_001.farc` (the DLC packs'
 * music), none in the 01.00 install. cwlib has no reader for them; the fields
 * are what the files hold, read by `TextResource`:
 *
 * ```
 * MUSt
 * MasterVolume	<number>
 * TrackTranslatedTag	"<LAMS tag>"
 * IsCopyrighted	<bool>
 * IsSting	<bool>                     19 of the 20
 * StereoPairs	<count>
 * 	[i]
 * 		MusicStemTranslatedTag	"<LAMS tag>"
 * 		SliderIndex	<int>
 * 		Fade	FadeIn	FadeOut	ForwardSend	RearSend	<number> each
 * 		Trigger	<bool>
 * ```
 *
 * The meaning is the names': what the game does with a fade or a send is not
 * measured.
 */

import { SerializerError } from '../io/serializer.ts';
import { TextResource } from '../io/text-resource.ts';

export interface MusicStem {
  /** A LAMS tag: `MUSIC_STEM_MELODY`, `_RHYTHM`, `_BASS`, `_DRUMS`… */
  readonly musicStemTranslatedTag: string;
  readonly sliderIndex: number;
  readonly fade: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
  readonly forwardSend: number;
  readonly rearSend: number;
  readonly trigger: boolean;
}

export interface MusicSettings {
  readonly masterVolume: number;
  /** A LAMS tag: the track's name (`VOLCANO_IMUSIC`). */
  readonly trackTranslatedTag: string;
  readonly isCopyrighted: boolean;
  /** Absent from one of the game's twenty. */
  readonly isSting?: boolean;
  readonly stereoPairs: readonly MusicStem[];
}

/** Read a `MUSt`. Throws on anything else, and unless every line is read. */
export function readMusicSettings(bytes: Uint8Array): MusicSettings {
  const t = new TextResource(bytes);
  if (t.magic !== 'MUSt') throw new SerializerError(`not music settings: "${t.magic}"`);
  const masterVolume = t.number(0, 'MasterVolume');
  const trackTranslatedTag = t.string(0, 'TrackTranslatedTag');
  const isCopyrighted = t.bool(0, 'IsCopyrighted');
  const isSting = t.has(0, 'IsSting') ? t.bool(0, 'IsSting') : undefined;
  const stereoPairs = t.array(0, 'StereoPairs', () => ({
    musicStemTranslatedTag: t.string(2, 'MusicStemTranslatedTag'),
    sliderIndex: t.int(2, 'SliderIndex'),
    fade: t.number(2, 'Fade'),
    fadeIn: t.number(2, 'FadeIn'),
    fadeOut: t.number(2, 'FadeOut'),
    forwardSend: t.number(2, 'ForwardSend'),
    rearSend: t.number(2, 'RearSend'),
    trigger: t.bool(2, 'Trigger'),
  }));
  t.end();
  return { masterVolume, trackTranslatedTag, isCopyrighted, ...(isSting === undefined ? {} : { isSting }), stereoPairs };
}
