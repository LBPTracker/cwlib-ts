/**
 * An `RMesh` as Wavefront OBJ text: cwlib's `MeshExporter.OBJ.export`
 * (`io/exports/MeshExporter.java`, ennuo/toolkit `d6a2ef8`). The bind pose, as
 * stored: `v` and `vn` per vertex, `vt` from one UV channel with `v` turned
 * over (OBJ's `v` runs up the image), and each primitive's triangles as `f`
 * with one 1-based index for all three.
 *
 * Where this differs from Java: a primitive opens with `usemtl` when the
 * caller names its material (`materialName`), and a primitive that repeats
 * another's run (`MeshPrimitive.triangles`) is written once; Java writes every
 * primitive under no material.
 */

import type { ResourceRef } from '../io/serializer.ts';
import type { Mesh } from './mesh.ts';

export interface ObjOptions {
  /** The UV channel written as `vt`; 0 by default, as Java's `export(path, mesh)`. */
  readonly channel?: number;
  /** A primitive's material name, for `usemtl`; none written where this gives none. */
  readonly materialName?: (material: ResourceRef) => string | undefined;
}

/** `%f`-free numbers: the shortest text that reads back as the same float. */
const num = (x: number): string => (Number.isFinite(x) ? String(Math.fround(x)) : '0');

export function meshToObj(mesh: Mesh, { channel = 0, materialName }: ObjOptions = {}): string {
  const lines: string[] = [];
  const p = mesh.positions;
  const n = mesh.normals;
  const uv = mesh.uvs[channel];
  for (let v = 0; v < mesh.vertexCount; v += 1) lines.push(`v ${num(p[v * 3])} ${num(p[v * 3 + 1])} ${num(p[v * 3 + 2])}`);
  for (let v = 0; v < mesh.vertexCount; v += 1) lines.push(`vn ${num(n[v * 3])} ${num(n[v * 3 + 1])} ${num(n[v * 3 + 2])}`);
  if (uv !== undefined) {
    for (let v = 0; v < mesh.vertexCount; v += 1) lines.push(`vt ${num(uv[v * 2])} ${num(1 - uv[v * 2 + 1])}`);
  }
  const seen = new Set<string>();
  for (const primitive of mesh.primitives) {
    const run = `${primitive.firstIndex}/${primitive.numIndices}`;
    if (seen.has(run)) continue;
    seen.add(run);
    const name = primitive.material && materialName?.(primitive.material);
    if (name !== undefined) lines.push(`usemtl ${name}`);
    const t = primitive.triangles;
    const corner = (i: number): string => (uv !== undefined ? `${i}/${i}/${i}` : `${i}//${i}`);
    for (let i = 0; i + 2 < t.length; i += 3) lines.push(`f ${corner(t[i] + 1)} ${corner(t[i + 1] + 1)} ${corner(t[i + 2] + 1)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A mesh's softbody springs as OBJ -- cwlib's `MeshExporter.OBJ.exportsprings`:
 * the vertices `minSpringVert` to `maxSpringVert`, each with its softbody
 * weight in a comment, and each spring an `l` line between them. The springs
 * number their vertices from `minSpringVert` (`MeshTail.softbodySprings`), so
 * the lines' 1-based indices are theirs plus one.
 */
export function meshSpringsToObj(mesh: Mesh): string {
  const p = mesh.positions;
  const lines: string[] = [];
  const { minSpringVert, maxSpringVert } = mesh.tail;
  for (let v = minSpringVert; v <= maxSpringVert && v < mesh.vertexCount; v += 1) {
    lines.push(`v ${num(p[v * 3])} ${num(p[v * 3 + 1])} ${num(p[v * 3 + 2])} # weight = ${mesh.softbodyWeights[v].toFixed(6)}`);
  }
  for (const spring of mesh.tail.softbodySprings) lines.push(`l ${spring.a + 1} ${spring.b + 1}`);
  return `${lines.join('\n')}\n`;
}

/**
 * The vertices of one softbody cluster as OBJ points, each with its weight in
 * a comment -- cwlib's `MeshExporter.OBJ.exportcluster`, which writes no faces
 * either (its loop over them is commented out).
 */
export function meshClusterToObj(mesh: Mesh, cluster: number): string {
  const p = mesh.positions;
  const lines: string[] = [];
  for (let v = 0; v < mesh.vertexCount; v += 1) {
    if (mesh.softbodyClusterIndices[v] !== cluster) continue;
    lines.push(`v ${num(p[v * 3])} ${num(p[v * 3 + 1])} ${num(p[v * 3 + 2])} # weight = ${mesh.softbodyWeights[v].toFixed(6)}`);
  }
  return `${lines.join('\n')}\n`;
}
