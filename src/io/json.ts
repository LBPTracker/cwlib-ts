/**
 * Anything a reader here returns, as JSON text, and back (`fromJson`,
 * `src/io/from-json.ts`) -- the counterpart of cwlib's `gson/` converters for
 * this library's own objects, not Java's classes: a value that went to JSON and
 * back encodes to the same bytes as the value it came from
 * (`dev/json-census.ts`).
 *
 * What JSON cannot hold is spelled as a tag object, so it reads back by eye and
 * by code:
 *
 * - a byte buffer (`Uint8Array`) as `{ "$bytes": "<hex>" }`;
 * - any other typed array as its numbers under a tag naming its class --
 *   `$i8 $u8c $i16 $u16 $i32 $u32 $f32 $f64`, and `$i64 $u64` (decimal
 *   strings) -- an element that is no JSON number (NaN, ±Infinity, -0) as the
 *   string `Number` reads back; a float array holding a NaN whose bits are not
 *   the canonical one is its bytes instead, little-endian hex;
 * - a `Map` as `{ "$map": [[key, value], …] }`, a `Set` as `{ "$set": […] }`;
 * - a `bigint` as `{ "$bigint": "<decimal>" }`, a float no JSON number holds
 *   (NaN, ±Infinity, -0) as `{ "$float": "NaN" }` -- the game's files hold some;
 * - `undefined` as `null`, a field's too -- a field there and undefined is told
 *   from one not there (`'hash' in ref`), as some writers do -- and a real `null`,
 *   which no reader returns, as `{ "$null": true }`.
 *
 * **A graph stays a graph.** An object mentioned more than once -- a Thing its
 * children name as parent, a script's layout, a shape a contact names -- carries
 * `"$id": n` where it is first written and is `{ "$ref": n }` at every later
 * mention (a Thing's reference keeps its `uid` beside it, to be read by eye). An
 * array that needs an id or hidden fields is wrapped: `{ "$id": n, "$array": […] }`.
 *
 * **What is out of sight is carried too.** A reader hides some fields as
 * non-enumerable properties so comparisons and renderers see only the value: a
 * `PosPart`'s bone on its matrix, the stored mask of a compressed matrix, a
 * mesh's, a texture's and a static mesh's stored bytes, a `WorldPart`'s
 * `world`. An object's own non-enumerable string-keyed data properties are
 * written under `"$hidden": { … }`, and `fromJson` puts them back out of sight.
 * A module's `WeakMap` beside its values -- the reference id each object was
 * read under, a slot's boolean bytes, the part a value was read as -- is
 * registered (`registerJsonStore`, `src/io/from-json.ts`), and each object it
 * holds an entry for carries `"$stores": { "<name>": … }`. ⚠️ Symbol-keyed
 * properties are never written, so no reader keeps what it must write back
 * under one.
 *
 * A real key beginning with `$` is written with a second `$` in front.
 */

import { jsonStores } from './from-json.ts';
import { toHex } from './hex.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A typed array's tag in JSON, by its class name. `Uint8Array` is `$bytes`. */
export const TYPED_TAGS: Readonly<Record<string, string>> = {
  Int8Array: '$i8', Uint8ClampedArray: '$u8c', Int16Array: '$i16', Uint16Array: '$u16',
  Int32Array: '$i32', Uint32Array: '$u32', Float32Array: '$f32', Float64Array: '$f64',
  BigInt64Array: '$i64', BigUint64Array: '$u64',
};

/** A number JSON cannot hold as itself, as the string `Number` reads back. */
function odd(n: number): string | undefined {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (n === 0 && 1 / n < 0) return '-0';
  return undefined;
}

/** A `$`-led key gets a second `$`, so tags and real keys never meet. */
const escapeKey = (key: string): string => (key.startsWith('$') ? '$' + key : key);

/** Own non-enumerable string-keyed data properties: what a reader hid. */
function hiddenOf(object: object): [string, unknown][] {
  const out: [string, unknown][] = [];
  const isArray = Array.isArray(object);
  for (const key of Object.getOwnPropertyNames(object)) {
    if (isArray && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(object, key)!;
    if (d.enumerable || !('value' in d) || typeof d.value === 'function') continue;
    out.push([key, d.value]);
  }
  return out;
}

const isThing = (o: Record<string, unknown>): boolean => typeof o.uid === 'number' && o.parts instanceof Map;

/** The objects the value reaches more than once: those that get an `$id`. */
function sharedOf(root: unknown): Set<object> {
  const seen = new Set<object>();
  const twice = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) {
      twice.add(value);
      continue;
    }
    seen.add(value);
    for (const [, v] of hiddenOf(value)) stack.push(v);
    for (const store of jsonStores().values()) stack.push(store.get(value));
    if (ArrayBuffer.isView(value)) continue;
    if (value instanceof Map) {
      for (const [k, v] of value) stack.push(k, v);
    } else if (value instanceof Set || Array.isArray(value)) {
      for (const v of value) stack.push(v);
    } else {
      for (const v of Object.values(value)) stack.push(v);
    }
  }
  return twice;
}

const CANONICAL_NAN32 = new Uint32Array(Float32Array.of(NaN).buffer)[0];
const CANONICAL_NAN64 = new BigUint64Array(Float64Array.of(NaN).buffer)[0];

/** A float array's bytes little-endian, NaN payloads and all. */
function floatBytes(view: Float32Array | Float64Array): Uint8Array {
  const out = new Uint8Array(view.byteLength);
  const d = new DataView(out.buffer);
  const size = view.BYTES_PER_ELEMENT;
  // Through integer views, never through a float: a float read can quiet a NaN.
  if (view instanceof Float32Array) {
    const words = new Uint32Array(view.buffer, view.byteOffset, view.length);
    for (let i = 0; i < words.length; i += 1) d.setUint32(i * size, words[i], true);
  } else {
    const words = new BigUint64Array(view.buffer, view.byteOffset, view.length);
    for (let i = 0; i < words.length; i += 1) d.setBigUint64(i * size, words[i], true);
  }
  return out;
}

/** Whether a float array holds a NaN with other bits than the canonical one. */
function oddNaN(view: Float32Array | Float64Array): boolean {
  if (view.byteOffset % view.BYTES_PER_ELEMENT !== 0) return false;
  if (view instanceof Float32Array) {
    const words = new Uint32Array(view.buffer, view.byteOffset, view.length);
    for (let i = 0; i < view.length; i += 1) if (Number.isNaN(view[i]) && words[i] !== CANONICAL_NAN32) return true;
  } else {
    const words = new BigUint64Array(view.buffer, view.byteOffset, view.length);
    for (let i = 0; i < view.length; i += 1) if (Number.isNaN(view[i]) && words[i] !== CANONICAL_NAN64) return true;
  }
  return false;
}

class Encoder {
  private readonly ids = new Map<object, number>();
  private readonly shared: Set<object>;
  constructor(shared: Set<object>) {
    this.shared = shared;
  }

  value(value: unknown): Json {
    if (value === undefined) return null;
    if (value === null) return { $null: true };
    switch (typeof value) {
      case 'boolean':
      case 'string':
        return value;
      case 'number': {
        const s = odd(value);
        return s === undefined ? value : { $float: s };
      }
      case 'bigint':
        return { $bigint: value.toString() };
      case 'function':
      case 'symbol':
        return null; // undefined, as a reader never returns them
      default:
        break;
    }
    const object = value as Record<string, unknown>;
    const id = this.ids.get(object);
    if (id !== undefined) return isThing(object) ? { $ref: id, uid: object.uid as number } : { $ref: id };
    const out: { [key: string]: Json } = {};
    if (this.shared.has(object)) {
      const n = this.ids.size;
      this.ids.set(object, n);
      out.$id = n;
    }
    if (value instanceof Uint8Array) out.$bytes = toHex(value);
    else if (ArrayBuffer.isView(value)) {
      const tag = TYPED_TAGS[value.constructor.name];
      if (!tag) throw new Error(`toJson: no tag for ${value.constructor.name}`);
      out[tag] = this.typed(value);
    } else if (value instanceof Map) out.$map = [...value].map(([k, v]) => [this.value(k), this.value(v)]);
    else if (value instanceof Set) out.$set = [...value].map((v) => this.value(v));
    else if (Array.isArray(value)) out.$array = value.map((v) => this.value(v));
    else for (const [k, v] of Object.entries(object)) out[escapeKey(k)] = this.value(v);
    const hidden = hiddenOf(object);
    if (hidden.length > 0) out.$hidden = Object.fromEntries(hidden.map(([k, v]) => [escapeKey(k), this.value(v)]));
    const kept: { [key: string]: Json } = {};
    for (const [name, store] of jsonStores()) {
      const v = store.get(object);
      if (v !== undefined) kept[name] = this.value(v);
    }
    if (Object.keys(kept).length > 0) out.$stores = kept;
    // An array with nothing beside it is the plain JSON array.
    if (Array.isArray(value) && Object.keys(out).length === 1) return out.$array as Json[];
    return out;
  }

  private typed(view: ArrayBufferView): Json {
    if (view instanceof BigInt64Array || view instanceof BigUint64Array) return Array.from(view, (v) => v.toString());
    if ((view instanceof Float32Array || view instanceof Float64Array) && oddNaN(view)) return toHex(floatBytes(view));
    return Array.from(view as unknown as ArrayLike<number>, (v) => odd(v) ?? v);
  }
}

/** JSON text for a reader's result; `indent` as `JSON.stringify` takes it. `fromJson` reads it back. */
export function toJson(value: unknown, indent?: number | string): string {
  return JSON.stringify(new Encoder(sharedOf(value)).value(value), null, indent);
}

export { fromJson } from './from-json.ts';
