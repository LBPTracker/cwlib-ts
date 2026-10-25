/** `STREAMING_DATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PStreamingData`: whether a streamed Thing is currently hidden. */
export interface StreamingDataPart {
  readonly hidden: number;
  readonly originator: number;
}

export function readStreamingData(s: Serializer): StreamingDataPart {
  const hidden = s.i8();
  const originator = s.i16(); // subVersion > 0xdd
  return { hidden, originator };
}

/** `readStreamingData`'s mirror. */
export function writeStreamingData(w: Writer, v: StreamingDataPart, _ctx: PartWriteContext): void {
  w.i8(v.hidden);
  w.i16(v.originator);
}
