/**
 * `toJson`'s inverse (`src/io/json.ts`, which spells the format): JSON text back
 * to the value it was written from -- `Uint8Array`s, typed arrays of their own
 * classes, `Map`s, `Set`s, `bigint`s, odd floats, `undefined` (JSON's `null`), the
 * fields a reader hid (non-enumerable again), and the graph: every `{ "$ref": n }`
 * is the very object written with `"$id": n`, cycles included.
 *
 * Objects come back plain: a reader's values carry no prototype of their own,
 * and what was under a Symbol was never written. A side store (`registerJsonStore`)
 * must be registered before `fromJson` meets it -- its module imported.
 */

import { fromHex } from './hex.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

type TypedCtor = { new (length: number): ArrayBufferView & { [i: number]: number | bigint }; new (buffer: ArrayBuffer): ArrayBufferView };
const TYPED: Readonly<Record<string, TypedCtor>> = {
  $i8: Int8Array, $u8c: Uint8ClampedArray, $i16: Int16Array, $u16: Uint16Array,
  $i32: Int32Array, $u32: Uint32Array, $f32: Float32Array, $f64: Float64Array,
  $i64: BigInt64Array, $u64: BigUint64Array,
} as unknown as Record<string, TypedCtor>;

/**
 * A side store: data a module keeps beside a value it read -- a `WeakMap` keyed
 * by the value, which no enumeration reaches -- that its encoder needs. A module
 * that registers its store here has it written under `"$stores": { name: … }` on
 * each object it holds an entry for, and put back by `fromJson`.
 */
export interface JsonStore {
  get(object: object): unknown;
  set(object: object, value: unknown): void;
}

const stores = new Map<string, JsonStore>();

/** Carry a module's side store through `toJson` and `fromJson`, under `name`. */
export function registerJsonStore(name: string, store: JsonStore): void {
  stores.set(name, store);
}

/** The side stores registered so far, by name. */
export function jsonStores(): ReadonlyMap<string, JsonStore> {
  return stores;
}

const RESERVED = new Set(['$id', '$hidden', '$stores']);

const unescapeKey = (key: string): string => (key.startsWith('$$') ? key.slice(1) : key);

const isObject = (node: Json): node is JsonObject => node !== null && typeof node === 'object' && !Array.isArray(node);

/** The tag a JSON object is spelled with, or undefined for a plain object. */
function tagOf(node: JsonObject): string | undefined {
  for (const key of Object.keys(node)) {
    if (key.startsWith('$') && !key.startsWith('$$') && !RESERVED.has(key)) return key;
  }
  return undefined;
}

/** Bytes little-endian hex into a float array, through integer words so a NaN keeps its bits. */
function floatsFromHex(ctor: TypedCtor, hex: string): ArrayBufferView {
  const bytes = fromHex(hex);
  const d = new DataView(bytes.buffer);
  if (ctor === (Float32Array as unknown)) {
    const words = new Uint32Array(bytes.length / 4);
    for (let i = 0; i < words.length; i += 1) words[i] = d.getUint32(i * 4, true);
    return new Float32Array(words.buffer);
  }
  const words = new BigUint64Array(bytes.length / 8);
  for (let i = 0; i < words.length; i += 1) words[i] = d.getBigUint64(i * 8, true);
  return new Float64Array(words.buffer);
}

class Decoder {
  private readonly byId = new Map<number, object>();
  private readonly filled = new Set<object>();

  /** Every `$id`'s object made empty first, so a `$ref` before its `$id` resolves too. */
  shells(root: Json): void {
    const stack: Json[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (Array.isArray(node)) {
        for (const v of node) if (v !== null && typeof v === 'object') stack.push(v);
        continue;
      }
      if (!isObject(node)) continue;
      if (typeof node.$id === 'number') this.byId.set(node.$id, this.shell(node));
      for (const v of Object.values(node)) if (v !== null && typeof v === 'object') stack.push(v);
    }
  }

  private shell(node: JsonObject): object {
    const tag = tagOf(node);
    if (tag === undefined) return {};
    if (tag === '$array') return [];
    if (tag === '$map') return new Map();
    if (tag === '$set') return new Set();
    // Typed arrays hold no references: made whole at once.
    return this.leaf(tag, node[tag]);
  }

  private leaf(tag: string, body: Json): object {
    if (tag === '$bytes') return fromHex(body as string);
    const ctor = TYPED[tag];
    if (!ctor) throw new Error(`fromJson: unknown tag ${tag}`);
    if (typeof body === 'string') return floatsFromHex(ctor, body);
    const items = body as (number | string)[];
    const out = new ctor(items.length);
    const big = tag === '$i64' || tag === '$u64';
    for (let i = 0; i < items.length; i += 1) out[i] = big ? BigInt(items[i]) : Number(items[i]);
    return out;
  }

  value(node: Json): unknown {
    if (node === null) return undefined;
    if (typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((v) => this.value(v));
    if ('$ref' in node) {
      const target = this.byId.get(node.$ref as number);
      if (target === undefined) throw new Error(`fromJson: no $id ${String(node.$ref)}`);
      return target;
    }
    const tag = tagOf(node);
    if (tag === '$float') return Number(node.$float);
    if (tag === '$bigint') return BigInt(node.$bigint as string);
    if (tag === '$null') return null;
    const target = typeof node.$id === 'number' ? this.byId.get(node.$id)! : this.shell(node);
    if (this.filled.has(target)) return target;
    this.filled.add(target);
    if (tag === undefined) {
      const out = target as Record<string, unknown>;
      for (const [k, v] of Object.entries(node)) {
        if (RESERVED.has(k)) continue;
        out[unescapeKey(k)] = this.value(v);
      }
    } else if (tag === '$array') {
      const out = target as unknown[];
      for (const v of node.$array as Json[]) out.push(this.value(v));
    } else if (tag === '$map') {
      for (const [k, v] of node.$map as [Json, Json][]) (target as Map<unknown, unknown>).set(this.value(k), this.value(v));
    } else if (tag === '$set') {
      for (const v of node.$set as Json[]) (target as Set<unknown>).add(this.value(v));
    }
    if (isObject(node.$hidden ?? null)) {
      for (const [k, v] of Object.entries(node.$hidden as JsonObject)) {
        Object.defineProperty(target, unescapeKey(k), { value: this.value(v), enumerable: false, writable: true, configurable: true });
      }
    }
    if (isObject(node.$stores ?? null)) {
      for (const [name, v] of Object.entries(node.$stores as JsonObject)) {
        const store = stores.get(name);
        if (!store) throw new Error(`fromJson: no store ${name} registered`);
        store.set(target, this.value(v));
      }
    }
    return target;
  }
}

/** The value `toJson` wrote this text from. */
export function fromJson(text: string): unknown {
  const root = JSON.parse(text) as Json;
  const decoder = new Decoder();
  decoder.shells(root);
  return decoder.value(root);
}
