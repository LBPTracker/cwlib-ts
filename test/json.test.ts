import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { toJson } from '../src/io/json.ts';
import { nodeInflate } from '../src/platform/node.ts';
import { readThings } from '../src/things/level.ts';

/** A reader's result as JSON. src/io/json.ts. */
const FIXTURES = process.env.LBP_FIXTURES ?? path.join(import.meta.dirname, '..', '..', 'lbptracker', 'fixtures');
const ASCETIC = path.join(FIXTURES, 'levels', 'ascetic.lvl');

test('what JSON cannot hold is spelled out, and an object seen twice is a reference to its $id', () => {
  const thing: Record<string, unknown> = { uid: 7, parts: new Map([['POS', Float32Array.of(1, 0.5)]]) };
  thing.parent = thing;
  const value = {
    bytes: Uint8Array.of(0xde, 0xad), ints: Int16Array.of(-1, 2), map: new Map([[1, 'a']]),
    big: 2n ** 60n, nan: NaN, gone: undefined, thing,
  };
  assert.deepEqual(JSON.parse(toJson(value)), {
    bytes: { $bytes: 'dead' }, ints: { $i16: [-1, 2] }, map: { $map: [[1, 'a']] },
    big: { $bigint: '1152921504606846976' }, nan: { $float: 'NaN' }, gone: null,
    thing: { $id: 0, uid: 7, parts: { $map: [['POS', { $f32: [1, 0.5] }]] }, parent: { $ref: 0, uid: 7 } },
  });
});

test("ascetic.lvl's Things go to JSON and back as text", async (t) => {
  if (!existsSync(ASCETIC)) return t.skip(`no ${ASCETIC}`);
  const { things } = await readThings(new Uint8Array(await readFile(ASCETIC)), nodeInflate);
  // The world's Things are its WORLD part too, and carry the rest of PWorld out of sight.
  const root = JSON.parse(toJson(things)) as { $id: number; $array: unknown[]; $hidden: { world: unknown } };
  assert.ok(root.$hidden.world);
  const parsed = root.$array;
  assert.equal(parsed.length, things.length);
  const placed = parsed.filter((x) => (x as { parts?: { $map?: [string, unknown][] } } | null)?.parts?.$map?.some(([k]) => k === 'POS')).length;
  assert.ok(placed > 0);
});
