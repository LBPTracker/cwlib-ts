/** `TRANSITION`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/**
 * `PTransition`: the doorway between two islands of a streaming level.
 *
 * Every island in an LBP3 adventure carries one, so this is the part that stood
 * between the reader and 2,553 islands of streamed level.
 */
export function readTransition(s: Serializer): void {
  const { subVersion } = s.revision;
  s.s32(); // colorIndex
  if (subVersion <= 0xf) s.i32();
  if (subVersion >= 0x1a) s.wstr(); // label
  if (subVersion > 0x18) s.bool(); // enabled
  if (subVersion >= 0x14e && subVersion < 0x156) s.i32();
  if (subVersion > 0x17c) {
    s.bool(); // showColor
    s.bool(); // playAudio
  }
}
