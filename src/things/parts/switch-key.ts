/** `SWITCH_KEY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  /**
   * The byte `hideInPlayMode` was read from, where it is a plain bool that is
   * neither 0 nor 1 (2 on four keys of `base_001.farc` `644e3290`): only it
   * writes the part back as it was.
   */
  readonly hideInPlayModeByte?: number;
  /**
   * The packed byte (version 0x3ed on, below subVersion 0x132) where it holds
   * bits besides 0x80 and 0x40 -- 0x01 on keys of `chunk1_001.farc` `37c915bb`:
   * those bits are written back as they were.
   */
  readonly packedByte?: number;
}

export function readSwitchKey(s: Serializer): SwitchKeyPart {
  const { version, subVersion } = s.revision;
  const colorIndex = s.s32();
  const name = version >= 0x2dc ? s.wstr() : '';
  let hideInPlayMode = false;
  let isDummy = false;
  let hideByte = 0;
  let packedByte: number | undefined;
  if (subVersion < 0x132 && version > 0x1bc) {
    if (version < 0x3ed) {
      hideByte = s.u8();
      hideInPlayMode = hideByte !== 0;
    }
    else {
      // hideInPlayMode and isDummy, packed into 0x80 and 0x40
      const packed = s.u8();
      if ((packed & ~0xc0) !== 0) packedByte = packed;
      hideInPlayMode = (packed & 0x80) !== 0;
      isDummy = (packed & 0x40) !== 0;
    }
  } else {
    if (version > 0x1bc) {
      hideByte = s.u8();
      hideInPlayMode = hideByte !== 0;
    }
    if (subVersion >= 0x132) isDummy = s.bool();
  }
  return {
    colorIndex, name, hideInPlayMode, isDummy,
    ...(hideByte > 1 ? { hideInPlayModeByte: hideByte } : {}),
    ...(packedByte !== undefined ? { packedByte } : {}),
  };
}

/** `readSwitchKey`'s mirror; the packed byte as cwlib writes it, `0x80` and `0x40`. */
export function writeSwitchKey(w: Writer, v: SwitchKeyPart, _ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  w.s32(v.colorIndex);
  if (version >= 0x2dc) w.wstr(v.name ?? '');
  if (subVersion < 0x132 && version > 0x1bc) {
    if (version < 0x3ed) w.u8(v.hideInPlayMode ? (v.hideInPlayModeByte ?? 1) : 0);
    else w.u8(((v.packedByte ?? 0) & ~0xc0) | (v.hideInPlayMode ? 0x80 : 0) | (v.isDummy ? 0x40 : 0));
  } else {
    if (version > 0x1bc) w.u8(v.hideInPlayMode ? (v.hideInPlayModeByte ?? 1) : 0);
    if (subVersion >= 0x132) w.bool(v.isDummy);
  }
}
