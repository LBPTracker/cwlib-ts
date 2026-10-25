/**
 * `RMesh` -- the game's skinned meshes: magic `MSHb`, dependency type 2, FileDB
 * paths ending `.mol`.
 *
 * The walk is cwlib's `resources/RMesh.java` and its `structs/mesh/` (toolkit
 * checkout at `fee22399`), and every convention a renderer depends on is
 * measured on **all 5,941 `MSHb` resources in LBP3 PS4 1.28's four FARCs**
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

function readPrimitive(s: Serializer): Run {
  const { version } = s.revision;
  const material = s.resource();
  if (version < 0x149) s.resource(); // a second gfxMaterial, removed at 0x149
  const textureAlternatives = version >= 0x179 ? s.resource() : undefined;
  return {
    material,
    textureAlternatives,
    minVert: s.i32(),
    maxVert: s.i32(),
    firstIndex: s.i32(),
    numIndices: s.i32(),
    region: s.i32(),
  };
}

/** `Bone`, which is `AnimBone`'s four fields and then its own. */
export function readBone(s: Serializer): MeshBone {
  const name = latin1(s.bytes(32), true);
  const flags = s.i32();
  const animHash = s.i32();
  const parent = s.s32();
  const firstChild = s.s32();
  const nextSibling = s.s32();
  const skinPose = s.matrix();
  const invSkinPose = s.matrix();
  s.skipVector4(); // obbMin
  s.skipVector4(); // obbMax
  s.array((x) => { // shapeVerts: MeshShapeVertex
    x.skipVector4(); // localPos
    x.skipVector4(); // localNormal
    x.i32(); // boneIndex
  });
  s.array((x) => { // shapeInfos: MeshShapeInfo
    x.i32(); // numVerts
    x.i32(); // isPointCloud, an intbool
  });
  s.f32(); // shapeMinZ
  s.f32(); // shapeMaxZ
  const boundBoxMin = s.vector4();
  const boundBoxMax = s.vector4();
  const boundSphere = s.vector4();
  return {
    name, flags, animHash, parent, firstChild, nextSibling, skinPose, invSkinPose,
    boundBoxMin, boundBoxMax, boundSphere,
  };
}

/**
 * Everything after the bones -- mirroring, softbody, implicit shapes, culling --
 * walked and dropped. Returns the primitive type and the skeleton type.
 */
function readTail(s: Serializer): { primitiveType: number; skeletonType: number } {
  const { version, subVersion, branchId, branchRevision } = s.revision;
  s.array((x) => x.i16()); // mirrorBones
  s.array((x) => x.u8()); // mirrorBoneFlipTypes, enum8
  s.array((x) => x.i16()); // mirrorMorphs
  const primitiveType = s.u8();
  // SoftbodyClusterData: a count, then four arrays of that many, each with its
  // own redundant length in front.
  const clusters = s.count();
  s.i32();
  for (let i = 0; i < clusters; i += 1) s.skipVector4(); // restCOM
  s.i32();
  for (let i = 0; i < clusters; i += 1) s.skipMatrix(); // restDyadicSum
  s.i32();
  s.skip(clusters * 81 * 4); // restQuadraticDyadicSum, f32 each
  s.i32();
  for (let i = 0; i < clusters; i += 1) s.skip(0x20); // names
  s.array((x) => { // softbodySprings
    x.i16();
    x.i16();
    x.f32();
  });
  s.array((x) => { // softbodyEquivs
    x.i16();
    x.i16();
  });
  s.array((x) => x.f32()); // mass
  const ellipsoid = (x: Serializer): void => {
    x.skipMatrix();
    x.i32(); // parentBone
    x.i32(); // affectWorldOnly
  };
  s.array(ellipsoid); // implicitEllipsoids
  s.array((x) => x.matrix()); // clusterImplicitEllipsoids
  s.array(ellipsoid); // insideImplicitEllipsoids
  s.array((x) => { // implicitPlanes
    x.skipVector4();
    x.skipVector4();
    x.i32();
  });
  s.resource(); // softPhysSettings
  s.i32(); // minSpringVert
  s.i32(); // maxSpringVert
  s.i32(); // minUnalignedSpringVert
  s.array((x) => x.i16()); // springyTriIndices
  s.i32(); // springTrisStripped, an intbool
  s.skipVector4(); // softbodyContainingBoundBoxMin
  s.skipVector4(); // softbodyContainingBoundBoxMax
  s.array((x) => { // cullBones
    x.skipMatrix();
    x.skipVector4();
    x.skipVector4();
  });
  s.intVector(); // regionIDsToHide
  s.i32(); // costumeCategoriesUsed
  if (version >= 0x141) s.i32(); // hairMorphs, enum32
  s.i32(); // bevelVertexCount
  s.bool(); // implicitBevelSprings
  // ⚠️ cwlib's, unmeasured: no mesh in the PS4 FARCs is on the Vita branch.
  if (branchId === DOUBLE11 && version === DOUBLE11_HEAD && branchRevision >= 0x28) {
    s.array((x) => x.i32(true)); // vertexColors
  }
  const skeletonType = subVersion >= 0xd6 ? s.u8() : 0;
  return { primitiveType, skeletonType };
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
  s.i32(); // numTris: the non-degenerate count, on every mesh that draws no run twice
  const streamCount = s.i32();
  const attributeCount = s.i32();
  const morphCount = s.i32();
  const morphNames: string[] = [];
  for (let i = 0; i < MAX_MORPHS; i += 1) morphNames.push(latin1(s.bytes(0x10), true));
  morphNames.length = Math.min(morphCount, MAX_MORPHS);
  if (version >= 0x239) {
    // ⚠️ Not the bounds of any UV channel: values below `minUV` are common.
    s.array((x) => x.f32()); // minUV
    s.array((x) => x.f32()); // maxUV
    s.f32(); // areaScaleFactor
  }
  // The streams' offsets: 0, each stream's end, then the last end again --
  // exactly that in all 5,941, so they are skipped and the sizes assumed.
  for (let i = 0; i < streamCount + 2; i += 1) s.i32();
  if (streamCount < 2) throw new SerializerError(`a mesh with ${streamCount} vertex streams`);
  const position = s.bytes(vertexCount * VERTEX);
  const skin = s.bytes(vertexCount * VERTEX);
  const morphStreams: Uint8Array[] = [];
  for (let i = 2; i < streamCount; i += 1) morphStreams.push(s.bytes(vertexCount * VERTEX)); // a morph each
  const attributes = s.bytes(s.i32());
  const indices = s.bytes(s.i32());
  if (subVersion >= 0x16b) s.skip(s.i32()); // triangleAdjacencyInfos
  const runs = s.array(readPrimitive);
  const bones = s.array(readBone);
  const { primitiveType, skeletonType } = readTail(s);
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
  // cluster and weight (`0x000000ff` on 4,664,668 of 4,896,968 vertices). Stream 1: the
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
    return { ...run, triangles: triangles(iv, run.firstIndex, run.numIndices, primitiveType) };
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

  return {
    revision, vertexCount, positions, normals, tangents, uvs, joints, weights,
    primitives, bones, primitiveType, morphNames, morphs, skeletonType,
  };
}
