/**
 * Anything a reader here returns, as JSON text -- the counterpart of cwlib's
 * `gson/` converters in the one direction this library can go: its readers'
 * objects out, not Java's classes, and not back in (that needs a writer for
 * every resource, steering/java-parity.md, *Writing*).
 *
 * What JSON cannot hold is spelled so it can be read back by eye and by code:
 * a byte buffer (`Uint8Array`) as `{ "$bytes": "<hex>" }`, any other typed
 * array as a plain array of its numbers, a `Map` as `{ "$map": [[key, value], …] }`,
 * a `bigint` as `{ "$bigint": "<decimal>" }`, and a float that is no number
 * (NaN, ±Infinity) as `{ "$float": "NaN" }` -- the game's files hold some.
 * A Thing graph is a graph: a Thing seen twice is written once, then as
 * `{ "$ref": <its uid> }`, so a level's cycles end.
 */

import { toHex } from './hex.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function encode(value: unknown, seen: Set<object>): Json {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : { $float: String(value) };
    case 'bigint':
      return { $bigint: value.toString() };
    case 'function':
    case 'symbol':
      return null;
    default:
      break;
  }
  if (value instanceof Uint8Array) return { $bytes: toHex(value) };
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>, (v) => encode(v, seen));
  }
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [encode(k, seen), encode(v, seen)]) };
  if (value instanceof Set) return [...value].map((v) => encode(v, seen));
  const object = value as Record<string, unknown>;
  // A Thing: its uid and parts; a second sighting is a reference.
  if (typeof object.uid === 'number' && object.parts instanceof Map) {
    if (seen.has(object)) return { $ref: object.uid };
    seen.add(object);
  } else if (seen.has(object)) {
    return { $ref: null };
  } else {
    seen.add(object);
  }
  const out: Json = Array.isArray(value)
    ? value.map((v) => encode(v, seen))
    : Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v, seen)]));
  if (!(typeof object.uid === 'number' && object.parts instanceof Map)) seen.delete(object);
  return out;
}

/** JSON text for a reader's result; `indent` as `JSON.stringify` takes it. */
export function toJson(value: unknown, indent?: number | string): string {
  return JSON.stringify(encode(value, new Set()), null, indent);
}
