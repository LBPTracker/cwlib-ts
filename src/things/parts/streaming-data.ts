/** `STREAMING_DATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PStreamingData`: whether a streamed Thing is currently hidden. */
export function readStreamingData(s: Serializer): void {
  s.i8(); // hidden
  s.i16(); // originator, subVersion > 0xdd
}
