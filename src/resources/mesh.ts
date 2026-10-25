/**
 * `RMesh` -- the game's skinned meshes: magic `MSHb`, dependency type 2, FileDB
 * paths ending `.mol`.
 *
 * The walk is cwlib's `resources/RMesh.java` and its `structs/mesh/` (toolkit
 * checkout at `fee22399`), and every convention a renderer depends on is
 * measured on **all 5,941 `MSHb` resources in LBP3 PS4 01.00's four FARCs**
 * (`dev/mesh-census.ts`) -- steering/level-files.md, *The game's meshes*:
 *
 * - ❗ **The read ends on the payload's last byte in 5,941 of 5,941**, revisions
 *   `0x237`--`0x3f9` and subVersions up to `0x16b`, which is the proof the field
 *   list and its gates are right. Nothing after the bones is kept, but all of it
 *   is walked: there is no length to skip by.
 * - The index buffer is `numIndices + numEdgeIndices` big-endian `u16`s, the
 *   primitives' indices first and the edge list after (5,941 of 5,941).
 * - Strips restart on `0xffff` and alternate winding in the usual way: read so,
 *   **99.87% of 5.19 M triangles wind counter-clockwise about their vertices'
 *   own normals** -- the check on the strip parity and the normal unpacking
 *   together.
 * - Joints are 0-based bone indices (never one at or past the bone count), the
 *   weights belong b2 / b1 / b0 / remainder to the joint bytes 3 / 7 / 11 / 15,
 *   and the bone matrices are column-major like `PPos`.
 * - UV channels are interleaved per vertex.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { Serializer, SerializerError, latin1, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

/** `CellGcmPrimitive`: the two values `RMesh.primitiveType` takes in the game's meshes. */
export const PRIMITIVE_TRIANGLES = 5;
export const PRIMITIVE_TRIANGLE_STRIP = 6;

/** One draw: a run of the index buffer under one material. */
export interface MeshPrimitive {
  /** The `RGfxMaterial`: a GUID on 12,344 of the game's 12,403 primitives, absent on the rest. */
  readonly material?: ResourceRef;
  /** An `RTextureList`, from version `0x179`. */
  readonly textureAlternatives?: ResourceRef;
  /**
   * The vertex range the indices are said to stay inside.
   *
   * ⚠️ **Not to be trusted as a bound**: six of the game's meshes carry a
   * primitive whose range is nonsense (`-2147412636..1480` in
   * `newton_low_poly.mol`) and indices outside it. The triangles never need it.
   */
  readonly minVert: number;
  readonly maxVert: number;
  /** Where this primitive's run starts in the raw index buffer, and its length. */
  readonly firstIndex: number;
  readonly numIndices: number;
  readonly region: number;
  /**
   * The run as a **triangle list**, counter-clockwise, strips unrolled and
   * their degenerate stitching triangles dropped -- a GPU upload as it stands.
   *
   * ⚠️ **Two primitives can share a run.** 345 meshes, LBP2 costumes mostly,
   * draw one index range twice under two materials; the distinct ranges tile
   * the primitives' part of the buffer exactly in all 5,941.
   */
  readonly triangles: Uint16Array;
  /**
   * The second `gfxMaterial` a primitive carries below version `0x149`, where it
   * was removed. Non-enumerable, kept so `encodeMesh` writes it back.
   */
  readonly secondMaterial?: ResourceRef;
}

/** A skeleton bone. */
export interface MeshBone {
  /** NUL-padded to 32 bytes in the stream. */
  readonly name: string;
  readonly flags: number;
  readonly animHash: number;
  /** An index into `bones`, or -1; always below the bone's own index. */
  readonly parent: number;
  readonly firstChild: number;
  readonly nextSibling: number;
  /** The bind pose, column-major: elements 12..14 are the translation. */
  readonly skinPose: Float32Array;
  /** Its inverse; `skinPose * invSkinPose` is the identity on all 114,635 bones. */
  readonly invSkinPose: Float32Array;
  /** The box, in bone space, that the vertices weighted to this bone fall in. */
  readonly boundBoxMin: readonly [number, number, number, number];
  readonly boundBoxMax: readonly [number, number, number, number];
  readonly boundSphere: readonly [number, number, number, number];
  /** What the stream holds that the fields above leave out. Non-enumerable; `encodeMesh` writes it back. */
  readonly stored?: BoneStored;
}

/** A bone's fields as stored that `MeshBone` does not return (cwlib's names). */
export interface BoneStored {
  /** The 32 name bytes as stored, padding included: written back while they still read as `name`. */
  readonly name: Uint8Array;
  readonly obbMin: readonly [number, number, number, number];
  readonly obbMax: readonly [number, number, number, number];
  readonly shapeVerts: readonly {
    readonly localPos: readonly [number, number, number, number];
    readonly localNormal: readonly [number, number, number, number];
    readonly boneIndex: number;
  }[];
  readonly shapeInfos: readonly { readonly numVerts: number; readonly isPointCloud: number }[];
  readonly shapeMinZ: number;
  readonly shapeMaxZ: number;
}

export interface Mesh {
  readonly revision: RevisionInfo;
  readonly vertexCount: number;
  /** `vertexCount * 3`. */
  readonly positions: Float32Array;
  /** `vertexCount * 3`, unit length. */
  readonly normals: Float32Array;
  /**
   * `vertexCount * 3`, unit length: the direction the first UV channel's `u`
   * runs, the skin stream's pack at 12 -- cwlib's `getTangents` (ennuo/toolkit
   * `d6a2ef8`). ✔ Perpendicular to the normal on 97.4% of the game's 4.9 M
   * vertices, and within 0.9 of the tangent made from positions and UV 0 on
   * 97.2% of those it can be made on: the same way on 4,441,900, the opposite
   * on 198,418. No handedness is stored.
   */
  readonly tangents: Float32Array;
  /**
   * `vertexCount`, 0 to 1: stream 0's byte 15 over 255, cwlib's
   * `getSoftbodyWeights` (ennuo/toolkit `d6a2ef8`). ✔ It goes with the
   * softbody: 1 on every vertex of 4,875 of the game's meshes, none of which
   * has a spring, and below 1 somewhere on 1,063, of which 1,055 have springs
   * (8 exceptions either way, scratch census 2026-10-25). 4,666,393 of the 4.9 M
   * vertices are 1. What the game does with it is not measured.
   */
  readonly softbodyWeights: Float32Array;
  /**
   * `vertexCount`: the vertex's softbody cluster, stream 0's byte 12 over 2 --
   * cwlib's `getClusterIndex`. ✔ Below the cluster count on every vertex of all
   * 116 of the game's meshes with clusters (`MeshTail.softbodyClusters`); 0 on
   * a mesh without.
   */
  readonly softbodyClusterIndices: Uint8Array;
  /** One `vertexCount * 2` array per channel -- every channel the mesh has, 1 to 3. */
  readonly uvs: Float32Array[];
  /** `vertexCount * 4` bone indices; a slot whose weight is zero is usually 0. */
  readonly joints: Uint8Array;
  /** `vertexCount * 4`, summing to 1. */
  readonly weights: Float32Array;
  readonly primitives: MeshPrimitive[];
  readonly bones: MeshBone[];
  /** `PRIMITIVE_TRIANGLE_STRIP` in 5,802 of the game's meshes, `PRIMITIVE_TRIANGLES` in 139. */
  readonly primitiveType: number;
  /** The morph targets' names. */
  readonly morphNames: string[];
  /** Each morph target, in the order of `morphNames`: a stream after the two of every mesh. */
  readonly morphs: MeshMorph[];
  /** cwlib's `SkeletonType`: 0 sackboy, 1 giant, 2 dwarf, 3 bird, 4 quad. */
  readonly skeletonType: number;
  /** Everything after the bones: mirroring, softbody, implicit shapes, culling (`MeshTail`). */
  readonly tail: MeshTail;
  /**
   * The payload's fields and streams as stored, which the values above decode
   * lossily or not at all. Non-enumerable. `encodeMesh` writes a stream from
   * here wherever it still decodes to the values -- vertex by vertex, field by
   * field -- and from the values elsewhere, so an edited or built mesh writes too.
   */
  readonly stored?: MeshStored;
}

/** What `readMesh` keeps of a payload so that `encodeMesh` writes it back byte for byte. */
export interface MeshStored {
  readonly vertexCount: number;
  readonly numIndices: number;
  readonly numTris: number;
  readonly morphCount: number;
  /** All 32 morph name slots, 16 bytes each, padding and unused slots included. */
  readonly morphNames: Uint8Array;
  /** From version `0x239`. */
  readonly minUV?: readonly number[];
  readonly maxUV?: readonly number[];
  readonly areaScaleFactor?: number;
  /** The `streamCount + 2` stream offsets. */
  readonly streamOffsets: readonly number[];
  /** Stream 0: positions, and the softbody bytes (13 and 14 returned nowhere). */
  readonly position: Uint8Array;
  /** Stream 1: weights, joints, normal, the unexplained pack at 8, tangent. */
  readonly skin: Uint8Array;
  readonly morphs: readonly Uint8Array[];
  readonly attributes: Uint8Array;
  /** The whole index buffer: the primitives' runs, then the edge list. */
  readonly indices: Uint8Array;
  /** From subVersion `0x16b`. */
  readonly triangleAdjacency?: Uint8Array;
}

/**
 * A morph target: per vertex, how far it moves and its normal when the morph is
 * full on. cwlib's `RMesh.getMorphs` (ennuo/toolkit `d6a2ef8`): a stream of
 * `f32 x, y, z` and a `u32` normal (`unpackNormal32`) per vertex.
 *
 * ✔ Over the game's 558 meshes with morphs, 5,567,384 morph vertices: the stream
 * count is two more than the morph count on every one, the normal is of unit
 * length to 0.02 on 99.99%, and 78% of offsets are zero -- the vertices a morph
 * does not move. ⚠️ One mesh, `c7a1a3b0`, has 21 offsets that are no float
 * (`ffff000d`), NaN as read; they are returned as they are.
 */
export interface MeshMorph {
  readonly name: string;
  readonly offsets: Float32Array;
  readonly normals: Float32Array;
}

const MAX_MORPHS = 32;
const VERTEX = 0x10;

/** cwlib's DOUBLE11, the Vita branch, which adds per-vertex colours at its revision 0x28. */
const DOUBLE11 = 0x4431;
const DOUBLE11_HEAD = 0x3e2;

/**
 * cwlib's `Bytes.unpackNormal24`: x in 11 bits and y in 10, each two's
 * complement, z rebuilt from them with its sign in bit 23.
 */
function unpackNormal(b: Uint8Array, at: number, out: Float32Array, to: number): void {
  const raw = (b[at] << 16) | (b[at + 1] << 8) | b[at + 2];
  let x = raw & 0x7ff;
  x = (raw & 0x800) !== 0 ? -(0x800 - x) / 0x7ff : x / 0x7ff;
  let y = (raw >> 12) & 0x3ff;
  y = ((raw >> 12) & 0x400) !== 0 ? -(0x400 - y) / 0x3ff : y / 0x3ff;
  const z = Math.sqrt(Math.max(0, 1 - (x * x + y * y)));
  out[to] = x;
  out[to + 1] = y;
  out[to + 2] = raw >> 23 !== 0 ? -z : z;
}

/**
 * cwlib's `Bytes.unpackNormal32`: x and y in 10 bits each with a sign bit after
 * them, z in 9 with its sign in bit 31; a negative component counts down from
 * the top.
 */
function unpackNormal32(word: number, out: Float32Array, to: number): void {
  const x = word & 0x3ff;
  const y = (word >>> 11) & 0x3ff;
  const z = (word >>> 22) & 0x1ff;
  out[to] = (word >>> 10) & 1 ? -(1023 - x) / 1023 : x / 1023;
  out[to + 1] = (word >>> 21) & 1 ? -(1023 - y) / 1023 : y / 1023;
  out[to + 2] = word >>> 31 ? -(511 - z) / 511 : z / 511;
}

/** What a tangent frame is made of: an `RMesh`, or an `RStaticMesh` (`staticmesh.ts`). */
export interface TangentFramed {
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly tangents: Float32Array;
  readonly uvs: readonly Float32Array[];
  readonly primitives: readonly { readonly triangles: ArrayLike<number> }[];
}

/**
 * Each vertex's handedness on a UV channel: +1 where the bitangent
 * `normal × tangent` runs the way `v` grows (`∂P/∂v`, summed over the
 * vertex's triangles), -1 where it runs against it, 0 where no triangle says.
 * The stream stores no handedness (`Mesh.tangents`); a tangent frame takes its
 * sign from this, by its own convention -- glTF's runs toward `v = 0`
 * (`mesh-gltf.ts`), a renderer with `v` down the image may run with it.
 */
export function uvHandedness(mesh: TangentFramed, channel = 0): Int8Array {
  const n = mesh.vertexCount;
  const out = new Int8Array(n);
  const uv = mesh.uvs[channel];
  if (uv === undefined) return out;
  const dpdv = new Float64Array(n * 3);
  const p = mesh.positions;
  for (const primitive of mesh.primitives) {
    const t = primitive.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const a = t[i];
      const b = t[i + 1];
      const c = t[i + 2];
      if (a >= n || b >= n || c >= n) continue;
      const du1 = uv[b * 2] - uv[a * 2];
      const dv1 = uv[b * 2 + 1] - uv[a * 2 + 1];
      const du2 = uv[c * 2] - uv[a * 2];
      const dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
      const det = du1 * dv2 - du2 * dv1;
      if (!Number.isFinite(det) || det === 0) continue;
      for (let k = 0; k < 3; k += 1) {
        const d = ((p[c * 3 + k] - p[a * 3 + k]) * du1 - (p[b * 3 + k] - p[a * 3 + k]) * du2) / det;
        dpdv[a * 3 + k] += d;
        dpdv[b * 3 + k] += d;
        dpdv[c * 3 + k] += d;
      }
    }
  }
  const nr = mesh.normals;
  const tg = mesh.tangents;
  for (let v = 0; v < n; v += 1) {
    const i = v * 3;
    const side = (nr[i + 1] * tg[i + 2] - nr[i + 2] * tg[i + 1]) * dpdv[i]
      + (nr[i + 2] * tg[i] - nr[i] * tg[i + 2]) * dpdv[i + 1]
      + (nr[i] * tg[i + 1] - nr[i + 1] * tg[i]) * dpdv[i + 2];
    out[v] = side > 0 ? 1 : side < 0 ? -1 : 0;
  }
  return out;
}

/** One primitive's run of the index buffer, as a triangle list. */
function triangles(indices: DataView, first: number, count: number, type: number): Uint16Array {
  const run = new Uint16Array(count);
  for (let i = 0; i < count; i += 1) run[i] = indices.getUint16((first + i) * 2, false);
  // Sized for every triangle the run could hold, then cut to those kept: one
  // typed array and one copy, not a growing `number[]` converted at the end.
  const out = new Uint16Array(type === PRIMITIVE_TRIANGLES ? count - (count % 3) : Math.max(0, count - 2) * 3);
  let n = 0;
  const push = (a: number, b: number, c: number): void => {
    // A strip is stitched with degenerate triangles; nothing is drawn by them.
    if (a === b || b === c || a === c) return;
    out[n] = a;
    out[n + 1] = b;
    out[n + 2] = c;
    n += 3;
  };
  if (type === PRIMITIVE_TRIANGLES) {
    for (let i = 0; i + 2 < count; i += 3) push(run[i], run[i + 1], run[i + 2]);
    return out.slice(0, n);
  }
  if (type !== PRIMITIVE_TRIANGLE_STRIP) {
    throw new SerializerError(`primitive type ${type} is neither a strip nor a list`);
  }
  // ⚠️ `0xffff` restarts the strip, and the parity restarts with it.
  let k = 0;
  for (let i = 2; i < count; i += 1) {
    if (run[i] === 0xffff) {
      i += 2;
      k = 0;
      continue;
    }
    if (run[i - 1] === 0xffff || run[i - 2] === 0xffff) continue;
    if ((k & 1) !== 0) push(run[i - 2], run[i], run[i - 1]);
    else push(run[i - 2], run[i - 1], run[i]);
    k += 1;
  }
  return out.slice(0, n);
}

type Run = Omit<MeshPrimitive, 'triangles'>;

function readPrimitive(s: Serializer): Run & { secondMaterial?: ResourceRef } {
  const { version } = s.revision;
  const material = s.resource();
  const secondMaterial = version < 0x149 ? s.resource() : undefined; // removed at 0x149
  const textureAlternatives = version >= 0x179 ? s.resource() : undefined;
  return {
    material,
    textureAlternatives,
    minVert: s.i32(),
    maxVert: s.i32(),
    firstIndex: s.i32(),
    numIndices: s.i32(),
    region: s.i32(),
    secondMaterial,
  };
}

/** `Bone`, which is `AnimBone`'s four fields and then its own. */
export function readBone(s: Serializer): MeshBone {
  const storedName = s.bytes(32);
  const name = latin1(storedName, true);
  const flags = s.i32();
  const animHash = s.i32();
  const parent = s.s32();
  const firstChild = s.s32();
  const nextSibling = s.s32();
  const skinPose = s.matrix();
  const invSkinPose = s.matrix();
  const obbMin = s.vector4();
  const obbMax = s.vector4();
  // MeshShapeVertex, then MeshShapeInfo (isPointCloud an intbool).
  const shapeVerts = s.array((x) => ({ localPos: x.vector4(), localNormal: x.vector4(), boneIndex: x.i32() }));
  const shapeInfos = s.array((x) => ({ numVerts: x.i32(), isPointCloud: x.i32() }));
  const shapeMinZ = s.f32();
  const shapeMaxZ = s.f32();
  const boundBoxMin = s.vector4();
  const boundBoxMax = s.vector4();
  const boundSphere = s.vector4();
  const bone: MeshBone = {
    name, flags, animHash, parent, firstChild, nextSibling, skinPose, invSkinPose,
    boundBoxMin, boundBoxMax, boundSphere,
  };
  const stored: BoneStored = { name: storedName, obbMin, obbMax, shapeVerts, shapeInfos, shapeMinZ, shapeMaxZ };
  hide(bone, 'stored', stored);
  return bone;
}

/** A fixed-size NUL-padded name: the bytes as stored while they still read as `name`. */
function fixedName(w: Writer, name: string, stored: Uint8Array | undefined, size: number, read: (b: Uint8Array) => string): void {
  if (stored && stored.length === size && read(stored) === name) {
    w.bytes(stored);
    return;
  }
  const out = new Uint8Array(size);
  for (let i = 0; i < Math.min(size, name.length); i += 1) out[i] = name.charCodeAt(i) & 0xff;
  w.bytes(out);
}

/** `readBone`'s pair: a bone as `Bone` stores it; a bone built from values writes zero shape fields. */
export function writeBone(w: Writer, bone: MeshBone): void {
  const stored = bone.stored;
  fixedName(w, bone.name, stored?.name, 32, (b) => latin1(b, true));
  w.i32(bone.flags);
  w.i32(bone.animHash);
  w.s32(bone.parent);
  w.s32(bone.firstChild);
  w.s32(bone.nextSibling);
  w.matrix(bone.skinPose);
  w.matrix(bone.invSkinPose);
  w.vector4(stored?.obbMin ?? [0, 0, 0, 0]);
  w.vector4(stored?.obbMax ?? [0, 0, 0, 0]);
  const shapeVerts = stored?.shapeVerts ?? [];
  w.i32(shapeVerts.length);
  for (const v of shapeVerts) {
    w.vector4(v.localPos);
    w.vector4(v.localNormal);
    w.i32(v.boneIndex);
  }
  const shapeInfos = stored?.shapeInfos ?? [];
  w.i32(shapeInfos.length);
  for (const info of shapeInfos) {
    w.i32(info.numVerts);
    w.i32(info.isPointCloud);
  }
  w.f32(stored?.shapeMinZ ?? 0);
  w.f32(stored?.shapeMaxZ ?? 0);
  w.vector4(bone.boundBoxMin);
  w.vector4(bone.boundBoxMax);
  w.vector4(bone.boundSphere);
}

/** A softbody cluster: cwlib's `SoftbodyCluster`. */
export interface SoftbodyCluster {
  readonly name: string;
  readonly restCOM: readonly [number, number, number, number];
  /** A 4x4, column-major. */
  readonly restDyadicSum: Float32Array;
  /** 81 floats, a 9x9. */
  readonly restQuadraticDyadicSum: Float32Array;
  /** The 32 name bytes as stored. Non-enumerable; written back while they still read as `name`. */
  readonly storedName?: Uint8Array;
}

/** cwlib's `ImplicitEllipsoid`: a collision ellipsoid on a bone. */
export interface ImplicitEllipsoid {
  readonly transform: Float32Array;
  readonly parentBone: number;
  readonly affectWorldOnly: number;
}

/**
 * Everything an `RMesh` holds after its bones, in cwlib's names (`RMesh.java`,
 * ennuo/toolkit `d6a2ef8`): the mirroring tables, the softbody (clusters,
 * springs, equivalences, masses), the implicit collision shapes, the spring
 * range, the cull boxes and the costume fields. ⚠️ Read as cwlib reads them and
 * proven only by the walk ending on the payload's last byte; what the game does
 * with each is not measured, except the springs' place in `softbodyWeights`.
 */
export interface MeshTail {
  readonly mirrorBones: readonly number[];
  /** cwlib's `FlipType`, an enum8 per mirrored bone. */
  readonly mirrorBoneFlipTypes: readonly number[];
  readonly mirrorMorphs: readonly number[];
  readonly softbodyClusters: readonly SoftbodyCluster[];
  /**
   * Vertex `a` to vertex `b`, both counted from `minSpringVert`, and the
   * square of the rest length. ✔ So read, all 1,038,735 of the game's springs
   * (1,055 meshes) join vertices up to `maxSpringVert`, and every
   * `restLengthSq` is the square of the two vertices' distance in the bind
   * pose; read as plain vertex indices, 504,499 stay in range and 190,639 fit.
   */
  readonly softbodySprings: readonly { readonly a: number; readonly b: number; readonly restLengthSq: number }[];
  readonly softbodyEquivs: readonly { readonly first: number; readonly count: number }[];
  readonly mass: Float32Array;
  readonly implicitEllipsoids: readonly ImplicitEllipsoid[];
  readonly clusterImplicitEllipsoids: readonly Float32Array[];
  readonly insideImplicitEllipsoids: readonly ImplicitEllipsoid[];
  readonly implicitPlanes: readonly {
    readonly planeNormal: readonly [number, number, number, number];
    readonly pointInPlane: readonly [number, number, number, number];
    readonly parentBone: number;
  }[];
  /** An `RSettingsSoftPhys`. */
  readonly softPhysSettings?: ResourceRef;
  readonly minSpringVert: number;
  readonly maxSpringVert: number;
  readonly minUnalignedSpringVert: number;
  readonly springyTriIndices: readonly number[];
  readonly springTrisStripped: boolean;
  readonly softbodyContainingBoundBoxMin: readonly [number, number, number, number];
  readonly softbodyContainingBoundBoxMax: readonly [number, number, number, number];
  readonly cullBones: readonly {
    readonly invSkinPoseMatrix: Float32Array;
    readonly boundBoxMin: readonly [number, number, number, number];
    readonly boundBoxMax: readonly [number, number, number, number];
  }[];
  readonly regionIDsToHide: readonly number[];
  readonly costumeCategoriesUsed: number;
  /** cwlib's `HairMorph`, from version `0x141`; 0 before. */
  readonly hairMorphs: number;
  readonly bevelVertexCount: number;
  readonly implicitBevelSprings: boolean;
  /** The Vita branch's per-vertex colours (`DOUBLE11` at `0x28`); absent elsewhere. */
  readonly vertexColors?: readonly number[];
  /** Words the tail stores that its values leave out. Non-enumerable; `encodeMesh` writes them back. */
  readonly stored?: {
    /** The redundant length in front of each of the four cluster arrays. */
    readonly clusterLengths: readonly number[];
    /** `springTrisStripped`'s word and `implicitBevelSprings`'s byte, as stored. */
    readonly springTrisStripped: number;
    readonly implicitBevelSprings: number;
  };
}

/** Put a field on an object out of sight of enumeration, `deepEqual` and JSON. */
function hide(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: false, writable: true, configurable: true });
}

/** Everything after the bones, returned; and the primitive and skeleton types among it. */
function readTail(s: Serializer): { primitiveType: number; skeletonType: number; tail: MeshTail } {
  const { version, subVersion, branchId, branchRevision } = s.revision;
  const mirrorBones = s.array((x) => x.i16());
  const mirrorBoneFlipTypes = s.array((x) => x.u8());
  const mirrorMorphs = s.array((x) => x.i16());
  const primitiveType = s.u8();
  // SoftbodyClusterData: a count, then four arrays of that many, each with its
  // own redundant length in front.
  const clusters = s.count();
  const clusterLengths = [s.i32()];
  const restCOM = Array.from({ length: clusters }, () => s.vector4());
  clusterLengths.push(s.i32());
  const restDyadicSum = Array.from({ length: clusters }, () => s.matrix());
  clusterLengths.push(s.i32());
  const restQuadratic = Array.from({ length: clusters }, () => Float32Array.from({ length: 81 }, () => s.f32()));
  clusterLengths.push(s.i32());
  const storedNames = Array.from({ length: clusters }, () => s.bytes(0x20));
  const softbodyClusters = storedNames.map((stored, i) => {
    const cluster: SoftbodyCluster = {
      name: clusterName(stored), restCOM: restCOM[i], restDyadicSum: restDyadicSum[i], restQuadraticDyadicSum: restQuadratic[i],
    };
    hide(cluster, 'storedName', stored);
    return cluster;
  });
  const softbodySprings = s.array((x) => ({ a: x.i16(), b: x.i16(), restLengthSq: x.f32() }));
  const softbodyEquivs = s.array((x) => ({ first: x.i16(), count: x.i16() }));
  const mass = Float32Array.from(s.array((x) => x.f32()));
  const ellipsoid = (x: Serializer): ImplicitEllipsoid => ({ transform: x.matrix(), parentBone: x.i32(), affectWorldOnly: x.i32() });
  const implicitEllipsoids = s.array(ellipsoid);
  const clusterImplicitEllipsoids = s.array((x) => x.matrix());
  const insideImplicitEllipsoids = s.array(ellipsoid);
  const implicitPlanes = s.array((x) => ({ planeNormal: x.vector4(), pointInPlane: x.vector4(), parentBone: x.i32() }));
  const softPhysSettings = s.resource();
  const minSpringVert = s.i32();
  const maxSpringVert = s.i32();
  const minUnalignedSpringVert = s.i32();
  const springyTriIndices = s.array((x) => x.i16());
  const storedSpringTrisStripped = s.i32();
  const springTrisStripped = storedSpringTrisStripped !== 0;
  const softbodyContainingBoundBoxMin = s.vector4();
  const softbodyContainingBoundBoxMax = s.vector4();
  const cullBones = s.array((x) => ({ invSkinPoseMatrix: x.matrix(), boundBoxMin: x.vector4(), boundBoxMax: x.vector4() }));
  const regionIDsToHide = s.intVector();
  const costumeCategoriesUsed = s.i32();
  const hairMorphs = version >= 0x141 ? s.i32() : 0;
  const bevelVertexCount = s.i32();
  const storedImplicitBevelSprings = s.u8();
  const implicitBevelSprings = storedImplicitBevelSprings !== 0;
  // ⚠️ cwlib's, unmeasured: no mesh in the PS4 FARCs is on the Vita branch.
  const vertexColors = branchId === DOUBLE11 && version === DOUBLE11_HEAD && branchRevision >= 0x28
    ? s.array((x) => x.i32(true))
    : undefined;
  const skeletonType = subVersion >= 0xd6 ? s.u8() : 0;
  const tail: MeshTail = {
    mirrorBones, mirrorBoneFlipTypes, mirrorMorphs, softbodyClusters, softbodySprings, softbodyEquivs, mass,
    implicitEllipsoids, clusterImplicitEllipsoids, insideImplicitEllipsoids, implicitPlanes,
    ...(softPhysSettings ? { softPhysSettings } : {}),
    minSpringVert, maxSpringVert, minUnalignedSpringVert, springyTriIndices, springTrisStripped,
    softbodyContainingBoundBoxMin, softbodyContainingBoundBoxMax, cullBones, regionIDsToHide,
    costumeCategoriesUsed, hairMorphs, bevelVertexCount, implicitBevelSprings,
    ...(vertexColors ? { vertexColors } : {}),
  };
  hide(tail, 'stored', {
    clusterLengths, springTrisStripped: storedSpringTrisStripped, implicitBevelSprings: storedImplicitBevelSprings,
  });
  return { primitiveType, skeletonType, tail };
}

/** A cluster's name: its 32 bytes up to the first NUL. */
function clusterName(stored: Uint8Array): string {
  return latin1(stored).replace(/\0.*$/s, '');
}

/**
 * Read an `RMesh`.
 *
 * Throws on anything that is not a `MSHb`, and -- like `readPlan` -- when the
 * walk does not end exactly on the payload's last byte, because that is the
 * check that it was read right.
 */
export async function readMesh(bytes: Uint8Array, inflate: Inflate): Promise<Mesh> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'MSHb') throw new SerializerError(`not a mesh: "${resource.magic}"`);
  const { version, subVersion } = revision;

  const vertexCount = s.i32();
  const numIndices = s.i32();
  const numEdgeIndices = s.i32();
  const numTris = s.i32(); // the non-degenerate count, on every mesh that draws no run twice
  const streamCount = s.i32();
  const attributeCount = s.i32();
  const morphCount = s.i32();
  const storedMorphNames = s.bytes(MAX_MORPHS * 0x10);
  const morphNames: string[] = [];
  for (let i = 0; i < MAX_MORPHS; i += 1) morphNames.push(morphName(storedMorphNames, i));
  morphNames.length = Math.min(morphCount, MAX_MORPHS);
  let uvRange: Pick<MeshStored, 'minUV' | 'maxUV' | 'areaScaleFactor'> = {};
  if (version >= 0x239) {
    // ⚠️ Not the bounds of any UV channel: values below `minUV` are common.
    const minUV = s.array((x) => x.f32());
    const maxUV = s.array((x) => x.f32());
    uvRange = { minUV, maxUV, areaScaleFactor: s.f32() };
  }
  // The streams' offsets: 0, each stream's end, then the last end again --
  // exactly that in all 5,941, so the sizes are assumed and these only kept.
  const streamOffsets: number[] = [];
  for (let i = 0; i < streamCount + 2; i += 1) streamOffsets.push(s.i32());
  if (streamCount < 2) throw new SerializerError(`a mesh with ${streamCount} vertex streams`);
  const position = s.bytes(vertexCount * VERTEX);
  const skin = s.bytes(vertexCount * VERTEX);
  const morphStreams: Uint8Array[] = [];
  for (let i = 2; i < streamCount; i += 1) morphStreams.push(s.bytes(vertexCount * VERTEX)); // a morph each
  const attributes = s.bytes(s.i32());
  const indices = s.bytes(s.i32());
  const triangleAdjacency = subVersion >= 0x16b ? s.bytes(s.i32()) : undefined; // triangleAdjacencyInfos
  const runs = s.array(readPrimitive);
  const bones = s.array(readBone);
  const { primitiveType, skeletonType, tail } = readTail(s);
  if (s.remaining !== 0) {
    throw new SerializerError(`the mesh left ${s.remaining} of ${s.data.length} bytes unread`);
  }
  if (attributes.length !== vertexCount * attributeCount * 8) {
    throw new SerializerError(`${attributes.length} bytes of UVs for ${vertexCount} x ${attributeCount}`);
  }
  if (indices.length !== (numIndices + numEdgeIndices) * 2) {
    throw new SerializerError(`${indices.length} bytes of indices for ${numIndices} + ${numEdgeIndices}`);
  }

  // Stream 0, per vertex: f32 x, y, z, then four bytes cwlib reads as a softbody
  // cluster and weight (`0x000000ff` on 4,664,668 of 4,896,968 vertices): the
  // weight in byte 15 (`Mesh.softbodyWeights`), the cluster in byte 12 over 2
  // (`Mesh.softbodyClusterIndices`); bytes 12-14 are non-zero only on meshes with
  // softbody clusters (112 of 116), 13 and 14 not returned. Stream 1: the
  // three weights in bytes 2, 1, 0, a joint in every fourth byte, and the
  // normal as a 24-bit pack at 4, the tangent as one at 12.
  //
  // ❗ **The tangent is the pack at 12, not at 8**, whatever cwlib's comment on
  // the stream says (`u24 tangent` at 8, a "smooth normal" at 12); its
  // `getTangents` at `d6a2ef8` reads 12, and the game agrees (`Mesh.tangents`).
  // The pack at 8 is perpendicular to the normal on 2.4% of 4.9 M vertices and
  // lines up with the UV tangent on as few; what it is, nothing says yet.
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const softbodyWeights = new Float32Array(vertexCount);
  const softbodyClusterIndices = new Uint8Array(vertexCount);
  const joints = new Uint8Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  const pv = new DataView(position.buffer, position.byteOffset, position.byteLength);
  for (let v = 0; v < vertexCount; v += 1) {
    const at = v * VERTEX;
    positions[v * 3] = pv.getFloat32(at, false);
    positions[v * 3 + 1] = pv.getFloat32(at + 4, false);
    positions[v * 3 + 2] = pv.getFloat32(at + 8, false);
    unpackNormal(skin, at + 4, normals, v * 3);
    unpackNormal(skin, at + 12, tangents, v * 3);
    softbodyWeights[v] = position[at + 15] / 0xff;
    softbodyClusterIndices[v] = position[at + 12] >> 1;
    // A single-bone vertex is `ff 00 00` and needs no case of its own: the
    // remainder is then zero. The three never sum past 0xff in the game's meshes.
    const w0 = skin[at + 2];
    const w1 = skin[at + 1];
    const w2 = skin[at];
    weights[v * 4] = w0 / 0xff;
    weights[v * 4 + 1] = w1 / 0xff;
    weights[v * 4 + 2] = w2 / 0xff;
    weights[v * 4 + 3] = Math.max(0, 0xff - w0 - w1 - w2) / 0xff;
    joints[v * 4] = skin[at + 3];
    joints[v * 4 + 1] = skin[at + 7];
    joints[v * 4 + 2] = skin[at + 11];
    joints[v * 4 + 3] = skin[at + 15];
  }

  const av = new DataView(attributes.buffer, attributes.byteOffset, attributes.byteLength);
  const uvs: Float32Array[] = [];
  for (let c = 0; c < attributeCount; c += 1) {
    const uv = new Float32Array(vertexCount * 2);
    for (let v = 0; v < vertexCount; v += 1) {
      const at = (v * attributeCount + c) * 8;
      uv[v * 2] = av.getFloat32(at, false);
      uv[v * 2 + 1] = av.getFloat32(at + 4, false);
    }
    uvs.push(uv);
  }

  const iv = new DataView(indices.buffer, indices.byteOffset, indices.byteLength);
  const primitives = runs.map((run): MeshPrimitive => {
    if (run.firstIndex < 0 || run.numIndices < 0 || run.firstIndex + run.numIndices > numIndices) {
      throw new SerializerError(`primitive ${run.firstIndex}+${run.numIndices} runs past ${numIndices} indices`);
    }
    const { secondMaterial, ...rest } = run;
    const primitive: MeshPrimitive = { ...rest, triangles: triangles(iv, run.firstIndex, run.numIndices, primitiveType) };
    if (secondMaterial) hide(primitive, 'secondMaterial', secondMaterial);
    return primitive;
  });

  const morphs = morphStreams.map((stream, m): MeshMorph => {
    const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    const offsets = new Float32Array(vertexCount * 3);
    const morphNormals = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v += 1) {
      const at = v * VERTEX;
      offsets[v * 3] = view.getFloat32(at, false);
      offsets[v * 3 + 1] = view.getFloat32(at + 4, false);
      offsets[v * 3 + 2] = view.getFloat32(at + 8, false);
      unpackNormal32(view.getUint32(at + 12, false), morphNormals, v * 3);
    }
    return { name: morphNames[m] ?? '', offsets, normals: morphNormals };
  });

  const mesh: Mesh = {
    revision, vertexCount, positions, normals, tangents, softbodyWeights, softbodyClusterIndices, uvs, joints, weights,
    primitives, bones, primitiveType, morphNames, morphs, skeletonType, tail,
  };
  const stored: MeshStored = {
    vertexCount, numIndices, numTris, morphCount, morphNames: storedMorphNames, ...uvRange, streamOffsets,
    position, skin, morphs: morphStreams, attributes, indices, ...(triangleAdjacency ? { triangleAdjacency } : {}),
  };
  hide(mesh, 'stored', stored);
  return mesh;
}

/** Morph name slot `i` of the 32 stored, up to its first NUL. */
function morphName(stored: Uint8Array, i: number): string {
  return latin1(stored.subarray(i * 0x10, (i + 1) * 0x10), true);
}

/** Below zero, -0 included: the packs store its sign. */
const negative = (value: number): boolean => value < 0 || Object.is(value, -0);

/** `unpackNormal`'s inverse: x in 11 bits and y in 10 with their signs after, z's sign in bit 23. */
function packNormal(x: number, y: number, z: number): number {
  const field = (value: number, bits: number): number => {
    const max = (1 << bits) - 1;
    const m = Math.min(max, Math.round(Math.abs(value) * max) || 0);
    // A negative component counts down from the sign bit: -(2^bits - field) / max.
    return value < 0 && m > 0 ? (1 << bits) | ((1 << bits) - m) : m;
  };
  return field(x, 11) | (field(y, 10) << 12) | (negative(z) ? 1 << 23 : 0);
}

/** `unpackNormal32`'s inverse: x and y in 10 bits with a sign after each, z in 9 with its sign in bit 31. */
function packNormal32(x: number, y: number, z: number): number {
  const field = (value: number, max: number): [number, number] => {
    const m = Math.min(max, Math.round(Math.abs(value) * max) || 0);
    return negative(value) ? [max - m, 1] : [m, 0];
  };
  const [fx, sx] = field(x, 1023);
  const [fy, sy] = field(y, 1023);
  const [fz, sz] = field(z, 511);
  return (fx | (sx << 10) | (fy << 11) | (sy << 21) | (fz << 22) | (sz << 31)) >>> 0;
}

const scratch = new Float32Array(3);

/** Does the stored triple at `at` still decode to `values[to..to+2]`? */
function sameTriple(values: Float32Array, to: number): boolean {
  return Object.is(scratch[0], values[to]) && Object.is(scratch[1], values[to + 1]) && Object.is(scratch[2], values[to + 2]);
}

/** A stored stream of `size` bytes to start from, if there is one of that size; else zeros. */
function base(stored: Uint8Array | undefined, size: number): { out: Uint8Array; view: DataView; kept: boolean } {
  const kept = stored !== undefined && stored.length === size;
  const out = kept ? stored.slice() : new Uint8Array(size);
  return { out, view: new DataView(out.buffer), kept };
}

/** A float at `at`, rewritten only where the stored one is not `value` (a stored NaN keeps its bits). */
function putF32(view: DataView, at: number, value: number, kept: boolean): void {
  if (!kept || !Object.is(view.getFloat32(at, false), value)) view.setFloat32(at, value, false);
}

const byte = (value: number): number => Math.max(0, Math.min(0xff, Math.round(value * 0xff) || 0));

/** Stream 0 from the values, over the stored one where there is one. */
function encodePositions(mesh: Mesh): Uint8Array {
  const n = mesh.vertexCount;
  const { out, view, kept } = base(mesh.stored?.position, n * VERTEX);
  for (let v = 0; v < n; v += 1) {
    const at = v * VERTEX;
    for (let k = 0; k < 3; k += 1) putF32(view, at + k * 4, mesh.positions[v * 3 + k], kept);
    const cluster = mesh.softbodyClusterIndices[v];
    if (!kept || out[at + 12] >> 1 !== cluster) out[at + 12] = ((cluster << 1) | (out[at + 12] & 1)) & 0xff;
    const weight = mesh.softbodyWeights[v];
    if (!kept || Math.fround(out[at + 15] / 0xff) !== weight) out[at + 15] = byte(weight);
  }
  return out;
}

/** Stream 1 from the values, over the stored one where there is one. */
function encodeSkin(mesh: Mesh): Uint8Array {
  const n = mesh.vertexCount;
  const { out, kept } = base(mesh.stored?.skin, n * VERTEX);
  const { weights, joints, normals, tangents } = mesh;
  for (let v = 0; v < n; v += 1) {
    const at = v * VERTEX;
    // The fourth weight is the remainder and is not stored.
    if (
      !kept || Math.fround(out[at + 2] / 0xff) !== weights[v * 4] || Math.fround(out[at + 1] / 0xff) !== weights[v * 4 + 1]
      || Math.fround(out[at] / 0xff) !== weights[v * 4 + 2]
    ) {
      out[at + 2] = byte(weights[v * 4]);
      out[at + 1] = byte(weights[v * 4 + 1]);
      out[at] = byte(weights[v * 4 + 2]);
    }
    out[at + 3] = joints[v * 4];
    out[at + 7] = joints[v * 4 + 1];
    out[at + 11] = joints[v * 4 + 2];
    out[at + 15] = joints[v * 4 + 3];
    for (const [to, values] of [[4, normals], [12, tangents]] as const) {
      if (kept) {
        unpackNormal(out, at + to, scratch, 0);
        if (sameTriple(values, v * 3)) continue;
      }
      const packed = packNormal(values[v * 3], values[v * 3 + 1], values[v * 3 + 2]);
      out[at + to] = (packed >> 16) & 0xff;
      out[at + to + 1] = (packed >> 8) & 0xff;
      out[at + to + 2] = packed & 0xff;
    }
  }
  return out;
}

/** A morph's stream from its values, over the stored one where there is one. */
function encodeMorph(mesh: Mesh, morph: MeshMorph, stored: Uint8Array | undefined): Uint8Array {
  const n = mesh.vertexCount;
  const { view, out, kept } = base(stored, n * VERTEX);
  for (let v = 0; v < n; v += 1) {
    const at = v * VERTEX;
    for (let k = 0; k < 3; k += 1) putF32(view, at + k * 4, morph.offsets[v * 3 + k], kept);
    if (kept) {
      unpackNormal32(view.getUint32(at + 12, false), scratch, 0);
      if (sameTriple(morph.normals, v * 3)) continue;
    }
    view.setUint32(at + 12, packNormal32(morph.normals[v * 3], morph.normals[v * 3 + 1], morph.normals[v * 3 + 2]), false);
  }
  return out;
}

/** The UV channels, interleaved per vertex, over the stored ones where they are the same shape. */
function encodeAttributes(mesh: Mesh): Uint8Array {
  const n = mesh.vertexCount;
  const channels = mesh.uvs.length;
  const { view, out, kept } = base(mesh.stored?.attributes, n * channels * 8);
  for (let c = 0; c < channels; c += 1) {
    const uv = mesh.uvs[c];
    for (let v = 0; v < n; v += 1) {
      const at = (v * channels + c) * 8;
      putF32(view, at, uv[v * 2], kept);
      putF32(view, at + 4, uv[v * 2 + 1], kept);
    }
  }
  return out;
}

function sameIndices(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The index buffer, the primitives' runs as written and the triangle count:
 * the stored buffer where every primitive's run still unrolls to its triangles,
 * else built from the triangles -- a list as it stands, or under a strip mesh
 * each triangle a strip of its own, `0xffff` between, which unrolls to it.
 * The stored edge list is kept while the vertex count is; a built one has none.
 */
function encodeIndices(mesh: Mesh): { indices: Uint8Array; numIndices: number; numTris: number; runs: { firstIndex: number; numIndices: number }[] } {
  const stored = mesh.stored;
  if (stored) {
    const view = new DataView(stored.indices.buffer, stored.indices.byteOffset, stored.indices.byteLength);
    const same = mesh.primitives.every((p) => p.firstIndex >= 0 && p.numIndices >= 0
      && p.firstIndex + p.numIndices <= stored.numIndices
      && sameIndices(triangles(view, p.firstIndex, p.numIndices, mesh.primitiveType), p.triangles));
    if (same) {
      return {
        indices: stored.indices, numIndices: stored.numIndices, numTris: stored.numTris,
        runs: mesh.primitives.map((p) => ({ firstIndex: p.firstIndex, numIndices: p.numIndices })),
      };
    }
  }
  const strip = mesh.primitiveType === PRIMITIVE_TRIANGLE_STRIP;
  const buffer: number[] = [];
  const seen = new Map<Uint16Array, { firstIndex: number; numIndices: number }>();
  let numTris = 0;
  const runs = mesh.primitives.map((p) => {
    const again = seen.get(p.triangles);
    if (again) return again;
    const firstIndex = buffer.length;
    const t = p.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) {
      if (strip && i > 0) buffer.push(0xffff);
      buffer.push(t[i], t[i + 1], t[i + 2]);
      numTris += 1;
    }
    const run = { firstIndex, numIndices: buffer.length - firstIndex };
    seen.set(p.triangles, run);
    return run;
  });
  const numIndices = buffer.length;
  if (stored && stored.vertexCount === mesh.vertexCount) {
    const view = new DataView(stored.indices.buffer, stored.indices.byteOffset, stored.indices.byteLength);
    for (let i = stored.numIndices; i < stored.indices.length / 2; i += 1) buffer.push(view.getUint16(i * 2, false));
  }
  const indices = new Uint8Array(buffer.length * 2);
  const view = new DataView(indices.buffer);
  buffer.forEach((index, i) => view.setUint16(i * 2, index, false));
  return { indices, numIndices, numTris, runs };
}

function writeTail(w: Writer, mesh: Mesh): void {
  const { version, subVersion, branchId, branchRevision } = w.revision;
  const t = mesh.tail;
  const list = <T>(values: readonly T[], write: (value: T) => void): void => {
    w.i32(values.length);
    for (const value of values) write(value);
  };
  list(t.mirrorBones, (v) => w.i16(v));
  list(t.mirrorBoneFlipTypes, (v) => w.u8(v));
  list(t.mirrorMorphs, (v) => w.i16(v));
  w.u8(mesh.primitiveType);
  const clusters = t.softbodyClusters;
  const lengths = t.stored?.clusterLengths;
  const length = (i: number): number => (lengths && lengths.length === 4 ? lengths[i] : clusters.length);
  w.i32(clusters.length);
  w.i32(length(0));
  for (const c of clusters) w.vector4(c.restCOM);
  w.i32(length(1));
  for (const c of clusters) w.matrix(c.restDyadicSum);
  w.i32(length(2));
  for (const c of clusters) for (let i = 0; i < 81; i += 1) w.f32(c.restQuadraticDyadicSum[i] ?? 0);
  w.i32(length(3));
  for (const c of clusters) fixedName(w, c.name, c.storedName, 0x20, clusterName);
  list(t.softbodySprings, (v) => {
    w.i16(v.a);
    w.i16(v.b);
    w.f32(v.restLengthSq);
  });
  list(t.softbodyEquivs, (v) => {
    w.i16(v.first);
    w.i16(v.count);
  });
  list(Array.from(t.mass), (v) => w.f32(v));
  const ellipsoid = (v: ImplicitEllipsoid): void => {
    w.matrix(v.transform);
    w.i32(v.parentBone);
    w.i32(v.affectWorldOnly);
  };
  list(t.implicitEllipsoids, ellipsoid);
  list(t.clusterImplicitEllipsoids, (v) => w.matrix(v));
  list(t.insideImplicitEllipsoids, ellipsoid);
  list(t.implicitPlanes, (v) => {
    w.vector4(v.planeNormal);
    w.vector4(v.pointInPlane);
    w.i32(v.parentBone);
  });
  w.ref(t.softPhysSettings);
  w.i32(t.minSpringVert);
  w.i32(t.maxSpringVert);
  w.i32(t.minUnalignedSpringVert);
  list(t.springyTriIndices, (v) => w.i16(v));
  const stripped = t.stored?.springTrisStripped;
  w.i32(stripped !== undefined && (stripped !== 0) === t.springTrisStripped ? stripped : t.springTrisStripped ? 1 : 0);
  w.vector4(t.softbodyContainingBoundBoxMin);
  w.vector4(t.softbodyContainingBoundBoxMax);
  list(t.cullBones, (v) => {
    w.matrix(v.invSkinPoseMatrix);
    w.vector4(v.boundBoxMin);
    w.vector4(v.boundBoxMax);
  });
  w.intVector(t.regionIDsToHide);
  w.i32(t.costumeCategoriesUsed);
  if (version >= 0x141) w.i32(t.hairMorphs);
  w.i32(t.bevelVertexCount);
  const bevel = t.stored?.implicitBevelSprings;
  w.u8(bevel !== undefined && (bevel !== 0) === t.implicitBevelSprings ? bevel : t.implicitBevelSprings ? 1 : 0);
  if (branchId === DOUBLE11 && version === DOUBLE11_HEAD && branchRevision >= 0x28) {
    list(t.vertexColors ?? [], (v) => w.i32(v, true));
  }
  if (subVersion >= 0xd6) w.u8(mesh.skeletonType);
}

/**
 * Write an `RMesh`'s payload -- what `loadResource(...).data` holds -- from the
 * value `readMesh` returned: its every read mirrored, in order, under the same
 * revision gates. What the value decodes lossily or leaves out comes from
 * `Mesh.stored` (and the bones', clusters', primitives' and tail's hidden
 * fields) wherever it still decodes to the value; a mesh built or edited from
 * values writes from them, the fields nothing returns as zeros.
 */
export function encodeMesh(mesh: Mesh, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const { version, subVersion } = header.revision;
  const stored = mesh.stored;
  const n = mesh.vertexCount;
  const morphCount = stored && Math.min(stored.morphCount, MAX_MORPHS) === mesh.morphNames.length
    ? stored.morphCount
    : mesh.morphNames.length;
  const streamCount = 2 + mesh.morphs.length;
  const { indices, numIndices, numTris, runs } = encodeIndices(mesh);

  w.i32(n);
  w.i32(numIndices);
  w.i32(indices.length / 2 - numIndices);
  w.i32(numTris);
  w.i32(streamCount);
  w.i32(mesh.uvs.length);
  w.i32(morphCount);
  const names = stored?.morphNames.length === MAX_MORPHS * 0x10 ? stored.morphNames.slice() : new Uint8Array(MAX_MORPHS * 0x10);
  mesh.morphNames.slice(0, MAX_MORPHS).forEach((name, i) => {
    if (morphName(names, i) === name) return;
    const slot = names.subarray(i * 0x10, (i + 1) * 0x10);
    slot.fill(0);
    for (let k = 0; k < Math.min(0x10, name.length); k += 1) slot[k] = name.charCodeAt(k) & 0xff;
  });
  w.bytes(names);
  if (version >= 0x239) {
    const minUV = stored?.minUV ?? [];
    const maxUV = stored?.maxUV ?? [];
    w.i32(minUV.length);
    for (const v of minUV) w.f32(v);
    w.i32(maxUV.length);
    for (const v of maxUV) w.f32(v);
    w.f32(stored?.areaScaleFactor ?? 1);
  }
  const offsets = stored && stored.vertexCount === n && stored.streamOffsets.length === streamCount + 2
    ? stored.streamOffsets
    : [0, ...Array.from({ length: streamCount }, (_, i) => (i + 1) * n * VERTEX), streamCount * n * VERTEX];
  for (const offset of offsets) w.i32(offset);
  w.bytes(encodePositions(mesh));
  w.bytes(encodeSkin(mesh));
  mesh.morphs.forEach((morph, i) => w.bytes(encodeMorph(mesh, morph, stored?.morphs[i])));
  const attributes = encodeAttributes(mesh);
  w.i32(attributes.length);
  w.bytes(attributes);
  w.i32(indices.length);
  w.bytes(indices);
  if (subVersion >= 0x16b) {
    const adjacency = stored?.triangleAdjacency ?? new Uint8Array(0);
    w.i32(adjacency.length);
    w.bytes(adjacency);
  }
  w.i32(mesh.primitives.length);
  mesh.primitives.forEach((p, i) => {
    w.ref(p.material);
    if (version < 0x149) w.ref(p.secondMaterial);
    if (version >= 0x179) w.ref(p.textureAlternatives);
    w.i32(p.minVert);
    w.i32(p.maxVert);
    w.i32(runs[i].firstIndex);
    w.i32(runs[i].numIndices);
    w.i32(p.region);
  });
  w.i32(mesh.bones.length);
  for (const bone of mesh.bones) writeBone(w, bone);
  writeTail(w, mesh);
  return w.done();
}
