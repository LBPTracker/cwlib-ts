import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { fromJson, registerJsonStore } from '../src/io/from-json.ts';
import { toJson } from '../src/io/json.ts';
import { loadResource } from '../src/io/resource.ts';
import { nodeInflate } from '../src/platform/node.ts';
import { encodeLevel } from '../src/things/encode-things.ts';
import { readLevel } from '../src/things/level.ts';

/** `fromJson(toJson(x))` is `x`: src/io/json.ts, src/io/from-json.ts. */
const FIXTURES = process.env.LBP_FIXTURES ?? path.join(import.meta.dirname, '..', '..', 'lbptracker', 'fixtures');
const ASCETIC = path.join(FIXTURES, 'levels', 'ascetic.lvl');

const back = <T>(value: T): T => fromJson(toJson(value)) as T;

test('typed arrays come back as their own classes, odd floats as themselves', () => {
  const nan = new Float32Array(2);
  new Uint32Array(nan.buffer)[1] = 0x7fc00001; // a NaN with a payload
  const value = {
    bytes: Uint8Array.of(1, 255), clamped: Uint8ClampedArray.of(9), i8: Int8Array.of(-3), i16: Int16Array.of(-1, 2),
    u16: Uint16Array.of(65535), i32: Int32Array.of(-7), u32: Uint32Array.of(0xffffffff), f32: Float32Array.of(0.1, -0, Infinity),
    f64: Float64Array.of(Math.PI), i64: BigInt64Array.of(-(2n ** 62n)), u64: BigUint64Array.of(2n ** 64n - 1n), nan,
    negativeZero: -0, notANumber: NaN, big: 2n ** 70n, set: new Set([1, 'a']), map: new Map<unknown, unknown>([[{ k: 1 }, [2]]]),
  };
  const again = back(value);
  for (const [key, v] of Object.entries(value)) {
    if (ArrayBuffer.isView(v)) assert.equal((again as unknown as Record<string, object>)[key].constructor, v.constructor, key);
  }
  assert.deepEqual(again, value);
  assert.ok(Object.is(again.negativeZero, -0));
  assert.ok(Object.is(again.f32[1], -0));
  assert.equal(new Uint32Array(again.nan.buffer)[1], 0x7fc00001);
});

test('a graph keeps its identity: shared objects, cycles, a Thing named twice', () => {
  const layout = { fields: ['a'] };
  const thing: Record<string, unknown> = { uid: 3, parts: new Map() };
  const child = { uid: 4, parts: new Map(), parent: thing };
  thing.children = [child, child];
  const list = [layout, layout];
  const value = { first: layout, list, again: list, thing };
  const again = back(value);
  assert.equal(again.list[0], again.first);
  assert.equal(again.list[1], again.first);
  assert.equal(again.again, again.list);
  const children = (again.thing as { children: { parent: unknown }[] }).children;
  assert.equal(children[0], children[1]);
  assert.equal(children[0].parent, again.thing);
  // A Thing's reference keeps its uid beside the id.
  assert.match(toJson(value), /\{"\$ref":\d+,"uid":4\}/);
});

test('hidden fields come back hidden; undefined, null and $-keys as they were', () => {
  const matrix = Float32Array.of(1, 2);
  Object.defineProperties(matrix, { mask: { value: 3 }, animHash: { value: 9 } });
  const things: unknown[] = [];
  Object.defineProperty(things, 'world', { value: { tail: Uint8Array.of(7) } });
  const value = { matrix, things, there: undefined, real: null, $dollar: 1, list: [undefined, 1] };
  const again = back(value) as typeof value & { matrix: { mask: number; animHash: number }; things: { world: { tail: Uint8Array } } };
  assert.equal(again.matrix.mask, 3);
  assert.equal(again.matrix.animHash, 9);
  assert.ok(!Object.keys(again.matrix).includes('mask'));
  assert.deepEqual(again.things.world.tail, Uint8Array.of(7));
  assert.ok(!Object.keys(again.things).includes('world'));
  assert.ok('there' in again && again.there === undefined);
  assert.equal(again.real, null);
  assert.equal(again.$dollar, 1);
  assert.deepEqual(again.list, [undefined, 1]);
});

test('a registered side store is carried under $stores', () => {
  const store = new WeakMap<object, Uint8Array>();
  registerJsonStore('test.raw', { get: (o) => store.get(o), set: (o, v) => store.set(o, v as Uint8Array) });
  const value = { name: 'kept' };
  store.set(value, Uint8Array.of(0xab));
  const again = back({ value }).value;
  assert.deepEqual(store.get(again), Uint8Array.of(0xab));
});

test("ascetic.lvl through JSON encodes to the payload it was read from", async (t) => {
  if (!existsSync(ASCETIC)) return t.skip(`no ${ASCETIC}`);
  const bytes = new Uint8Array(await readFile(ASCETIC));
  const resource = await loadResource(bytes, nodeInflate);
  const parse = await readLevel(bytes, nodeInflate);
  if (parse.unreadTail !== undefined) return t.skip('ascetic.lvl does not read whole');
  const header = { revision: resource.revisionInfo, compressionFlags: resource.compressionFlags };
  const again = back(parse);
  assert.deepEqual(encodeLevel(again, header), resource.data);
});
