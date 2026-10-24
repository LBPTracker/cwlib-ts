import { strict as assert } from 'node:assert';
import test from 'node:test';

import { toHex } from '../src/hex.ts';

test('toHex spells every byte as two lower-case digits', () => {
  assert.equal(toHex(new Uint8Array([0, 1, 0x0f, 0x10, 0xab, 0xff])), '00010f10abff');
  assert.equal(toHex(new Uint8Array(0)), '');
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(toHex(all), [...all].map((b) => b.toString(16).padStart(2, '0')).join(''));
});
