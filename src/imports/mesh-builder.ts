/**
 * An `RMesh` built from raw streams the way Java cwlib's importers build one:
 * `new RMesh(streams, attributes, indices, bones)` and the passes they run on
 * it -- `applySkeleton`, `calculateBoundBoxes`, `strip` (with `generateEdges`),
 * `calculateSmoothNormals`, and for a softbody `generateEquivs`,
 * `generateSprings` and `generateClusters` (`resources/RMesh.java`,
 * ennuo/toolkit `d6a2ef8`) -- and then handed over as this library's `Mesh`
 * value, with the bytes it was built from as its `stored`, so `encodeMesh`
 * writes the payload Java's `RMesh.build` writes.
 *
 * Float arithmetic is JOML's, step for step (`joml.ts`); the orders Java's
 * `HashSet`s impose are `java-hash.ts`'s; the strips are NvTriStrip's
 * (`tristrip.ts`). The streams are big-endian, as Java's `MemoryOutputStream`
 * writes them.
 */

import { latin1, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';
import { PRIMITIVE_TRIANGLES, PRIMITIVE_TRIANGLE_STRIP, type BoneStored, type Mesh, type MeshBone, type MeshMorph, type MeshPrimitive, type MeshStored, type MeshTail, type SoftbodyCluster } from '../resources/mesh.ts';
import type { Skeleton } from '../resources/bone-set.ts';
import { JavaHashSet } from './java-hash.ts';
import {
  angle3, cross3, f, identity4, length3, length4, mat4, max4, min4, mulVec4, normalize3, toInt, vec3Key, type Mat4,
} from './joml.ts';
import { generateStrips } from './tristrip.ts';

export const STREAM_POS_BONEINDICES = 0;
export const STREAM_BONEWEIGHTS_NORM_TANGENT_SMOOTH_NORM = 1;
export const STREAM_MORPHS0 = 2;
export const MAX_MORPHS = 32;

/** `RAnimation.calculateAnimationHash`: a bone name's hash, which `AnimBone.animHash` and `MeshBone.animHash` hold. */
export function animationHash(name: string | null | undefined): number {
  if (name === null || name === undefined) return 0;
  let offset = 0;
  let value = name;
  if (value.includes(' R ')) {
    offset = 3;
    value = value.replaceAll(' R ', '');
  } else if (value.includes(' L ')) {
    offset = 2;
    value = value.replaceAll(' L ', '');
  }
  // Java's long arithmetic, of which only the low 32 bits reach the result.
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (value.charCodeAt(i) + Math.imul(hash, 0x1003f)) >>> 0;
  return ((hash << 2) + offset) | 0;
}

/** Java's `String.hashCode`. */
export function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export type Vec4 = [number, number, number, number];

/** cwlib's `Bone`, mutable, as the importers make and change them. */
export interface JBone {
  name: string | null;
  flags: number;
  animHash: number;
  parent: number;
  firstChild: number;
  nextSibling: number;
  skinPose: Mat4;
  invSkinPose: Mat4;
  obbMin: Vec4 | null;
  obbMax: Vec4 | null;
  shapeVerts: BoneStored['shapeVerts'];
  shapeInfos: BoneStored['shapeInfos'];
  shapeMinZ: number;
  shapeMaxZ: number;
  boundBoxMin: Vec4 | null;
  boundBoxMax: Vec4 | null;
  boundSphere: Vec4 | null;
}

/** `new Bone(name)`: identity poses, no parent, the name cut at 32 and hashed. */
export function newBone(name: string | null): JBone {
  return {
    name: name !== null && name.length >= 32 ? name.slice(0, 32) : name,
    flags: 0,
    animHash: animationHash(name),
    parent: -1,
    firstChild: -1,
    nextSibling: -1,
    skinPose: identity4(),
    invSkinPose: identity4(),
    obbMin: null,
    obbMax: null,
    shapeVerts: [],
    shapeInfos: [],
    shapeMinZ: 0,
    shapeMaxZ: 0,
    boundBoxMin: null,
    boundBoxMax: null,
    boundSphere: null,
  };
}

/** A bone read by this library (a bone set's, a mesh's) as cwlib holds it. */
export function boneOf(bone: MeshBone): JBone {
  const stored = bone.stored;
  return {
    name: bone.name,
    flags: bone.flags,
    animHash: bone.animHash,
    parent: bone.parent,
    firstChild: bone.firstChild,
    nextSibling: bone.nextSibling,
    skinPose: mat4(bone.skinPose),
    invSkinPose: mat4(bone.invSkinPose),
    obbMin: stored ? [...stored.obbMin] as Vec4 : null,
    obbMax: stored ? [...stored.obbMax] as Vec4 : null,
    shapeVerts: stored?.shapeVerts ?? [],
    shapeInfos: stored?.shapeInfos ?? [],
    shapeMinZ: stored?.shapeMinZ ?? 0,
    shapeMaxZ: stored?.shapeMaxZ ?? 0,
    boundBoxMin: [...bone.boundBoxMin] as Vec4,
    boundBoxMax: [...bone.boundBoxMax] as Vec4,
    boundSphere: [...bone.boundSphere] as Vec4,
  };
}

/** `MemoryOutputStream.str(value, size)`: US-ASCII (`?` for the rest), cut or zero-padded to `size`. */
export function fixedString(value: string | null, size: number): Uint8Array {
  const out = new Uint8Array(size);
  if (value === null) return out;
  for (let i = 0; i < Math.min(size, value.length); i += 1) {
    const c = value.charCodeAt(i);
    out[i] = c < 0x80 ? c : 0x3f;
  }
  return out;
}

/** cwlib's `Primitive`. */
export interface JPrimitive {
  material?: ResourceRef;
  textureAlternatives?: ResourceRef;
  minVert: number;
  maxVert: number;
  firstIndex: number;
  numIndices: number;
  region: number;
}

export interface JCullBone {
  invSkinPose: Mat4 | null;
  boundBoxMin: Vec4 | null;
  boundBoxMax: Vec4 | null;
}

/** cwlib's `SoftbodySpring`: A below B, both shorts. */
export interface JSpring {
  a: number;
  b: number;
  restLengthSq: number;
}

/** `new SoftbodySpring(a, b, rest)`: the two ends ordered and cut to shorts. */
export function newSpring(a: number, b: number, restLengthSq: number): JSpring {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return { a: (lo << 16) >> 16, b: (hi << 16) >> 16, restLengthSq: f(restLengthSq) };
}

export interface JCluster {
  name: string;
  restCOM: Vec4;
  restDyadicSum: Float32Array;
  restQuadraticDyadicSum: Float32Array;
}

const short = (v: number): number => (v << 16) >> 16;

/** cwlib's `Bytes.packNormal24` at `d6a2ef8`: x and y truncated toward zero, not rounded. */
export function packNormal24(x: number, y: number, z: number): number {
  const px = toInt(f(x * 0x7ff)) & 0xfff;
  const py = toInt(f(y * 0x3ff)) & 0x7ff;
  const pz = z < 0 ? 1 : 0;
  return px | (py << 12) | (pz << 23);
}

/** cwlib's `Bytes.packNormal32` at `d6a2ef8`, truncating like `packNormal24`. */
export function packNormal32(x: number, y: number, z: number): number {
  const px = toInt(f(x * 0x3ff)) & 0x7ff;
  const py = toInt(f(y * 0x3ff)) & 0x7ff;
  const pz = toInt(f(z * 0x1ff)) & 0x3ff;
  return (px | (py << 11) | (pz << 22)) | 0;
}

/** cwlib's `Bytes.unpackNormal24`: x and y in float, z through the double. */
export function unpackNormal24(normal: number): [number, number, number] {
  let x = normal & 0x7ff;
  x = (normal & 0x800) !== 0 ? f(-f(0x800 - x) / 0x7ff) : f(x / 0x7ff);
  let y = (normal >> 12) & 0x3ff;
  y = ((normal >> 12) & 0x400) !== 0 ? f(-f(0x400 - y) / 0x3ff) : f(y / 0x3ff);
  const z = f((normal >> 23 !== 0 ? -1 : 1) * Math.sqrt(1 - (x * x + y * y)));
  return [x, y, z];
}

/** cwlib's `Bytes.unpackNormal32`. */
export function unpackNormal32(value: number): [number, number, number] {
  const v = value >>> 0;
  const x = v & 0x3ff;
  const y = (v >>> 11) & 0x3ff;
  const z = (v >>> 22) & 0x1ff;
  return [
    (v >>> 10) & 1 ? -f(f(1023 - x) / 1023) : f(x / 1023),
    (v >>> 21) & 1 ? -f(f(1023 - y) / 1023) : f(y / 1023),
    (v >>> 31) & 1 ? -f(f(511 - z) / 511) : f(z / 511),
  ];
}

/** A growable big-endian byte stream: Java's `MemoryOutputStream` as the importers use it. */
export class ByteStream {
  buffer: Uint8Array;
  offset = 0;
  length = 0;
  constructor(capacity: number) {
    this.buffer = new Uint8Array(capacity);
  }
  private ensure(size: number): void {
    if (this.buffer.length >= size) return;
    const grown = new Uint8Array(Math.max(size, this.buffer.length * 2));
    grown.set(this.buffer);
    this.buffer = grown;
  }
  private advance(n: number): void {
    this.offset += n;
    if (this.offset > this.length) this.length = this.offset;
  }
  private view(): DataView {
    return new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }
  seek(offset: number): void {
    this.offset = offset;
  }
  u8(v: number): void {
    this.ensure(this.offset + 1);
    this.buffer[this.offset] = v & 0xff;
    this.advance(1);
  }
  u16(v: number): void {
    this.ensure(this.offset + 2);
    this.view().setUint16(this.offset, v & 0xffff, false);
    this.advance(2);
  }
  u24(v: number): void {
    this.ensure(this.offset + 3);
    this.buffer[this.offset] = (v >>> 16) & 0xff;
    this.buffer[this.offset + 1] = (v >>> 8) & 0xff;
    this.buffer[this.offset + 2] = v & 0xff;
    this.advance(3);
  }
  i32(v: number): void {
    this.ensure(this.offset + 4);
    this.view().setInt32(this.offset, v | 0, false);
    this.advance(4);
  }
  f32(v: number): void {
    this.ensure(this.offset + 4);
    this.view().setFloat32(this.offset, v, false);
    this.advance(4);
  }
  clear(n: number): void {
    this.ensure(this.offset + n);
    this.buffer.fill(0, this.offset, this.offset + n);
    this.advance(n);
  }
  /** `getBuffer()`: the whole buffer, its capacity included -- as Java hands it to `RMesh`. */
  whole(): Uint8Array {
    return this.buffer;
  }
  /** `shrink().getBuffer()`. */
  shrunk(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

const viewOf = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** What became of Java's own nondeterminism in a build: see `java-hash.ts`. */
export interface BuildNotes {
  /** A `HashSet` this build iterated had a tree bin, so Java's order may differ from the one taken. */
  hashOrderUncertain: boolean;
  /** Which: `edges` (the edge list's order), `triangles` (the smooth normals' summation order), `springs`. */
  readonly uncertainSets: string[];
}

/** cwlib's `RMesh` under construction. */
export class MeshBuild {
  numVerts = 0;
  numIndices = 0;
  numEdgeIndices = 0;
  numTris = 0;
  streams: Uint8Array[] = [];
  attributeCount = 0;
  morphCount = 0;
  morphNames: (string | null)[] = new Array<string | null>(MAX_MORPHS).fill(null);
  minUV: number[] | null = [0, 0];
  maxUV: number[] | null = [1, 1];
  areaScaleFactor = 500;
  attributes: Uint8Array = new Uint8Array(0);
  indices: Uint8Array = new Uint8Array(0);
  primitives: JPrimitive[] = [];
  bones: JBone[] = [];
  mirrorBones: number[] = [];
  mirrorBoneFlipTypes: number[] = [];
  mirrorMorphs: number[] = [];
  primitiveType = PRIMITIVE_TRIANGLE_STRIP;
  softbodyClusters: JCluster[] | null = null;
  softbodySprings: JSpring[] = [];
  softbodyEquivs: { first: number; count: number }[] = [];
  mass: Float32Array = new Float32Array(0);
  softPhysSettings?: ResourceRef;
  minSpringVert = 0;
  maxSpringVert = 0;
  minUnalignedSpringVert = 0;
  springyTriIndices: number[] | null = null;
  springTrisStripped = false;
  softbodyContainingBoundBoxMin: Vec4 | null = null;
  softbodyContainingBoundBoxMax: Vec4 | null = null;
  cullBones: JCullBone[] = [];
  regionIDsToHide: number[] = [];
  costumeCategoriesUsed = 0;
  hairMorphs = 0;
  bevelVertexCount = 0;
  implicitBevelSprings = false;
  vertexColors: number[] = [];
  skeletonType = 0;
  readonly notes: BuildNotes = { hashOrderUncertain: false, uncertainSets: [] };

  private uncertain(set: string): void {
    this.notes.hashOrderUncertain = true;
    if (!this.notes.uncertainSets.includes(set)) this.notes.uncertainSets.push(set);
  }

  /** `new RMesh(streams, attributes, indices, bones)`: a triangle list. */
  constructor(streams: Uint8Array[], attributes: Uint8Array | null, indices: Uint8Array | null, bones: JBone[]) {
    this.primitiveType = PRIMITIVE_TRIANGLES;
    if (indices !== null) {
      if (indices.length % 6 !== 0) throw new Error('Indices buffer must be divisible by 0x6 since it contains triangle data!');
      this.numTris = indices.length / 6;
      this.numIndices = indices.length / 2;
    }
    if (streams.length === 0) return;
    if (streams.length > 34) throw new Error('Meshes cannot have more than 32 morphs!');
    const size = streams[0].length;
    for (const stream of streams) {
      if (stream.length !== size) throw new Error('All vertex streams must be the same size!');
      if (stream.length % 0x10 !== 0) throw new Error('All vertex streams must be divisible by 0x10!');
    }
    this.streams = streams;
    this.numVerts = size / 0x10;
    this.mass = new Float32Array(this.numVerts);
    if (streams.length > 2) {
      this.morphCount = streams.length - 2;
      this.mirrorMorphs = new Array<number>(this.morphCount).fill(0);
    }
    if (attributes !== null) {
      const attributeSize = this.numVerts * 8;
      if (attributeSize === 0) throw new Error('/ by zero');
      if (attributes.length % attributeSize !== 0) throw new Error("Attribute buffer doesn't match vertex count!");
      this.attributeCount = attributes.length / attributeSize;
      this.attributes = attributes;
    }
    if (indices !== null) this.indices = indices;
    this.mirrorBones = bones.map((_, i) => i);
    this.mirrorBoneFlipTypes = bones.map(() => 0);
    this.bones = bones;
    this.cullBones = bones.map((b) => ({ boundBoxMin: b.boundBoxMin, boundBoxMax: b.boundBoxMax, invSkinPose: b.invSkinPose }));
    this.vertexColors = new Array<number>(this.numVerts).fill(-1);
  }

  /** `applySkeleton`: the skeleton's bones, cull bones and mirroring in place of the mesh's. */
  applySkeleton(skeleton: { bones: JBone[]; cullBones: JCullBone[]; mirror: number[]; mirrorType: number[] }): void {
    this.bones = skeleton.bones;
    this.cullBones = skeleton.cullBones;
    this.mirrorBoneFlipTypes = skeleton.mirrorType;
    this.mirrorBones = skeleton.mirror;
  }

  // -- the getters the passes read, as Java's read the streams --

  vertices(): Float32Array {
    const out = new Float32Array(this.numVerts * 3);
    const v = viewOf(this.streams[STREAM_POS_BONEINDICES]);
    for (let i = 0; i < this.numVerts; i += 1) {
      out[i * 3] = v.getFloat32(i * 16, false);
      out[i * 3 + 1] = v.getFloat32(i * 16 + 4, false);
      out[i * 3 + 2] = v.getFloat32(i * 16 + 8, false);
    }
    return out;
  }

  /** `getJoints`: Java's signed bytes. */
  joints(): Int8Array {
    const s = this.streams[STREAM_BONEWEIGHTS_NORM_TANGENT_SMOOTH_NORM];
    const out = new Int8Array(this.numVerts * 4);
    for (let i = 0; i < this.numVerts; i += 1) {
      out[i * 4] = s[i * 16 + 3];
      out[i * 4 + 1] = s[i * 16 + 7];
      out[i * 4 + 2] = s[i * 16 + 11];
      out[i * 4 + 3] = s[i * 16 + 15];
    }
    return out;
  }

  /** `getNormals`: the pack at 4, unpacked as Java does. */
  normals(at = 4): [number, number, number][] {
    const s = this.streams[STREAM_BONEWEIGHTS_NORM_TANGENT_SMOOTH_NORM];
    const out: [number, number, number][] = [];
    for (let i = 0; i < this.numVerts; i += 1) {
      const o = i * 16 + at;
      out.push(unpackNormal24((s[o] << 16) | (s[o + 1] << 8) | s[o + 2]));
    }
    return out;
  }

  /** `getSoftbodyWeights`: stream 0's byte 15 over 255. */
  softbodyWeights(): Float32Array {
    const s = this.streams[STREAM_POS_BONEINDICES];
    return Float32Array.from({ length: this.numVerts }, (_, i) => f(s[i * 16 + 15] / 0xff));
  }

  /** `getTriangles(start, count)`: a list as stored, a strip unrolled as Java unrolls one. */
  triangles(start: number, count: number): number[] {
    const v = viewOf(this.indices);
    const faces: number[] = [];
    for (let i = 0; i < count; i += 1) faces.push(v.getUint16((start + i) * 2, false));
    if (this.primitiveType !== PRIMITIVE_TRIANGLE_STRIP) return faces;
    return unrollStrip(faces);
  }

  /** `getSpringyTriangles`. */
  springyTriangles(): number[] {
    const faces = (this.springyTriIndices ?? []).map((x) => x & 0xffff);
    if (!this.springTrisStripped) return faces;
    const out: number[] = [faces[0], faces[1], faces[2]];
    for (let i = 3, j = 1; i < faces.length; i += 1, j += 1) {
      if (faces[i] === 65535) {
        out.push(faces[i + 1], faces[i + 2], faces[i + 3]);
        i += 3;
        j = 0;
        continue;
      }
      if ((j & 1) !== 0) out.push(faces[i - 2], faces[i], faces[i - 1]);
      else out.push(faces[i - 2], faces[i - 1], faces[i]);
    }
    return out;
  }

  // -- the passes --

  /** `calculateBoundBoxes(setOBB)`: each bone's box of every vertex any of its four joints names, in the bone's space. */
  calculateBoundBoxes(setOBB: boolean): void {
    const vertices = this.vertices();
    const joints = this.joints();
    const mins = this.bones.map((): Vec4 => [Infinity, Infinity, Infinity, 1]);
    const maxs = this.bones.map((): Vec4 => [-Infinity, -Infinity, -Infinity, 1]);
    for (let i = 0; i < this.numVerts; i += 1) {
      const v: Vec4 = [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2], 1];
      for (let j = 0; j < 4; j += 1) {
        const joint = joints[i * 4 + j];
        const bone = this.bones[joint];
        if (bone === undefined) throw new RangeError(`Index ${joint} out of bounds for length ${this.bones.length}`);
        const local = mulVec4(bone.invSkinPose, v);
        max4(maxs[joint], local);
        min4(mins[joint], local);
      }
    }
    for (let i = 0; i < this.bones.length; i += 1) {
      const bone = this.bones[i];
      const culler = this.cullBones[i];
      const max = maxs[i];
      const min = mins[i];
      if (min[0] === Infinity || max[0] === -Infinity) {
        bone.boundBoxMin = [0, 0, 0, 1];
        bone.boundBoxMax = [0, 0, 0, 1];
        bone.boundSphere = [0, 0, 0, 0];
      } else {
        bone.boundBoxMin = min;
        bone.boundBoxMax = max;
        if (setOBB) {
          bone.obbMin = min;
          bone.obbMax = max;
        }
        const half = f(1 / 2);
        const sphere: Vec4 = [f(f(max[0] + min[0]) * half), f(f(max[1] + min[1]) * half), f(f(max[2] + min[2]) * half), f(f(max[3] + min[3]) * half)];
        sphere[3] = Math.abs(f(f(length4(f(max[0] - min[0]), f(max[1] - min[1]), f(max[2] - min[2]), f(max[3] - min[3])) + f(0.001)) / 2));
        bone.boundSphere = sphere;
      }
      if (culler) {
        culler.boundBoxMin = bone.boundBoxMin;
        culler.boundBoxMax = bone.boundBoxMax;
        culler.invSkinPose = bone.invSkinPose;
      }
    }
    // The springy block Java runs first is overwritten by this one whatever it found.
    const min: Vec4 = [Infinity, Infinity, Infinity, 1];
    const max: Vec4 = [-Infinity, -Infinity, -Infinity, 1];
    for (let i = 0; i < this.numVerts; i += 1) {
      const local: Vec4 = [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2], 1];
      max4(max, local);
      min4(min, local);
    }
    const dist = max.map(Math.abs);
    max4(dist, min.map(Math.abs));
    this.softbodyContainingBoundBoxMax = [dist[0], dist[1], dist[2], 1];
    this.softbodyContainingBoundBoxMin = [-dist[0], -dist[1], -dist[2], 1];
  }

  /** `strip()`: every primitive's list as NvTriStrip's strips, each group ended by `0xffff`, then the edge list. */
  strip(): void {
    if (this.primitiveType !== PRIMITIVE_TRIANGLE_STRIP) {
      const stream = new ByteStream(Math.max(0, (this.numVerts - 2 + this.numVerts) * 4 + this.numVerts * 4));
      this.numTris = 0;
      for (const primitive of this.primitives) {
        const tris = this.triangles(primitive.firstIndex, primitive.numIndices);
        this.numTris += Math.trunc(tris.length / 3);
        const groups = generateStrips(tris);
        primitive.numIndices = 0;
        primitive.firstIndex = stream.offset / 2;
        for (const group of groups) {
          for (const index of group.indices) stream.u16(index);
          stream.u16(0xffff);
          primitive.numIndices += group.indices.length + 1;
        }
      }
      this.numEdgeIndices = 0;
      this.numIndices = stream.offset / 2;
      this.primitiveType = PRIMITIVE_TRIANGLE_STRIP;
      this.indices = stream.shrunk();
      this.generateEdges();
    }
    if (!this.springTrisStripped && this.springyTriIndices !== null && this.springyTriIndices.length !== 0) {
      const groups = generateStrips(this.springyTriangles());
      const out: number[] = [];
      groups.forEach((group, g) => {
        for (const index of group.indices) out.push(short(index));
        if (g !== groups.length - 1) out.push(-1);
      });
      this.springyTriIndices = out;
      this.springTrisStripped = true;
    }
  }

  /** `generateEdges()`: the triangles' distinct edges, in `HashSet<Edge>` order, after the indices. */
  generateEdges(): void {
    const tris = this.triangles(0, this.numIndices);
    const edges = new JavaHashSet<[number, number]>(Math.trunc(tris.length / 2));
    const add = (x: number, y: number): void => {
      const [a, b] = x < y ? [x, y] : [y, x];
      edges.add(`${a},${b}`, b, [a, b]);
    };
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const [f0, f1, f2] = [tris[i], tris[i + 1], tris[i + 2]];
      if (f0 !== f1) add(f0, f1);
      if (f1 !== f2) add(f1, f2);
      if (f2 !== f0) add(f2, f0);
    }
    if (edges.treeified) this.uncertain('edges');
    const list = edges.values();
    this.numEdgeIndices = list.length * 2;
    const out = new Uint8Array(this.numIndices * 2 + list.length * 4);
    out.set(this.indices.subarray(0, this.numIndices * 2));
    let at = this.numIndices * 2;
    for (const [a, b] of list) {
      out[at++] = (a >>> 8) & 0xff;
      out[at++] = a & 0xff;
      out[at++] = (b >>> 8) & 0xff;
      out[at++] = b & 0xff;
    }
    this.indices = out;
  }

  /**
   * `calculateSmoothNormals()`: per position, the angle-weighted sum of the
   * unit normals of the distinct triangles around it, into the pack at 8.
   * ⚠️ Java normalizes the shared sum in place, so a position the second
   * vertex at it finds already normalized is normalized again.
   */
  calculateSmoothNormals(): void {
    const vertices = this.vertices();
    const key = (i: number): string => vec3Key(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
    const cache = new Map<string, number[]>();
    for (let i = 0; i < this.numVerts; i += 1) cache.set(key(i), [0, 0, 0]);
    const sharedIndex = new Map<string, number>();
    const shared: number[][] = [];
    const tris = this.triangles(0, this.numIndices);
    for (let i = 0; i < tris.length; i += 1) {
      const k = key(tris[i]);
      let index = sharedIndex.get(k);
      if (index === undefined) {
        index = shared.length;
        sharedIndex.set(k, index);
        const v = tris[i];
        shared.push([vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2], v]);
      }
      tris[i] = index;
    }
    const triangles = new JavaHashSet<[number, number, number]>();
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      if (a === b || a === c || b === c) continue;
      triangles.add(`${a},${b},${c}`, (Math.imul(31, b) + c) | 0, [a, b, c]);
    }
    if (triangles.treeified) this.uncertain('triangles');
    const sub = (p: number[], q: number[]): number[] => [f(p[0] - q[0]), f(p[1] - q[1]), f(p[2] - q[2])];
    for (const [ia, ib, ic] of triangles.values()) {
      const a = shared[ia];
      const b = shared[ib];
      const c = shared[ic];
      const n = cross3(sub(b, a), sub(c, a));
      normalize3(n);
      const aAngle = angle3(sub(b, a), sub(c, a));
      const bAngle = angle3(sub(c, b), sub(a, b));
      const cAngle = angle3(sub(a, c), sub(b, c));
      for (const [p, w] of [[a, aAngle], [b, bAngle], [c, cAngle]] as const) {
        const acc = cache.get(vec3Key(p[0], p[1], p[2]))!;
        acc[0] = f(acc[0] + f(n[0] * w));
        acc[1] = f(acc[1] + f(n[1] * w));
        acc[2] = f(acc[2] + f(n[2] * w));
      }
    }
    const normals = this.normals();
    const stream = this.streams[STREAM_BONEWEIGHTS_NORM_TANGENT_SMOOTH_NORM];
    for (let i = 0; i < this.numVerts; i += 1) {
      const acc = cache.get(key(i))!;
      normalize3(acc);
      const normal = length3(acc[0], acc[1], acc[2]) === 0 ? normals[i] : acc;
      const n = packNormal24(normal[0], normal[1], normal[2]);
      const o = i * 16 + 8;
      stream[o] = (n >>> 16) & 0xff;
      stream[o + 1] = (n >>> 8) & 0xff;
      stream[o + 2] = n & 0xff;
    }
  }

  /** `generateEquivs()`: runs of consecutive vertices at the same position. */
  generateEquivs(): void {
    const v = this.vertices();
    const same = (i: number, j: number): boolean => vec3Key(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]) === vec3Key(v[j * 3], v[j * 3 + 1], v[j * 3 + 2]);
    this.softbodyEquivs = [];
    let start = 0;
    let count = 1;
    for (let i = 1; i < this.numVerts; i += 1) {
      if (same(i, i - 1)) count += 1;
      else {
        if (count !== 1) this.softbodyEquivs.push({ first: short(start), count: short(count) });
        start = i;
        count = 1;
      }
    }
    if (count !== 1) this.softbodyEquivs.push({ first: short(start), count: short(count) });
  }

  /**
   * `generateSprings(springs)`: the springs between two vertices not both of
   * weight 1, every triangle springy (Java's filter is commented out), the
   * spring range aligned down to 8, and the springs made local to it and
   * deduplicated through a `HashSet`.
   */
  generateSprings(springs: JSpring[]): void {
    const weights = this.softbodyWeights();
    const kept = springs.filter((s) => !(weights[s.a] === 1 && weights[s.b] === 1));
    const tris = this.triangles(0, this.numIndices);
    this.springyTriIndices = tris.map(short);
    this.springTrisStripped = false;
    let minSpring = 2147483647;
    let maxSpring = -2147483648;
    for (const index of this.springyTriIndices) {
      const face = index & 0xffff;
      if (minSpring > face) minSpring = face;
      if (maxSpring < face) maxSpring = face;
    }
    this.minUnalignedSpringVert = minSpring;
    while (minSpring % 8 !== 0) minSpring -= 1;
    this.minSpringVert = minSpring;
    this.maxSpringVert = maxSpring;
    for (const s of kept) {
      s.a = short(s.a - minSpring);
      s.b = short(s.b - minSpring);
    }
    const set = JavaHashSet.of(kept.map((s) => ({ key: `${s.a},${s.b}`, hash: s.b, value: s })));
    if (set.treeified) this.uncertain('springs');
    this.softbodySprings = set.values();
  }
}

/** Java's `getTriangles` over a strip: the first three, then each next index, `0xffff` restarting. */
export function unrollStrip(faces: number[]): number[] {
  const count = faces.length;
  const out: number[] = [faces[0], faces[1], faces[2]];
  for (let i = 3, j = 1; i < count; i += 1, j += 1) {
    if (faces[i] === 65535) {
      if (i + 3 >= count) break;
      out.push(faces[i + 1], faces[i + 2], faces[i + 3]);
      i += 3;
      j = 0;
      continue;
    }
    if ((j & 1) !== 0) out.push(faces[i - 2], faces[i], faces[i - 1]);
    else out.push(faces[i - 2], faces[i - 1], faces[i]);
  }
  return out;
}

// -- the hand-over: a built mesh as this library's `Mesh` --

/** The lib's own unroll (`readMesh`'s `triangles`), so the primitives' triangles are what `encodeMesh` checks the stored runs against. */
function libTriangles(indices: DataView, first: number, count: number, type: number): Uint16Array {
  const run = new Uint16Array(count);
  for (let i = 0; i < count; i += 1) run[i] = indices.getUint16((first + i) * 2, false);
  const out: number[] = [];
  const push = (a: number, b: number, c: number): void => {
    if (a === b || b === c || a === c) return;
    out.push(a, b, c);
  };
  if (type === PRIMITIVE_TRIANGLES) {
    for (let i = 0; i + 2 < count; i += 3) push(run[i], run[i + 1], run[i + 2]);
    return Uint16Array.from(out);
  }
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
  return Uint16Array.from(out);
}

/** `unpackNormal` of `mesh.ts`, which the values must agree with to the bit. */
function libUnpack24(b: Uint8Array, at: number, out: Float32Array, to: number): void {
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

function libUnpack32(word: number, out: Float32Array, to: number): void {
  const x = word & 0x3ff;
  const y = (word >>> 11) & 0x3ff;
  const z = (word >>> 22) & 0x1ff;
  out[to] = (word >>> 10) & 1 ? -(1023 - x) / 1023 : x / 1023;
  out[to + 1] = (word >>> 21) & 1 ? -(1023 - y) / 1023 : y / 1023;
  out[to + 2] = word >>> 31 ? -(511 - z) / 511 : z / 511;
}

function hide(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: false, writable: true, configurable: true });
}

const vec = (v: Vec4 | null): [number, number, number, number] => (v ? [v[0], v[1], v[2], v[3]] : [0, 0, 0, 0]);
const IDENTITY = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** A built mesh as a `MeshBone` list: the values, and what Java writes besides them as each bone's `stored`. */
function meshBones(bones: JBone[]): MeshBone[] {
  return bones.map((b) => {
    const nameBytes = fixedString(b.name, 32);
    const bone: MeshBone = {
      name: latin1(nameBytes, true),
      flags: b.flags,
      animHash: b.animHash,
      parent: b.parent,
      firstChild: b.firstChild,
      nextSibling: b.nextSibling,
      skinPose: b.skinPose.m.slice(),
      invSkinPose: b.invSkinPose.m.slice(),
      boundBoxMin: vec(b.boundBoxMin),
      boundBoxMax: vec(b.boundBoxMax),
      boundSphere: vec(b.boundSphere),
    };
    const stored: BoneStored = {
      name: nameBytes, obbMin: vec(b.obbMin), obbMax: vec(b.obbMax), shapeVerts: b.shapeVerts, shapeInfos: b.shapeInfos,
      shapeMinZ: b.shapeMinZ, shapeMaxZ: b.shapeMaxZ,
    };
    hide(bone, 'stored', stored);
    return bone;
  });
}

/**
 * The built mesh as this library's `Mesh`: the values decoded from the
 * streams exactly as `readMesh` decodes them, and the streams, morph names,
 * UV range and index buffer as its `stored`, so that `encodeMesh(mesh)`
 * writes Java's bytes -- the smooth normals at 8 and the truncated packs
 * included, which no value carries.
 */
export function toMesh(build: MeshBuild, revision: RevisionInfo): Mesh {
  const n = build.numVerts;
  const position = build.streams[STREAM_POS_BONEINDICES] ?? new Uint8Array(0);
  const skin = build.streams[STREAM_BONEWEIGHTS_NORM_TANGENT_SMOOTH_NORM] ?? new Uint8Array(0);
  const morphStreams = build.streams.slice(2);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const tangents = new Float32Array(n * 3);
  const softbodyWeights = new Float32Array(n);
  const softbodyClusterIndices = new Uint8Array(n);
  const joints = new Uint8Array(n * 4);
  const weights = new Float32Array(n * 4);
  const pv = viewOf(position);
  for (let v = 0; v < n; v += 1) {
    const at = v * 16;
    positions[v * 3] = pv.getFloat32(at, false);
    positions[v * 3 + 1] = pv.getFloat32(at + 4, false);
    positions[v * 3 + 2] = pv.getFloat32(at + 8, false);
    libUnpack24(skin, at + 4, normals, v * 3);
    libUnpack24(skin, at + 12, tangents, v * 3);
    softbodyWeights[v] = position[at + 15] / 0xff;
    softbodyClusterIndices[v] = position[at + 12] >> 1;
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
  const av = viewOf(build.attributes);
  const uvs: Float32Array[] = [];
  for (let c = 0; c < build.attributeCount; c += 1) {
    const uv = new Float32Array(n * 2);
    for (let v = 0; v < n; v += 1) {
      const at = (v * build.attributeCount + c) * 8;
      uv[v * 2] = av.getFloat32(at, false);
      uv[v * 2 + 1] = av.getFloat32(at + 4, false);
    }
    uvs.push(uv);
  }
  const iv = viewOf(build.indices);
  const primitives: MeshPrimitive[] = build.primitives.map((p) => ({
    ...(p.material ? { material: p.material } : {}),
    ...(p.textureAlternatives ? { textureAlternatives: p.textureAlternatives } : {}),
    minVert: p.minVert,
    maxVert: p.maxVert,
    firstIndex: p.firstIndex,
    numIndices: p.numIndices,
    region: p.region,
    triangles: libTriangles(iv, p.firstIndex, p.numIndices, build.primitiveType),
  }));
  const morphNameBytes = new Uint8Array(MAX_MORPHS * 0x10);
  build.morphNames.forEach((name, i) => morphNameBytes.set(fixedString(name, 0x10), i * 0x10));
  const morphNames = Array.from({ length: Math.min(build.morphCount, MAX_MORPHS) }, (_, i) =>
    latin1(morphNameBytes.subarray(i * 0x10, (i + 1) * 0x10), true));
  const morphs: MeshMorph[] = morphStreams.map((stream, m) => {
    const view = viewOf(stream);
    const offsets = new Float32Array(n * 3);
    const morphNormals = new Float32Array(n * 3);
    for (let v = 0; v < n; v += 1) {
      offsets[v * 3] = view.getFloat32(v * 16, false);
      offsets[v * 3 + 1] = view.getFloat32(v * 16 + 4, false);
      offsets[v * 3 + 2] = view.getFloat32(v * 16 + 8, false);
      libUnpack32(view.getUint32(v * 16 + 12, false), morphNormals, v * 3);
    }
    return { name: morphNames[m] ?? '', offsets, normals: morphNormals };
  });
  const clusters: SoftbodyCluster[] = (build.softbodyClusters ?? []).map((c) => {
    const cluster: SoftbodyCluster = { name: latin1(fixedString(c.name, 0x20)).replace(/\0.*$/s, ''), restCOM: c.restCOM, restDyadicSum: c.restDyadicSum, restQuadraticDyadicSum: c.restQuadraticDyadicSum };
    hide(cluster, 'storedName', fixedString(c.name, 0x20));
    return cluster;
  });
  const hasSoftbody = clusters.length !== 0;
  const tail: MeshTail = {
    mirrorBones: build.mirrorBones,
    mirrorBoneFlipTypes: build.mirrorBoneFlipTypes,
    mirrorMorphs: build.mirrorMorphs,
    softbodyClusters: clusters,
    softbodySprings: build.softbodySprings.map((s) => ({ a: s.a, b: s.b, restLengthSq: s.restLengthSq })),
    softbodyEquivs: build.softbodyEquivs,
    // ❗ Java writes the masses only where the mesh has softbody clusters.
    mass: hasSoftbody ? build.mass : new Float32Array(0),
    implicitEllipsoids: [],
    clusterImplicitEllipsoids: [],
    insideImplicitEllipsoids: [],
    implicitPlanes: [],
    ...(build.softPhysSettings ? { softPhysSettings: build.softPhysSettings } : {}),
    minSpringVert: build.minSpringVert,
    maxSpringVert: build.maxSpringVert,
    minUnalignedSpringVert: build.minUnalignedSpringVert,
    springyTriIndices: build.springyTriIndices ?? [],
    springTrisStripped: build.springTrisStripped,
    softbodyContainingBoundBoxMin: vec(build.softbodyContainingBoundBoxMin),
    softbodyContainingBoundBoxMax: vec(build.softbodyContainingBoundBoxMax),
    cullBones: build.cullBones.map((c) => ({ invSkinPoseMatrix: c.invSkinPose ? c.invSkinPose.m.slice() : IDENTITY.slice(), boundBoxMin: vec(c.boundBoxMin), boundBoxMax: vec(c.boundBoxMax) })),
    regionIDsToHide: build.regionIDsToHide,
    costumeCategoriesUsed: build.costumeCategoriesUsed,
    hairMorphs: build.hairMorphs,
    bevelVertexCount: build.bevelVertexCount,
    implicitBevelSprings: build.implicitBevelSprings,
    vertexColors: build.vertexColors,
  };
  // Java's `SoftbodyClusterData` writes the quadratic sums as one float array,
  // its length 81 a cluster where the other three arrays count clusters.
  const k = clusters.length;
  hide(tail, 'stored', {
    clusterLengths: [k, k, k * 81, k],
    springTrisStripped: build.springTrisStripped ? 1 : 0,
    implicitBevelSprings: build.implicitBevelSprings ? 1 : 0,
  });
  const mesh: Mesh = {
    revision, vertexCount: n, positions, normals, tangents, softbodyWeights, softbodyClusterIndices, uvs, joints, weights,
    primitives, bones: meshBones(build.bones), primitiveType: build.primitiveType, morphNames, morphs, skeletonType: build.skeletonType, tail,
  };
  const streamOffsets = [0];
  let offset = 0;
  for (const stream of build.streams) streamOffsets.push((offset += stream.length));
  streamOffsets.push(offset);
  const stored: MeshStored = {
    vertexCount: n,
    numIndices: build.numIndices,
    numTris: build.numTris,
    morphCount: build.morphCount,
    morphNames: morphNameBytes,
    ...(build.minUV ? { minUV: build.minUV } : { minUV: [] }),
    ...(build.maxUV ? { maxUV: build.maxUV } : { maxUV: [] }),
    areaScaleFactor: build.areaScaleFactor,
    streamOffsets,
    position,
    skin,
    morphs: morphStreams,
    attributes: build.attributes,
    indices: build.indices,
  };
  hide(mesh, 'stored', stored);
  return mesh;
}

/** A bone set's skeleton as `applySkeleton` takes it: fresh bones, so a build's passes change only its own copy. */
export function skeletonOf(skeleton: Skeleton): { bones: JBone[]; cullBones: JCullBone[]; mirror: number[]; mirrorType: number[] } {
  return {
    bones: skeleton.bones.map(boneOf),
    cullBones: skeleton.cullBones.map((c) => ({ invSkinPose: mat4(c.invSkinPose), boundBoxMin: [...c.boundBoxMin] as Vec4, boundBoxMax: [...c.boundBoxMax] as Vec4 })),
    mirror: Array.from(skeleton.mirror),
    mirrorType: Array.from(skeleton.mirrorType),
  };
}

