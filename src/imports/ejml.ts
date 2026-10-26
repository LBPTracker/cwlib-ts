/**
 * The 9x9 inverse `RMesh.generateClusters` takes of each cluster's quadratic
 * dyadic sum, which Java does with EJML's `CommonOps_FDRM.invert`.
 *
 * ⚠️ **Not EJML's arithmetic.** EJML is not in the toolkit's jar, so the Java
 * oracle runs a stand-in for it; this is the same stand-in -- Gauss-Jordan
 * elimination with partial pivoting in double precision, rounded to float at
 * the end -- and agrees with EJML's LU-based float inverse only to rounding.
 * Row-major in and out; a singular matrix is returned as it came, as EJML's
 * `invert` leaves its argument when it reports failure.
 */
export function invert9(matrix: ArrayLike<number>): Float32Array {
  const n = 9;
  const a: number[][] = Array.from({ length: n }, (_, i) => [
    ...Array.from({ length: n }, (_, j) => matrix[i * n + j]),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (d === 0) return Float32Array.from(matrix);
    for (let j = 0; j < 2 * n; j += 1) a[c][j] /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const k = a[r][c];
      if (k === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[r][j] -= k * a[c][j];
    }
  }
  return Float32Array.from({ length: n * n }, (_, i) => a[Math.trunc(i / n)][n + (i % n)]);
}
