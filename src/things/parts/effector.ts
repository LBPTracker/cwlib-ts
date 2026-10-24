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
 * ⚠️ **UNEXERCISED, and that is measured rather than suspected.** `EFFECTOR`
 * appears in 13 of the archive sample's 19 LBP1 levels and **all 13 are a null
 * reference** — one byte of id and no body. This function has never run. It is
 * a faithful port and it is not a tested one; the first file that carries a real
 * effector is what would settle it, and 103 archive levels do not contain one.
 *
 * ⚠️ **Adding it is also not what unblocked those levels.** They were failing on
 * the *declaration*, in the walk, before the reference was read — see the note
 * beside `UnimplementedPartError` in `src/thing.ts`.
 */
export function readEffector(s: Serializer): void {
  s.skipVector3(); // posVel
  s.f32(); // angVel
  s.f32(); // viscosity
  s.f32(); // density
  s.skipVector3(); // gravity, defaulting to (0, -2.7, 0)
  s.bool(); // pushBack
  s.bool(); // swimmable
  s.f32(); // viscosityCheap
  s.f32(); // modScale
}
