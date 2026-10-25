/** `SCRIPT_NAME`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { latin1, Serializer } from '../../io/serializer.ts';

/** `PScriptName`: a length-prefixed blob this reader only has to step over. */
/** `PScriptName`: the name a script refers to the Thing by, as stored. */
export function readScriptName(s: Serializer): string {
  return latin1(s.bytes(s.s32()));
}
