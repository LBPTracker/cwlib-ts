/** `ANIMATION`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PAnimation`: a plain animation playing on a Thing. */
export function readAnimation(s: Serializer): void {
  s.resource(); // animation
  s.f32(); // velocity
  s.f32(); // position
}
