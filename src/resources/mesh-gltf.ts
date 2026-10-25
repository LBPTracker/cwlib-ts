/**
 * An `RMesh` as a binary glTF 2.0 (`.glb`): cwlib's `MeshExporter.GLB.FromMesh`
 * (`io/exports/MeshExporter.java`, ennuo/toolkit `d6a2ef8`).
 *
 * What goes in: one glTF mesh per `region` of the primitives, as Java's
 * `getSubmeshes` groups them, each primitive a triangle list under its material;
 * positions, normals, every UV channel; the bones as nodes with a skin, joints
 * and weights; the morphs as targets named in `extras.targetNames`, as Java
 * names them. A material is what `gltfMaterials` (`gltf-material.ts`) made of
 * it -- its textures embedded as PNG, a sample's UV transform as
 * `KHR_texture_transform`, its wrap as a sampler -- or else a name and a white
 * base colour, the name the caller's (`materialName`).
 *
 * Where this differs from Java (lbp-modding-toolchain.md, *Where we
 * deliberately differ*):
 * - **The vertices are one set of accessors, shared, and the indices index
 *   them.** Java cuts each primitive's accessors at `minVert..maxVert`, which on
 *   six of the game's meshes is no bound at all (`MeshPrimitive.minVert`).
 * - **A float that is no number is written 0.** glTF refuses NaN: one mesh,
 *   `c7a1a3b0`, has 21 in its morphs (`MeshMorph`), and `22e0a38f` 20 in its
 *   second UV channel.
 * - **A joint named twice on a vertex is named once**, its weights added, and a
 *   slot of no weight names joint 0. The remainder weight (`readMesh`) goes to
 *   the fourth joint byte, which on 335,720 of the game's vertices is another
 *   slot's joint again; skinning adds the two, so one slot is the same pose,
 *   and glTF refuses the repeat.
 * - **An inverse bind matrix's last row is written (0, 0, 0, 1)**, which the
 *   game's are only to a float step; glTF wants it exact.
 * - **A mesh with no vertices** -- the game has two, `9cb6855f` and
 *   `d875feda`, skeletons of 43 bones -- **is written as its skeleton**, with
 *   no glTF mesh.
 * - **A mesh's node sits at the scene's root**, beside the armature, as glTF
 *   advises for a skinned mesh; Java hangs it under the armature.
 * - **A tangent's w is the vertex's handedness, made from the geometry**,
 *   where Java writes 1: the stream stores none. glTF's normal map has +Y up in
 *   the image, toward `v = 0`, so w is the sign that turns `normal × tangent`
 *   that way, against `∂P/∂v` summed over the vertex's triangles on the
 *   tangent's UV channel; 1 where there is none. It comes out +1 on 82% of the
 *   game's vertices.
 * - **The softbody weight is `_SOFTBODY_WEIGHT`, a float per vertex, and only
 *   where some vertex is below 1** (1,063 of the game's meshes). Java writes it
 *   on every mesh as `_VERTEX_MASS`, the weight in a grey unsigned-short VEC4.
 */

import { ARRAY_BUFFER, GltfBuilder, UNSIGNED_BYTE, bytesOf, type GltfOptions } from './gltf-builder.ts';
import { uvHandedness, type Mesh, type TangentFramed } from './mesh.ts';

export type { GltfOptions } from './gltf-builder.ts';

/**
 * A column-major affine matrix as glTF's translation, rotation and scale,
 * as Java's `createNode` makes them (`Matrix4f.getScale`, `Quaternionf.setFromUnnormalized`).
 */
function trs(m: ArrayLike<number>): { translation: number[]; rotation: number[]; scale: number[] } {
  const column = (c: number): number[] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const scale = [0, 1, 2].map((c) => Math.hypot(...column(c)));
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) scale[0] = -scale[0];
  const r = (row: number, col: number): number => m[col * 4 + row] / scale[col];
  const trace = r(0, 0) + r(1, 1) + r(2, 2);
  let q: number[];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(r(2, 1) - r(1, 2)) / s, (r(0, 2) - r(2, 0)) / s, (r(1, 0) - r(0, 1)) / s, s / 4];
  } else if (r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2)) {
    const s = Math.sqrt(1 + r(0, 0) - r(1, 1) - r(2, 2)) * 2;
    q = [s / 4, (r(0, 1) + r(1, 0)) / s, (r(0, 2) + r(2, 0)) / s, (r(2, 1) - r(1, 2)) / s];
  } else if (r(1, 1) > r(2, 2)) {
    const s = Math.sqrt(1 + r(1, 1) - r(0, 0) - r(2, 2)) * 2;
    q = [(r(0, 1) + r(1, 0)) / s, s / 4, (r(1, 2) + r(2, 1)) / s, (r(0, 2) - r(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + r(2, 2) - r(0, 0) - r(1, 1)) * 2;
    q = [(r(0, 2) + r(2, 0)) / s, (r(1, 2) + r(2, 1)) / s, s / 4, (r(1, 0) - r(0, 1)) / s];
  }
  const length = Math.hypot(...q);
  return { translation: [m[12], m[13], m[14]], rotation: q.map((v) => v / length), scale };
}

/**
 * Each vertex's joints with a repeat folded into its first slot, weight and
 * all, and a slot of no weight naming joint 0, as glTF advises.
 */
function foldJoints(joints: Uint8Array, weights: Float32Array): { joints: Uint8Array; weights: Float32Array } {
  const j = joints.slice();
  const w = weights.slice();
  for (let v = 0; v < j.length; v += 4) {
    for (let a = 1; a < 4; a += 1) {
      for (let b = 0; b < a; b += 1) {
        if (j[v + a] !== j[v + b] || w[v + a] === 0) continue;
        w[v + b] += w[v + a];
        w[v + a] = 0;
        break;
      }
    }
    for (let a = 0; a < 4; a += 1) if (w[v + a] === 0) j[v + a] = 0;
  }
  return { joints: j, weights: w };
}

/**
 * The tangents as glTF's VEC4: xyz as `readMesh` gives them, w the handedness
 * (header) -- `uvHandedness` turned round, glTF's +Y running toward `v = 0`.
 */
export function tangentsWithHandedness(mesh: TangentFramed): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 4);
  const hand = uvHandedness(mesh);
  const tg = mesh.tangents;
  for (let v = 0; v < mesh.vertexCount; v += 1) {
    const i = v * 3;
    out.set([
      Number.isNaN(tg[i]) ? 0 : tg[i], Number.isNaN(tg[i + 1]) ? 0 : tg[i + 1], Number.isNaN(tg[i + 2]) ? 0 : tg[i + 2],
      hand[v] > 0 ? -1 : 1,
    ], v * 4);
  }
  return out;
}

/** Column-major `a × b`. */
function multiply(a: Float32Array, b: Float32Array): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Write a mesh as a `.glb`. */
export function meshToGlb(mesh: Mesh, options: GltfOptions = {}): Uint8Array {
  const g = new GltfBuilder(options);
  const hasVertices = mesh.vertexCount > 0;
  const skinned = mesh.bones.length > 0;
  const attributes: Record<string, number> = {};
  let targets: Record<string, number>[] = [];
  if (hasVertices) {
    attributes.POSITION = g.floats(mesh.positions, 'VEC3', ARRAY_BUFFER, true);
    attributes.NORMAL = g.floats(mesh.normals, 'VEC3', ARRAY_BUFFER);
    attributes.TANGENT = g.floats(tangentsWithHandedness(mesh), 'VEC4', ARRAY_BUFFER);
    if (mesh.softbodyWeights.some((w) => w < 1)) attributes._SOFTBODY_WEIGHT = g.floats(mesh.softbodyWeights, 'SCALAR', ARRAY_BUFFER);
    mesh.uvs.forEach((uv, i) => {
      attributes[`TEXCOORD_${i}`] = g.floats(uv, 'VEC2', ARRAY_BUFFER);
    });
    if (skinned) {
      const { joints, weights } = foldJoints(mesh.joints, mesh.weights);
      attributes.JOINTS_0 = g.accessor(g.view(bytesOf(joints), ARRAY_BUFFER), UNSIGNED_BYTE, 'VEC4', mesh.vertexCount);
      attributes.WEIGHTS_0 = g.floats(weights, 'VEC4', ARRAY_BUFFER);
    }
    targets = mesh.morphs.map((morph) => ({
      POSITION: g.floats(morph.offsets, 'VEC3', ARRAY_BUFFER, true),
      NORMAL: g.floats(morph.normals, 'VEC3', ARRAY_BUFFER),
    }));
  }

  // Java's `getSubmeshes`: one mesh per region, here in the order regions first appear.
  const regions = new Map<number, Record<string, unknown>[]>();
  for (const primitive of mesh.primitives) {
    if (primitive.triangles.length === 0 || !hasVertices) continue;
    const list = regions.get(primitive.region) ?? [];
    regions.set(primitive.region, list);
    list.push({
      attributes,
      indices: g.indices(primitive.triangles),
      mode: 4,
      ...(primitive.material ? { material: g.material(primitive.material) } : {}),
      ...(targets.length > 0 ? { targets } : {}),
    });
  }
  const meshes = [...regions.values()].map((primitives) => ({
    primitives,
    ...(targets.length > 0 ? { weights: targets.map(() => 0), extras: { targetNames: mesh.morphNames } } : {}),
  }));

  // The bones first, so a bone's node index is its own; then one node per mesh.
  const nodes: Record<string, unknown>[] = mesh.bones.map((bone, i) => {
    const local = bone.parent < 0 ? [...bone.skinPose] : multiply(mesh.bones[bone.parent].invSkinPose, bone.skinPose);
    const children = mesh.bones.flatMap((other, j) => (other.parent === i ? [j] : []));
    return { name: bone.name, ...trs(local), ...(children.length > 0 ? { children } : {}) };
  });
  const skins = skinned
    ? [{
      joints: mesh.bones.map((_, i) => i),
      inverseBindMatrices: g.floats(Float32Array.from(mesh.bones.flatMap((b) =>
        [...b.invSkinPose].map((v, i) => (i === 15 ? 1 : i % 4 === 3 ? 0 : v)))), 'MAT4', undefined),
    }]
    : [];
  const meshNodes = meshes.map((_, i) => {
    nodes.push({ mesh: i, ...(skinned ? { skin: 0 } : {}) });
    return nodes.length - 1;
  });
  // A skinned mesh's node at the scene's root, beside the skeleton, as glTF advises; Java hangs it under the armature.
  const roots = mesh.bones.flatMap((b, i) => (b.parent < 0 ? [i] : []));
  nodes.push({ name: 'Armature', ...(roots.length > 0 ? { children: roots } : {}) });
  const armature = nodes.length - 1;

  return g.glb('cwlib-ts meshToGlb', {
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [armature, ...meshNodes] }],
    nodes,
    ...(meshes.length > 0 ? { meshes } : {}),
    ...(skins.length > 0 ? { skins } : {}),
  });
}
