/** `EFFECTOR`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/**
 * `PEffector`: the volume physics behaves differently inside — gravity, and
 * water.
 *
 * ❗ **No version gates at all.** cwlib's `PEffector` reads the same nine fields
 * at every revision it knows, so this is correct wherever the walk reaches it
 * rather than correct only in the range `requireLbp3` asserts. Its width is
 * fixed at **46 bytes** under any compression flags, because not one of the nine
 * is an integer and `cf7` only compresses those.
 *
 * ✔ **Exercised by the game's own files**: 164 `EFFECTOR`s in the four FARCs'
 * levels and plans (`dev/things-census.ts`, 2026-10-25), every one inside a
 * file that reads to its last byte. The archive sample's 13 LBP1 ones are all
 * null references, which is why this once said it had never run.
 *
 * ⚠️ **Adding it is also not what unblocked those levels.** They were failing on
 * the *declaration*, in the walk, before the reference was read — see the note
 * beside `UnimplementedPartError` in `src/things/thing.ts`.
 */
export interface EffectorPart {
  readonly posVel: readonly [number, number, number];
  readonly angVel: number;
  readonly viscosity: number;
  readonly density: number;
  /** cwlib's default is (0, -2.7, 0). */
  readonly gravity: readonly [number, number, number];
  readonly pushBack: boolean;
  /** Water: a volume a Sackboy swims in. */
  readonly swimmable: boolean;
  readonly viscosityCheap: number;
  readonly modScale: number;
}

export function readEffector(s: Serializer): EffectorPart {
  return {
    posVel: s.vector3(),
    angVel: s.f32(),
    viscosity: s.f32(),
    density: s.f32(),
    gravity: s.vector3(),
    pushBack: s.bool(),
    swimmable: s.bool(),
    viscosityCheap: s.f32(),
    modScale: s.f32(),
  };
}
