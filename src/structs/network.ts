/**
 * PSN identities, as the game writes who made something: in a Thing's
 * `PGroup`, a poppet power-up, a slot's author. cwlib's
 * `types/data/NetworkOnlineID.java` and `NetworkPlayerID.java` (ennuo/toolkit
 * `d6a2ef8`).
 */

import { latin1, type Serializer } from '../io/serializer.ts';
import type { Writer } from '../io/writer.ts';

/**
 * `NetworkOnlineID`: 16 bytes of PSN id, a terminator and three of padding --
 * 20 fixed bytes from version 0x234, the two blocks each length-prefixed
 * below it. Returns the id: up to 16 ASCII characters, NUL-padded.
 */
export function readNetworkOnlineId(s: Serializer): string {
  const prefixed = s.revision.version < 0x234;
  if (prefixed) s.i32(); // 16
  const data = s.bytes(16);
  s.u8(); // term
  if (prefixed) s.i32(); // 3
  s.skip(3); // dummy
  return latin1(data, true);
}

/** `NetworkPlayerID`: an online id and two 8-byte blocks, `opt` and `reserved`. Returns the id. */
export function readNetworkPlayerId(s: Serializer): string {
  const handle = readNetworkOnlineId(s);
  const prefixed = s.revision.version < 0x234;
  if (prefixed) s.i32(); // 8
  s.skip(8); // opt
  if (prefixed) s.i32(); // 8
  s.skip(8); // reserved
  return handle;
}

/**
 * `readNetworkOnlineId`'s mirror: the handle in 16 bytes, NUL-padded, then the
 * terminator and the three dummy bytes, written 0 as cwlib's defaults are.
 */
export function writeNetworkOnlineId(w: Writer, handle: string): void {
  const prefixed = w.revision.version < 0x234;
  if (prefixed) w.i32(16);
  const data = new Uint8Array(16);
  for (let i = 0; i < Math.min(16, handle.length); i += 1) data[i] = handle.charCodeAt(i) & 0xff;
  w.bytes(data);
  w.u8(0); // term
  if (prefixed) w.i32(3);
  w.bytes(new Uint8Array(3)); // dummy
}

/** `readNetworkPlayerId`'s mirror: the handle, then `opt` and `reserved`, eight 0 bytes each. */
export function writeNetworkPlayerId(w: Writer, handle: string): void {
  writeNetworkOnlineId(w, handle);
  const prefixed = w.revision.version < 0x234;
  if (prefixed) w.i32(8);
  w.bytes(new Uint8Array(8)); // opt
  if (prefixed) w.i32(8);
  w.bytes(new Uint8Array(8)); // reserved
}
