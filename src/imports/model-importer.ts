/**
 * A glTF model as an `RMesh`: Java cwlib's `io/imports/ModelImporter.java`
 * (ennuo/toolkit `d6a2ef8`), ported.
 *
 * What it does, as Java does:
 * - Every node with a mesh, in node order, adds each of its mesh's primitives:
 *   their vertices (scaled and offset by the config), weights and joints --
 *   a joint found among the skeleton's bones by its node's name, through
 *   `boneRemap`, bone 0 where none is -- normal, tangent, up to three UV
 *   channels, morph targets (named by the mesh's `extras.targetNames`, else
 *   `Morph_i`) and a softbody mass from `COLOR_0`, each primitive a draw of its
 *   material: `materialOverrides` by the glTF material's name, else GUID 10803.
 * - The vertex count is padded up to a multiple of 8 with zero vertices put
 *   **in front**, so every primitive starts 8-aligned plus the padding.
 * - The skeleton is the given one (Java's default: Sackboy's, out of the
 *   toolkit's `characters.boneset`), or with `skeleton: null` the glTF's
 *   skins: a bone per joint, posed by its node's TRS made global down the
 *   joint hierarchy, its inverse bind matrix as stored. No skin at all is one
 *   bone, `BocchiTheRock!`, as Java names it.
 * - Then `calculateBoundBoxes`, the costume fields, `strip` and
 *   `calculateSmoothNormals` (`mesh-builder.ts`).
 *
 * Weights are written truncated, `(int)(w * 255)` -- `254` when a second
 * weight is non-zero -- and normals packed truncated, as Java's `Bytes` at
 * `d6a2ef8` does; the mesh is Java's to the byte, smooth normals and edge list
 * included (`test/imports.test.ts`, `dev/import-java.ts`).
 *
 * Where this differs from Java, on purpose:
 * - **Primitives that share one set of accessors share their vertices**
 *   (`shareAccessors`, on by default), across nodes too where the skin and
 *   the morph names are the same. This library's `meshToGlb` writes every
 *   primitive -- of every region's glTF mesh -- over one set of accessors, and
 *   Java adds the whole vertex set again for each one; `shareAccessors: false`
 *   does as Java does.
 * - **A Java tree bin is not reproducible.** Where a `HashSet` the build
 *   iterates (edges, smooth-normal triangles) puts nine equal hashes in one
 *   bucket, Java orders them by identity hashes; `MeshImport.notes` says so
 *   (`java-hash.ts`).
 * - **A joint hierarchy with a cycle is refused**, where Java overflows its stack.
 * - **What Java dereferences as null is a value here**: a primitive with no
 *   `TEXCOORD_n` while others have one writes zeros (Java throws a
 *   `NullPointerException`), one with no material takes GUID 10803, one with no
 *   indices draws its vertices in order.
 * - **Accessors are read by their component type**: indices of 8 or 32 bits,
 *   weights and `COLOR_0` as normalized integers or floats, which Java reads as
 *   shorts and floats whatever they are. A float `COLOR_0` is a mass of
 *   `round(c * 255)`; this library's own `_SOFTBODY_WEIGHT` (`meshToGlb`) is
 *   read as one when there is no `COLOR_0`.
 * - **A soft mesh is not an exit.** Java ends the process (`System.exit(0)`)
 *   when a primitive has a mass and three vertices of mass at or below 250
 *   form a triangle, its spring generation commented out; here the masses are
 *   written and no springs are made (`MeshImport.springyTriangles` counts what
 *   Java would have stopped on).
 *
 * ⚠️ Faithful to Java and lossy on a round trip (`dev/import-roundtrip.ts`):
 * a morph target's `NORMAL` is taken as a delta and added to the vertex
 * normal, as glTF means it -- `meshToGlb` writes the game's absolute morph
 * normals, so they come back wrong; NvTriStrip turns the winding of some
 * triangles round; a bind pose with shear does not survive glTF's TRS.
 */

import type { ResourceRef, RevisionInfo } from '../io/serializer.ts';
import type { Mesh } from '../resources/mesh.ts';
import type { Skeleton } from '../resources/bone-set.ts';
import { COMPONENT_FLOAT, COMPONENT_SHORT, COMPONENT_UNSIGNED_SHORT, Gltf, type GltfNode, type GltfPrimitive } from './gltf-read.ts';
import { JavaHashSet } from './java-hash.ts';
import { f, identity4, mat4, mul4, toInt, translationRotateScale } from './joml.ts';
import {
  ByteStream, MAX_MORPHS, MeshBuild,
  newBone, packNormal24, packNormal32, skeletonOf, toMesh, type BuildNotes, type JBone, type JPrimitive,
} from './mesh-builder.ts';

/** `ResourceDescriptor(10803, GFX_MATERIAL)`: the material Java gives a primitive no override names. */
export const DEFAULT_MATERIAL: ResourceRef = { guid: 10803 };

export interface ModelImportConfig {
  /** Multiplies every position, morph targets' included. Default 1. */
  readonly vertexScale?: number;
  /** Added to every position -- and, as Java does, to every morph target's offset. Default zero. */
  readonly vertexOffset?: readonly [number, number, number];
  /** A glTF joint's name to the skeleton bone it skins to. */
  readonly boneRemap?: Readonly<Record<string, string>>;
  /** A glTF material's name to the `RGfxMaterial` its primitives draw with. */
  readonly materialOverrides?: Readonly<Record<string, ResourceRef>>;
  /** cwlib's `CostumePieceCategory` indices (0 beard ... 13 waist) the piece takes up. */
  readonly categories?: readonly number[];
  /** Region ids of the wearer's mesh this piece hides. */
  readonly regionIDsToHide?: readonly number[];
  /** cwlib's `HairMorph`: 0 hat (Java's default), 1 helmet, 2 fringe. */
  readonly hairMorph?: number;
  /**
   * The skeleton to skin to -- a `Skeleton` of the toolkit's
   * `characters.boneset` (`readBoneSet`), which Java's default, Sackboy's, is
   * the first of -- or `null` for the glTF's own skins. Default `null`: this
   * library ships no bone set.
   */
  readonly skeleton?: Skeleton | null;
  /** cwlib's `SkeletonType` the mesh is stamped with (0 sackboy ... 4 quad). Default 0, as Java's. */
  readonly skeletonType?: number;
  /** Read this library's `_SOFTBODY_WEIGHT` (`meshToGlb`) as the mass where there is no `COLOR_0` (default true); Java reads only `COLOR_0`. */
  readonly readSoftbodyWeight?: boolean;
  /** Primitives over the same accessors share vertices (default true); false adds them again, as Java. */
  readonly shareAccessors?: boolean;
  /** The revision the `Mesh` value carries; what the payload is written at is `encodeMesh`'s header. */
  readonly revision?: RevisionInfo;
}

export interface MeshImport {
  readonly mesh: Mesh;
  /** Each glTF material index (`-1` for none) to the mesh primitives drawn with it: Java's `getPrimitiveMappings`. */
  readonly materialPrimitives: ReadonlyMap<number, number>;
  /** Triangles of three vertices of mass 250 or below: where Java would have exited. */
  readonly springyTriangles: number;
  readonly notes: BuildNotes;
}

export class ModelImportError extends Error {}

/** LBP3's newest mesh revision, the default a `Mesh` value says it is. */
export const DEFAULT_MESH_REVISION: RevisionInfo = { version: 0x3f8, subVersion: 0x16b, branchId: 0, branchRevision: 0 };

/** The bytes of a glTF or `.glb`, or one already opened. */
export type GltfSource = Uint8Array | Gltf;

const open = (source: GltfSource): Gltf => (source instanceof Gltf ? source : Gltf.read(source));

/** `ModelImporter.getMesh()`. */
export function importModel(source: GltfSource, config: ModelImportConfig = {}): MeshImport {
  const gltf = open(source);
  const scale = config.vertexScale ?? 1;
  const offset = config.vertexOffset ?? [0, 0, 0];
  const share = config.shareAccessors ?? true;
  const meshNodes = gltf.nodes.filter((node) => node.mesh !== undefined);
  const primitivesOf = (meshIndex: number): GltfPrimitive[] => gltf.meshes[meshIndex]?.primitives ?? [];

  for (const node of meshNodes) {
    for (const p of primitivesOf(node.mesh!)) {
      if (p.attributes.TANGENT === undefined) {
        throw new ModelImportError('Model is missing tangents, this will cause issues with normals! Please re-export model with tangents!');
      }
    }
  }

  // The skeleton.
  let bones: JBone[];
  let skeleton: ReturnType<typeof skeletonOf> | undefined;
  if (config.skeleton) {
    skeleton = skeletonOf(config.skeleton);
    bones = skeleton.bones;
  } else bones = customSkeleton(gltf);
  const jointLookup = new Map<string | null, number>();
  bones.forEach((bone, i) => jointLookup.set(bone.name, i));
  const jointIndex = (nodeIndex: number): number => {
    const raw = gltf.nodes[nodeIndex]?.name ?? null;
    const name = raw !== null && config.boneRemap && Object.hasOwn(config.boneRemap, raw) ? config.boneRemap[raw] : raw;
    return jointLookup.get(name) ?? 0;
  };

  // Which primitives bring vertices of their own.
  // One vertex set per set of accessors under one skin and one list of morph names, across nodes.
  const keyOf = (p: GltfPrimitive, node: GltfNode): string => JSON.stringify([
    Object.entries(p.attributes).sort(), (p.targets ?? []).map((t) => Object.entries(t).sort()), node.skin ?? -1,
    gltf.meshes[node.mesh!]?.extras?.targetNames ?? null,
  ]);
  const vertexCountOf = (p: GltfPrimitive): number => {
    const position = p.attributes.POSITION;
    if (position === undefined) throw new ModelImportError('a primitive with no POSITION');
    return gltf.accessor(position).count;
  };
  const indexCountOf = (p: GltfPrimitive): number => (p.indices === undefined ? vertexCountOf(p) : gltf.accessor(p.indices).count);
  let totalVerts = 0;
  let totalIndices = 0;
  const seen = new Set<string>();
  for (const node of meshNodes) {
    for (const p of primitivesOf(node.mesh!)) {
      const key = keyOf(p, node);
      if (!share || !seen.has(key)) totalVerts += vertexCountOf(p);
      seen.add(key);
      totalIndices += indexCountOf(p);
    }
  }
  if (totalVerts >= 0xffff) throw new ModelImportError("Max vertex count is 65,535, can't import model!");
  let pad = 0;
  if (totalVerts % 8 !== 0) {
    pad = 8 - (totalVerts % 8);
    totalVerts += pad;
  }
  let vertexOffset = pad;
  let indexOffset = 0;

  let attributeCount = 0;
  let morphCount = 0;
  for (const node of meshNodes) {
    for (const p of primitivesOf(node.mesh!)) {
      for (let i = 0; i < 3; i += 1) {
        if (p.attributes[`TEXCOORD_${i}`] === undefined) break;
        if (i + 1 > attributeCount) attributeCount = i + 1;
      }
      morphCount = Math.max(morphCount, p.targets?.length ?? 0);
    }
  }
  if (morphCount >= MAX_MORPHS) throw new ModelImportError("Max morph count is 32, can't import model!");

  const vertexStream = new ByteStream(totalVerts * 16);
  const skinStream = new ByteStream(totalVerts * 16);
  const morphStreams = Array.from({ length: morphCount }, () => new ByteStream(totalVerts * 16));
  for (const s of [vertexStream, skinStream, ...morphStreams]) s.clear(pad * 16);
  const attributeStream = new ByteStream(totalVerts * attributeCount * 8);
  attributeStream.clear(pad * attributeCount * 8);
  const indexStream = new ByteStream(totalIndices * 2);

  const morphs: string[] = [];
  const targetLookup = new Map<string, number>();
  const targetIndex = (name: string): number => {
    let index = targetLookup.get(name);
    if (index === undefined) {
      index = morphs.length;
      morphs.push(name);
      targetLookup.set(name, index);
    }
    return index;
  };
  const minUV = [Infinity, Infinity];
  const maxUV = [-Infinity, -Infinity];
  const primitives: JPrimitive[] = [];
  const materialPrimitives = new Map<number, number>();
  let springyTriangles = 0;

  const shared = new Map<string, { minVert: number; maxVert: number }>();
  for (const node of meshNodes) {
    const gmesh = gltf.meshes[node.mesh!];
    const targetNames = gmesh.extras?.targetNames ?? Array.from({ length: morphCount }, (_, i) => `Morph_${i}`);
    const skin = node.skin === undefined ? undefined : gltf.skins[node.skin];
    for (const p of gmesh.primitives) {
      const numVertices = vertexCountOf(p);
      const numIndices = indexCountOf(p);
      const firstIndex = indexOffset;
      indexOffset += numIndices;
      const key = keyOf(p, node);
      const again = share ? shared.get(key) : undefined;
      let minVert: number;
      let maxVert: number;
      let masses: Int32Array | undefined;
      if (again) {
        ({ minVert, maxVert } = again);
      } else {
        minVert = vertexOffset;
        maxVert = minVert + numVertices;
        vertexOffset += numVertices;
        shared.set(key, { minVert, maxVert });
        masses = addVertices(p, minVert);
      }
      // The indices, and the triangles Java would have stopped on.
      const local = p.indices === undefined ? Float64Array.from({ length: numIndices }, (_, i) => i) : gltf.values(p.indices);
      for (let i = 0; i + 2 < numIndices; i += 3) {
        const f0 = (local[i] & 0xffff) + minVert;
        const f1 = (local[i + 1] & 0xffff) + minVert;
        const f2 = (local[i + 2] & 0xffff) + minVert;
        if (masses && masses[f0 - minVert] <= 0xfa && masses[f1 - minVert] <= 0xfa && masses[f2 - minVert] <= 0xfa) springyTriangles += 1;
        indexStream.u16(f0);
        indexStream.u16(f1);
        indexStream.u16(f2);
      }
      const materialName = p.material === undefined ? undefined : gltf.json.materials?.[p.material]?.name;
      const material = materialName !== undefined && config.materialOverrides && Object.hasOwn(config.materialOverrides, materialName)
        ? config.materialOverrides[materialName]
        : DEFAULT_MATERIAL;
      primitives.push({ material, minVert, maxVert, firstIndex, numIndices, region: 0 });
      materialPrimitives.set(p.material ?? -1, primitives.length - 1);
    }

    /** One primitive's vertices into the streams at `minVert`; their masses where it has some. */
    function addVertices(p: GltfPrimitive, minVert: number): Int32Array | undefined {
      const n = vertexCountOf(p);
      const positions = gltf.floats(p.attributes.POSITION);
      const massAccessor = p.attributes.COLOR_0 ?? (config.readSoftbodyWeight ?? true ? p.attributes._SOFTBODY_WEIGHT : undefined);
      let massValues: Float64Array | undefined;
      let massPer = 1;
      let massType = 0;
      if (massAccessor !== undefined) {
        massValues = gltf.values(massAccessor);
        massPer = gltf.components(massAccessor);
        massType = gltf.accessor(massAccessor).componentType;
      }
      const masses = massValues ? new Int32Array(n) : undefined;
      for (let i = 0; i < n; i += 1) {
        const x = f(f(f(positions[i * 3]) * scale) + offset[0]);
        const y = f(f(f(positions[i * 3 + 1]) * scale) + offset[1]);
        const z = f(f(f(positions[i * 3 + 2]) * scale) + offset[2]);
        vertexStream.f32(x);
        vertexStream.f32(y);
        vertexStream.f32(z);
        let mass = 0xff;
        if (massValues && masses) {
          const raw = massValues[i * massPer];
          if (massType === COMPONENT_UNSIGNED_SHORT || massType === COMPONENT_SHORT) mass = Math.round(f(f((raw & 0xffff) / 0xffff) * 0xff)) & 0xff;
          else if (massType === COMPONENT_FLOAT) mass = Math.max(0, Math.min(0xff, Math.round(raw * 0xff)));
          else mass = raw & 0xff;
          masses[i] = mass;
        }
        vertexStream.u8(0);
        vertexStream.u8(0);
        vertexStream.u8(0);
        vertexStream.u8(mass);
      }

      const weights = p.attributes.WEIGHTS_0 === undefined ? undefined : gltf.unitFloats(p.attributes.WEIGHTS_0);
      const joints = p.attributes.JOINTS_0 === undefined ? undefined : gltf.values(p.attributes.JOINTS_0);
      if (p.attributes.NORMAL === undefined) throw new ModelImportError('a primitive with no NORMAL, which Java dereferences');
      const normals = gltf.floats(p.attributes.NORMAL);
      const tangents = gltf.floats(p.attributes.TANGENT);
      const uvs = [0, 1, 2].map((c) => (p.attributes[`TEXCOORD_${c}`] === undefined ? undefined : gltf.floats(p.attributes[`TEXCOORD_${c}`])));
      const targets = p.targets ?? [];
      const targetPositions = targets.map((t) => {
        if (t.POSITION === undefined) throw new ModelImportError('A morph stream is missing position accessors!');
        return gltf.floats(t.POSITION);
      });
      const targetNormals = targets.map((t) => {
        if (t.NORMAL === undefined) throw new ModelImportError('A morph stream is missing normal accessors!');
        return gltf.floats(t.NORMAL);
      });
      const targetStreams = n === 0 ? [] : targets.map((_, j) => {
        const name = targetNames[j];
        if (name === undefined) throw new ModelImportError(`morph target ${j} has no name in extras.targetNames`);
        const stream = morphStreams[targetIndex(name)];
        if (stream === undefined) throw new ModelImportError(`morph "${name}" is past the ${morphCount} morph streams`);
        return stream;
      });
      const jointCache = [0, 0, 0, 0];
      const weightCache = [1, 0, 0, 0];
      for (let i = 0; i < n; i += 1) {
        weightCache[0] = 1;
        weightCache[1] = weightCache[2] = weightCache[3] = 0;
        if (weights) for (let j = 0; j < 4; j += 1) weightCache[j] = weights[i * 4 + j];
        if (skin === undefined || joints === undefined) {
          jointCache.fill(0);
        } else {
          for (let j = 0; j < 4; j += 1) {
            const joint = joints[i * 4 + j] & 0xff;
            const nodeIndex = skin.joints[joint];
            if (nodeIndex === undefined) throw new ModelImportError(`joint ${joint} is past the skin's ${skin.joints.length}`);
            jointCache[j] = jointIndex(nodeIndex);
          }
        }
        const s = weightCache[1] !== 0 ? 0xfe : 0xff;
        skinStream.u8(toInt(f(weightCache[2] * s)));
        skinStream.u8(toInt(f(weightCache[1] * s)));
        skinStream.u8(toInt(f(weightCache[0] * s)));
        skinStream.u8(jointCache[0]);
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        skinStream.u24(packNormal24(nx, ny, nz));
        skinStream.u8(jointCache[1]);
        // The normal again where the smooth normal goes; `calculateSmoothNormals` writes it.
        skinStream.u24(packNormal24(nx, ny, nz));
        skinStream.u8(jointCache[2]);
        skinStream.u24(packNormal24(tangents[i * 4], tangents[i * 4 + 1], tangents[i * 4 + 2]));
        skinStream.u8(jointCache[3]);

        for (let j = 0; j < attributeCount; j += 1) {
          const uv = uvs[j];
          if (uv === undefined) {
            attributeStream.clear(8); // Java: a NullPointerException
            continue;
          }
          const u = uv[i * 2];
          const v = uv[i * 2 + 1];
          if (u > maxUV[0]) maxUV[0] = u;
          if (v > maxUV[1]) maxUV[1] = v;
          if (u < minUV[0]) minUV[0] = u;
          if (v < minUV[1]) minUV[1] = v;
          attributeStream.f32(u);
          attributeStream.f32(v);
        }

        for (let j = 0; j < targets.length; j += 1) {
          const stream = targetStreams[j];
          stream.seek((i + minVert) * 0x10);
          const tp = targetPositions[j];
          const tn = targetNormals[j];
          stream.f32(f(f(tp[i * 3] * scale) + offset[0]));
          stream.f32(f(f(tp[i * 3 + 1] * scale) + offset[1]));
          stream.f32(f(f(tp[i * 3 + 2] * scale) + offset[2]));
          stream.i32(packNormal32(f(tn[i * 3] + nx), f(tn[i * 3 + 1] + ny), f(tn[i * 3 + 2] + nz)));
        }
      }
      return masses;
    }
  }

  const build = new MeshBuild(
    [vertexStream.whole(), skinStream.whole(), ...morphStreams.map((s) => s.whole())],
    attributeStream.whole(),
    indexStream.whole(),
    bones,
  );
  if (skeleton) build.applySkeleton(skeleton);
  for (let i = 0; i < morphs.length; i += 1) build.morphNames[i] = morphs[i].length > 15 ? morphs[i].slice(0, 15) : morphs[i];
  build.primitives = primitives;
  build.minUV = minUV;
  build.maxUV = maxUV;
  build.calculateBoundBoxes(!config.skeleton);
  // A HashSet<Integer> iterated, as Java fills the region array.
  const regions = new JavaHashSet<number>();
  for (const region of config.regionIDsToHide ?? []) regions.add(String(region), region | 0, region | 0);
  build.regionIDsToHide = regions.values();
  let categories = 0;
  for (const c of new Set(config.categories ?? [])) if (c >= 0 && c < 14) categories |= 1 << c;
  build.costumeCategoriesUsed = categories;
  build.hairMorphs = config.hairMorph ?? 0;
  build.skeletonType = config.skeletonType ?? 0;
  build.strip();
  build.calculateSmoothNormals();
  return { mesh: toMesh(build, config.revision ?? DEFAULT_MESH_REVISION), materialPrimitives, springyTriangles, notes: build.notes };
}

/** `getCustomSkeleton()`: a bone per joint of every skin, posed globally down the joint hierarchy. */
function customSkeleton(gltf: Gltf): JBone[] {
  if (gltf.skins.length === 0) return [newBone('BocchiTheRock!')];
  const bones: JBone[] = [];
  const lookup = new Map<number, JBone>();
  for (const skin of gltf.skins) {
    const inverse = skin.inverseBindMatrices === undefined ? undefined : gltf.floats(skin.inverseBindMatrices);
    skin.joints.forEach((nodeIndex, index) => {
      const node = gltf.nodes[nodeIndex];
      const bone = newBone(node?.name ?? null);
      const t = node?.translation ?? [0, 0, 0];
      const q = node?.rotation ?? [0, 0, 0, 1];
      const s = node?.scale ?? [1, 1, 1];
      bone.skinPose = translationRotateScale(t.map(f), q.map(f), s.map(f));
      bone.invSkinPose = inverse ? mat4(inverse.subarray(index * 16, index * 16 + 16)) : identity4();
      bones.push(bone);
      lookup.set(nodeIndex, bone);
    });
    for (const nodeIndex of skin.joints) {
      const all = gltf.nodes[nodeIndex]?.children ?? [];
      const children = all.filter((c) => skin.joints.includes(c));
      if (children.length === 0) continue;
      const bone = lookup.get(nodeIndex)!;
      const index = bones.indexOf(bone);
      bone.firstChild = bones.indexOf(lookup.get(children[0])!);
      for (const child of children) lookup.get(child)!.parent = index;
      for (let i = 1; i < children.length; i += 1) lookup.get(children[i - 1])!.nextSibling = bones.indexOf(lookup.get(children[i])!);
    }
  }
  // Java's `Bone.getIndex` finds a bone by its hash, the first of a name.
  const indexOf = (bone: JBone): number => bones.findIndex((b) => b.animHash === bone.animHash);
  const global = (bone: JBone, parent: ReturnType<typeof identity4>, depth: number): void => {
    if (depth > bones.length) throw new ModelImportError('the joint hierarchy is a cycle (Java overflows its stack)');
    bone.skinPose = mul4(parent, bone.skinPose);
    const index = indexOf(bone);
    for (const child of bones) if (child !== bone && child.parent === index) global(child, bone.skinPose, depth + 1);
  };
  for (const bone of bones) if (bone.parent === -1) global(bone, identity4(), 0);
  return bones;
}
