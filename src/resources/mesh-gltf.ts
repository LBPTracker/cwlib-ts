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
 * - No vertex colour: `readMesh` does not return the stream Java writes as
 *   `COLOR_0`.
 */

import type { ResourceRef } from '../io/serializer.ts';
import { refKey, type GltfMaterial, type GltfTexture } from './gltf-material.ts';
import type { Mesh } from './mesh.ts';

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

export interface GltfOptions {
  /** Each material by `refKey`, as `gltfMaterials` makes them. */
  readonly materials?: ReadonlyMap<string, GltfMaterial>;
  /** A material's name where `materials` has none; by default `g<GUID>` or its hash in hex. */
  readonly materialName?: (material: ResourceRef) => string | undefined;
}

/** cwlib's `TextureWrap` as a glTF wrap: 1 repeat, 2 mirrored repeat, the clamps to the edge. */
const wrapOf = (wrap: number): number => (wrap === 1 ? 10497 : wrap === 2 ? 33648 : 33071);

/**
 * A sample's `u' = a·u + b·v + c`, `v' = d·u + e·v + f` as
 * `KHR_texture_transform`'s offset, rotation and scale (`uv' = T·R·S·uv`, `R`
 * the rotation by `rotation` counter-clockwise); undefined for the identity.
 * ⚠️ A shear has no place in it and is lost.
 */
function textureTransform([a, b, c, d, e, f]: GltfTexture['uvTransform']): Record<string, unknown> | undefined {
  if (a === 1 && b === 0 && c === 0 && d === 0 && e === 1 && f === 0) return undefined;
  if (b === 0 && d === 0) return { offset: [c, f], scale: [a, e] };
  const rotation = Math.atan2(-d, a);
  const sx = Math.hypot(a, d);
  const sy = b * Math.sin(rotation) + e * Math.cos(rotation);
  return { offset: [c, f], rotation, scale: [sx, sy] };
}

/** NaN written 0. */
const finite = (values: Float32Array): Float32Array => (values.some(Number.isNaN) ? values.map((v) => (Number.isNaN(v) ? 0 : v)) : values);

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
  const parts: Uint8Array[] = [];
  let length = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];

  /** A view onto bytes appended to the buffer, 4-aligned; its index. */
  const view = (bytes: Uint8Array, target?: number): number => {
    const pad = (4 - (length % 4)) % 4;
    if (pad > 0) {
      parts.push(new Uint8Array(pad));
      length += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    parts.push(bytes);
    length += bytes.length;
    return bufferViews.length - 1;
  };
  const bytesOf = (array: Float32Array | Uint8Array | Uint16Array): Uint8Array =>
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const accessor = (bufferView: number, componentType: number, type: string, count: number, extra: Record<string, unknown> = {}): number => {
    accessors.push({ bufferView, componentType, count, type, ...extra });
    return accessors.length - 1;
  };
  const bounds = (values: Float32Array): { min: number[]; max: number[] } => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      if (v < min[i % 3]) min[i % 3] = v;
      if (v > max[i % 3]) max[i % 3] = v;
    }
    return { min, max };
  };
  const vec3 = (values: Float32Array, withBounds: boolean): number =>
    accessor(view(bytesOf(finite(values)), ARRAY_BUFFER), FLOAT, 'VEC3', mesh.vertexCount, withBounds ? bounds(finite(values)) : {});

  const hasVertices = mesh.vertexCount > 0;
  const skinned = mesh.bones.length > 0;
  const attributes: Record<string, number> = {};
  let targets: Record<string, number>[] = [];
  if (hasVertices) {
    attributes.POSITION = vec3(mesh.positions, true);
    attributes.NORMAL = vec3(mesh.normals, false);
    mesh.uvs.forEach((uv, i) => {
      attributes[`TEXCOORD_${i}`] = accessor(view(bytesOf(finite(uv)), ARRAY_BUFFER), FLOAT, 'VEC2', mesh.vertexCount);
    });
    if (skinned) {
      const { joints, weights } = foldJoints(mesh.joints, mesh.weights);
      attributes.JOINTS_0 = accessor(view(bytesOf(joints), ARRAY_BUFFER), UNSIGNED_BYTE, 'VEC4', mesh.vertexCount);
      attributes.WEIGHTS_0 = accessor(view(bytesOf(weights), ARRAY_BUFFER), FLOAT, 'VEC4', mesh.vertexCount);
    }
    targets = mesh.morphs.map((morph) => ({ POSITION: vec3(morph.offsets, true), NORMAL: vec3(morph.normals, false) }));
  }

  const images: Record<string, unknown>[] = [];
  const imageIndex = new Map<Uint8Array, number>();
  const samplers: Record<string, unknown>[] = [];
  const textures: Record<string, unknown>[] = [];
  const textureIndex = new Map<string, number>();
  let transformed = false;
  const textureInfo = (texture: GltfTexture, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    let image = imageIndex.get(texture.png);
    if (image === undefined) {
      images.push({ name: texture.name, mimeType: 'image/png', bufferView: view(texture.png) });
      image = images.length - 1;
      imageIndex.set(texture.png, image);
    }
    const wrapS = wrapOf(texture.wrapS);
    const wrapT = wrapOf(texture.wrapT);
    let sampler = samplers.findIndex((s) => s.wrapS === wrapS && s.wrapT === wrapT);
    if (sampler < 0) sampler = samplers.push({ wrapS, wrapT }) - 1;
    const key = `${image}/${sampler}`;
    let index = textureIndex.get(key);
    if (index === undefined) {
      index = textures.push({ source: image, sampler }) - 1;
      textureIndex.set(key, index);
    }
    const transform = textureTransform(texture.uvTransform);
    if (transform) transformed = true;
    return {
      index, ...extra,
      ...(texture.texCoord !== 0 ? { texCoord: texture.texCoord } : {}),
      ...(transform ? { extensions: { KHR_texture_transform: transform } } : {}),
    };
  };

  const materials: Record<string, unknown>[] = [];
  const materialIndex = new Map<string, number>();
  const materialOf = (ref: ResourceRef): number => {
    const key = refKey(ref);
    let index = materialIndex.get(key);
    if (index === undefined) {
      index = materials.length;
      const made = options.materials?.get(key);
      materials.push(made === undefined
        ? { name: options.materialName?.(ref) ?? key, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0 } }
        : {
          name: made.name,
          pbrMetallicRoughness: {
            baseColorFactor: made.baseColorFactor ?? [1, 1, 1, 1],
            metallicFactor: 0,
            ...(made.baseColorTexture ? { baseColorTexture: textureInfo(made.baseColorTexture) } : {}),
          },
          ...(made.normalTexture ? { normalTexture: textureInfo(made.normalTexture) } : {}),
          ...(made.doubleSided ? { doubleSided: true } : {}),
          ...(made.alphaCutoff !== undefined ? { alphaMode: 'MASK', alphaCutoff: made.alphaCutoff } : {}),
        });
      materialIndex.set(key, index);
    }
    return index;
  };

  // Java's `getSubmeshes`: one mesh per region, here in the order regions first appear.
  const regions = new Map<number, Record<string, unknown>[]>();
  for (const primitive of mesh.primitives) {
    if (primitive.triangles.length === 0 || !hasVertices) continue;
    const indices = accessor(view(bytesOf(primitive.triangles), ELEMENT_ARRAY_BUFFER), UNSIGNED_SHORT, 'SCALAR', primitive.triangles.length);
    const list = regions.get(primitive.region) ?? [];
    regions.set(primitive.region, list);
    list.push({
      attributes,
      indices,
      mode: 4,
      ...(primitive.material ? { material: materialOf(primitive.material) } : {}),
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
      inverseBindMatrices: accessor(view(bytesOf(Float32Array.from(mesh.bones.flatMap((b) =>
        [...b.invSkinPose].map((v, i) => (i === 15 ? 1 : i % 4 === 3 ? 0 : v)))))), FLOAT, 'MAT4', mesh.bones.length),
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

  const json = {
    asset: { version: '2.0', generator: 'cwlib-ts meshToGlb' },
    ...(transformed ? { extensionsUsed: ['KHR_texture_transform'] } : {}),
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [armature, ...meshNodes] }],
    nodes,
    ...(meshes.length > 0 ? { meshes } : {}),
    ...(materials.length > 0 ? { materials } : {}),
    ...(textures.length > 0 ? { textures, images, samplers } : {}),
    ...(skins.length > 0 ? { skins } : {}),
    accessors,
    bufferViews,
    buffers: [{ byteLength: length }],
  };

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, JSON_CHUNK, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLength);
  let at = 20 + jsonLength;
  dv.setUint32(at, binLength, true);
  dv.setUint32(at + 4, BIN_CHUNK, true);
  at += 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
