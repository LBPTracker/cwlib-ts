/**
 * The Vita's own parts, at bits 0x27 and 0x28 from parts revisions 0x30 and
 * 0x31 -- where LBP3 has `POPPET_POWERUP` and `POCKET_ITEM`, and cwlib's table
 * has nothing for the Vita (`VITA_PARTS` in `../thing.ts`).
 *
 * ❗ **A reading of our own, and a partial one**: no reader in cwlib or
 * elsewhere to port, and nothing in the files names a field. **12 of the game's
 * 18 levels that carry them read to the payload's last byte with these
 * readers**; the other 6 contradict them somewhere, and do not open
 * (steering/level-files.md, *The Vita branch*). Every field is a width; the
 * comments say what the values looked like, not what they are.
 */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** Bit 0x27: always on a Thing with a `SCRIPT`. */
export function readVita27(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  s.u8(); // 0 or 2
  s.u8(); // 0 to 12, even: a zigzag 0..6, a kind?
  s.wstr(); // a name the creator gave: "Beam 1", "Timer Hand", "Sackboy"
  s.f32();
  s.i32(true); // zero in every one
  s.f32(); // 1.0 in every one
  s.f32(); // 1.0 in every one
  // ⚠️ Two references, or two bytes that read alike: 0 almost always, 1 on a few.
  readThingRef(s, readers);
  readThingRef(s, readers);
}

/** Bit 0x28: always on a Thing with a `SCRIPT` and a `SWITCH`. */
export function readVita28(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  s.u8(); // 0 or 2
  s.u8(); // 2 in every one
  s.u8(); // 0 or 1
  const closed = s.u8(); // 0 or 1: 1 ends the body after the next varint
  s.u8();
  s.u8();
  s.u8();
  s.u32(); // 8 whenever `closed` is 1; up to 11,129,208 otherwise
  if (closed === 0) readThingRef(s, readers); // a Thing, inline when it is first met
}
