/** `TRANSITION`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * `PTransition`: the doorway between two islands of a streaming level.
 *
 * Every island in an LBP3 adventure carries one, so this is the part that stood
 * between the reader and 2,553 islands of streamed level.
 */
/** `PTransition`, kept: a door's colour, label and state. */
export interface TransitionPart {
  readonly colorIndex: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly showColor: boolean;
  readonly playAudio: boolean;
}

export function readTransition(s: Serializer): TransitionPart {
  const { subVersion } = s.revision;
  const colorIndex = s.s32();
  if (subVersion <= 0xf) s.i32();
  const label = subVersion >= 0x1a ? s.wstr() : '';
  const enabled = subVersion > 0x18 ? s.bool() : true;
  if (subVersion >= 0x14e && subVersion < 0x156) s.i32();
  let showColor = false;
  let playAudio = false;
  if (subVersion > 0x17c) {
    showColor = s.bool();
    playAudio = s.bool();
  }
  return { colorIndex, label, enabled, showColor, playAudio };
}

/** `readTransition`'s mirror; the discarded words are written as 0. */
export function writeTransition(w: Writer, v: TransitionPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.s32(v.colorIndex);
  if (subVersion <= 0xf) w.i32(0);
  if (subVersion >= 0x1a) w.wstr(v.label);
  if (subVersion > 0x18) w.bool(v.enabled);
  if (subVersion >= 0x14e && subVersion < 0x156) w.i32(0);
  if (subVersion > 0x17c) {
    w.bool(v.showColor);
    w.bool(v.playAudio);
  }
}
