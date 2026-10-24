/** `SWITCH_KEY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/**
 * `PSwitchKey`: the colour and name of a switch's key.
 *
 * ⚠️ `hideInPlayMode` and `isDummy` swap encodings twice. Below subVersion
 * 0x132 they share one byte and its layout changes again at version 0x3ed --
 * which is *inside* the corpus, so both branches are live here.
 */
export function readSwitchKey(s: Serializer): void {
  const { version, subVersion } = s.revision;
  s.s32(); // colorIndex
  if (version >= 0x2dc) s.wstr(); // name
  if (subVersion < 0x132 && version > 0x1bc) {
    if (version < 0x3ed) s.bool(); // hideInPlayMode
    else s.u8(); // hideInPlayMode and isDummy, packed into 0x80 and 0x40
  } else {
    if (version > 0x1bc) s.bool(); // hideInPlayMode
    if (subVersion >= 0x132) s.bool(); // isDummy
  }
}
