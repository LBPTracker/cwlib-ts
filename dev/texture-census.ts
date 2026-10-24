/**
 * Every `GTF ` and `TEX ` in an installed game's FARCs through `readTexture`,
 * and the checks behind each layout convention in `src/resources/texture.ts`:
 *
 *   node dev/texture-census.ts [png-dir]     LBP_GAME required
 *
 * Prints how many read, by magic and format, and the failures with their
 * reasons; then the measurements:
 *
 * - **mip offsets**: the first level no wider than 64 against the one after it,
 *   box-filtered down. A level read from the wrong offset matches nothing; the
 *   control is the same comparison with the smaller level rolled by half its
 *   width. Every level's offset depends on every size before it, so the late
 *   levels are the strict test.
 * - **swizzle**: on the first level no larger than 256, the mean difference
 *   between neighbouring texels read as the reader does, against the other
 *   reading (Morton for linear BC blocks, linear for Morton texels). Natural
 *   images are smooth; the wrong layout is not.
 * - `GTF ` flags bit 0 against paths that name a normal or bump map.
 *
 * With a directory, writes a few decoded textures there as PNG for a look.
 * Nothing else is written; the FARCs are read in place.
 */

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

import { openFarc } from '../src/archives/farc.ts';
import { decodeLevel, readTexture, type Texture, type TextureLevel } from '../src/resources/texture.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { magicOf } from '../src/io/resource.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const PNG_DIR = process.argv[2];

/** Path fragments of the textures written out as PNG. */
const SAMPLES = [
  'mw_manglemetal/mw_manglemetal_d.tex',
  'cowboy/oddsock_horse_body_diffuse.tex',
  'dynamic_elements/dc_comics_promo_32bit.tex',
  'ui/search_icon_sdf.tex',
  'bu_swirly_jestar_hat/bu_swirly_jestar_hat_norm.tex',
  'reflection_maps/desert_horizon_cube.tex',
  'texture_library/areatex.tex',
  'colourspaces/colourspace_volume_lurid.tex',
  'ui/auto_icons/wheels_5443.tex',
  'mach99mtbiker/sticker_02.tex',
  'gamedata/data/noise.tex',
  'x-nobody-x/sticker_15.tex',
];

function writePng(file: string, w: number, h: number, rgba: Uint8Array): void {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    Buffer.from(data).copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array()),
  ]));
}

const { pathOf } = await gameFileDB();

const tally = new Map<string, number>();
const bump = (key: string, by = 1): void => void tally.set(key, (tally.get(key) ?? 0) + by);

/** Mean absolute RGB difference between `small` and `big` box-filtered by 2, `small` rolled by `roll` columns. */
function mipError(big: Uint8Array, bw: number, bh: number, small: Uint8Array, sw: number, sh: number, roll: number): number {
  const fx = bw / sw;
  const fy = bh / sh;
  let sum = 0;
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const s = (y * sw + ((x + roll) % sw)) * 4;
      for (let c = 0; c < 3; c += 1) {
        let acc = 0;
        for (let j = 0; j < fy; j += 1) for (let i = 0; i < fx; i += 1) acc += big[((y * fy + j) * bw + x * fx + i) * 4 + c];
        sum += Math.abs(acc / (fx * fy) - small[s + c]);
      }
    }
  }
  return sum / (sw * sh * 3);
}

/** Mean absolute RGB difference between horizontal and vertical neighbours. */
function roughness(rgba: Uint8Array, w: number, h: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      for (const p of [x + 1 < w ? o + 4 : -1, y + 1 < h ? o + w * 4 : -1]) {
        if (p < 0) continue;
        for (let c = 0; c < 3; c += 1) sum += Math.abs(rgba[o + c] - rgba[p + c]);
        n += 1;
      }
    }
  }
  return n ? sum / n : 0;
}

/** The same level with its BC blocks taken in Morton order, or its texels re-swizzled: the other reading. */
function otherReading(t: Texture, level: TextureLevel): Uint8Array | undefined {
  const { width: w, height: h } = level;
  if (t.format === 'rgba8') {
    // Our texels are unswizzled; apply the swizzle once more to get what a
    // linear reading of the raw bytes would have shown, up to the remap.
    if (t.gcm === undefined || t.gcm.format & 0x20 || w & (w - 1) || h & (h - 1)) return undefined;
    const lw = Math.log2(w);
    const lh = Math.log2(h);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let m = 0;
        let bit = 0;
        for (let i = 0; i < Math.max(lw, lh); i += 1) {
          if (i < lw) m |= ((x >> i) & 1) << bit++;
          if (i < lh) m |= ((y >> i) & 1) << bit++;
        }
        // Linear position m holds texel (x, y).
        out.set(level.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), m * 4);
      }
    }
    return out;
  }
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  if (bw & (bw - 1) || bh & (bh - 1) || bw < 2 || bh < 2) return undefined;
  const size = t.format === 'bc1' ? 8 : 16;
  const moved = new Uint8Array(level.data.length);
  const [lw, lh] = [Math.log2(bw), Math.log2(bh)];
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let m = 0;
      let bit = 0;
      for (let i = 0; i < Math.max(lw, lh); i += 1) {
        if (i < lw) m |= ((bx >> i) & 1) << bit++;
        if (i < lh) m |= ((by >> i) & 1) << bit++;
      }
      moved.set(level.data.subarray(m * size, m * size + size), (by * bw + bx) * size);
    }
  }
  return decodeLevel(t.format, { ...level, data: moved });
}

function measure(t: Texture, name: string): void {
  const kind = `${t.magic.trim()} ${t.format}${t.gcm && t.gcm.format & 0x20 ? ' LN' : ''}`;
  const chain = t.levels[0];
  const k = chain.findIndex((l) => l.width <= 64 && l.height <= 64);
  if (k >= 0 && k + 1 < chain.length && chain[k + 1].width >= 2 && chain[k + 1].height >= 2 && t.depth === 1) {
    const [a, b] = [chain[k], chain[k + 1]];
    if (a.width === b.width * 2 && a.height === b.height * 2) {
      const big = decodeLevel(t.format, a);
      const small = decodeLevel(t.format, b);
      const right = mipError(big, a.width, a.height, small, b.width, b.height, 0);
      const control = mipError(big, a.width, a.height, small, b.width, b.height, b.width >> 1);
      // Only a level the roll changes can tell a right offset from a wrong one.
      if (control >= 8) {
        bump(`mip ${kind}, control differs: ${right < 8 ? 'matches' : 'MISMATCH'} its box-filtered parent`);
        bump(`mip ${kind}, control differs: ${right < control / 2 ? 'under half' : 'NOT UNDER HALF'} the control's error`);
      } else {
        bump(`mip ${kind}: too uniform to tell`);
      }
    }
  }
  const s = chain.findIndex((l) => l.width <= 256 && l.height <= 256);
  if (s >= 0 && t.depth === 1) {
    const level = chain[s];
    const ours = roughness(decodeLevel(t.format, level), level.width, level.height);
    const other = otherReading(t, level);
    if (other) {
      const theirs = roughness(other, level.width, level.height);
      if (ours !== theirs) bump(`layout ${kind}: ${ours < theirs ? 'smoother as read' : 'SMOOTHER THE OTHER WAY'}`);
    }
  }
  if (t.gcm) {
    const named = /norm|bump|_nm\b|_n\.tex/i.test(name);
    bump(`flags bit 0 ${t.gcm.flags & 1 ? 'set' : 'clear'} on ${named ? 'a normal/bump name' : 'other names'}`);
    bump(`flags bit 1 ${(t.gcm.flags >> 1) & 1}, bit 2 ${(t.gcm.flags >> 2) & 1} under ${name.split('/')[0]}/`);
  }
}

function sample(t: Texture, name: string): void {
  if (!PNG_DIR || !SAMPLES.some((s) => name.endsWith(s))) return;
  const base = path.join(PNG_DIR, path.basename(name, '.tex'));
  const level = t.levels[0][0];
  const rgba = decodeLevel(t.format, level);
  if (t.depth > 1) {
    // A volume: its slices stacked downwards.
    writePng(`${base}.png`, level.width, level.height * level.depth, rgba);
  } else {
    writePng(`${base}.png`, level.width, level.height, rgba);
  }
  if (t.faces > 1) {
    for (let f = 1; f < t.faces; f += 1) writePng(`${base}-face${f}.png`, level.width, level.height, decodeLevel(t.format, t.levels[f][0]));
  }
  const last = t.levels[0].findIndex((l) => l.width <= 64 && l.height <= 64);
  if (last > 0) {
    const l = t.levels[0][last];
    writePng(`${base}-mip${last}.png`, l.width, l.height, decodeLevel(t.format, l));
  }
  // Opaque copy, for what the alpha hides.
  const opaque = Uint8Array.from(rgba);
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  writePng(`${base}-opaque.png`, level.width, level.height * level.depth, opaque);
}

if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });
const failures = new Map<string, string[]>();
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      const magic = magicOf(head);
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      if (magic !== 'GTF ' && magic !== 'TEX ') {
        if (name.endsWith('.tex')) bump(`.tex that is not a texture resource: ${JSON.stringify(magic)}`);
        continue;
      }
      seen.add(entry.sha1);
      // A texture has no revision; the format byte (GTF) or the DDS is what varies.
      const format = magic === 'GTF ' ? `GTF 0x${head[4].toString(16)}` : 'TEX';
      let t: Texture;
      try {
        t = await readTexture((await farc.get(entry.sha1))!, nodeInflate);
      } catch (error) {
        const list = failures.get(format) ?? [];
        list.push(`${name}: ${(error as Error).message}`);
        failures.set(format, list);
        continue;
      }
      bump(`read ${format} -> ${t.format}${t.faces > 1 ? ' cube' : ''}${t.depth > 1 ? ' volume' : ''}`);
      if (t.bump) bump(`bump ${t.magic.trim()}`);
      measure(t, name);
      sample(t, name);
    }
  } finally {
    await access.close();
  }
}

const read = [...tally].filter(([k]) => k.startsWith('read ')).reduce((sum, [, n]) => sum + n, 0);
console.log(`${seen.size} textures, ${read} read`);
for (const [format, list] of failures) {
  console.log(`  ✗ ${format}: ${list.length} failed`);
  for (const line of list.slice(0, 5)) console.log(`      ${line}`);
}
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}`);
