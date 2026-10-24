import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc, type Farc } from '../src/farc.ts';
import { readFileDB } from '../src/filedb.ts';
import { decodeLevel, readTexture, TextureFormatError, type TextureLevel } from '../src/texture.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

/**
 * The game's own files are Sony's and never committed -- see lbptracker's
 * `steering/game-assets.md`. `LBP_GAME` is an installed LBP3 PS4 build; without
 * it the game tests skip. `dev/texture-census.ts` is the same over all 32,914
 * textures in its four FARCs.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';

const noInflate = (): Uint8Array => {
  throw new Error('a stored chunk is not inflated');
};

/** A chunk table holding `payload` as one stored chunk. */
function stored(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, 1, false);
  view.setUint16(2, 1, false);
  view.setUint16(4, payload.length, false);
  view.setUint16(6, payload.length, false);
  out.set(payload, 8);
  return out;
}

function gtf(format: number, width: number, height: number, remap: number, payload: Uint8Array): Uint8Array {
  const head = new Uint8Array(0x1c);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode('GTF '), 0);
  head[4] = format;
  head[5] = 1; // one mip
  head[6] = 2;
  view.setUint32(8, remap, false);
  view.setUint16(12, width, false);
  view.setUint16(14, height, false);
  view.setUint16(16, 1, false);
  const chunks = stored(payload);
  const out = new Uint8Array(head.length + chunks.length);
  out.set(head, 0);
  out.set(chunks, head.length);
  return out;
}

/* ------------------------------------------------------------- synthetic */

test('A8R8G8B8 is Morton-swizzled, x in the lowest bit, even when not square', async () => {
  // 4 x 2: linear index m = x0 | y0 << 1 | x1 << 2. Each texel says where it is.
  const payload = new Uint8Array(0x80); // the chain, padded to 128
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const m = (x & 1) | (y << 1) | ((x >> 1) << 2);
      payload.set([255, x * 10, y * 10, m], m * 4); // A, R, G, B
    }
  }
  const t = await readTexture(gtf(0x85, 4, 2, 0xaae4, payload), noInflate);
  assert.equal(t.format, 'rgba8');
  const px = t.levels[0][0].data;
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const m = (x & 1) | (y << 1) | ((x >> 1) << 2);
      assert.deepEqual([...px.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)], [x * 10, y * 10, m, 255]);
    }
  }
});

test('B8 goes through the remap: 0xa9ff is grey and opaque, 0x02ff is alpha only', async () => {
  const payload = new Uint8Array(0x80);
  payload[0] = 200;
  const grey = await readTexture(gtf(0x81, 1, 1, 0xa9ff, payload), noInflate);
  assert.deepEqual([...grey.levels[0][0].data], [200, 200, 200, 255]);
  const alpha = await readTexture(gtf(0x81, 1, 1, 0x02ff, payload), noInflate);
  assert.deepEqual([...alpha.levels[0][0].data], [0, 0, 0, 200]);
});

test('a GTF payload longer than its mip chain padded to 128 is refused', async () => {
  await assert.rejects(readTexture(gtf(0x85, 4, 2, 0xaae4, new Uint8Array(0x100)), noInflate), TextureFormatError);
});

test('BC1 decodes as S3TC has it: four colours, or three and transparent black', () => {
  // c0 red (0xf800) > c1 blue (0x001f): index 0 red, 1 blue, 2 and 3 between.
  const block = Uint8Array.of(0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0);
  const level: TextureLevel = { width: 4, height: 4, depth: 1, data: block };
  const px = decodeLevel('bc1', level);
  assert.deepEqual([...px.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...px.subarray(4, 8)], [0, 0, 255, 255]);
  assert.deepEqual([...px.subarray(8, 12)], [170, 0, 85, 255]);
  // c0 <= c1: index 3 is transparent black.
  const punch = Uint8Array.of(0x1f, 0x00, 0x00, 0xf8, 0b11000000, 0, 0, 0);
  assert.deepEqual([...decodeLevel('bc1', { ...level, data: punch }).subarray(12, 16)], [0, 0, 0, 0]);
});

test('a TEX is a DDS in a chunk table, and BUMP after it marks a normal map', async () => {
  const dds = new Uint8Array(0x80 + 8 + 4);
  const view = new DataView(dds.buffer);
  dds.set(new TextEncoder().encode('DDS '), 0);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x1007, true);
  view.setUint32(12, 4, true); // height
  view.setUint32(16, 4, true); // width
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x4, true); // FourCC
  dds.set(new TextEncoder().encode('DXT1'), 84);
  dds.set(new TextEncoder().encode('BUMP'), 0x80 + 8);
  const chunks = stored(dds);
  const bytes = new Uint8Array(4 + chunks.length);
  bytes.set(new TextEncoder().encode('TEX '), 0);
  bytes.set(chunks, 4);
  const t = await readTexture(bytes, noInflate);
  assert.equal(t.format, 'bc1');
  assert.equal(t.bump, true);
  assert.equal(t.levels[0][0].data.length, 8);
});

/* ---------------------------------------------------------------- the game */

async function archive(file: string): Promise<{ farc: Farc; close(): Promise<void> } | undefined> {
  if (!inGame(file)) return undefined;
  const access = await openFileAccess(path.join(GAME, file));
  return { farc: await openFarc(access), close: () => access.close() };
}

test('every texture in intro_001.farc reads, its levels accounting for every byte', async (t) => {
  const open = await archive('intro_001.farc');
  if (!open) return t.skip(NO_GAME);
  try {
    let count = 0;
    for (const entry of open.farc.entries.values()) {
      const bytes = (await open.farc.get(entry.sha1))!;
      if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'GTF ') continue;
      const tex = await readTexture(bytes, nodeInflate);
      count += 1;
      assert.equal(tex.levels.length, tex.faces);
      assert.ok(tex.levels.every((chain) => chain.length === tex.mipCount));
    }
    assert.equal(count, 624);
  } finally {
    await open.close();
  }
});

test('dc_comics_promo_32bit and an auto icon: a swizzled A8R8G8B8 and a TEX', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const open = (await archive('base_001.farc'))!;
  try {
    const promo = await readTexture((await open.farc.get(db.get(525492)!.sha1))!, nodeInflate);
    assert.equal(promo.gcm?.format, 0x85);
    assert.deepEqual([promo.format, promo.width, promo.height, promo.mipCount], ['rgba8', 512, 256, 10]);
    // The picture is smooth only when unswizzled right: the mean step between
    // horizontal neighbours is about 10.5, and a misread one is noise.
    const { data, width, height } = promo.levels[0][0];
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x + 1 < width; x += 1) {
        for (let c = 0; c < 3; c += 1) sum += Math.abs(data[(y * width + x) * 4 + c] - data[(y * width + x + 1) * 4 + c]);
      }
    }
    assert.ok(sum / ((width - 1) * height * 3) < 12);

    const icon = await readTexture((await open.farc.get(db.get(31180)!.sha1))!, nodeInflate);
    assert.equal(icon.magic, 'TEX ');
    assert.deepEqual([icon.format, icon.width, icon.height, icon.mipCount, icon.bump], ['bc3', 128, 128, 8, false]);
    assert.deepEqual([...decodeLevel(icon.format, icon.levels[0][0]).subarray(0, 4)], [173, 174, 173, 0]);
  } finally {
    await open.close();
  }
});

/* ------------------------------------------------------- the users' TEX */

const FIXTURES = process.env.LBP_FIXTURES ?? path.join(import.meta.dirname, '..', '..', 'lbptracker', 'fixtures');
const USER_TEXTURES = path.join(FIXTURES, 'textures');

test("every user texture the archive sample's levels name reads, a DDS used up exactly", async (t) => {
  // `dev/fetch-textures.ts` gathers them: 619 of the 621 hashed type-1
  // dependencies of fixtures/archive, each checked against its SHA-1.
  if (!existsSync(USER_TEXTURES)) return t.skip(`no ${USER_TEXTURES}`);
  const { readdir } = await import('node:fs/promises');
  const formats = new Map<string, number>();
  let count = 0;
  for (const file of await readdir(USER_TEXTURES)) {
    const tex = await readTexture(new Uint8Array(await readFile(path.join(USER_TEXTURES, file))), nodeInflate);
    assert.equal(tex.magic, 'TEX ');
    assert.equal(tex.mipCount, 1);
    formats.set(tex.format, (formats.get(tex.format) ?? 0) + 1);
    count += 1;
  }
  assert.equal(count, 619);
  assert.deepEqual(Object.fromEntries(formats), { bc1: 590, bc3: 29 });
});
