/** `SCRIPT_NAME`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PScriptName`: a length-prefixed blob this reader only has to step over. */
export function readScriptName(s: Serializer): void {
  s.skip(s.s32());
}
