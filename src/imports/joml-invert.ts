/**
 * JOML 1.10.5's `Matrix4f.invert(dest)`, by the path the matrix's properties
 * pick -- identity, translation, orthonormal, affine, generic -- each read off
 * the jar's bytecode like `joml.ts` (the perspective path is not one a bind
 * pose takes, and goes generic here).
 */

import { f, fma, identity4, PROPERTY_AFFINE, PROPERTY_IDENTITY, PROPERTY_ORTHONORMAL, PROPERTY_TRANSLATION, type Mat4 } from './joml.ts';

export function invert4(mat: Mat4): Mat4 {
  const p = mat.properties;
  const s = mat.m;
  const g = (c: number, r: number): number => s[c * 4 + r];
  const out = new Float32Array(16);
  const set = (c: number, r: number, v: number): void => {
    out[c * 4 + r] = v;
  };
  if (p & PROPERTY_IDENTITY) return identity4();
  if (p & PROPERTY_TRANSLATION) {
    out.set(s);
    set(3, 0, -g(3, 0));
    set(3, 1, -g(3, 1));
    set(3, 2, -g(3, 2));
    return { m: out, properties: PROPERTY_AFFINE | PROPERTY_TRANSLATION | PROPERTY_ORTHONORMAL };
  }
  const [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33] = Array.from(s);
  if (p & PROPERTY_ORTHONORMAL) {
    const nm30 = -f(f(f(m00 * m30) + f(m01 * m31)) + f(m02 * m32));
    const nm31 = -f(f(f(m10 * m30) + f(m11 * m31)) + f(m12 * m32));
    const nm32 = -f(f(f(m20 * m30) + f(m21 * m31)) + f(m22 * m32));
    out.set([m00, m10, m20, 0, m01, m11, m21, 0, m02, m12, m22, 0, nm30, nm31, nm32, 1]);
    return { m: out, properties: PROPERTY_AFFINE | PROPERTY_ORTHONORMAL };
  }
  if (p & PROPERTY_AFFINE) {
    const m11m00 = f(m00 * m11);
    const m10m01 = f(m01 * m10);
    const m10m02 = f(m02 * m10);
    const m12m00 = f(m00 * m12);
    const m12m01 = f(m01 * m12);
    const m11m02 = f(m02 * m11);
    const det = f(f(f(f(m11m00 - m10m01) * m22) + f(f(m10m02 - m12m00) * m21)) + f(f(m12m01 - m11m02) * m20));
    const inv = f(1 / det);
    const m10m22 = f(m10 * m22);
    const m10m21 = f(m10 * m21);
    const m11m22 = f(m11 * m22);
    const m11m20 = f(m11 * m20);
    const m12m21 = f(m12 * m21);
    const m12m20 = f(m12 * m20);
    const m20m02 = f(m20 * m02);
    const m20m01 = f(m20 * m01);
    const m21m02 = f(m21 * m02);
    const m21m00 = f(m21 * m00);
    const m22m01 = f(m22 * m01);
    const m22m00 = f(m22 * m00);
    const nm31 = f(f(f(f(f(f(f(m20m02 * m31) - f(m20m01 * m32)) + f(m21m00 * m32)) - f(m21m02 * m30)) + f(m22m01 * m30)) - f(m22m00 * m31)) * inv);
    const nm32 = f(f(f(f(f(f(f(m11m02 * m30) - f(m12m01 * m30)) + f(m12m00 * m31)) - f(m10m02 * m31)) + f(m10m01 * m32)) - f(m11m00 * m32)) * inv);
    const nm30 = f(f(f(f(f(f(f(m10m22 * m31) - f(m10m21 * m32)) + f(m11m20 * m32)) - f(m11m22 * m30)) + f(m12m21 * m30)) - f(m12m20 * m31)) * inv);
    out.set([
      f(f(m11m22 - m12m21) * inv), f(f(m21m02 - m22m01) * inv), f(f(m12m01 - m11m02) * inv), 0,
      f(f(m12m20 - m10m22) * inv), f(f(m22m00 - m20m02) * inv), f(f(m10m02 - m12m00) * inv), 0,
      f(f(m10m21 - m11m20) * inv), f(f(m20m01 - m21m00) * inv), f(f(m11m00 - m10m01) * inv), 0,
      nm30, nm31, nm32, 1,
    ]);
    return { m: out, properties: PROPERTY_AFFINE };
  }
  // invertGenericNonThis
  const a = f(f(m00 * m11) - f(m01 * m10));
  const b = f(f(m00 * m12) - f(m02 * m10));
  const c = f(f(m00 * m13) - f(m03 * m10));
  const d = f(f(m01 * m12) - f(m02 * m11));
  const e = f(f(m01 * m13) - f(m03 * m11));
  const ff = f(f(m02 * m13) - f(m03 * m12));
  const gg = f(f(m20 * m31) - f(m21 * m30));
  const h = f(f(m20 * m32) - f(m22 * m30));
  const i = f(f(m20 * m33) - f(m23 * m30));
  const j = f(f(m21 * m32) - f(m22 * m31));
  const k = f(f(m21 * m33) - f(m23 * m31));
  const l = f(f(m22 * m33) - f(m23 * m32));
  let det = f(f(f(f(f(f(a * l) - f(b * k)) + f(c * j)) + f(d * i)) - f(e * h)) + f(ff * gg));
  det = f(1 / det);
  const x = (v: number): number => f(v * det);
  out.set([
    x(fma(m11, l, fma(-m12, k, f(m13 * j)))), x(fma(-m01, l, fma(m02, k, f(-m03 * j)))),
    x(fma(m31, ff, fma(-m32, e, f(m33 * d)))), x(fma(-m21, ff, fma(m22, e, f(-m23 * d)))),
    x(fma(-m10, l, fma(m12, i, f(-m13 * h)))), x(fma(m00, l, fma(-m02, i, f(m03 * h)))),
    x(fma(-m30, ff, fma(m32, c, f(-m33 * b)))), x(fma(m20, ff, fma(-m22, c, f(m23 * b)))),
    x(fma(m10, k, fma(-m11, i, f(m13 * gg)))), x(fma(-m00, k, fma(m01, i, f(-m03 * gg)))),
    x(fma(m30, e, fma(-m31, c, f(m33 * a)))), x(fma(-m20, e, fma(m21, c, f(-m23 * a)))),
    x(fma(-m10, j, fma(m11, h, f(-m12 * gg)))), x(fma(m00, j, fma(-m01, h, f(m02 * gg)))),
    x(fma(-m30, d, fma(m31, b, f(-m32 * a)))), x(fma(m20, d, fma(-m21, b, f(m22 * a)))),
  ]);
  return { m: out, properties: 0 };
}
