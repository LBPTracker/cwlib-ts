/** `WORMHOLE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/**
 * `PWormhole`: the door between two islands.
 *
 * ⚠️ **The second field is gated, and this read it unconditionally.** The
 * game's loader, `v0xd46f20`, reads `ActiveTypeForTwoWayHole` only when the
 * head is `>= 0x1110000`, as cwlib says. Measured on the bytes too: the two
 * wormholes in LBP2 levels #24 and #19883 off Bonsai are exactly eight fields
 * long, and an extra byte would have eaten the next Thing's first one.
 */
export function readWormhole(s: Serializer): void {
  s.s32(); // type
  if (s.revision.subVersion >= 0x111) s.i8(); // activeTypeForTwoWayHole
  s.s32(); // playerMode
  s.bool(); // audioEnabled
  s.bool(); // trigger
  s.bool(); // finished
  s.bool(); // activated
  s.i32(); // exitCount
  s.i32(); // exitDelay
}
