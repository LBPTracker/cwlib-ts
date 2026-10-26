/**
 * Small glTF files made from scratch for the importers' tests
 * (`test/imports.test.ts`), whose Java outputs are pinned there by SHA-1:
 * write them with `node dev/import-fixtures.ts <dir>` and run the harnesses
 * (`JImp`) on them to re-pin.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { ARRAY_BUFFER, GltfBuilder, UNSIGNED_BYTE, bytesOf } from '../src/resources/gltf-builder.ts';

/**
 * A bent 5 x 4 grid over two bones, cut into two primitives of their own
 * accessors (as Java's exporter cuts them), materials `jam` and `toast`, two
 * UV channels, one morph target (`smile`) whose normals are deltas, and an
 * animation of 6 sampled keys bending the second bone -- the second primitive
 * with an unsigned-byte `COLOR_0` of full masses (255: Java exits on a soft triangle).
 */
export function gridGlb(): Uint8Array {
  const g = new GltfBuilder();
  const w = 5;
  const h = 4;
  const primitives: Record<string, unknown>[] = [];
  for (let part = 0; part < 2; part += 1) {
    const positions: number[] = [];
    const normals: number[] = [];
    const tangents: number[] = [];
    const uv0: number[] = [];
    const uv1: number[] = [];
    const joints: number[] = [];
    const weights: number[] = [];
    const morph: number[] = [];
    const morphNormals: number[] = [];
    const colors: number[] = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const px = x + part * (w - 1);
        positions.push(px * 0.25, Math.sin(px * 0.6) * 0.3, y * 0.25);
        const n = [-Math.cos(px * 0.6) * 0.18, 1, 0.05];
        const l = Math.hypot(...n);
        normals.push(n[0] / l, n[1] / l, n[2] / l);
        tangents.push(1, 0.1 * x, 0, y % 2 ? 1 : -1);
        uv0.push(px / 8, y / 3);
        uv1.push(1 - px / 8, y / 6);
        const t = px / (2 * (w - 1));
        joints.push(0, 1, 0, 0);
        weights.push(1 - t, t, 0, 0);
        morph.push(0, y === 1 ? 0.1 * x : 0, 0);
        morphNormals.push(0, 0, y === 1 ? 0.01 : 0);
        colors.push(255, x === 0 ? 200 : 255, 255, 255);
      }
    }
    const indices: number[] = [];
    for (let y = 0; y + 1 < h; y += 1) {
      for (let x = 0; x + 1 < w; x += 1) {
        const a = y * w + x;
        indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
      }
    }
    primitives.push({
      attributes: {
        POSITION: g.floats(Float32Array.from(positions), 'VEC3', ARRAY_BUFFER, true),
        NORMAL: g.floats(Float32Array.from(normals), 'VEC3', ARRAY_BUFFER),
        TANGENT: g.floats(Float32Array.from(tangents), 'VEC4', ARRAY_BUFFER),
        TEXCOORD_0: g.floats(Float32Array.from(uv0), 'VEC2', ARRAY_BUFFER),
        TEXCOORD_1: g.floats(Float32Array.from(uv1), 'VEC2', ARRAY_BUFFER),
        JOINTS_0: g.accessor(g.view(bytesOf(Uint8Array.from(joints)), ARRAY_BUFFER), UNSIGNED_BYTE, 'VEC4', w * h),
        WEIGHTS_0: g.floats(Float32Array.from(weights), 'VEC4', ARRAY_BUFFER),
        ...(part === 1 ? { COLOR_0: g.accessor(g.view(bytesOf(Uint8Array.from(colors)), ARRAY_BUFFER), UNSIGNED_BYTE, 'VEC4', w * h, { normalized: true }) } : {}),
      },
      indices: g.indices(Uint16Array.from(indices)),
      material: part,
      targets: [{
        POSITION: g.floats(Float32Array.from(morph), 'VEC3', ARRAY_BUFFER, true),
        NORMAL: g.floats(Float32Array.from(morphNormals), 'VEC3', ARRAY_BUFFER),
      }],
    });
  }
  const frames = 6;
  const time = g.floats(Float32Array.from({ length: frames }, (_, f) => f / 24), 'SCALAR', undefined, true);
  const rotations = new Float32Array(frames * 4);
  for (let f = 0; f < frames; f += 1) {
    const angle = f * 0.15;
    rotations.set([0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], f * 4);
  }
  const still = new Float32Array(frames * 3).fill(0);
  for (let f = 0; f < frames; f += 1) still.set([1, 0, 0], f * 3);
  const inverse = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1);
  return g.glb('cwlib-ts dev/import-fixtures gridGlb', {
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: 'root', children: [1], rotation: [0, 0.0499792, 0, 0.9987503] },
      { name: 'bend', translation: [1, 0, 0] },
      { name: 'grid', mesh: 0, skin: 0 },
    ],
    meshes: [{ primitives, weights: [0], extras: { targetNames: ['smile'] } }],
    skins: [{ joints: [0, 1], inverseBindMatrices: g.floats(inverse, 'MAT4', undefined) }],
    materials: [{ name: 'jam' }, { name: 'toast' }],
    animations: [{
      name: 'bend',
      channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }, { sampler: 1, target: { node: 1, path: 'translation' } }],
      samplers: [
        { input: time, output: g.floats(rotations, 'VEC4', undefined), interpolation: 'LINEAR' },
        { input: time, output: g.floats(still, 'VEC3', undefined), interpolation: 'LINEAR' },
      ],
    }],
  });
}

if (import.meta.main && process.argv[2]) {
  writeFileSync(path.join(process.argv[2], 'grid.glb'), gridGlb());
  console.log('wrote grid.glb');
}
