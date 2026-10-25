/**
 * An `RStaticMesh` -- a level's backdrop -- as a binary glTF 2.0: cwlib's
 * `MeshExporter.GLB.FromMesh(RStaticMesh)` (ennuo/toolkit `d6a2ef8`). One mesh,
 * a primitive per backdrop primitive under its material, positions, normals
 * and both UV channels, and the tangents with their handedness as `meshToGlb`
 * writes them (Java writes none), on a node named `bg` as Java names it. Materials come
 * as for a mesh (`gltfMaterials` in `gltf-material.ts`).
 *
 * Where this differs from Java, as `meshToGlb` does: the vertices are one set
 * of accessors indexed by each primitive's triangles, where Java cuts them at
 * the primitive's `vertexStart`; NaN is written 0. The baked light maps
 * (`lightmap`, `risemap`, `fallmap`) are not written, by Java either.
 */

import { ARRAY_BUFFER, GltfBuilder, type GltfOptions } from './gltf-builder.ts';
import { tangentsWithHandedness } from './mesh-gltf.ts';
import type { StaticMesh } from './staticmesh.ts';

export function staticMeshToGlb(mesh: StaticMesh, options: GltfOptions = {}): Uint8Array {
  const g = new GltfBuilder(options);
  const primitives: Record<string, unknown>[] = [];
  if (mesh.vertexCount > 0) {
    const attributes: Record<string, number> = {
      POSITION: g.floats(mesh.positions, 'VEC3', ARRAY_BUFFER, true),
      NORMAL: g.floats(mesh.normals, 'VEC3', ARRAY_BUFFER),
      TANGENT: g.floats(tangentsWithHandedness(mesh), 'VEC4', ARRAY_BUFFER),
      TEXCOORD_0: g.floats(mesh.uvs[0], 'VEC2', ARRAY_BUFFER),
      TEXCOORD_1: g.floats(mesh.uvs[1], 'VEC2', ARRAY_BUFFER),
    };
    for (const primitive of mesh.primitives) {
      if (primitive.triangles.length === 0) continue;
      primitives.push({
        attributes,
        indices: g.indices(primitive.triangles),
        mode: 4,
        ...(primitive.material ? { material: g.material(primitive.material) } : {}),
      });
    }
  }
  const meshes = primitives.length > 0 ? [{ primitives }] : [];
  return g.glb('cwlib-ts staticMeshToGlb', {
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name: 'bg', ...(meshes.length > 0 ? { mesh: 0 } : {}) }],
    ...(meshes.length > 0 ? { meshes } : {}),
  });
}
