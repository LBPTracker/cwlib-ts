import { strict as assert } from 'node:assert';
import test from 'node:test';

import { latin1 } from '../src/serializer.ts';

test('latin1 is one character a byte, and stops at a NUL only when asked', () => {
  const bytes = new Uint8Array([0x4d, 0x4d, 0x5f, 0x00, 0x41, 0xe9]);
  assert.equal(latin1(bytes), 'MM_\0Aé');
  assert.equal(latin1(bytes, true), 'MM_');
  assert.equal(latin1(new Uint8Array(4), true), '');
});

test('latin1 reads a string far longer than an argument list may be', () => {
  // `String.fromCharCode(...bytes)` throws a RangeError on this in V8.
  const long = new Uint8Array(1_000_000).fill(0x61);
  assert.equal(latin1(long).length, 1_000_000);
});
