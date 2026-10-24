/** `TAG_SYNCHRONIZER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PTagSynchroniser` -- a tag, as the crossplay levels use them. cwlib's `PTagSynchroniser.java`. */
export function readTagSynchroniser(s: Serializer): void {
  s.s32(); // type
  s.s32(); // colorIndex
  if (s.revision.version >= 0x2dc) s.wstr(); // name
  s.f32(); // radius
  s.f32(); // minRadius
  s.f32(); // scaleX
  s.f32(); // scaleY
  s.bool(); // useLayers
  s.bool(); // visible
}
