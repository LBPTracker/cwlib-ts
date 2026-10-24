/** `QUEST`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError } from '../../io/serializer.ts';

/**
 * `PQuest`, as the game's own loader reads it: `v0xdc0290` in `eboot-v128.bin`.
 *
 * ❗ **Read off the eboot, not off cwlib**, which throws on every type but 5.
 * The loader's gates are on the head word and match cwlib's `subVersion` gates
 * one for one (`>= 0x9d0000` is `subVersion > 0x9c`, and so on); the block after
 * them is a jump table on `type - 1` at `v0xdc087c`: type 1 to `v0xdc064b`, 2 to
 * `v0xdc06e6`, 3 and 4 to `v0xdc0613`. Every string goes through the same
 * routine, `v0xbdd2a0`, which is the one `questID` uses.
 *
 * ⚠️ **Type 5 has no block, and anything outside 1..5 is an error in the game
 * too** (`0x7a`, when the per-type data was not allocated and the type is not
 * 5). Every quest measured so far is type 5 at subVersion `0x218`: 47 of them
 * in LBP3 levels off Bonsai, 2026-10-04. The "type 2" that two LBP2 levels
 * seemed to carry was a `PWormhole` read under the wrong mask bit (`partBit` in
 * `thing.ts`); types 1 to 4 have not been seen in a file.
 */
export function readQuest(s: Serializer): void {
  const { subVersion } = s.revision;
  const type = s.i32();
  if (type < 1 || type > 5) throw new SerializerError(`quest type ${type} is not one the game reads`);
  if (subVersion > 0x9c) {
    s.wstr(); // questID
    s.wstr(); // objectiveID
  }
  if (subVersion > 0x140) {
    s.i32(); // questKey
    s.i32(); // objectiveKey
  }
  if (subVersion < 0x52) s.u8();
  if (type === 5 || subVersion < 0x47) return;
  if (type === 1) {
    s.wstr();
    s.wstr();
    s.u8();
    if (subVersion >= 0x5e && subVersion < 0x127) s.u8();
  } else if (type === 2) {
    s.wstr();
  } else {
    s.i32();
    s.wstr();
    s.wstr();
    s.wstr();
  }
}
