/**
 * PSN identities, as the game writes who made something: in a Thing's
 * `PGroup`, a poppet power-up, a slot's author. cwlib's
 * `types/data/NetworkOnlineID.java` and `NetworkPlayerID.java` (ennuo/toolkit
 * `d6a2ef8`).
 *
 * ❗ **The bytes past the handle are not always zero.** The game's own files
 * hold data after the handle's NUL, in the terminator, the padding and the
 * `opt` and `reserved` blocks (the platform, a counter), which the readers
 * below step over: they return the handle. A reader that has to write the id
 * back reads it with `readNetworkOnlineIdKept` or `readNetworkPlayerIdKept`,
 * keeps the `bytes` they return beside the handle in its own struct (a
 * `…Bytes` field, present only where writing the handle afresh would not give
 * them back), and hands them to the writer, which writes them while the handle
 * is the one they hold.
 */

import { latin1, Serializer } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

/** A PSN id read: its handle, and its bytes where writing the handle afresh would not give them back. */
export interface NetworkId {
  readonly handle: string;
  readonly bytes?: Uint8Array;
}

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

/** The id `read` reads, with its bytes where `write` would not give them back from the handle. */
function readKept(s: Serializer, read: (s: Serializer) => string, write: (w: Writer, handle: string) => void): NetworkId {
  const start = s.position;
  const handle = read(s);
  const raw = s.data.subarray(start, s.position);
  const fresh = new Writer(s.revision, s.compressionFlags, raw.length + 16);
  write(fresh, handle);
  const made = fresh.done();
  if (made.length === raw.length && made.every((byte, i) => byte === raw[i])) return { handle };
  return { handle, bytes: raw.slice() };
}

/** `readNetworkOnlineId`, keeping its bytes (`NetworkId`). */
export function readNetworkOnlineIdKept(s: Serializer): NetworkId {
  return readKept(s, readNetworkOnlineId, (w, handle) => writeNetworkOnlineId(w, handle));
}

/** `readNetworkPlayerId`, keeping its bytes (`NetworkId`). */
export function readNetworkPlayerIdKept(s: Serializer): NetworkId {
  return readKept(s, readNetworkPlayerId, (w, handle) => writeNetworkPlayerId(w, handle));
}

/** Whether kept `bytes` read under the writer's revision as exactly `handle`. */
function holds(w: Writer, bytes: Uint8Array, handle: string, read: (s: Serializer) => string): boolean {
  try {
    const s = new Serializer(bytes, w.revision, w.compressionFlags);
    return read(s) === handle && s.remaining === 0;
  } catch {
    return false;
  }
}

/**
 * `readNetworkOnlineId`'s mirror: the handle in 16 bytes, NUL-padded, then the
 * terminator and the three dummy bytes, written 0 as cwlib's defaults are --
 * or `bytes`, the id as read (`readNetworkOnlineIdKept`), while they hold `handle`.
 */
export function writeNetworkOnlineId(w: Writer, handle: string, bytes?: Uint8Array): void {
  if (bytes && holds(w, bytes, handle, readNetworkOnlineId)) {
    w.bytes(bytes);
    return;
  }
  const prefixed = w.revision.version < 0x234;
  if (prefixed) w.i32(16);
  const data = new Uint8Array(16);
  for (let i = 0; i < Math.min(16, handle.length); i += 1) data[i] = handle.charCodeAt(i) & 0xff;
  w.bytes(data);
  w.u8(0); // term
  if (prefixed) w.i32(3);
  w.bytes(new Uint8Array(3)); // dummy
}

/**
 * `readNetworkPlayerId`'s mirror: the handle, then `opt` and `reserved`, eight
 * 0 bytes each -- or `bytes`, the id as read (`readNetworkPlayerIdKept`), while
 * they hold `handle`.
 */
export function writeNetworkPlayerId(w: Writer, handle: string, bytes?: Uint8Array): void {
  if (bytes && holds(w, bytes, handle, readNetworkPlayerId)) {
    w.bytes(bytes);
    return;
  }
  writeNetworkOnlineId(w, handle);
  const prefixed = w.revision.version < 0x234;
  if (prefixed) w.i32(8);
  w.bytes(new Uint8Array(8)); // opt
  if (prefixed) w.i32(8);
  w.bytes(new Uint8Array(8)); // reserved
}

/** An array of ids, each kept: the handles, and their bytes beside them where any id has some. */
export function readNetworkIds(
  s: Serializer,
  player: boolean,
): { handles: string[]; bytes?: (Uint8Array | undefined)[] } {
  const ids = s.array(player ? readNetworkPlayerIdKept : readNetworkOnlineIdKept);
  const handles = ids.map((id) => id.handle);
  return ids.some((id) => id.bytes) ? { handles, bytes: ids.map((id) => id.bytes) } : { handles };
}

/** `readNetworkIds`' mirror: the count, then each id, its bytes as kept while they hold its handle. */
export function writeNetworkIds(
  w: Writer,
  player: boolean,
  handles: readonly string[] | undefined,
  bytes?: readonly (Uint8Array | undefined)[],
): void {
  const list = handles ?? [];
  w.i32(list.length);
  list.forEach((handle, i) => (player ? writeNetworkPlayerId : writeNetworkOnlineId)(w, handle, bytes?.[i]));
}

/**
 * A kept id as its parent struct holds it: the handle under `field`, and its
 * bytes, where it has any, under `field` + `Bytes` -- `{ creatorID, creatorIDBytes }`.
 */
export function keptField<K extends string>(field: K, id: NetworkId): { [P in K]: string } & { [P in `${K}Bytes`]?: Uint8Array } {
  return (id.bytes ? { [field]: id.handle, [`${field}Bytes`]: id.bytes } : { [field]: id.handle }) as never;
}
