/** `STREAMING_DATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

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
