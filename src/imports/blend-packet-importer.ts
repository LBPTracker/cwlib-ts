/**
 * A Blender "blend packet" (`BMSH`) as `RMesh`es: Java cwlib's
 * `io/imports/BlendPacketImporter.java` (ennuo/toolkit `d6a2ef8`), ported --
 * the packet's reader (`BlendPacket.FromFile`, `BlendMesh.FromFile`) and the
 * mesh half of `Work2`, which turns each packed mesh into an `RMesh`.
 *
 * The packet is what the toolkit's Blender exporter writes: after a
 * big-endian `BMSH`, little-endian counts, then textures (BGRA pixels or a
 * reference), materials (a path, a name, flags, a serialised `RGfxMaterial`),
 * bones (name, hierarchy, bind pose), softbody cluster names, and the meshes,
 * each a blob of its own: positions per vertex; UVs, normals and tangents per
 * loop (a face corner); the loops' vertices; primitives as loop triangles of a
 * material; and by its flags joints and weights, masses, springs, clusters and
 * the softbody settings' path.
 *
 * What a mesh becomes, as Java builds it: one vertex per distinct (position,
 * normal, tangent, UVs) among the loops of each vertex, the vertices of one
 * position together; the count padded to a multiple of 8 with copies of the
 * first vertex **in front**; weights rounded to 255ths (not truncated, as
 * `ModelImporter` does), cluster index doubled into byte 12 and the mass in
 * byte 15. Springs gain the "bending" springs between each vertex and its
 * neighbours' neighbours; then `generateEquivs`, `generateSprings`,
 * `calculateSmoothNormals`, `calculateBoundBoxes(true)`, `generateClusters`
 * and `strip`, in Java's order (`mesh-builder.ts`). Materials are named by
 * `makePathGUID` of their path (`gamedata_randy/gmat/<name>.gmat` where they
 * have none), the softbody settings likewise.
 *
 * What is not ported: the rest of `Work2` -- textures compressed to DXT5
 * `.tex`, materials recompiled through `GfxAssembler` and the external Cg
 * compiler, palette `.plan`s, the FileDB and FARC it writes into. The
 * packet's textures and materials are read and handed back as they are.
 *
 * Where this differs from Java, on purpose: nothing in the arithmetic. Java
 * gives every mesh GUID 251193 (its `makePathGUID` is commented out); the GUID
 * is the caller's here, and `meshPath` says what Java would have named it.
 */

import type { ResourceRef, RevisionInfo } from '../io/serializer.ts';
import type { Mesh } from '../resources/mesh.ts';
import { f, mat4, vec3Key } from './joml.ts';
import {
  ByteStream, MeshBuild, newBone, newSpring, packNormal24, toMesh, type BuildNotes, type JBone, type JCluster, type JPrimitive, type JSpring,
} from './mesh-builder.ts';
import { invert4 } from './joml-invert.ts';
import { invert9 } from './ejml.ts';

export class BlendPacketError extends Error {}

export interface BlendTexture {
  readonly key: number;
  readonly name: string;
  /** Absent where the packet names a texture without pixels. */
  readonly width?: number;
  readonly height?: number;
  /** Bit 0: sRGB. */
  readonly flags?: number;
  /** ARGB, a row at a time, as Java turns the packet's ABGR round. */
  readonly pixels: Int32Array;
}

export interface BlendMaterial {
  readonly path: string;
  readonly name: string;
  /** Bit 0: glassy. */
  readonly flags: number;
  /** A serialised `RGfxMaterial`, or none. */
  readonly data: Uint8Array;
}

export interface BlendBone {
  readonly name: string;
  readonly parent: number;
  readonly firstChild: number;
  readonly nextSibling: number;
  /** Column-major. */
  readonly skinPose: Float32Array;
}

export const HAS_ARMATURE = 1 << 0;
export const HAS_SHAPE_KEYS = 1 << 1;
export const HAS_VERTEX_MASS = 1 << 2;
export const HAS_SOFTBODY_CLUSTERS = 1 << 3;
export const HAS_SOFTBODY_SPRINGS = 1 << 4;
export const HAS_SOFTPHYSICS = HAS_SOFTBODY_CLUSTERS | HAS_SOFTBODY_SPRINGS;

export interface BlendMesh {
  readonly path: string;
  readonly name: string;
  readonly flags: number;
  readonly numVertices: number;
  readonly numLoops: number;
  readonly numTriangles: number;
  readonly numShapeKeys: number;
  readonly positions: Float32Array;
  /** Per UV layer, two floats a loop. */
  readonly uvs: Float32Array[];
  readonly normals: Float32Array;
  readonly tangents: Float32Array;
  /** Each loop's vertex. */
  readonly loops: Int32Array;
  readonly primitives: { readonly materialIndex: number; readonly triangles: Int32Array }[];
  readonly joints?: Int32Array;
  readonly weights?: Float32Array;
  readonly mass?: Float32Array;
  readonly springs: { a: number; b: number; restLengthSq: number }[];
  readonly clusterIndices?: Int32Array;
  readonly softPhysSettings?: string;
}

export interface BlendPacket {
  readonly version: number;
  readonly textures: BlendTexture[];
  readonly materials: BlendMaterial[];
  readonly bones: BlendBone[];
  readonly clusters: string[];
  readonly meshes: BlendMesh[];
}

/** Little-endian reads, as the packet is after its magic; `str(n)` is Java's `new String(bytes).replace("\0", "")`. */
class Reader {
  private readonly view: DataView;
  at = 0;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  private need(n: number): number {
    if (n < 0 || this.at + n > this.data.length) throw new BlendPacketError(`the packet ends ${this.at + n - this.data.length} bytes early`);
    const at = this.at;
    this.at += n;
    return at;
  }
  i32(): number { return this.view.getInt32(this.need(4), true); }
  f32(): number { return this.view.getFloat32(this.need(4), true); }
  u8(): number { return this.view.getUint8(this.need(1)); }
  bytes(n: number): Uint8Array { const at = this.need(n); return this.data.slice(at, at + n); }
  str(n: number): string { return n === 0 ? '' : new TextDecoder().decode(this.bytes(n)).replaceAll('\0', ''); }
}

/** `BlendMesh.FromFile`. */
function readMeshBlob(blob: Uint8Array): BlendMesh {
  const r = new Reader(blob);
  const path = r.str(r.i32());
  const name = r.str(r.i32());
  const flags = r.i32();
  const numVertices = r.i32();
  const numLoops = r.i32();
  const numTriangles = r.i32();
  const numUvLayers = r.i32();
  r.i32(); // NumEdges: counted, never read
  const numPrimitives = r.i32();
  const numShapeKeys = (flags & HAS_SHAPE_KEYS) !== 0 ? r.i32() : 0;
  const floats = (n: number): Float32Array => Float32Array.from({ length: n }, () => r.f32());
  const positions = floats(numVertices * 3);
  const uvs = Array.from({ length: numUvLayers }, () => floats(numLoops * 2));
  const normals = floats(numLoops * 3);
  const tangents = floats(numLoops * 3);
  const loops = Int32Array.from({ length: numLoops }, () => r.i32());
  const primitives = Array.from({ length: numPrimitives }, () => {
    const materialIndex = r.i32();
    return { materialIndex, triangles: Int32Array.from({ length: r.i32() }, () => r.i32()) };
  });
  let joints: Int32Array | undefined;
  let weights: Float32Array | undefined;
  if ((flags & HAS_ARMATURE) !== 0) {
    joints = Int32Array.from({ length: numVertices * 4 }, () => r.i32());
    weights = floats(numVertices * 4);
  }
  let mass: Float32Array | undefined;
  if ((flags & HAS_VERTEX_MASS) !== 0) mass = floats(numVertices);
  const springs: { a: number; b: number; restLengthSq: number }[] = [];
  if ((flags & HAS_SOFTBODY_SPRINGS) !== 0) {
    const count = r.i32();
    for (let i = 0; i < count; i += 1) {
      const a = r.i32();
      const b = r.i32();
      springs.push(spring(a, b, positions, positions));
    }
  }
  let clusterIndices: Int32Array | undefined;
  if ((flags & HAS_SOFTBODY_CLUSTERS) !== 0) clusterIndices = Int32Array.from({ length: numVertices }, () => r.i32());
  let softPhysSettings: string | undefined;
  if ((flags & HAS_SOFTPHYSICS) !== 0) {
    softPhysSettings = r.str(r.i32());
    if ((flags & HAS_VERTEX_MASS) === 0) mass = new Float32Array(numVertices).fill(1);
  }
  return {
    path, name, flags, numVertices, numLoops, numTriangles, numShapeKeys, positions, uvs, normals, tangents, loops, primitives,
    joints, weights, mass, springs, clusterIndices, softPhysSettings,
  };
}

/** `new SoftbodySpring(a, b, |pb - pa|²)`, the square in double, as Java takes it. */
function spring(a: number, b: number, pa: ArrayLike<number>, pb: ArrayLike<number>, ia = a, ib = b): JSpring {
  const dx = f(pb[ib * 3] - pa[ia * 3]);
  const dy = f(pb[ib * 3 + 1] - pa[ia * 3 + 1]);
  const dz = f(pb[ib * 3 + 2] - pa[ia * 3 + 2]);
  if (Number.isNaN(dx + dy + dz) && (pa[ia * 3] === undefined || pb[ib * 3] === undefined)) {
    throw new BlendPacketError(`a spring ${a}-${b} past the vertices`);
  }
  return newSpring(a, b, dx * dx + dy * dy + dz * dz);
}

/** `BlendPacket.FromFile`. */
export function readBlendPacket(bytes: Uint8Array): BlendPacket {
  if (bytes.length < 4 || new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, false) !== 0x424d5348) {
    throw new BlendPacketError('Blend packet has invalid header!');
  }
  const r = new Reader(bytes);
  r.at = 4;
  const version = r.i32();
  const counts = { textures: r.i32(), materials: r.i32(), meshes: r.i32(), bones: r.i32(), clusters: r.i32() };
  const textures: BlendTexture[] = [];
  for (let i = 0; i < counts.textures; i += 1) {
    const key = r.i32();
    const name = r.str(r.i32());
    if (r.u8() !== 0) {
      textures.push({ key, name, pixels: new Int32Array(0) });
      continue;
    }
    const width = r.i32();
    const height = r.i32();
    const flags = r.i32();
    const pixels = Int32Array.from({ length: Math.trunc(r.i32() / 4) }, () => {
      const pixel = r.i32();
      const red = (pixel >> 16) & 0xff;
      const blue = pixel & 0xff;
      return (pixel & 0xff00ff00) | (blue << 16) | red;
    });
    textures.push({ key, name, width, height, flags, pixels });
  }
  const materials: BlendMaterial[] = Array.from({ length: counts.materials }, () => {
    const path = r.str(r.i32());
    const name = r.str(r.i32());
    const flags = r.i32();
    return { path, name, flags, data: r.bytes(r.i32()) };
  });
  const bones: BlendBone[] = Array.from({ length: counts.bones }, () => {
    const name = r.str(r.i32());
    const parent = r.i32();
    const firstChild = r.i32();
    const nextSibling = r.i32();
    return { name, parent, firstChild, nextSibling, skinPose: Float32Array.from({ length: 16 }, () => r.f32()) };
  });
  const clusters = Array.from({ length: counts.clusters }, () => r.str(r.i32()));
  const meshes = Array.from({ length: counts.meshes }, () => readMeshBlob(r.bytes(r.i32())));
  return { version, textures, materials, bones, clusters, meshes };
}

/** cwlib's `Crypto.makePathGUID`: the CRC-32 of the path's ASCII, its top bit set. */
export function makePathGuid(path: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < path.length; i += 1) {
    const c = path.charCodeAt(i);
    crc ^= c < 0x80 ? c : 0x3f;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) | 0x80000000) >>> 0;
}

/** Where `Work2` would put a material and a mesh, and the softbody settings, as GUIDs. */
export const materialPath = (m: BlendMaterial): string => (m.path ? m.path : `gamedata_randy/gmat/${m.name}.gmat`.toLowerCase());
export const meshPath = (m: BlendMesh): string => (m.path ? m.path : `gamedata_randy/mesh_library/${m.name}.mol`.toLowerCase());
export const texturePath = (t: BlendTexture): string => `gamedata_randy/texture_library/${t.name}.tex`.toLowerCase();

export interface BlendMeshImport {
  readonly mesh: Mesh;
  readonly notes: BuildNotes;
}

export interface BlendImportConfig {
  /** The revision the values carry. Java's `Work2` writes `0x132` (no compression). */
  readonly revision?: RevisionInfo;
}

/** The packet's skeleton as `Work2` makes it: inverse bind poses inverted from the bind poses, or one bone `Bone`. */
function skeletonOf(packet: BlendPacket): JBone[] {
  if (packet.bones.length === 0) return [newBone('Bone')];
  return packet.bones.map((b) => {
    const bone = newBone(b.name);
    bone.firstChild = b.firstChild;
    bone.nextSibling = b.nextSibling;
    bone.parent = b.parent;
    bone.skinPose = mat4(b.skinPose);
    bone.invSkinPose = invert4(bone.skinPose);
    return bone;
  });
}

interface PackedVertex {
  position: [number, number, number];
  normal: [number, number, number];
  tangent: [number, number, number];
  uv: [[number, number], [number, number], [number, number]];
  mass: number;
  springs: JSpring[];
  weights: [number, number, number, number];
  joints: [number, number, number, number];
  cluster: number;
}

/** The mesh half of `Work2`, for one of the packet's meshes. */
export function importBlendMesh(packet: BlendPacket, index: number, config: BlendImportConfig = {}): BlendMeshImport {
  const mesh = packet.meshes[index];
  if (!mesh) throw new BlendPacketError(`no mesh ${index}`);
  const materialRefs: ResourceRef[] = packet.materials.map((m) => ({ guid: makePathGuid(materialPath(m)) }));
  const skeleton = skeletonOf(packet);
  const soft = (mesh.flags & HAS_SOFTPHYSICS) !== 0;
  const armature = (mesh.flags & HAS_ARMATURE) !== 0;
  const clustered = (mesh.flags & HAS_SOFTBODY_CLUSTERS) !== 0;
  const layers = mesh.uvs.length;

  const loopToVertex = new Int32Array(mesh.numLoops);
  const vertexList: PackedVertex[] = [];
  const vertexIndex = new Map<string, number>();
  const vertexRemap = new Int32Array(mesh.numVertices);
  const loopsOf: number[][] = Array.from({ length: mesh.numVertices }, () => []);
  for (let j = 0; j < mesh.numLoops; j += 1) {
    const v = mesh.loops[j];
    if (v >= 0 && v < mesh.numVertices) loopsOf[v].push(j);
  }
  const zero: [number, number] = [0, 0];
  for (let i = 0; i < mesh.numVertices; i += 1) {
    vertexRemap[i] = vertexList.length;
    for (const j of loopsOf[i]) {
      const v: PackedVertex = {
        position: [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]],
        normal: [mesh.normals[j * 3], mesh.normals[j * 3 + 1], mesh.normals[j * 3 + 2]],
        tangent: [mesh.tangents[j * 3], mesh.tangents[j * 3 + 1], mesh.tangents[j * 3 + 2]],
        uv: [0, 1, 2].map((c) => (c < layers ? [mesh.uvs[c][j * 2], mesh.uvs[c][j * 2 + 1]] : zero)) as PackedVertex['uv'],
        mass: soft ? mesh.mass![i] : 1,
        springs: [],
        weights: armature ? [mesh.weights![i * 4], mesh.weights![i * 4 + 1], mesh.weights![i * 4 + 2], mesh.weights![i * 4 + 3]] : [0, 0, 0, 0],
        joints: armature ? [mesh.joints![i * 4], mesh.joints![i * 4 + 1], mesh.joints![i * 4 + 2], mesh.joints![i * 4 + 3]] : [0, 0, 0, 0],
        cluster: clustered ? mesh.clusterIndices![i] * 2 : 0,
      };
      const key = [vec3Key(...v.position), vec3Key(...v.normal), vec3Key(...v.tangent), ...v.uv.map(([x, y]) => vec3Key(x, y, 0))].join('|');
      const found = vertexIndex.get(key);
      if (found === undefined) {
        loopToVertex[j] = vertexList.length;
        vertexIndex.set(key, vertexList.length);
        vertexList.push(v);
      } else loopToVertex[j] = found;
    }
  }
  if (vertexList.length === 0) throw new BlendPacketError('a mesh with no loops');
  const pad = vertexList.length % 8 !== 0 ? 8 - (vertexList.length % 8) : 0;

  // Springs: each on both its vertices, then the bending springs to the neighbours' neighbours.
  const springs = mesh.springs.map((s) => ({ ...s }));
  const at = (i: number): PackedVertex => {
    const v = vertexList[vertexRemap[i]];
    if (v === undefined) throw new RangeError(`Index ${vertexRemap[i]} out of bounds for length ${vertexList.length}`);
    return v;
  };
  for (const s of springs) {
    at(s.a).springs.push(s);
    at(s.b).springs.push(s);
  }
  if (springs.length > 0) {
    const positionOf = (i: number): [number, number, number] => at(i).position;
    for (let i = 0; i < mesh.numVertices; i += 1) {
      const bp = at(i);
      const v0 = i;
      for (let b = bp.springs.length; b > 0; b -= 1) {
        const bs = bp.springs[b - 1];
        let other: PackedVertex;
        let notThis: number;
        if (v0 === bs.a) {
          other = at(bs.b);
          notThis = bs.b;
        } else if (v0 === bs.b) {
          other = at(bs.a);
          notThis = bs.a;
        } else throw new BlendPacketError('fuck you'); // Java's message: a spring on a vertex that shares its packed vertex with another
        for (let c = other.springs.length; c > 0; c -= 1) {
          const bs2 = other.springs[c - 1];
          for (const end of [bs2.a, bs2.b]) {
            if (end !== notThis && end > v0) {
              const pa = positionOf(Math.min(v0, end));
              const pb = positionOf(Math.max(v0, end));
              springs.push(spring(v0, end, pa, pb, 0, 0));
            }
          }
        }
      }
    }
  }
  for (const s of springs) {
    s.a = ((vertexRemap[s.a] + pad) << 16) >> 16;
    s.b = ((vertexRemap[s.b] + pad) << 16) >> 16;
  }

  const numVertices = vertexList.length + pad;
  const vs = new ByteStream(numVertices * 0x10);
  const ss = new ByteStream(numVertices * 0x10);
  const as = new ByteStream(numVertices * layers * 8);
  const round = (x: number): number => Math.round(f(x * 255));
  for (const v of [...Array.from({ length: pad }, () => vertexList[0]), ...vertexList]) {
    for (const c of v.position) vs.f32(c);
    vs.u8(v.cluster);
    vs.u8(0);
    vs.u8(0);
    vs.u8(round(v.mass));
    ss.u8(round(v.weights[2]));
    ss.u8(round(v.weights[1]));
    ss.u8(round(v.weights[0]));
    ss.u8(v.joints[0]);
    ss.u24(packNormal24(...v.normal));
    ss.u8(v.joints[1]);
    ss.u24(packNormal24(...v.normal));
    ss.u8(v.joints[2]);
    ss.u24(packNormal24(...v.tangent));
    ss.u8(v.joints[3]);
    for (let c = 0; c < layers; c += 1) {
      as.f32(v.uv[c][0]);
      as.f32(v.uv[c][1]);
    }
  }
  const is = new ByteStream(mesh.numTriangles * 6);
  const primitives: JPrimitive[] = [];
  let firstIndex = 0;
  for (const prim of mesh.primitives) {
    let max = -2147483648;
    let min = 2147483647;
    for (const loop of prim.triangles) {
      const v = loopToVertex[loop] + pad;
      if (v > max) max = v;
      if (v < min) min = v;
      is.u16(v);
    }
    const material = materialRefs[prim.materialIndex];
    if (material === undefined) throw new RangeError(`Index ${prim.materialIndex} out of bounds for length ${materialRefs.length}`);
    primitives.push({ material, minVert: min, maxVert: max, firstIndex, numIndices: prim.triangles.length, region: 0 });
    firstIndex += prim.triangles.length;
  }

  const build = new MeshBuild([vs.whole(), ss.whole()], as.whole(), is.whole(), skeleton);
  if (soft) build.generateEquivs();
  build.primitives.push(...primitives);
  if ((mesh.flags & HAS_SOFTBODY_SPRINGS) !== 0) build.generateSprings(springs);
  build.calculateSmoothNormals();
  build.calculateBoundBoxes(true);
  if (clustered) generateClusters(build, packet.clusters);
  build.strip();
  if (soft && mesh.softPhysSettings) build.softPhysSettings = { guid: makePathGuid(mesh.softPhysSettings) };
  return { mesh: toMesh(build, config.revision ?? { version: 0x132, subVersion: 0, branchId: 0, branchRevision: 0 }), notes: build.notes };
}

/** `RMesh.generateClusters`: each cluster's rest centre, dyadic sums and the vertex masses relative to it. */
function generateClusters(build: MeshBuild, names: readonly string[]): void {
  if (names.length === 0) return;
  const n = build.numVerts;
  const identity81 = (): Float32Array => Float32Array.from({ length: 81 }, (_, i) => (i % 10 === 0 ? 1 : 0));
  const identity16 = (): Float32Array => Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  // ⚠️ Java's named constructor calls `super()`, not `this()`: only the basis gets the identity 9x9.
  const clusters: (JCluster & { sum: number[] })[] = [
    { name: '', restCOM: [0, 0, 0, 0], restDyadicSum: identity16(), restQuadraticDyadicSum: identity81(), sum: [0, 0, 0] },
    ...names.map((name) => ({ name, restCOM: [0, 0, 0, 0] as [number, number, number, number], restDyadicSum: identity16(), restQuadraticDyadicSum: new Float32Array(81), sum: [0, 0, 0] })),
  ];
  const basis = clusters[0];
  const vertices = build.vertices();
  const stream = build.streams[0];
  const perCluster = new Int32Array(clusters.length);
  const massPer = new Float32Array(clusters.length);
  const toCluster = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = Math.trunc(((stream[i * 16 + 12] << 24) >> 24) / 2);
    const cluster = clusters[c];
    if (cluster === undefined) throw new RangeError(`Index ${c} out of bounds for length ${clusters.length}`);
    toCluster[i] = c;
    perCluster[c] += 1;
    for (let k = 0; k < 3; k += 1) cluster.sum[k] = f(cluster.sum[k] + vertices[i * 3 + k]);
  }
  clusters.forEach((cluster, i) => {
    const count = perCluster[i];
    if (count !== 0) {
      const inv = f(1 / count);
      cluster.restCOM = [f(cluster.sum[0] * inv), f(cluster.sum[1] * inv), f(cluster.sum[2] * inv), 0];
    }
  });
  const mass = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const com = clusters[toCluster[i]].restCOM;
    const dx = f(vertices[i * 3] - com[0]);
    const dy = f(vertices[i * 3 + 1] - com[1]);
    const dz = f(vertices[i * 3 + 2] - com[2]);
    const d = f(1 / f(Math.sqrt(f(f(dx * dx) + f(f(dy * dy) + f(dz * dz))))));
    mass[i] = d;
    massPer[toCluster[i]] = f(massPer[toCluster[i]] + d);
  }
  for (let i = 0; i < n; i += 1) mass[i] = f(mass[i] / massPer[toCluster[i]]);
  build.mass = mass;
  basis.restCOM = clusters[1].restCOM;
  clusters.forEach((cluster, c) => {
    if (perCluster[c] === 0) return;
    const com = cluster.restCOM;
    // Matrix3f, column-major: m00 m01 m02 m10 ...
    const aqq = new Array<number>(9).fill(0);
    const qs: number[][] = [];
    for (let i = 0; i < n; i += 1) {
      if (toCluster[i] !== c) continue;
      const w = mass[i];
      const q = [f(vertices[i * 3] - com[0]), f(vertices[i * 3 + 1] - com[1]), f(vertices[i * 3 + 2] - com[2])];
      qs.push([...q, w]);
      const [qx, qy, qz] = q;
      const add = [
        f(f(w * qx) * qx), f(f(w * qy) * qx), f(f(w * qz) * qx),
        f(f(w * qx) * qy), f(f(w * qy) * qy), f(f(w * qz) * qy),
        f(f(w * qx) * qz), f(f(w * qy) * qz), f(f(w * qz) * qz),
      ];
      for (let k = 0; k < 9; k += 1) aqq[k] = f(aqq[k] + add[k]);
    }
    const inv = invert3(aqq);
    const sum = identity16();
    for (let col = 0; col < 3; col += 1) for (let row = 0; row < 3; row += 1) sum[col * 4 + row] = inv[col * 3 + row];
    cluster.restDyadicSum = sum;
    if (cluster === basis) return;
    const mat = new Float32Array(81);
    for (const [qx, qy, qz, w] of qs) {
      const t = [qx, qy, qz, f(qx * qx), f(qy * qy), f(qz * qz), f(qx * qy), f(qy * qz), f(qz * qx)];
      for (let r = 0; r < 9; r += 1) for (let k = 0; k < 9; k += 1) mat[r * 9 + k] = f(mat[r * 9 + k] + f(f(0 + f(t[r] * t[k])) * w));
    }
    const inverted = invert9(mat);
    for (let col = 0; col < 9; col += 1) for (let row = 0; row < 9; row += 1) cluster.restQuadraticDyadicSum[col * 9 + row] = inverted[row * 9 + col];
  });
  build.softbodyClusters = clusters.map(({ name, restCOM, restDyadicSum, restQuadraticDyadicSum }) => ({ name, restCOM, restDyadicSum, restQuadraticDyadicSum }));
}

/** JOML's `Matrix3f.invert()`, column-major in, column-major out. */
function invert3(m: number[]): number[] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const fm = (a: number, b: number, c: number): number => f(f(a * b) + c);
  const a = fm(m00, m11, f(-m01 * m10));
  const b = fm(m02, m10, f(-m00 * m12));
  const c = fm(m01, m12, f(-m02 * m11));
  const d = fm(a, m22, fm(b, m21, f(c * m20)));
  const s = f(1 / d);
  return [
    f(fm(m11, m22, f(-m21 * m12)) * s), f(fm(m21, m02, f(-m01 * m22)) * s), f(c * s),
    f(fm(m20, m12, f(-m10 * m22)) * s), f(fm(m00, m22, f(-m20 * m02)) * s), f(b * s),
    f(fm(m10, m21, f(-m20 * m11)) * s), f(fm(m20, m01, f(-m00 * m21)) * s), f(a * s),
  ];
}


/** `readBlendPacket`'s inverse: a packet as the toolkit's Blender exporter lays one out (for tests and tools). */
export function writeBlendPacket(packet: BlendPacket): Uint8Array {
  const parts: number[] = [];
  const out = {
    i32(v: number): void { parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); },
    f32(v: number): void { const b = new Uint8Array(Float32Array.of(v).buffer); parts.push(...b); },
    bytes(b: Uint8Array): void { for (const x of b) parts.push(x); },
    str(s: string): void { const b = new TextEncoder().encode(s); out.i32(b.length); out.bytes(b); },
  };
  const blob = (write: (o: typeof out) => void): Uint8Array => {
    const saved = parts.splice(0);
    write(out);
    const b = Uint8Array.from(parts.splice(0));
    parts.push(...saved);
    return b;
  };
  parts.push(0x42, 0x4d, 0x53, 0x48);
  out.i32(packet.version);
  for (const n of [packet.textures.length, packet.materials.length, packet.meshes.length, packet.bones.length, packet.clusters.length]) out.i32(n);
  for (const t of packet.textures) {
    out.i32(t.key);
    out.str(t.name);
    if (t.width === undefined) {
      parts.push(1);
      continue;
    }
    parts.push(0);
    out.i32(t.width);
    out.i32(t.height ?? 0);
    out.i32(t.flags ?? 0);
    out.i32(t.pixels.length * 4);
    for (const p of t.pixels) out.i32((p & 0xff00ff00) | ((p & 0xff) << 16) | ((p >> 16) & 0xff));
  }
  for (const m of packet.materials) {
    out.str(m.path);
    out.str(m.name);
    out.i32(m.flags);
    out.i32(m.data.length);
    out.bytes(m.data);
  }
  for (const b of packet.bones) {
    out.str(b.name);
    out.i32(b.parent);
    out.i32(b.firstChild);
    out.i32(b.nextSibling);
    for (const v of b.skinPose) out.f32(v);
  }
  for (const c of packet.clusters) out.str(c);
  for (const m of packet.meshes) {
    const b = blob((o) => {
      o.str(m.path);
      o.str(m.name);
      o.i32(m.flags);
      o.i32(m.numVertices);
      o.i32(m.numLoops);
      o.i32(m.numTriangles);
      o.i32(m.uvs.length);
      o.i32(0);
      o.i32(m.primitives.length);
      if ((m.flags & HAS_SHAPE_KEYS) !== 0) o.i32(m.numShapeKeys);
      for (const v of m.positions) o.f32(v);
      for (const layer of m.uvs) for (const v of layer) o.f32(v);
      for (const v of m.normals) o.f32(v);
      for (const v of m.tangents) o.f32(v);
      for (const v of m.loops) o.i32(v);
      for (const p of m.primitives) {
        o.i32(p.materialIndex);
        o.i32(p.triangles.length);
        for (const t of p.triangles) o.i32(t);
      }
      if ((m.flags & HAS_ARMATURE) !== 0) {
        for (const v of m.joints!) o.i32(v);
        for (const v of m.weights!) o.f32(v);
      }
      if ((m.flags & HAS_VERTEX_MASS) !== 0) for (const v of m.mass!) o.f32(v);
      if ((m.flags & HAS_SOFTBODY_SPRINGS) !== 0) {
        o.i32(m.springs.length);
        for (const s of m.springs) {
          o.i32(s.a);
          o.i32(s.b);
        }
      }
      if ((m.flags & HAS_SOFTBODY_CLUSTERS) !== 0) for (const v of m.clusterIndices!) o.i32(v);
      if ((m.flags & HAS_SOFTPHYSICS) !== 0) o.str(m.softPhysSettings ?? '');
    });
    out.i32(b.length);
    out.bytes(b);
  }
  return Uint8Array.from(parts);
}

/**
 * A packet of one bent, two-boned, soft grid -- `size` x `size` vertices,
 * its UVs split along a seam so loops of one vertex differ -- with springs
 * along the grid's edges and two clusters: what the tests and
 * `dev/import-blend-java.ts` feed both importers.
 */
export function syntheticBlendPacket(size: number, seed: number, flags = HAS_ARMATURE | HAS_VERTEX_MASS | HAS_SOFTPHYSICS): BlendPacket {
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const n = size * size;
  const positions = new Float32Array(n * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      positions.set([x - size / 2 + random() * 0.1, Math.sin(x * 0.7) * 0.5 + random() * 0.1, y - size / 2], i * 3);
    }
  }
  const loops: number[] = [];
  const triangles: number[][] = [[], []];
  const uv: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  for (let y = 0; y + 1 < size; y += 1) {
    for (let x = 0; x + 1 < size; x += 1) {
      const quad = [y * size + x, y * size + x + 1, (y + 1) * size + x + 1, (y + 1) * size + x];
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        const prim = x < size / 2 ? 0 : 1;
        for (const k of tri) {
          const v = quad[k];
          triangles[prim].push(loops.length);
          loops.push(v);
          const seam = x >= size / 2 && k === 0 ? 0.5 : 0;
          uv.push((v % size) / size + seam, Math.trunc(v / size) / size);
          const len = Math.hypot(0.2, 1, 0.1);
          normals.push(0.2 / len, 1 / len, 0.1 / len);
          tangents.push(1, 0, 0);
        }
      }
    }
  }
  const springs: { a: number; b: number; restLengthSq: number }[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      if (x + 1 < size) springs.push({ a: i, b: i + 1, restLengthSq: 0 });
      if (y + 1 < size) springs.push({ a: i, b: i + size, restLengthSq: 0 });
    }
  }
  const joints = new Int32Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const t = (i % size) / (size - 1);
    joints.set([0, 1, 0, 0], i * 4);
    weights.set([1 - t, t, 0, 0], i * 4);
  }
  const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const moved = Float32Array.of(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 2, 0.5, 0, 1);
  return {
    version: 1,
    textures: [{ key: 1, name: 'grid', width: 1, height: 1, flags: 1, pixels: Int32Array.of(0x7f102030) }],
    materials: [
      { path: '', name: 'Grid_A', flags: 0, data: new Uint8Array(0) },
      { path: 'gamedata/gmat/b.gmat', name: 'b', flags: 1, data: new Uint8Array(0) },
    ],
    bones: [
      { name: 'root', parent: -1, firstChild: 1, nextSibling: -1, skinPose: identity },
      { name: 'tip', parent: 0, firstChild: -1, nextSibling: -1, skinPose: moved },
    ],
    clusters: ['left', 'right'],
    meshes: [{
      path: '', name: 'Grid', flags, numVertices: n, numLoops: loops.length, numTriangles: loops.length / 3, numShapeKeys: 0, positions,
      uvs: [Float32Array.from(uv)], normals: Float32Array.from(normals), tangents: Float32Array.from(tangents), loops: Int32Array.from(loops),
      primitives: triangles.map((t, m) => ({ materialIndex: m, triangles: Int32Array.from(t) })),
      joints, weights,
      mass: Float32Array.from({ length: n }, (_, i) => (i % size === 0 ? 1 : 0.3 + random() * 0.5)),
      springs,
      clusterIndices: Int32Array.from({ length: n }, (_, i) => ((i % size) < size / 2 ? 1 : 2)),
      softPhysSettings: 'gamedata/softphys/grid.sph',
    }],
  };
}
