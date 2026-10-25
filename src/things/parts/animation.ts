/** `ANIMATION`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * `PAnimation`: the animation a Thing plays, and where in it it is.
 *
 * ⚠️ **Empty in every one the game has**: all 783 over the story chunks and the
 * FARCs' levels hold a null reference and two zeros (2026-10-25). What a Thing
 * plays is not here in the game's own files.
 */
export interface AnimationPart {
  /** The `RAnimation` (`ANMb`) -- `readAnimation` in `resources/animation.ts` reads it. */
  readonly animation?: ResourceRef;
  /** cwlib's names; their units are not measured. */
  readonly velocity: number;
  readonly position: number;
}

export function readAnimation(s: Serializer): AnimationPart {
  const animation = s.resource();
  const velocity = s.f32();
  const position = s.f32();
  return { animation, velocity, position };
}

/** `readAnimation`'s mirror. */
export function writeAnimation(w: Writer, value: AnimationPart, _ctx: PartWriteContext): void {
  w.ref(value.animation);
  w.f32(value.velocity);
  w.f32(value.position);
}
