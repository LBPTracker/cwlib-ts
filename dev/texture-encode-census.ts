/**
 * The game's textures through `encodeImageTexture` and back:
 *
 *   node dev/texture-encode-census.ts [every]     LBP_GAME required
 *
 * Takes every `every`-th 2D, single-face `GTF ` and `TEX ` in the four FARCs
 * (default 50; 1 is all of them, hours), decodes its first level to RGBA8
 * (`decodeLevel`), encodes that again in the same format, container, size,
 * `noSRGB` (the texture's `bump`) and with mipmaps when it has more than one
 * level, reads the file back with `readTexture`, and prints:
 *
 * - **error**, per format: the first level as re-encoded against the first level
 *   as the game has it -- RGB PSNR (luma-weighted too, which is what the DXT fit
 *   minimises by default) and alpha PSNR at the 1st, 10th and 50th percentile,
 *   and the distribution of the largest error in any channel. A BC texture is
 *   re-encoded from what its own blocks decode to, so this is the loss of a
 *   second pass, where an encoder that found the game's blocks again would show
 *   none; an `rgba8` one must come back exactly. Each `rgba8` texture is also
 *   encoded as DXT1 and DXT5, the only first encodings here of an image no
 *   encoder has touched.
 * - **header**: per field, how often the file written agrees with the game's --
 *   the `CellGcmTexture` of a `GTF `, the DDS header of a `TEX ` -- leaving
 *   out nothing: what disagrees is cwlib's choice where the game made another
 *   (the mip chain cwlib stops at a side of 1; the PS4 re-export's flags bit 1).
 *
 * Nothing is written; the FARCs are read in place.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { inflateChunkTable, magicOf } from '../src/io/resource.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { encodeImageTexture, type ImageTextureFormat } from '../src/resources/texture-encode.ts';
import { decodeLevel, readTexture, type Texture, type TextureFormat } from '../src/resources/texture.ts';
import { FARCS, GAME } from './game.ts';

const EVERY = Math.max(1, Number(process.argv[2] ?? 50));

const FORMAT_OF: Record<TextureFormat, ImageTextureFormat> = { bc1: 'DXT1', bc2: 'DXT3', bc3: 'DXT5', rgba8: 'RGBA8' };
const LUMA = [0.2126 ** 2, 0.7152 ** 2, 0.0722 ** 2].map((v, _, a) => (3 * v) / (a[0] + a[1] + a[2]));

const psnr = (sse: number, n: number): number => (sse === 0 ? Infinity : 10 * Math.log10((255 * 255 * n) / sse));

function errors(a: Uint8Array, b: Uint8Array): { rgb: number; luma: number; alpha: number; max: number } {
  let rgb = 0;
  let luma = 0;
  let alpha = 0;
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 4; c += 1) {
      const d = a[i + c] - b[i + c];
      if (c < 3) {
        rgb += d * d;
        luma += LUMA[c] * d * d;
      } else alpha += d * d;
      if (Math.abs(d) > max) max = Math.abs(d);
    }
  }
  const n = a.length / 4;
  return { rgb: psnr(rgb, n * 3), luma: psnr(luma, n * 3), alpha: psnr(alpha, n), max };
}

/**
 * DXT1's one-bit alpha: what an encoder can be asked to keep of a source --
 * alpha cut at 128, and a texel under it transparent black, as DXT1 decodes it.
 */
const threshold = (rgba: Uint8Array): Uint8Array => rgba.map((v, k) => (rgba[k | 3] < 128 ? 0 : k % 4 === 3 ? 255 : v));

const results = new Map<string, { rgb: number[]; luma: number[]; alpha: number[]; max: number[] }>();
function record(key: string, e: ReturnType<typeof errors>): void {
  const r = results.get(key) ?? { rgb: [], luma: [], alpha: [], max: [] };
  r.rgb.push(e.rgb);
  r.luma.push(e.luma);
  r.alpha.push(e.alpha);
  r.max.push(e.max);
  results.set(key, r);
}

const fields = new Map<string, [number, number]>();
function agree(key: string, same: boolean): void {
  const f = fields.get(key) ?? [0, 0];
  f[same ? 0 : 1] += 1;
  fields.set(key, f);
}
const examples = new Map<string, string>();

const GCM_FIELDS: [string, (b: Uint8Array, v: DataView) => number][] = [
  ['format', (b) => b[4]], ['mipmap', (b) => b[5]], ['dimension', (b) => b[6]], ['cubemap', (b) => b[7]],
  ['remap', (_, v) => v.getUint32(8, false)], ['width', (_, v) => v.getUint16(12, false)],
  ['height', (_, v) => v.getUint16(14, false)], ['depth', (_, v) => v.getUint16(16, false)],
  ['location', (b) => b[18]], ['flags', (b) => b[19]], ['pitch', (_, v) => v.getUint32(20, false)],
  ['offset', (_, v) => v.getUint32(24, false)],
];
const DDS_FIELDS: [string, number][] = [
  ['size', 4], ['flags', 8], ['height', 12], ['width', 16], ['pitchOrLinearSize', 20], ['depth', 24],
  ['mipMapCount', 28], ['pf.size', 76], ['pf.flags', 80], ['pf.fourCC', 84], ['pf.bitCount', 88],
  ['pf.rMask', 92], ['pf.gMask', 96], ['pf.bMask', 100], ['pf.aMask', 104], ['caps', 108], ['caps2', 112],
];

async function compareHeaders(original: Uint8Array, ours: Uint8Array, t: Texture, name: string): Promise<void> {
  const kind = `${t.magic.trim()} ${t.format}`;
  const note = (field: string, a: number, b: number): void => {
    agree(`${kind} ${field}`, a === b);
    const key = `${kind} ${field}`;
    if (a !== b && !examples.has(key)) examples.set(key, `game 0x${a.toString(16)}, ours 0x${b.toString(16)} (${name})`);
  };
  if (t.magic === 'GTF ') {
    const vo = new DataView(original.buffer, original.byteOffset, original.byteLength);
    const vn = new DataView(ours.buffer, ours.byteOffset, ours.byteLength);
    for (const [field, get] of GCM_FIELDS) note(field, get(original, vo), get(ours, vn));
    return;
  }
  const a = (await inflateChunkTable(original, 4, nodeInflate)).data;
  const b = (await inflateChunkTable(ours, 4, nodeInflate)).data;
  const va = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const vb = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const [field, at] of DDS_FIELDS) note(field, va.getUint32(at, true), vb.getUint32(at, true));
  let reserved = true;
  for (let at = 32; at < 76; at += 1) if (a[at] !== b[at]) reserved = false;
  agree(`${kind} reserved1`, reserved);
  note('payload length', a.length, b.length);
}

let taken = 0;
let index = 0;
let skipped = 0;
const failures: string[] = [];
const started = Date.now();
const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const magic = magicOf(await access.read(entry.offset, 8));
      if (magic !== 'GTF ' && magic !== 'TEX ') continue;
      seen.add(entry.sha1);
      if (index++ % EVERY !== 0) continue;
      const bytes = (await farc.get(entry.sha1))!;
      let t: Texture;
      try {
        t = await readTexture(bytes, nodeInflate);
      } catch {
        skipped += 1; // dev/texture-census.ts counts these
        continue;
      }
      const level = t.levels[0][0];
      const pow2 = (n: number): boolean => (n & (n - 1)) === 0;
      if (t.faces !== 1 || t.depth !== 1 || !pow2(level.width) || !pow2(level.height)) {
        skipped += 1;
        continue;
      }
      taken += 1;
      const source = Uint8Array.from(decodeLevel(t.format, level));
      const name = entry.sha1;
      try {
        const ours = await encodeImageTexture(source, level.width, level.height, {
          format: FORMAT_OF[t.format], container: t.magic, noSRGB: t.bump, mipmaps: t.mipCount > 1,
        }, nodeDeflate);
        const back = await readTexture(ours, nodeInflate);
        const again = decodeLevel(back.format, back.levels[0][0]);
        record(`${t.magic.trim()} ${t.format} -> same`, errors(again, t.format === 'bc1' ? threshold(source) : source));
        await compareHeaders(bytes, ours, t, name);
        if (t.format === 'rgba8') {
          for (const [format, bc] of [['DXT1', 'bc1'], ['DXT5', 'bc3']] as const) {
            const first = await readTexture(await encodeImageTexture(source, level.width, level.height, { format, container: t.magic }, nodeDeflate), nodeInflate);
            const out = decodeLevel(bc, first.levels[0][0]);
            record(`${t.magic.trim()} rgba8 -> ${format}`, errors(out, bc === 'bc1' ? threshold(source) : source));
          }
        }
      } catch (error) {
        failures.push(`${name} ${t.magic} ${t.format} ${level.width}x${level.height}: ${(error as Error).message}`);
      }
    }
  } finally {
    await access.close();
  }
}

const pct = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const db = (v: number): string => (v === Infinity ? 'exact' : `${v.toFixed(1)}`);
console.log(`every ${EVERY}th of ${index} textures: ${taken} re-encoded, ${skipped} skipped (unread, cube, volume or not a power of two), ${failures.length} failed, ${((Date.now() - started) / 1000).toFixed(0)} s`);
for (const line of failures.slice(0, 10)) console.log(`  ✗ ${line}`);
console.log('\nerror of the first level, dB at p1 / p10 / p50 (exact = no error); max error in any channel at p50 / p90 / p100');
for (const [key, r] of [...results].sort()) {
  const exact = r.max.filter((m) => m === 0).length;
  console.log(`${key.padEnd(22)} n=${String(r.rgb.length).padStart(5)}  RGB ${[1, 10, 50].map((p) => db(pct(r.rgb, p))).join(' / ')}`
    + `  luma ${[1, 10, 50].map((p) => db(pct(r.luma, p))).join(' / ')}  alpha ${[1, 10, 50].map((p) => db(pct(r.alpha, p))).join(' / ')}`
    + `  max ${[50, 90, 100].map((p) => pct(r.max, p)).join(' / ')}  exact ${exact}`);
}
console.log('\nheader fields, agreeing / disagreeing with the game');
for (const [key, [same, differ]] of [...fields].sort()) {
  console.log(`${key.padEnd(32)} ${same} / ${differ}${differ ? `   e.g. ${examples.get(key) ?? ''}` : ''}`);
}
