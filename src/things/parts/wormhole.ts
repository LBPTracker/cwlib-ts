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
export interface WormholePart {
  /** cwlib's `WormholeType`. */
  readonly type: number;
  readonly playerMode: number;
  readonly audioEnabled: boolean;
  readonly activated: boolean;
  readonly trigger: boolean;
  readonly finished: boolean;
  readonly exitCount: number;
  readonly exitDelay: number;
  readonly activeTypeForTwoWayHole?: number;
}

export function readWormhole(s: Serializer): WormholePart {
  let activeTypeForTwoWayHole: number | undefined;
  const type = s.s32();
  if (s.revision.subVersion >= 0x111) activeTypeForTwoWayHole = s.i8();
  const playerMode = s.s32();
  const audioEnabled = s.bool();
  const trigger = s.bool();
  const finished = s.bool();
  const activated = s.bool();
  const exitCount = s.i32();
  const exitDelay = s.i32();
  return {
    type, playerMode, audioEnabled, activated, trigger, finished, exitCount, exitDelay,
    activeTypeForTwoWayHole,
  };
}
