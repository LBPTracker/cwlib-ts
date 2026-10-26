/**
 * The float arithmetic Java cwlib's importers do through JOML 1.10.5, the
 * version the toolkit's jar bundles, step for step in single precision, so a
 * value computed here is the bit pattern Java computes.
 *
 * Every operation is read off the jar's bytecode (`javap -c`), not JOML's
 * documentation, because the order of the operations is the result:
 *
 * - `org.joml.Math.fma(a, b, c)` is `a * b + c` with **two** roundings, not a
 *   fused multiply-add: `Runtime.HAS_Math_fma` is false unless the
 *   `joml.useMathFma` property is set, which the toolkit never sets.
 * - A dot product is `fma(x, x', fma(y, y', z * z'))` -- the last term first.
 * - `Math.sqrt`, `invsqrt` and `acos` on a float go through the double and
 *   round once, `invsqrt` as `1f / (float) sqrt(x)`.
 * - A matrix carries **properties** (`determineProperties`), and `mul` takes a
 *   different code path by them: the identity copies, two affine matrices skip
 *   the fourth row. The paths differ in the fourth row only, which is what a
 *   `Vector4f`'s w sees.
 *
 * Matrices are column-major `Float32Array`s of 16, JOML's `mCR` at `C * 4 + R`.
 */

/** Round to single precision. */
export const f = Math.fround;

/** JOML's `Math.fma`: `a * b + c`, each step rounded. */
export const fma = (a: number, b: number, c: number): number => f(f(a * b) + c);

/** `org.joml.Math.sqrt(float)`: through the double. */
export const sqrtf = (x: number): number => f(Math.sqrt(x));

/** `org.joml.Math.invsqrt(float)`: `1f / (float) Math.sqrt(x)`. */
export const invsqrtf = (x: number): number => f(1 / f(Math.sqrt(x)));

/** `org.joml.Math.acos(float)`. */
export const acosf = (x: number): number => f(Math.acos(x));

/** A JOML `Matrix4f`: sixteen floats, column-major, and its properties. */
export interface Mat4 {
  readonly m: Float32Array;
  properties: number;
}

export const PROPERTY_PERSPECTIVE = 1;
export const PROPERTY_AFFINE = 2;
export const PROPERTY_IDENTITY = 4;
export const PROPERTY_TRANSLATION = 8;
export const PROPERTY_ORTHONORMAL = 16;

/** `new Matrix4f()` / `identity()`: every property but perspective. */
export function identity4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return { m, properties: PROPERTY_IDENTITY | PROPERTY_AFFINE | PROPERTY_TRANSLATION | PROPERTY_ORTHONORMAL };
}

/** `Matrix4f.determineProperties`, which `set(float[])` and every matrix cwlib reads run. */
export function determineProperties(m: ArrayLike<number>): number {
  let p = 0;
  if (m[3] === 0 && m[7] === 0) {
    if (m[11] === 0 && m[15] === 1) {
      p |= PROPERTY_AFFINE;
      if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[4] === 0 && m[5] === 1 && m[6] === 0 && m[8] === 0 && m[9] === 0 && m[10] === 1) {
        p |= PROPERTY_TRANSLATION | PROPERTY_ORTHONORMAL;
        if (m[12] === 0 && m[13] === 0 && m[14] === 0) p |= PROPERTY_IDENTITY;
      }
    } else if (m[1] === 0 && m[2] === 0 && m[4] === 0 && m[6] === 0 && m[8] === 0 && m[9] === 0 && m[12] === 0 && m[13] === 0 && m[15] === 0) {
      p |= PROPERTY_PERSPECTIVE;
    }
  }
  return p;
}

/** `new Matrix4f().set(values)`: a matrix as cwlib reads one. */
export function mat4(values: ArrayLike<number>): Mat4 {
  const m = Float32Array.from(values as ArrayLike<number>);
  return { m, properties: determineProperties(m) };
}

const absEqualsOne = (v: number): boolean => Math.abs(v) === 1;

/** `Matrix4f.translationRotateScale(t, q, s)`. */
export function translationRotateScale(t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): Mat4 {
  const [qx, qy, qz, qw] = [q[0], q[1], q[2], q[3]];
  const [sx, sy, sz] = [s[0], s[1], s[2]];
  const dqx = f(qx + qx);
  const dqy = f(qy + qy);
  const dqz = f(qz + qz);
  const q00 = f(dqx * qx);
  const q11 = f(dqy * qy);
  const q22 = f(dqz * qz);
  const q01 = f(dqx * qy);
  const q02 = f(dqx * qz);
  const q03 = f(dqx * qw);
  const q12 = f(dqy * qz);
  const q13 = f(dqy * qw);
  const q23 = f(dqz * qw);
  const one = absEqualsOne(sx) && absEqualsOne(sy) && absEqualsOne(sz);
  const m = new Float32Array(16);
  m[0] = f(sx - f(f(q11 + q22) * sx));
  m[1] = f(f(q01 + q23) * sx);
  m[2] = f(f(q02 - q13) * sx);
  m[4] = f(f(q01 - q23) * sy);
  m[5] = f(sy - f(f(q22 + q00) * sy));
  m[6] = f(f(q12 + q03) * sy);
  m[8] = f(f(q02 + q13) * sz);
  m[9] = f(f(q12 - q03) * sz);
  m[10] = f(sz - f(f(q11 + q00) * sz));
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return { m, properties: PROPERTY_AFFINE | (one ? PROPERTY_ORTHONORMAL : 0) };
}

/** `a.mul(b, new Matrix4f())`, by the path JOML takes for the two matrices' properties. */
export function mul4(a: Mat4, b: Mat4): Mat4 {
  if (a.properties & PROPERTY_IDENTITY) return { m: b.m.slice(), properties: b.properties };
  if (b.properties & PROPERTY_IDENTITY) return { m: a.m.slice(), properties: a.properties };
  const x = a.m;
  const r = b.m;
  const m = new Float32Array(16);
  if ((a.properties & PROPERTY_TRANSLATION) && (b.properties & PROPERTY_AFFINE)) {
    // mulTranslationAffine
    for (let i = 0; i < 12; i += 1) m[i] = r[i];
    m[3] = x[3];
    m[7] = x[7];
    m[11] = x[11];
    m[12] = f(r[12] + x[12]);
    m[13] = f(r[13] + x[13]);
    m[14] = f(r[14] + x[14]);
    m[15] = x[15];
    return { m, properties: PROPERTY_AFFINE | (b.properties & PROPERTY_ORTHONORMAL) };
  }
  if ((a.properties & PROPERTY_AFFINE) && (b.properties & PROPERTY_AFFINE)) {
    // mulAffine
    for (let c = 0; c < 3; c += 1) {
      for (let row = 0; row < 3; row += 1) m[c * 4 + row] = fma(x[row], r[c * 4], fma(x[4 + row], r[c * 4 + 1], f(x[8 + row] * r[c * 4 + 2])));
    }
    m[3] = x[3];
    m[7] = x[7];
    m[11] = x[11];
    for (let row = 0; row < 3; row += 1) m[12 + row] = fma(x[row], r[12], fma(x[4 + row], r[13], fma(x[8 + row], r[14], x[12 + row])));
    m[15] = x[15];
    return { m, properties: PROPERTY_AFFINE | (a.properties & b.properties & PROPERTY_ORTHONORMAL) };
  }
  if (b.properties & PROPERTY_AFFINE) {
    // mulAffineR (the perspective path is not one cwlib's matrices take)
    for (let c = 0; c < 3; c += 1) {
      for (let row = 0; row < 4; row += 1) m[c * 4 + row] = fma(x[row], r[c * 4], fma(x[4 + row], r[c * 4 + 1], f(x[8 + row] * r[c * 4 + 2])));
    }
    for (let row = 0; row < 4; row += 1) m[12 + row] = fma(x[row], r[12], fma(x[4 + row], r[13], fma(x[8 + row], r[14], x[12 + row])));
    return { m, properties: a.properties & ~(PROPERTY_IDENTITY | PROPERTY_PERSPECTIVE | PROPERTY_TRANSLATION | PROPERTY_ORTHONORMAL) };
  }
  // mul0
  for (let c = 0; c < 4; c += 1) {
    for (let row = 0; row < 4; row += 1) {
      m[c * 4 + row] = fma(x[row], r[c * 4], fma(x[4 + row], r[c * 4 + 1], fma(x[8 + row], r[c * 4 + 2], f(x[12 + row] * r[c * 4 + 3]))));
    }
  }
  return { m, properties: 0 };
}

/** `new Vector4f(v, w).mul(mat)`: `mat * v`, w kept on an affine matrix. */
export function mulVec4(mat: Mat4, v: ArrayLike<number>): [number, number, number, number] {
  const m = mat.m;
  const [x, y, z, w] = [v[0], v[1], v[2], v[3]];
  const row = (r: number): number => fma(m[r], x, fma(m[4 + r], y, fma(m[8 + r], z, f(m[12 + r] * w))));
  return [row(0), row(1), row(2), mat.properties & PROPERTY_AFFINE ? w : row(3)];
}

/** `Matrix4f.scale(s, new Matrix4f())`: the first three columns scaled (the identity becomes a scaling). */
export function scale4(mat: Mat4, s: number): Mat4 {
  const m = new Float32Array(16);
  if (mat.properties & PROPERTY_IDENTITY) {
    m[0] = m[5] = m[10] = s;
    m[15] = 1;
    const one = absEqualsOne(s);
    return { m, properties: PROPERTY_AFFINE | (one ? PROPERTY_ORTHONORMAL : 0) };
  }
  for (let i = 0; i < 12; i += 1) m[i] = f(mat.m[i] * s);
  for (let i = 12; i < 16; i += 1) m[i] = mat.m[i];
  const one = absEqualsOne(s);
  return { m, properties: mat.properties & ~(PROPERTY_PERSPECTIVE | PROPERTY_IDENTITY | PROPERTY_TRANSLATION | (one ? 0 : PROPERTY_ORTHONORMAL)) };
}

/** `a.add(b)`: element by element; no properties survive. */
export function add4(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let i = 0; i < 16; i += 1) m[i] = f(a.m[i] + b.m[i]);
  return { m, properties: 0 };
}

/** `Vector3f.mul(Matrix3f)` with the matrix `get3x3` takes from `mat`: `M * v`. */
export function mul3x3(mat: Mat4, v: ArrayLike<number>): [number, number, number] {
  const m = mat.m;
  const row = (r: number): number => fma(m[r], v[0], fma(m[4 + r], v[1], f(m[8 + r] * v[2])));
  return [row(0), row(1), row(2)];
}

/** `Vector3f.lengthSquared` / a dot product of a vector with itself. */
export const lengthSq3 = (x: number, y: number, z: number): number => fma(x, x, fma(y, y, f(z * z)));

/** `Vector3f.length()`. */
export const length3 = (x: number, y: number, z: number): number => sqrtf(lengthSq3(x, y, z));

/** `Vector3f.normalize()`, in place on `v[at..at+2]`. */
export function normalize3(v: number[] | Float32Array, at = 0): void {
  const s = invsqrtf(lengthSq3(v[at], v[at + 1], v[at + 2]));
  v[at] = f(v[at] * s);
  v[at + 1] = f(v[at + 1] * s);
  v[at + 2] = f(v[at + 2] * s);
}

/** `a.cross(b)`. */
export function cross3(a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] {
  return [
    fma(a[1], b[2], f(-a[2] * b[1])),
    fma(a[2], b[0], f(-a[0] * b[2])),
    fma(a[0], b[1], f(-a[1] * b[0])),
  ];
}

/** `a.angle(b)`: `acos` of the cosine clamped to [-1, 1]. */
export function angle3(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const l1 = lengthSq3(a[0], a[1], a[2]);
  const l2 = lengthSq3(b[0], b[1], b[2]);
  const dot = fma(a[0], b[0], fma(a[1], b[1], f(a[2] * b[2])));
  let cos = f(dot / sqrtf(f(l1 * l2)));
  cos = cos < 1 ? cos : 1;
  cos = cos > -1 ? cos : -1;
  return acosf(cos);
}

/** `Vector4f.length()`. */
export const length4 = (x: number, y: number, z: number, w: number): number => sqrtf(fma(x, x, fma(y, y, fma(z, z, f(w * w)))));

/** `Vector4f.max(v)` in place: JOML's comparison, the argument winning ties and NaN. */
export function max4(a: number[], b: ArrayLike<number>): void {
  for (let i = 0; i < 4; i += 1) a[i] = a[i] > b[i] ? a[i] : b[i];
}

/** `Vector4f.min(v)` in place. */
export function min4(a: number[], b: ArrayLike<number>): void {
  for (let i = 0; i < 4; i += 1) a[i] = a[i] < b[i] ? a[i] : b[i];
}

/** A float's bits as Java's `Float.floatToIntBits` gives them (NaN canonical): what `Vector3f.equals` compares. */
const BITS = new DataView(new ArrayBuffer(4));
export function floatBits(v: number): number {
  if (Number.isNaN(v)) return 0x7fc00000;
  BITS.setFloat32(0, v);
  return BITS.getInt32(0);
}

/** The key under which `Vector3f.equals` makes two vectors one. */
export const vec3Key = (x: number, y: number, z: number): string => `${floatBits(x)},${floatBits(y)},${floatBits(z)}`;

/** Java's `(int) value` of a float: toward zero, NaN 0, saturating. */
export function toInt(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value >= 2147483647) return 2147483647;
  if (value <= -2147483648) return -2147483648;
  return Math.trunc(value);
}

/** Java's `Math.round(float)`: the nearest int, halves up, NaN 0, saturating -- JavaScript's `Math.round` on the float. */
export function roundf(value: number): number {
  return toInt(Math.round(value));
}
