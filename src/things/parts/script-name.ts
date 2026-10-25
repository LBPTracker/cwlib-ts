/** `SCRIPT_NAME`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { latin1, Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PScriptName`: the name a script refers to the Thing by, as stored. */
export function readScriptName(s: Serializer): string {
  return latin1(s.bytes(s.s32()));
}

/** `readScriptName`'s mirror: the length as an `s32`, then the bytes. */
export function writeScriptName(w: Writer, name: string, _ctx: PartWriteContext): void {
  w.s32(name.length);
  const bytes = new Uint8Array(name.length);
  for (let i = 0; i < name.length; i += 1) bytes[i] = name.charCodeAt(i) & 0xff;
  w.bytes(bytes);
}
