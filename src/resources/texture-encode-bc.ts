/**
 * An RGBA8 image to BC1, BC2 or BC3 blocks (DXT1, DXT3, DXT5): the block
 * compressor `texture-encode.ts` writes textures with, where cwlib calls
 * jsquish's `Squish.compressImage`.
 *
 * Written here, after the method libsquish describes rather than its code: the
 * colours of a block are ordered along their principal axis and every split of
 * that order into the palette's clusters is tried, each solved for its least-
 * squares endpoints (the *cluster fit*); a block of one colour takes the pair of
 * endpoints whose interpolant is nearest it, per channel (the *single-colour
 * fit*). It is what `Squish.compressImage(rgba, w, h, null, type)` runs --
 * `CLUSTER_FIT`, the `PERCEPTUAL` metric, alpha not weighted (javap of jsquish in
 * the toolkit's `sequencerdump-0.1.jar`).
 *
 * Where it differs from Squish, each towards a smaller error in the metric:
 * - the principal axis is taken with each channel scaled by its metric weight,
 *   the space the error is measured in;
 * - the indices are chosen last, each texel nearest its colour **in the palette
 *   the decoder will build** from the two 5:6:5 endpoints (`decodeLevel`'s), not
 *   taken from the cluster it was fitted in, and DXT1's three- and four-colour
 *   fits are judged on that real error;
 * - a fit is then refitted, least squares on the indices it chose, while the
 *   error falls (`refineColours`);
 * - DXT5's alpha, which Squish fits across the texels' range, is also searched
 *   for ends beyond it and refitted (`encodeAlpha5`).
 *
 * Not byte-for-byte Squish. Measured against it (the toolkit jar's cwlib
 * `bb79e81` on 23 images, each in the three formats): in the luma-weighted
 * error both minimise, never more than 0.04 dB worse and 4.3 dB better on
 * average; in plain RGB PSNR up to 2.7 dB worse, since the perceptual weights
 * leave blue to fend for itself (`metric: 'uniform'` is never worse there than
 * Squish's own perceptual fit, by 0.01 dB at most); DXT5 alpha never worse.
 * `dev/texture-encode-census.ts` measures it on the game's textures.
 */

export type BcFormat = 'bc1' | 'bc2' | 'bc3';

/**
 * The weights a colour error is measured with: Squish's `PERCEPTUAL` (Rec. 709
 * luma, its default) or `UNIFORM`.
 */
export type BcMetric = 'perceptual' | 'uniform';

export interface BcOptions {
  readonly metric?: BcMetric;
}

/** Bytes per 4x4 block. */
export const BC_BLOCK_BYTES: Readonly<Record<BcFormat, number>> = { bc1: 8, bc2: 16, bc3: 16 };

const expand5 = (c: number): number => ((c * 255 + 15) / 31) | 0;
const expand6 = (c: number): number => ((c * 255 + 31) / 63) | 0;

/** Per 8-bit value, the 5- or 6-bit code that expands nearest it. */
function nearestTable(bits: number): Uint8Array {
  const max = (1 << bits) - 1;
  const expand = bits === 5 ? expand5 : expand6;
  const out = new Uint8Array(256);
  for (let v = 0; v < 256; v += 1) {
    let best = 0;
    let err = Infinity;
    for (let q = 0; q <= max; q += 1) {
      const e = Math.abs(expand(q) - v);
      if (e < err) {
        err = e;
        best = q;
      }
    }
    out[v] = best;
  }
  return out;
}

const NEAREST5 = nearestTable(5);
const NEAREST6 = nearestTable(6);

/**
 * The single-colour tables: per 8-bit value, the pair of 5- or 6-bit codes
 * whose interpolant is nearest it -- index 2 of a four-colour palette,
 * `(2 a + b) / 3`, or of a three-colour one, `(a + b) / 2`, rounded as the
 * decoder rounds -- packed `e0 | e1 << 8 | error << 16`. Built on first use.
 */
const singleTables = new Map<string, Uint32Array>();

function singleTable(bits: number, three: boolean): Uint32Array {
  const key = `${bits}${three ? 3 : 4}`;
  let table = singleTables.get(key);
  if (table) return table;
  const max = (1 << bits) - 1;
  const expand = bits === 5 ? expand5 : expand6;
  table = new Uint32Array(256).fill(0xffffffff);
  for (let e0 = 0; e0 <= max; e0 += 1) {
    const a = expand(e0);
    for (let e1 = 0; e1 <= max; e1 += 1) {
      const b = expand(e1);
      const v = three ? (a + b) >> 1 : ((2 * a + b + 1) / 3) | 0;
      // Every value near v is reached from this pair with error |v - t|.
      for (let t = Math.max(0, v - 8); t <= Math.min(255, v + 8); t += 1) {
        const err = Math.abs(v - t);
        if (err < table[t] >>> 16) table[t] = (e0 | (e1 << 8) | (err << 16)) >>> 0;
      }
    }
  }
  singleTables.set(key, table);
  return table;
}

/** The 4-entry RGB palette `decodeLevel` builds from two 5:6:5 words, and whether entry 3 is transparent. */
function palette(c0: number, c1: number, four: boolean, out: Int32Array): void {
  out[0] = expand5((c0 >> 11) & 31);
  out[1] = expand6((c0 >> 5) & 63);
  out[2] = expand5(c0 & 31);
  out[3] = expand5((c1 >> 11) & 31);
  out[4] = expand6((c1 >> 5) & 63);
  out[5] = expand5(c1 & 31);
  for (let k = 0; k < 3; k += 1) {
    if (four) {
      out[6 + k] = ((2 * out[k] + out[3 + k] + 1) / 3) | 0;
      out[9 + k] = ((out[k] + 2 * out[3 + k] + 1) / 3) | 0;
    } else {
      out[6 + k] = (out[k] + out[3 + k]) >> 1;
      out[9 + k] = 0;
    }
  }
}

const word = (r: number, g: number, b: number): number => (r << 11) | (g << 5) | b;

/** A block's colours, as the fits see them. */
interface ColourBlock {
  /** RGB of each of the 16 texels, 0..255. */
  readonly rgb: Float64Array;
  /** Texel k takes part: inside the image and, in DXT1, opaque. */
  readonly used: Uint8Array;
  /** Texel k is inside the image but transparent (DXT1 only): it takes index 3 of a three-colour block. */
  readonly clear: Uint8Array;
  /** The distinct used colours and how many texels each stands for. */
  readonly points: Float64Array;
  readonly weights: Float64Array;
  count: number;
  anyClear: boolean;
}

function newColourBlock(): ColourBlock {
  return {
    rgb: new Float64Array(48), used: new Uint8Array(16), clear: new Uint8Array(16),
    points: new Float64Array(48), weights: new Float64Array(16), count: 0, anyClear: false,
  };
}

/** The real error of one encoding, with its indices: each used texel to its nearest palette entry. */
function assign(block: ColourBlock, c0: number, c1: number, four: boolean, msq: Float64Array, pal: Int32Array): { error: number; indices: number } {
  palette(c0, c1, four, pal);
  const entries = four ? 4 : 3;
  let error = 0;
  let indices = 0;
  for (let k = 0; k < 16; k += 1) {
    if (block.clear[k]) {
      indices |= 3 << (2 * k);
      continue;
    }
    if (!block.used[k]) continue;
    const r = block.rgb[k * 3];
    const g = block.rgb[k * 3 + 1];
    const b = block.rgb[k * 3 + 2];
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < entries; i += 1) {
      const dr = pal[i * 3] - r;
      const dg = pal[i * 3 + 1] - g;
      const db = pal[i * 3 + 2] - b;
      const e = msq[0] * dr * dr + msq[1] * dg * dg + msq[2] * db * db;
      if (e < bestErr) {
        bestErr = e;
        best = i;
      }
    }
    error += bestErr;
    indices |= best << (2 * k);
  }
  return { error, indices: indices >>> 0 };
}

interface Encoded {
  c0: number;
  c1: number;
  indices: number;
  error: number;
}

/**
 * Finish a pair of endpoints into a block: put the words in the order the mode
 * needs -- `c0 > c1` for four colours, `c0 <= c1` for three in DXT1 -- and
 * choose the indices against the palette that order decodes to.
 */
function finish(block: ColourBlock, wa: number, wb: number, three: boolean, bc1: boolean, msq: Float64Array, pal: Int32Array): Encoded {
  let c0 = wa;
  let c1 = wb;
  if (three ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0];
  // Equal words in DXT1 decode as three colours, all of them that one colour.
  const four = !bc1 || c0 > c1;
  const { error, indices } = assign(block, c0, c1, four, msq, pal);
  return { c0, c1, indices, error };
}

/** The single-colour fit: per channel the table pair, index 0's exact code where that is nearer. */
function fitSingle(block: ColourBlock, three: boolean, bc1: boolean, msq: Float64Array, pal: Int32Array): Encoded {
  const r = Math.round(block.points[0]);
  const g = Math.round(block.points[1]);
  const b = Math.round(block.points[2]);
  const tr = singleTable(5, three)[r];
  const tg = singleTable(6, three)[g];
  const tb = singleTable(5, three)[b];
  const wa = word(tr & 0xff, tg & 0xff, tb & 0xff);
  const wb = word((tr >> 8) & 0xff, (tg >> 8) & 0xff, (tb >> 8) & 0xff);
  const pair = finish(block, wa, wb, three, bc1, msq, pal);
  const exact = word(NEAREST5[r], NEAREST6[g], NEAREST5[b]);
  const alone = finish(block, exact, exact, three, bc1, msq, pal);
  return alone.error <= pair.error ? alone : pair;
}

/**
 * The principal axis of the block's points, by power iteration on their
 * covariance -- in the space the error is measured in, each channel scaled by
 * its metric weight, so the axis is the one the error runs along. (Unscaled, a
 * block whose red and green spread alike sorts along red, the cheap channel.)
 */
function principalAxis(block: ColourBlock, msq: Float64Array, axis: Float64Array): void {
  const { points, weights, count } = block;
  const k0 = Math.sqrt(msq[0]);
  const k1 = Math.sqrt(msq[1]);
  const k2 = Math.sqrt(msq[2]);
  let total = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (let i = 0; i < count; i += 1) {
    const w = weights[i];
    total += w;
    mr += w * points[i * 3];
    mg += w * points[i * 3 + 1];
    mb += w * points[i * 3 + 2];
  }
  mr /= total;
  mg /= total;
  mb /= total;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < count; i += 1) {
    const w = weights[i];
    const dr = (points[i * 3] - mr) * k0;
    const dg = (points[i * 3 + 1] - mg) * k1;
    const db = (points[i * 3 + 2] - mb) * k2;
    xx += w * dr * dr;
    xy += w * dr * dg;
    xz += w * dr * db;
    yy += w * dg * dg;
    yz += w * dg * db;
    zz += w * db * db;
  }
  // Start from the covariance's largest row, which is never orthogonal to the axis it is dominated by.
  let vx: number, vy: number, vz: number;
  if (xx >= yy && xx >= zz) [vx, vy, vz] = [xx, xy, xz];
  else if (yy >= zz) [vx, vy, vz] = [xy, yy, yz];
  else [vx, vy, vz] = [xz, yz, zz];
  for (let it = 0; it < 8; it += 1) {
    const nx = xx * vx + xy * vy + xz * vz;
    const ny = xy * vx + yy * vy + yz * vz;
    const nz = xz * vx + yz * vy + zz * vz;
    const m = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    if (m <= 0) break;
    vx = nx / m;
    vy = ny / m;
    vz = nz / m;
  }
  if (!(Math.abs(vx) + Math.abs(vy) + Math.abs(vz) > 0)) [vx, vy, vz] = [1, 1, 1];
  // Projected from the unscaled points.
  axis[0] = vx * k0;
  axis[1] = vy * k1;
  axis[2] = vz * k2;
}

/** The scratch a cluster fit runs in, reused block to block. */
interface Scratch {
  readonly axis: Float64Array;
  readonly order: number[];
  readonly dots: Float64Array;
  /** Prefix sums over the ordered points: weight, then weighted R, G, B. */
  readonly sw: Float64Array;
  readonly sx: Float64Array;
  readonly pal: Int32Array;
}

function newScratch(): Scratch {
  return {
    axis: new Float64Array(3), order: [], dots: new Float64Array(16),
    sw: new Float64Array(17), sx: new Float64Array(17 * 3), pal: new Int32Array(12),
  };
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** A float endpoint to its 5:6:5 word, and the colour that word expands to. */
function quantise(r: number, g: number, b: number, out: Float64Array, at: number): number {
  const qr = NEAREST5[clamp255(r)];
  const qg = NEAREST6[clamp255(g)];
  const qb = NEAREST5[clamp255(b)];
  out[at] = expand5(qr);
  out[at + 1] = expand6(qg);
  out[at + 2] = expand5(qb);
  return word(qr, qg, qb);
}

/**
 * The cluster fit: the points in order along the principal axis, every split
 * into four (or, `three`, three) runs tried, each run pulled toward its
 * palette entry; the endpoints of the best split by the fit's own error.
 */
function fitCluster(block: ColourBlock, three: boolean, bc1: boolean, msq: Float64Array, s: Scratch): Encoded {
  const { points, weights, count: n } = block;
  principalAxis(block, msq, s.axis);
  const order = s.order;
  order.length = 0;
  for (let i = 0; i < n; i += 1) {
    order.push(i);
    s.dots[i] = points[i * 3] * s.axis[0] + points[i * 3 + 1] * s.axis[1] + points[i * 3 + 2] * s.axis[2];
  }
  order.sort((a, b) => s.dots[a] - s.dots[b]);
  const { sw, sx } = s;
  sw[0] = 0;
  sx[0] = sx[1] = sx[2] = 0;
  for (let t = 0; t < n; t += 1) {
    const p = order[t];
    const w = weights[p];
    sw[t + 1] = sw[t] + w;
    for (let c = 0; c < 3; c += 1) sx[(t + 1) * 3 + c] = sx[t * 3 + c] + w * points[p * 3 + c];
  }
  const wt = sw[n];
  const xt0 = sx[n * 3];
  const xt1 = sx[n * 3 + 1];
  const xt2 = sx[n * 3 + 2];
  const m0 = msq[0];
  const m1 = msq[1];
  const m2 = msq[2];
  const q = new Float64Array(6);
  let bestErr = Infinity;
  let bestA = 0;
  let bestB = 0;

  const tryFit = (alpha2: number, beta2: number, alphabeta: number, ax0: number, ax1: number, ax2: number): void => {
    const det = alpha2 * beta2 - alphabeta * alphabeta;
    if (Math.abs(det) < 1e-9) return;
    const f = 1 / det;
    const bx0 = xt0 - ax0;
    const bx1 = xt1 - ax1;
    const bx2 = xt2 - ax2;
    const wa = quantise((ax0 * beta2 - bx0 * alphabeta) * f, (ax1 * beta2 - bx1 * alphabeta) * f, (ax2 * beta2 - bx2 * alphabeta) * f, q, 0);
    const wb = quantise((bx0 * alpha2 - ax0 * alphabeta) * f, (bx1 * alpha2 - ax1 * alphabeta) * f, (bx2 * alpha2 - ax2 * alphabeta) * f, q, 3);
    // sum w |x - (alpha a + beta b)|^2, but for the constant sum w |x|^2.
    const e0 = alpha2 * q[0] * q[0] + beta2 * q[3] * q[3] + 2 * alphabeta * q[0] * q[3] - 2 * (q[0] * ax0 + q[3] * bx0);
    const e1 = alpha2 * q[1] * q[1] + beta2 * q[4] * q[4] + 2 * alphabeta * q[1] * q[4] - 2 * (q[1] * ax1 + q[4] * bx1);
    const e2 = alpha2 * q[2] * q[2] + beta2 * q[5] * q[5] + 2 * alphabeta * q[2] * q[5] - 2 * (q[2] * ax2 + q[5] * bx2);
    const err = m0 * e0 + m1 * e1 + m2 * e2;
    if (err < bestErr) {
      bestErr = err;
      bestA = wa;
      bestB = wb;
    }
  };

  if (three) {
    // Runs [0, i) at a, [i, j) halfway, [j, n) at b.
    for (let i = 0; i <= n; i += 1) {
      const w0 = sw[i];
      for (let j = i; j <= n; j += 1) {
        const w1 = sw[j] - w0;
        const w2 = wt - sw[j];
        const ax0 = sx[i * 3] + 0.5 * (sx[j * 3] - sx[i * 3]);
        const ax1 = sx[i * 3 + 1] + 0.5 * (sx[j * 3 + 1] - sx[i * 3 + 1]);
        const ax2 = sx[i * 3 + 2] + 0.5 * (sx[j * 3 + 2] - sx[i * 3 + 2]);
        tryFit(w0 + 0.25 * w1, 0.25 * w1 + w2, 0.25 * w1, ax0, ax1, ax2);
      }
    }
  } else {
    // Runs [0, i) at a, [i, j) two thirds of the way to a, [j, k) one third, [k, n) at b.
    for (let i = 0; i <= n; i += 1) {
      const w0 = sw[i];
      for (let j = i; j <= n; j += 1) {
        const w1 = sw[j] - w0;
        for (let k = j; k <= n; k += 1) {
          const w2 = sw[k] - sw[j];
          const w3 = wt - sw[k];
          const ax0 = sx[i * 3] + (2 / 3) * (sx[j * 3] - sx[i * 3]) + (1 / 3) * (sx[k * 3] - sx[j * 3]);
          const ax1 = sx[i * 3 + 1] + (2 / 3) * (sx[j * 3 + 1] - sx[i * 3 + 1]) + (1 / 3) * (sx[k * 3 + 1] - sx[j * 3 + 1]);
          const ax2 = sx[i * 3 + 2] + (2 / 3) * (sx[j * 3 + 2] - sx[i * 3 + 2]) + (1 / 3) * (sx[k * 3 + 2] - sx[j * 3 + 2]);
          tryFit(w0 + (4 / 9) * w1 + (1 / 9) * w2, (1 / 9) * w1 + (4 / 9) * w2 + w3, (2 / 9) * (w1 + w2), ax0, ax1, ax2);
        }
      }
    }
  }
  if (bestErr === Infinity) {
    // Every split degenerate: the ends of the order.
    const lo = order[0];
    const hi = order[n - 1];
    bestA = quantise(points[lo * 3], points[lo * 3 + 1], points[lo * 3 + 2], q, 0);
    bestB = quantise(points[hi * 3], points[hi * 3 + 1], points[hi * 3 + 2], q, 3);
  }
  return finish(block, bestA, bestB, three, bc1, msq, s.pal);
}

/** Where each colour index sits between c0 and c1, four colours and three: [weight of c0, weight of c1], or none for transparent. */
const COLOUR_WEIGHTS: Readonly<Record<'4' | '3', readonly (readonly [number, number] | undefined)[]>> = {
  4: [[1, 0], [0, 1], [2 / 3, 1 / 3], [1 / 3, 2 / 3]],
  3: [[1, 0], [0, 1], [1 / 2, 1 / 2], undefined],
};

/**
 * A fit refitted: the least-squares endpoints for the indices it chose (per
 * channel, so the metric does not enter), quantised, the indices chosen again,
 * while the real error falls.
 */
function refineColours(block: ColourBlock, start: Encoded, bc1: boolean, msq: Float64Array, pal: Int32Array): Encoded {
  let best = start;
  const q = new Float64Array(6);
  for (let round = 0; round < 2 && best.error > 0; round += 1) {
    const four = !bc1 || best.c0 > best.c1;
    const weights = COLOUR_WEIGHTS[four ? '4' : '3'];
    let uu = 0, uv = 0, vv = 0;
    const ux = [0, 0, 0];
    const vx = [0, 0, 0];
    for (let k = 0; k < 16; k += 1) {
      if (!block.used[k]) continue;
      const w = weights[(best.indices >>> (2 * k)) & 3];
      if (!w) continue;
      uu += w[0] * w[0];
      uv += w[0] * w[1];
      vv += w[1] * w[1];
      for (let c = 0; c < 3; c += 1) {
        ux[c] += w[0] * block.rgb[k * 3 + c];
        vx[c] += w[1] * block.rgb[k * 3 + c];
      }
    }
    const det = uu * vv - uv * uv;
    if (Math.abs(det) < 1e-9) break;
    const wa = quantise((ux[0] * vv - vx[0] * uv) / det, (ux[1] * vv - vx[1] * uv) / det, (ux[2] * vv - vx[2] * uv) / det, q, 0);
    const wb = quantise((vx[0] * uu - ux[0] * uv) / det, (vx[1] * uu - ux[1] * uv) / det, (vx[2] * uu - ux[2] * uv) / det, q, 3);
    const next = finish(block, wa, wb, !four, bc1, msq, pal);
    if (next.error >= best.error) break;
    best = next;
  }
  return best;
}

/** A block's colour half: eight bytes at `out[at]`. */
function encodeColours(block: ColourBlock, bc1: boolean, msq: Float64Array, s: Scratch, out: Uint8Array, at: number): void {
  let best: Encoded;
  if (block.count === 0) {
    // Nothing opaque: a three-colour block of transparent texels, or black.
    best = { c0: 0, c1: 0, indices: block.anyClear ? 0xffffffff : 0, error: 0 };
  } else {
    const fit = block.count === 1 ? fitSingle
      : (b: ColourBlock, three: boolean, one: boolean, m: Float64Array) => refineColours(b, fitCluster(b, three, one, m, s), one, m, s.pal);
    // A transparent texel needs entry 3 of a three-colour block; DXT3 and DXT5 only have four.
    best = block.anyClear ? fit(block, true, bc1, msq, s.pal) : fit(block, false, bc1, msq, s.pal);
    if (bc1 && !block.anyClear) {
      const three = fit(block, true, bc1, msq, s.pal);
      if (three.error < best.error) best = three;
    }
  }
  out[at] = best.c0 & 0xff;
  out[at + 1] = best.c0 >> 8;
  out[at + 2] = best.c1 & 0xff;
  out[at + 3] = best.c1 >> 8;
  out[at + 4] = best.indices & 0xff;
  out[at + 5] = (best.indices >>> 8) & 0xff;
  out[at + 6] = (best.indices >>> 16) & 0xff;
  out[at + 7] = best.indices >>> 24;
}

/** DXT3's explicit alpha: four bits a texel, rounded. */
function encodeAlpha3(alpha: Uint8Array, inside: Uint8Array, out: Uint8Array, at: number): void {
  for (let k = 0; k < 16; k += 2) {
    const lo = inside[k] ? Math.round(alpha[k] / 17) : 0;
    const hi = inside[k + 1] ? Math.round(alpha[k + 1] / 17) : 0;
    out[at + (k >> 1)] = lo | (hi << 4);
  }
}

/** The 8 alpha values `decodeLevel` builds from a DXT5 block's two endpoints. */
function alphaPalette(a0: number, a1: number, out: Int32Array): void {
  out[0] = a0;
  out[1] = a1;
  if (a0 > a1) {
    for (let k = 1; k < 7; k += 1) out[k + 1] = (((7 - k) * a0 + k * a1 + 3) / 7) | 0;
  } else {
    for (let k = 1; k < 5; k += 1) out[k + 1] = (((5 - k) * a0 + k * a1 + 2) / 5) | 0;
    out[6] = 0;
    out[7] = 255;
  }
}

function alphaFit(alpha: Uint8Array, inside: Uint8Array, a0: number, a1: number, pal: Int32Array, codes: Uint8Array): number {
  alphaPalette(a0, a1, pal);
  let error = 0;
  for (let k = 0; k < 16; k += 1) {
    if (!inside[k]) {
      codes[k] = 0;
      continue;
    }
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < 8; i += 1) {
      const d = pal[i] - alpha[k];
      if (d * d < bestErr) {
        bestErr = d * d;
        best = i;
      }
    }
    codes[k] = best;
    error += bestErr;
  }
  return error;
}

/** Where each DXT5 alpha index sits between the endpoints, per mode: [weight of a0, weight of a1], or none for 0 and 255. */
const ALPHA_WEIGHTS: Readonly<Record<'7' | '5', readonly (readonly [number, number] | undefined)[]>> = {
  7: [[1, 0], [0, 1], ...[1, 2, 3, 4, 5, 6].map((k) => [(7 - k) / 7, k / 7] as const)],
  5: [[1, 0], [0, 1], ...[1, 2, 3, 4].map((k) => [(5 - k) / 5, k / 5] as const), undefined, undefined],
};

/**
 * One DXT5 alpha mode from its starting endpoints, then refitted: the least-
 * squares endpoints for the indices chosen, rounded, the indices chosen again,
 * while the error falls. (Squish stops at the start; the refit is what finds a
 * block's endpoints again when the range they span is wider than its texels'.)
 */
function refineAlpha(alpha: Uint8Array, inside: Uint8Array, a0: number, a1: number, seven: boolean, pal: Int32Array): { a0: number; a1: number; codes: Uint8Array; error: number } {
  let codes = new Uint8Array(16);
  let error = alphaFit(alpha, inside, a0, a1, pal, codes);
  const weights = ALPHA_WEIGHTS[seven ? '7' : '5'];
  for (let round = 0; round < 4 && error > 0; round += 1) {
    let uu = 0, uv = 0, vv = 0, ux = 0, vx = 0;
    for (let k = 0; k < 16; k += 1) {
      const w = inside[k] ? weights[codes[k]] : undefined;
      if (!w) continue;
      uu += w[0] * w[0];
      uv += w[0] * w[1];
      vv += w[1] * w[1];
      ux += w[0] * alpha[k];
      vx += w[1] * alpha[k];
    }
    const det = uu * vv - uv * uv;
    if (Math.abs(det) < 1e-9) break;
    let b0 = Math.min(255, Math.max(0, Math.round((ux * vv - vx * uv) / det)));
    let b1 = Math.min(255, Math.max(0, Math.round((vx * uu - ux * uv) / det)));
    // Keep the mode: seven steps want b0 > b1, five want b0 <= b1, and the ramp is the same either way round.
    if (seven ? b0 < b1 : b0 > b1) [b0, b1] = [b1, b0];
    if (seven && b0 === b1) break;
    if (b0 === a0 && b1 === a1) break;
    const next = new Uint8Array(16);
    const e = alphaFit(alpha, inside, b0, b1, pal, next);
    if (e >= error) break;
    [a0, a1, codes, error] = [b0, b1, next, e];
  }
  return { a0, a1, codes, error };
}

/**
 * DXT5's interpolated alpha: the seven-step ramp across the block's range, or
 * the five-step one across the range of what is neither 0 nor 255 (which that
 * mode holds exactly) -- whichever errs less, as Squish chooses. Each is then refitted (`refineAlpha`),
 * each ramp's ends are searched beyond the texels' (`spread`), and the
 * five-step one is started from 0 and 255 too: what finds the endpoints of a
 * block an encoder has made before.
 */
function encodeAlpha5(alpha: Uint8Array, inside: Uint8Array, out: Uint8Array, at: number): void {
  let min7 = 255, max7 = 0, min5 = 255, max5 = 0;
  for (let k = 0; k < 16; k += 1) {
    if (!inside[k]) continue;
    const a = alpha[k];
    if (a < min7) min7 = a;
    if (a > max7) max7 = a;
    if (a !== 0 && a !== 255) {
      if (a < min5) min5 = a;
      if (a > max5) max5 = a;
    }
  }
  if (min7 > max7) min7 = max7 = 255;
  if (min5 > max5) min5 = max5 = 0;
  const pal = new Int32Array(8);
  // Seven steps need a0 > a1; equal endpoints are the five-step mode, whose entry 0 is exact.
  let best = refineAlpha(alpha, inside, max7, min7, true, pal);
  const scratch = new Uint8Array(16);
  /**
   * The ramp's ends may lie beyond the texels': the lowest and highest texel
   * put on every pair of the ramp's steps, the ends that follows from that
   * tried, and the best of them refitted.
   */
  const spread = (lo: number, hi: number, steps: number, seven: boolean): void => {
    if (best.error === 0 || hi <= lo) return;
    let [b0, b1, error] = [0, 0, Infinity];
    for (let pl = 0; pl < steps; pl += 1) {
      for (let ph = pl + 1; ph <= steps; ph += 1) {
        const step = (hi - lo) / (ph - pl);
        const low = Math.max(0, Math.round(lo - pl * step));
        const high = Math.min(255, Math.round(lo + (steps - pl) * step));
        if (high <= low) continue;
        const [c0, c1] = seven ? [high, low] : [low, high];
        const e = alphaFit(alpha, inside, c0, c1, pal, scratch);
        if (e < error) [b0, b1, error] = [c0, c1, e];
      }
    }
    if (error < best.error) {
      const refined = refineAlpha(alpha, inside, b0, b1, seven, pal);
      if (refined.error < best.error) best = refined;
    }
  };
  spread(min7, max7, 7, true);
  // Five steps over what is neither 0 nor 255, from that range and from either end of the whole one.
  for (const [lo, hi] of [[min5, max5], [0, max5], [min5, 255], [0, 255]]) {
    if (best.error === 0) break;
    const five = refineAlpha(alpha, inside, lo, hi, false, pal);
    if (five.error < best.error) best = five;
  }
  spread(min5, max5, 5, false);
  const codes = best.codes;
  out[at] = best.a0;
  out[at + 1] = best.a1;
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < 8; k += 1) lo |= codes[k] << (3 * k);
  for (let k = 0; k < 8; k += 1) hi |= codes[8 + k] << (3 * k);
  out[at + 2] = lo & 0xff;
  out[at + 3] = (lo >> 8) & 0xff;
  out[at + 4] = (lo >> 16) & 0xff;
  out[at + 5] = hi & 0xff;
  out[at + 6] = (hi >> 8) & 0xff;
  out[at + 7] = (hi >> 16) & 0xff;
}

const METRICS: Readonly<Record<BcMetric, readonly number[]>> = {
  perceptual: [0.2126, 0.7152, 0.0722],
  uniform: [1, 1, 1],
};

/**
 * Compress an RGBA8 image (row-major, `width * height * 4` bytes) to BC
 * blocks, row-major as `readTexture` holds them and `decodeLevel` reads them.
 * A block the image's edge cuts short is fitted to the texels inside it.
 *
 * In BC1 a texel of alpha under 128 is transparent -- index 3 of a three-colour
 * block, as Squish has it; BC2 and BC3 fit the colour of every texel whatever
 * its alpha.
 */
export function compressBc(rgba: Uint8Array, width: number, height: number, format: BcFormat, options: BcOptions = {}): Uint8Array {
  if (rgba.length < width * height * 4) throw new RangeError(`${rgba.length} bytes is not a ${width}x${height} RGBA8 image`);
  const metric = METRICS[options.metric ?? 'perceptual'];
  const msq = Float64Array.from(metric, (m) => m * m);
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  const size = BC_BLOCK_BYTES[format];
  const out = new Uint8Array(bw * bh * size);
  const bc1 = format === 'bc1';
  const block = newColourBlock();
  const scratch = newScratch();
  const alpha = new Uint8Array(16);
  const inside = new Uint8Array(16);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      block.count = 0;
      block.anyClear = false;
      for (let k = 0; k < 16; k += 1) {
        const x = bx * 4 + (k & 3);
        const y = by * 4 + (k >> 2);
        block.used[k] = 0;
        block.clear[k] = 0;
        inside[k] = 0;
        alpha[k] = 255;
        if (x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        inside[k] = 1;
        alpha[k] = rgba[o + 3];
        if (bc1 && rgba[o + 3] < 128) {
          block.clear[k] = 1;
          block.anyClear = true;
          continue;
        }
        const r = rgba[o];
        const g = rgba[o + 1];
        const b = rgba[o + 2];
        block.used[k] = 1;
        block.rgb[k * 3] = r;
        block.rgb[k * 3 + 1] = g;
        block.rgb[k * 3 + 2] = b;
        let p = 0;
        while (p < block.count && (block.points[p * 3] !== r || block.points[p * 3 + 1] !== g || block.points[p * 3 + 2] !== b)) p += 1;
        if (p === block.count) {
          block.points[p * 3] = r;
          block.points[p * 3 + 1] = g;
          block.points[p * 3 + 2] = b;
          block.weights[p] = 0;
          block.count += 1;
        }
        block.weights[p] += 1;
      }
      const at = (by * bw + bx) * size;
      if (format === 'bc2') encodeAlpha3(alpha, inside, out, at);
      else if (format === 'bc3') encodeAlpha5(alpha, inside, out, at);
      encodeColours(block, bc1, msq, scratch, out, at + size - 8);
    }
  }
  return out;
}
