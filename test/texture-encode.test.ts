import { strict as assert } from 'node:assert';
import test from 'node:test';

import { nodeDeflate, nodeInflate } from '../src/platform/node.ts';
import { inflateChunkTable } from '../src/io/resource.ts';
import { compressBc } from '../src/resources/texture-encode-bc.ts';
import {
  encodeImageTexture, mipChain, textureFromImage, toBump, type ImageTextureOptions,
} from '../src/resources/texture-encode.ts';
import { decodeLevel, readTexture, writeTexture } from '../src/resources/texture.ts';

/**
 * The headers are cwlib's own bytes: `Images.toGTF` and `Images.toTEX` run from
 * the toolkit's `sequencerdump-0.1.jar` (cwlib `bb79e81`, jsquish) on the same
 * image, and their headers copied here. The blocks are not Squish's, so they
 * are judged by error; `dev/texture-encode-census.ts` does the same over the
 * game's textures.
 */

/** The image the Java run was given: 128 x 128, alpha rising to the right. */
function alphaRamp(): Uint8Array {
  const out = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) out.set([200, Math.round(100 + y / 2), 50, Math.min(255, x * 2)], (y * 128 + x) * 4);
  }
  return out;
}

function image(w: number, h: number, f: (x: number, y: number) => number[]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out.set(f(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * w + x) * 4);
  return out;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

function psnr(a: Uint8Array, b: Uint8Array, channels: number[]): number {
  let sse = 0;
  for (let i = 0; i < a.length; i += 4) for (const c of channels) sse += (a[i + c] - b[i + c]) ** 2;
  return sse === 0 ? Infinity : 10 * Math.log10((255 * 255 * (a.length / 4) * channels.length) / sse);
}

async function cwlibFile(options: Omit<ImageTextureOptions, 'layout'>): Promise<{ file: Uint8Array; payload: Uint8Array }> {
  const file = await encodeImageTexture(alphaRamp(), 128, 128, { ...options, layout: 'cwlib' }, nodeDeflate);
  const payload = (await inflateChunkTable(file, options.container === 'GTF ' ? 0x1c : 4, nodeInflate)).data;
  return { file, payload };
}

test("a GTF's CellGcmTexture is the one cwlib's toGTF writes", async () => {
  // Images.toGTF(image, DXT1, noSRGB false, mips true) and (DXT5, true, false).
  assert.equal(hex((await cwlibFile({ format: 'DXT1', container: 'GTF ', mipmaps: true })).file.subarray(0, 0x1c)),
    '47544620860802000000aae400800080000100000000000000000000');
  assert.equal(hex((await cwlibFile({ format: 'DXT5', container: 'GTF ', noSRGB: true })).file.subarray(0, 0x1c)),
    '47544620880102000000aae400800080000100010000000000000000');
});

test("a TEX's DDS header and footer are the ones cwlib's toTEX writes", async () => {
  const mips = await cwlibFile({ format: 'DXT5', container: 'TEX ', mipmaps: true });
  assert.equal(hex(mips.payload.subarray(0, 0x80)), '444453207c00000007100200800000008000000000000000000000000800000000000000'
    + '00000000000000000000000000000000000000000000000000000000000000000000000000000000200000000400000044585435'
    + '00000000000000000000000000000000000000000810400000000000000000000000000000000000');
  assert.equal(mips.payload.length, 22004);
  // Without noSRGB cwlib ends the DDS in four zero bytes; with it, `BUMP`.
  assert.equal(hex(mips.payload.subarray(-4)), '00000000');
  const bump = await cwlibFile({ format: 'DXT3', container: 'TEX ', noSRGB: true });
  assert.equal(hex(bump.payload.subarray(0, 0x80)), '444453207c00000007100000800000008000000000000000000000000100000000000000'
    + '00000000000000000000000000000000000000000000000000000000000000000000000000000000200000000400000044585433'
    + '00000000000000000000000000000000000000000010000000000000000000000000000000000000');
  assert.equal(bump.payload.length, 16516);
  assert.equal(hex(bump.payload.subarray(-4)), '42554d50');
});

test("cwlib's GTF chain is not padded; the game's is, to 128 bytes", async () => {
  // 128 x 128 DXT1 to 1 x 1: 8192 + 2048 + 512 + 128 + 32 + 8 + 8 + 8 bytes.
  assert.equal((await cwlibFile({ format: 'DXT1', container: 'GTF ', mipmaps: true })).payload.length, 10936);
  const game = await encodeImageTexture(alphaRamp(), 128, 128, { format: 'DXT1', container: 'GTF ', mipmaps: true }, nodeDeflate);
  assert.equal((await inflateChunkTable(game, 0x1c, nodeInflate)).data.length, 11008);
});

test('the game layout reads back, every level where it should be', async () => {
  const src = alphaRamp();
  for (const format of ['DXT1', 'DXT3', 'DXT5', 'RGBA8'] as const) {
    for (const container of ['GTF ', 'TEX '] as const) {
      for (const noSRGB of [false, true]) {
        const options = { format, container, noSRGB, mipmaps: true };
        const file = await encodeImageTexture(src, 128, 128, options, nodeDeflate);
        const t = await readTexture(file, nodeInflate);
        assert.equal(t.magic, container);
        assert.equal(t.format, { DXT1: 'bc1', DXT3: 'bc2', DXT5: 'bc3', RGBA8: 'rgba8' }[format]);
        assert.equal(t.mipCount, 8);
        assert.equal(t.bump, noSRGB);
        assert.deepEqual(t.levels[0].map((l) => l.width), [128, 64, 32, 16, 8, 4, 2, 1]);
        // Each level is the one textureFromImage made.
        const value = textureFromImage(src, 128, 128, options);
        t.levels[0].forEach((level, mip) => assert.deepEqual(level.data, value.levels[0][mip].data, `${format} ${container} mip ${mip}`));
        // A GTF from textureFromImage is the same file through writeTexture.
        if (container === 'GTF ') assert.deepEqual(await writeTexture(value, nodeDeflate), file);
      }
    }
  }
});

test("the game layout's TEX header is the game's: a linear size and no level count for one level", async () => {
  const one = await encodeImageTexture(alphaRamp(), 128, 128, { format: 'DXT1', container: 'TEX ' }, nodeDeflate);
  const dds = (await inflateChunkTable(one, 4, nodeInflate)).data;
  const view = new DataView(dds.buffer, dds.byteOffset);
  assert.equal(view.getUint32(8, true), 0x81007);
  assert.equal(view.getUint32(20, true), 32 * 32 * 8);
  assert.equal(view.getUint32(28, true), 0);
  assert.equal(dds.length, 0x80 + 32 * 32 * 8);
});

test('RGBA8 comes back exactly, swizzled in a GTF and as ARGB words in a TEX', async () => {
  const src = image(64, 32, (x, y) => [x * 4, y * 8, (x ^ y) * 3, 255 - x]);
  for (const container of ['GTF ', 'TEX '] as const) {
    const t = await readTexture(await encodeImageTexture(src, 64, 32, { format: 'RGBA8', container }, nodeDeflate), nodeInflate);
    assert.deepEqual(t.levels[0][0].data, src);
  }
});

test('the DXT fit: smooth images close, flat ones exact, re-encoding what it decoded lossless', () => {
  // R, G and B each run their own way, so no block's colours lie on a line: 34.8 dB
  // (38.4 uniform) when measured, the 1 dB below that a margin.
  const smooth = image(64, 64, (x, y) => [x * 4, y * 4, 128 + 60 * Math.sin(x / 9), 255 - x * 2]);
  for (const format of ['bc1', 'bc2', 'bc3'] as const) {
    const fit = (metric: 'perceptual' | 'uniform'): Uint8Array =>
      decodeLevel(format, { width: 64, height: 64, depth: 1, data: compressBc(smooth, 64, 64, format, { metric }) });
    const once = fit('perceptual');
    const uniform = fit('uniform');
    assert.ok(psnr(once, smooth, [0, 1, 2]) > 33.8, `${format} RGB ${psnr(once, smooth, [0, 1, 2])}`);
    assert.ok(psnr(uniform, smooth, [0, 1, 2]) > 37.4, `${format} RGB, uniform ${psnr(uniform, smooth, [0, 1, 2])}`);
    // The perceptual metric spends its error on blue to keep green.
    assert.ok(psnr(once, smooth, [1]) > psnr(uniform, smooth, [1]) + 5);
    if (format === 'bc2') assert.ok(psnr(once, smooth, [3]) > 34, `alpha ${psnr(once, smooth, [3])}`);
    // Alpha falling by 2 a texel, 4 values a block, DXT5 holds exactly.
    if (format === 'bc3') assert.equal(psnr(once, smooth, [3]), Infinity);
    const twice = decodeLevel(format, { width: 64, height: 64, depth: 1, data: compressBc(once, 64, 64, format) });
    assert.ok(psnr(twice, once, [0, 1, 2, 3]) > 60, `${format} second pass ${psnr(twice, once, [0, 1, 2, 3])}`);
  }
  // One colour: the single-colour fit's pair, within a level of it in every channel.
  const flat = image(8, 8, () => [77, 140, 201, 255]);
  const back = decodeLevel('bc1', { width: 8, height: 8, depth: 1, data: compressBc(flat, 8, 8, 'bc1') });
  for (let i = 0; i < back.length; i += 4) for (let c = 0; c < 3; c += 1) assert.ok(Math.abs(back[i + c] - flat[i + c]) <= 1);
});

test('DXT1 keeps alpha as a bit: under 128 is transparent, black, the rest opaque', () => {
  const src = image(8, 4, (x) => [200, 120, 40, x < 4 ? 20 : 200]);
  const back = decodeLevel('bc1', { width: 8, height: 4, depth: 1, data: compressBc(src, 8, 4, 'bc1') });
  for (let i = 0; i < 32; i += 1) {
    const clear = i % 8 < 4;
    assert.deepEqual([...back.subarray(i * 4, i * 4 + 4)].map((v, c) => (c === 3 ? v : clear ? v : Math.abs(v - src[i * 4 + c]) <= 4 ? -1 : v)),
      clear ? [0, 0, 0, 0] : [-1, -1, -1, 255]);
  }
});

test('blocks the image cuts short, 1 x 1 and 2 x 2, are fitted to what is inside', () => {
  const tiny = image(2, 2, (x, y) => [x * 255, y * 255, 100, 255]);
  assert.equal(compressBc(tiny, 2, 2, 'bc3').length, 16);
  const one = image(1, 1, () => [10, 20, 30, 40]);
  const back = decodeLevel('bc3', { width: 1, height: 1, depth: 1, data: compressBc(one, 1, 1, 'bc3') });
  assert.equal(back[3], 40);
  for (let c = 0; c < 3; c += 1) assert.ok(Math.abs(back[c] - one[c]) <= 2);
});

test("cwlib's sizes: sides scaled down to a power of two, mipmaps halved until a side is 1", () => {
  assert.deepEqual(mipChain(new Uint8Array(300 * 200 * 4), 300, 200, false).map((l) => [l.width, l.height]), [[256, 128]]);
  assert.deepEqual(mipChain(new Uint8Array(256 * 64 * 4), 256, 64, true).map((l) => [l.width, l.height]),
    [[256, 64], [128, 32], [64, 16], [32, 8], [16, 4], [8, 2], [4, 1]]);
  // Halving is the 2 x 2 mean.
  const [, half] = mipChain(Uint8Array.from([0, 0, 0, 0, 10, 20, 30, 40, 100, 100, 100, 100, 2, 2, 2, 2]), 2, 2, true);
  assert.deepEqual([...half.rgba], [28, 31, 33, 36]);
});

test("toBump: a normal map's texels to (G, G, G, R); a grey first texel leaves it be", () => {
  assert.deepEqual([...toBump(Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80]), 2, 1)], [20, 20, 20, 10, 60, 60, 60, 50]);
  assert.deepEqual([...toBump(Uint8Array.from([9, 9, 9, 40, 50, 60, 70, 80]), 2, 1)], [9, 9, 9, 40, 50, 60, 70, 80]);
});
