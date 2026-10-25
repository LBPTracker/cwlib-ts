import { strict as assert } from 'node:assert';
import { inflateSync } from 'node:zlib';
import test from 'node:test';

import { encodePng } from '../src/io/png.ts';
import { nodeDeflate } from '../src/platform/node.ts';

/** A PNG read back chunk by chunk: each CRC checked, the IDAT inflated. src/io/png.ts. */
test('a PNG holds its pixels behind filter 0, every chunk with its CRC', async () => {
  const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => i * 7);
  const png = await encodePng(3, 2, rgba, nodeDeflate);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const crc = new Uint32Array(1);
    crc[0] = 0xffffffff;
    for (const b of png.subarray(at + 4, at + 8 + length)) {
      crc[0] ^= b;
      for (let k = 0; k < 8; k += 1) crc[0] = crc[0] & 1 ? 0xedb88320 ^ (crc[0] >>> 1) : crc[0] >>> 1;
    }
    assert.equal(view.getUint32(at + 8 + length), (crc[0] ^ 0xffffffff) >>> 0, `${type} CRC`);
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([...chunks[0].data], [0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
  const raw = new Uint8Array(inflateSync(chunks[1].data));
  assert.deepEqual([...raw], [0, ...rgba.subarray(0, 12), 0, ...rgba.subarray(12)]);
  await assert.rejects(encodePng(4, 4, rgba, nodeDeflate), /4×4 PNG/);
});
