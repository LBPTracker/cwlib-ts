/** `TAG_SYNCHRONIZER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PTagSynchroniser` -- a tag, as the crossplay levels use them. cwlib's `PTagSynchroniser.java`. */
/** `PTagSynchroniser`, kept: the tag's kind, colour, name and reach. */
export interface TagSynchronizerPart {
  readonly type: number;
  readonly colorIndex: number;
  readonly name: string;
  readonly radius: number;
  readonly minRadius: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly useLayers: boolean;
  readonly visible: boolean;
}

export function readTagSynchroniser(s: Serializer): TagSynchronizerPart {
  return {
    type: s.s32(),
    colorIndex: s.s32(),
    name: s.revision.version >= 0x2dc ? s.wstr() : '',
    radius: s.f32(),
    minRadius: s.f32(),
    scaleX: s.f32(),
    scaleY: s.f32(),
    useLayers: s.bool(),
    visible: s.bool(),
  };
}
