/**
 * The handful of Java formatting rules `gfx-assembler.ts` needs to print
 * numbers exactly as toolkit `d6a2ef8`'s `GfxAssembler` does on JDK 25:
 *
 * - `Float.toString(float)` -- what `String.format("%s", aFloat)`, `"" + f`
 *   and `Float.toString` print: the shortest decimal (at least two digits)
 *   that rounds back to the float, the closest of those, ties to an even last
 *   digit; plain between 10^-3 and 10^7, `d.dddE±n` outside.
 * - `String.format("%f", aFloat)` -- the float widened to a double, that
 *   double's shortest decimal, rounded half-up to six places.
 *
 * ✔ Both are measured against JDK 25.0.3 over 2,000,000 floats
 * (`dev/gfx-assembler-census.ts --numbers`), not just reasoned from its
 * documentation.
 */

const BITS = new DataView(new ArrayBuffer(8));

/** A finite double as `num / den`, exactly; `den` a power of two. */
function rational(x: number): { num: bigint; den: bigint } {
  BITS.setFloat64(0, x, false);
  const hi = BITS.getUint32(0, false);
  const lo = BITS.getUint32(4, false);
  const sign = hi >>> 31 ? -1n : 1n;
  const biased = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent: number;
  if (biased === 0) exponent = -1074;
  else {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  return exponent >= 0
    ? { num: sign * (mantissa << BigInt(exponent)), den: 1n }
    : { num: sign * mantissa, den: 1n << BigInt(-exponent) };
}

/** `digits × 10^exp` as `num / den`. */
function decimal(digits: bigint, exp: number): { num: bigint; den: bigint } {
  return exp >= 0 ? { num: digits * 10n ** BigInt(exp), den: 1n } : { num: digits, den: 10n ** BigInt(-exp) };
}

const compare = (a: { num: bigint; den: bigint }, b: { num: bigint; den: bigint }): number => {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
};
const minus = (a: { num: bigint; den: bigint }, b: { num: bigint; den: bigint }) => {
  const num = a.num * b.den - b.num * a.den;
  return { num: num < 0n ? -num : num, den: a.den * b.den };
};

const F32 = new DataView(new ArrayBuffer(4));
const floatBits = (f: number): number => {
  F32.setFloat32(0, f, false);
  return F32.getUint32(0, false);
};
const bitsFloat = (bits: number): number => {
  F32.setUint32(0, bits >>> 0, false);
  return F32.getFloat32(0, false);
};

/** Java's `Float.floatToIntBits`, NaN collapsed to the canonical one. */
export function javaFloatBits(f: number): number {
  if (Number.isNaN(f)) return 0x7fc00000;
  return floatBits(f) | 0;
}

/**
 * The shortest decimal (of at least two digits) that rounds back to the
 * positive finite float `a`, closest first, ties to even: `[digits, exp]`.
 */
function shortestFloat(a: number): [bigint, number] {
  const bits = floatBits(a);
  const even = (bits & 1) === 0;
  const below = bits === 0 ? 0 : bitsFloat(bits - 1);
  const above = bits === 0x7f7fffff ? a + (a - below) : bitsFloat(bits + 1);
  // Both midpoints are exact doubles: two adjacent floats' mean needs 25 bits.
  const low = rational((below + a) / 2);
  const high = rational((a + above) / 2);
  const exact = rational(a);
  const rounds = (d: { num: bigint; den: bigint }): boolean => {
    const l = compare(d, low);
    const h = compare(d, high);
    return (l > 0 || (l === 0 && even)) && (h < 0 || (h === 0 && even));
  };
  for (let p = 2; p <= 9; p += 1) {
    const [m, e] = a.toExponential(p - 1).split('e');
    const digits = BigInt(m.replace('.', ''));
    const exp = Number(e) - (p - 1);
    let best: [bigint, number] | undefined;
    let bestDistance: { num: bigint; den: bigint } | undefined;
    for (const d of [digits - 1n, digits, digits + 1n]) {
      if (d <= 0n) continue;
      const value = decimal(d, exp);
      if (!rounds(value)) continue;
      const distance = minus(value, exact);
      const order = bestDistance === undefined ? -1 : compare(distance, bestDistance);
      if (order < 0 || (order === 0 && d % 2n === 0n)) {
        best = [d, exp];
        bestDistance = distance;
      }
    }
    if (best) return best;
  }
  throw new Error(`no decimal of nine digits rounds to the float ${a}`);
}

/** Java's `Float.toString(f)`; `f` is taken as a float (`Math.fround`). */
export function javaFloatToString(value: number): string {
  const f = Math.fround(value);
  if (Number.isNaN(f)) return 'NaN';
  if (f === Infinity) return 'Infinity';
  if (f === -Infinity) return '-Infinity';
  if (f === 0) return Object.is(f, -0) ? '-0.0' : '0.0';
  const sign = f < 0 ? '-' : '';
  let [digits, exp] = shortestFloat(Math.abs(f));
  while (digits % 10n === 0n) {
    digits /= 10n;
    exp += 1;
  }
  const s = digits.toString();
  const e = s.length - 1 + exp; // value = s[0].s[1..] × 10^e
  if (e >= -3 && e < 7) {
    if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${s}`;
    const whole = s.length > e + 1 ? s.slice(0, e + 1) : s.padEnd(e + 1, '0');
    const fraction = s.length > e + 1 ? s.slice(e + 1) : '0';
    return `${sign}${whole}.${fraction}`;
  }
  return `${sign}${s[0]}.${s.length > 1 ? s.slice(1) : '0'}E${e}`;
}

/**
 * Java's `String.format(locale, "%f", f)` for a float or double `value`: six
 * places, half-up from the double's shortest decimal. `separator` is the
 * locale's decimal separator -- `Locale.ROOT`'s `.`, or `,` for the Italian
 * default some of `GfxAssembler`'s calls fall back to.
 */
export function javaFormatF(value: number, separator = '.', precision = 6): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  const negative = value < 0 || Object.is(value, -0);
  let n: bigint;
  if (value === 0) n = 0n;
  else {
    const [m, e] = Math.abs(value).toExponential().split('e');
    const digits = BigInt(m.replace('.', ''));
    const exp = Number(e) - (m.includes('.') ? m.length - 2 : 0);
    const shift = exp + precision;
    if (shift >= 0) n = digits * 10n ** BigInt(shift);
    else {
      const unit = 10n ** BigInt(-shift);
      n = digits / unit;
      if ((digits % unit) * 2n >= unit) n += 1n;
    }
  }
  const s = n.toString().padStart(precision + 1, '0');
  const whole = s.slice(0, s.length - precision);
  const fraction = s.slice(s.length - precision);
  return `${negative ? '-' : ''}${whole}${precision > 0 ? separator + fraction : ''}`;
}

/** Java's `(int) b` of a `byte`: the value read as unsigned, back to signed. */
export const javaByte = (u8: number): number => (u8 << 24) >> 24;

/**
 * Java's `BufferedReader.lines().collect(joining(separator))` over a text: the
 * lines split on `\r\n`, `\r` or `\n`, a final terminator dropped. It is how
 * `FileIO.getResourceFileAsString` loads the templates, with
 * `System.lineSeparator()` -- `\r\n` on Windows, `\n` elsewhere.
 */
export function javaJoinLines(text: string, separator: string): string {
  if (text === '') return '';
  const lines = text.split(/\r\n|\r|\n/);
  if (/[\r\n]$/.test(text)) lines.pop();
  return lines.join(separator);
}
