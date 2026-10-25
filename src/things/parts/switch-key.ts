/** `SWITCH_KEY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/**
 * `PSwitchKey`: the colour and name of a switch's key.
 *
 * ⚠️ `hideInPlayMode` and `isDummy` swap encodings twice. Below subVersion
 * 0x132 they share one byte and its layout changes again at version 0x3ed --
 * which is *inside* the corpus, so both branches are live here.
 */
/** `PSwitchKey`, kept: a key's colour and name, and whether it shows in play. */
export interface SwitchKeyPart {
  readonly colorIndex: number;
  readonly name: string;
  readonly hideInPlayMode: boolean;
  readonly isDummy: boolean;
}

export function readSwitchKey(s: Serializer): SwitchKeyPart {
  const { version, subVersion } = s.revision;
  const colorIndex = s.s32();
  const name = version >= 0x2dc ? s.wstr() : '';
  let hideInPlayMode = false;
  let isDummy = false;
  if (subVersion < 0x132 && version > 0x1bc) {
    if (version < 0x3ed) hideInPlayMode = s.bool();
    else {
      // hideInPlayMode and isDummy, packed into 0x80 and 0x40
      const packed = s.u8();
      hideInPlayMode = (packed & 0x80) !== 0;
      isDummy = (packed & 0x40) !== 0;
    }
  } else {
    if (version > 0x1bc) hideInPlayMode = s.bool();
    if (subVersion >= 0x132) isDummy = s.bool();
  }
  return { colorIndex, name, hideInPlayMode, isDummy };
}
