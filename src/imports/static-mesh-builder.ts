/**
 * An `RStaticMesh` -- a backdrop -- baked from meshes placed in the world:
 * Java cwlib's `io/imports/StaticMeshBuilder.java` (ennuo/toolkit `d6a2ef8`),
 * ported.
 *
 * What it does, as Java does: each Thing with a `POS` and a `RENDER_MESH`
 * whose mesh has no animation adds that mesh, skinned once into world space --
 * every vertex by the weighted sum of its four joints' `world * invSkinPose`,
 * a joint's world the world matrix of the bone Thing riding that bone
 * (`PPos.animHash`), else the Thing's own -- normals, tangents and smooth
 * normals turned by the same matrix's 3x3. Each of the mesh's primitives is a
 * backdrop primitive: its run of the index buffer made local to its first
 * vertex (`vertexStart` takes the offset), its box the box of its skinned
 * vertices, its material and primitive type the mesh's. One tree node holds
 * every primitive and the box of all vertices.
 *
 * The float arithmetic is JOML's (`joml.ts`), the packs Java's (truncated
 * normals, `MemoryOutputStream.f16`'s half floats): with `javaSkinning` the
 * static mesh's positions, normals, UVs, primitives, boxes and index buffer
 * are Java's to the bit (`dev/import-staticmesh-java.ts`).
 *
 * Where this differs from Java, on purpose:
 * - ❗ **The tangent goes to the word at 28**, where the game's backdrops keep
 *   it (`StaticMesh.tangents`, measured on the game's 47); Java writes the
 *   mesh's tangent at 20 and its smooth normal at 28. The word at 20, which
 *   no value carries, `writeStaticMesh` writes zero; the smooth normal is
 *   dropped.
 * - **A mesh with one UV channel bakes**, its second channel zero; Java's
 *   `getUVs(1)` throws on it.
 * - ❗ **The joints' matrices are blended whole.** Java weights each with
 *   `Matrix4f.scale(w)`, which scales the first three columns and leaves the
 *   translation, and adds the four: every vertex lands at its skinned place
 *   plus three more times its joints' translation -- a Thing placed at x = 10
 *   bakes at x = 40. `javaSkinning: true` does as Java does (the oracle
 *   comparison runs so).
 * - **A Thing's mesh comes from the caller** (`addThing`'s `load`), where Java
 *   asks its global `ResourceSystem`.
 */

import type { ResourceRef, RevisionInfo } from '../io/serializer.ts';
import { halfToFloat } from '../io/stream.ts';
import type { Mesh } from '../resources/mesh.ts';
import type { StaticMesh, StaticPrimitive, StaticUnknownStruct } from '../resources/staticmesh.ts';
import { PRIMITIVE_TRIANGLES, PRIMITIVE_TRIANGLE_STRIP } from '../resources/mesh.ts';
import type { Thing } from '../things/thing.ts';
import { add4, f, mat4, max4, min4, mul3x3, mul4, mulVec4, scale4, type Mat4 } from './joml.ts';
import { packNormal32, unpackNormal24 } from './mesh-builder.ts';

/** cwlib's `MemoryOutputStream.f16`: a float as a half, ties rounded away from zero. */
export function javaHalf(value: number): number {
  const bits = new DataView(new ArrayBuffer(4));
  bits.setFloat32(0, value);
  let fbits = bits.getInt32(0);
  if (Number.isNaN(value)) fbits = 0x7fc00000;
  const sign = (fbits >>> 16) & 0x8000;
  let val = ((fbits & 0x7fffffff) + 0x1000) | 0;
  if (val >= 0x47800000) {
    if ((fbits & 0x7fffffff) >= 0x47800000) {
      if (val < 0x7f800000) return sign | 0x7c00;
      return sign | 0x7c00 | ((fbits & 0x007fffff) >>> 13);
    }
    return sign | 0x7bff;
  }
  if (val >= 0x38800000) return (sign | ((val - 0x38000000) >>> 13)) & 0xffff;
  if (val < 0x33000000) return sign;
  val = (fbits & 0x7fffffff) >>> 23;
  return (sign | ((((fbits & 0x7fffff) | 0x800000) + (0x800000 >>> ((val - 102) & 31))) >>> ((126 - val) & 31))) & 0xffff;
}

/** `Bytes.unpackNormal32` as `readStaticMesh` decodes it, so a packed word round-trips through `writeStaticMesh`. */
function libUnpack32(value: number, out: Float32Array, at: number): void {
  const x = value & 0x3ff;
  const y = (value >>> 11) & 0x3ff;
  const z = (value >>> 22) & 0x1ff;
  out[at] = (value >>> 10) & 1 ? -((1023 - x) / 1023) : x / 1023;
  out[at + 1] = (value >>> 21) & 1 ? -((1023 - y) / 1023) : y / 1023;
  out[at + 2] = (value >>> 31) & 1 ? -((511 - z) / 511) : z / 511;
}

type V4 = [number, number, number, number];

/** A placement: the world matrix, and the world matrices of the bones that ride the mesh's bones. */
export interface Placement {
  /** Column-major, as `PPos` holds it. */
  readonly world: ArrayLike<number>;
  /** Each bone Thing's `PPos.animHash` and world matrix. */
  readonly bones?: readonly { readonly animHash: number; readonly world: ArrayLike<number> }[];
}

export class StaticMeshBuilder {
  private readonly vertexRecords: Uint8Array[] = [];
  private readonly indexRuns: Uint8Array[] = [];
  private readonly primitives: StaticPrimitive[] = [];
  private globalMax: V4 = [-Infinity, -Infinity, -Infinity, -Infinity];
  private globalMin: V4 = [Infinity, Infinity, Infinity, Infinity];
  private vertexOffset = 0;
  private readonly javaSkinning: boolean;

  /**
   * `javaSkinning`: blend the joints' matrices as Java does, `Matrix4f.scale`
   * by each weight -- which leaves the translation column alone, so the sum
   * of the four carries a placement's translation four times. Off by default.
   */
  constructor(options: { readonly javaSkinning?: boolean } = {}) {
    this.javaSkinning = options.javaSkinning ?? false;
  }
  private indexOffset = 0;

  /**
   * `add(thing)`: a Thing's mesh, if it has a `POS` and an unanimated
   * `RENDER_MESH` (else nothing happens and false comes back). `load`
   * resolves the mesh reference.
   */
  async addThing(thing: Thing | undefined, load: (ref: ResourceRef) => Promise<Mesh | undefined>): Promise<boolean> {
    if (!thing) return false;
    const pos = thing.parts.get('POS') as Float32Array | undefined;
    const part = thing.parts.get('RENDER_MESH') as { mesh?: ResourceRef; anim?: ResourceRef; boneThings: (Thing | undefined)[] } | undefined;
    if (!pos || !part || !part.mesh || part.anim) return false;
    const mesh = await load(part.mesh);
    if (!mesh) throw new Error(`Failed to extract RMesh (${part.mesh.hash ? 'h' : 'g'}${part.mesh.guid})`);
    const bones: { animHash: number; world: Float32Array }[] = [];
    for (const bone of part.boneThings) {
      if (!bone || bone === thing) continue;
      const bonePos = bone.parts.get('POS') as (Float32Array & { animHash?: number }) | undefined;
      if (!bonePos) continue;
      bones.push({ animHash: bonePos.animHash ?? 0, world: bonePos });
    }
    this.add(mesh, { world: pos, bones });
    return true;
  }

  /** The heart of `add(thing)`: one mesh at one placement. */
  add(mesh: Mesh, placement: Placement): void {
    const n = mesh.vertexCount;
    const stored = mesh.stored && mesh.stored.vertexCount === n ? mesh.stored : undefined;
    const skinBytes = stored?.skin;
    const pv = stored ? new DataView(stored.position.buffer, stored.position.byteOffset, stored.position.byteLength) : undefined;
    const bones = mesh.bones;
    const wpos = mat4(placement.world);
    if (bones.length === 0) throw new RangeError('Index 0 out of bounds for length 0');
    const inverse = bones.map((b) => mat4(b.invSkinPose));
    const matrices: Mat4[] = bones.map(() => mul4(wpos, inverse[0]));
    for (const bone of placement.bones ?? []) {
      // `Bone.indexOf`: hash 0 is the first bone.
      const index = bone.animHash === 0 ? 0 : bones.findIndex((b) => b.animHash === bone.animHash);
      if (index === -1) continue;
      matrices[index] = mul4(mat4(bone.world), inverse[index]);
    }

    // Java's getters, from the stored streams where the mesh has them.
    const vertex = (i: number): V4 => (pv
      ? [pv.getFloat32(i * 16, false), pv.getFloat32(i * 16 + 4, false), pv.getFloat32(i * 16 + 8, false), 1]
      : [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2], 1]);
    const pack24 = (i: number, at: number): [number, number, number] | undefined => {
      if (!skinBytes) return undefined;
      const o = i * 16 + at;
      return unpackNormal24((skinBytes[o] << 16) | (skinBytes[o + 1] << 8) | skinBytes[o + 2]);
    };
    const normalOf = (i: number): [number, number, number] => pack24(i, 4) ?? [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]];
    const tangentOf = (i: number): [number, number, number] => pack24(i, 12) ?? [mesh.tangents[i * 3], mesh.tangents[i * 3 + 1], mesh.tangents[i * 3 + 2]];
    const jointsOf = (i: number): number[] => (skinBytes
      ? [skinBytes[i * 16 + 3], skinBytes[i * 16 + 7], skinBytes[i * 16 + 11], skinBytes[i * 16 + 15]].map((b) => (b << 24) >> 24)
      : Array.from(mesh.joints.subarray(i * 4, i * 4 + 4)));
    const weightsOf = (i: number): number[] => {
      if (!skinBytes) return Array.from(mesh.weights.subarray(i * 4, i * 4 + 4));
      const w0 = skinBytes[i * 16 + 2];
      const w1 = skinBytes[i * 16 + 1];
      const w2 = skinBytes[i * 16];
      if (w0 === 0xff) return [1, 0, 0, 0];
      return [f(w0 / 0xff), f(w1 / 0xff), f(w2 / 0xff), f(f(f(f(0xff - w2) - w1) - w0) / 0xff)];
    };
    const uv = (channel: number, i: number): [number, number] => {
      const c = mesh.uvs[channel];
      return c ? [c[i * 2], c[i * 2 + 1]] : [0, 0];
    };

    const records = new Uint8Array(n * 0x20);
    const rv = new DataView(records.buffer);
    const wVerts: V4[] = [];
    const wMax: V4 = [-Infinity, -Infinity, -Infinity, -Infinity];
    const wMin: V4 = [Infinity, Infinity, Infinity, Infinity];
    for (let i = 0; i < n; i += 1) {
      const j = jointsOf(i);
      const w = weightsOf(i);
      const m = (k: number): Mat4 => {
        const matrix = matrices[j[k]];
        if (matrix === undefined) throw new RangeError(`Index ${j[k]} out of bounds for length ${matrices.length}`);
        return matrix;
      };
      const by = this.javaSkinning ? scale4 : weigh;
      const skin = add4(add4(add4(by(m(0), w[0]), by(m(1), w[1])), by(m(2), w[2])), by(m(3), w[3]));
      const vpos = mulVec4(skin, vertex(i));
      wVerts.push(vpos);
      const normal = mul3x3(skin, normalOf(i));
      const smooth = mul3x3(skin, pack24(i, 8) ?? normalOf(i));
      const tangent = mul3x3(skin, tangentOf(i));
      const o = i * 0x20;
      rv.setFloat32(o, vpos[0], false);
      rv.setFloat32(o + 4, vpos[1], false);
      rv.setFloat32(o + 8, vpos[2], false);
      rv.setUint32(o + 12, packNormal32(normal[0], normal[1], normal[2]) >>> 0, false);
      const [u0, v0] = uv(0, i);
      rv.setUint16(o + 16, javaHalf(u0), false);
      rv.setUint16(o + 18, javaHalf(v0), false);
      rv.setUint32(o + 20, packNormal32(tangent[0], tangent[1], tangent[2]) >>> 0, false);
      const [u1, v1] = uv(1, i);
      rv.setUint16(o + 24, javaHalf(u1), false);
      rv.setUint16(o + 26, javaHalf(v1), false);
      rv.setUint32(o + 28, packNormal32(smooth[0], smooth[1], smooth[2]) >>> 0, false);
      max4(wMax, vpos);
      min4(wMin, vpos);
    }
    max4(this.globalMax, wMax);
    min4(this.globalMin, wMin);
    this.vertexRecords.push(records);

    // Every run made local to its primitive's first vertex. (Java hashes each
    // run to share equal ones, and never fills the cache it looks them up in.)
    const indexData = stored?.indices;
    const iv = indexData ? new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength) : undefined;
    for (const primitive of mesh.primitives) {
      const max: V4 = [-Infinity, -Infinity, -Infinity, -Infinity];
      const min: V4 = [Infinity, Infinity, Infinity, Infinity];
      const count = iv ? primitive.numIndices : primitive.triangles.length;
      const local = new Uint8Array(count * 2);
      for (let i = 0; i < count; i += 1) {
        let index = iv ? iv.getUint16((primitive.firstIndex + i) * 2, false) : primitive.triangles[i];
        if (index !== 65535) {
          const v = wVerts[index];
          if (v === undefined) throw new RangeError(`Index ${index} out of bounds for length ${n}`);
          max4(max, v);
          min4(min, v);
          index -= primitive.minVert;
        }
        local[i * 2] = (index >> 8) & 0xff;
        local[i * 2 + 1] = index & 0xff;
      }
      this.indexRuns.push(local);
      const type = iv ? mesh.primitiveType : PRIMITIVE_TRIANGLES;
      this.primitives.push({
        min, max, ...(primitive.material ? { material: primitive.material } : {}),
        vertexStart: this.vertexOffset + primitive.minVert, indexStart: this.indexOffset, numIndices: count, type,
        triangles: new Uint32Array(0),
      });
      this.indexOffset += count;
    }
    this.vertexOffset += n;
  }

  /**
   * `export(path)`'s resource as this library's `StaticMesh` -- its values the
   * bytes Java builds, decoded as `readStaticMesh` decodes them, so
   * `writeStaticMesh` writes them back to the bit (the tangent at 28, above).
   */
  build(revision: RevisionInfo = { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 }): StaticMesh {
    const vertexCount = this.vertexOffset;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const tangents = new Float32Array(vertexCount * 3);
    const uv0 = new Float32Array(vertexCount * 2);
    const uv1 = new Float32Array(vertexCount * 2);
    let v = 0;
    for (const records of this.vertexRecords) {
      const d = new DataView(records.buffer);
      for (let o = 0; o < records.length; o += 0x20, v += 1) {
        positions[v * 3] = d.getFloat32(o, false);
        positions[v * 3 + 1] = d.getFloat32(o + 4, false);
        positions[v * 3 + 2] = d.getFloat32(o + 8, false);
        libUnpack32(d.getUint32(o + 12, false), normals, v * 3);
        uv0[v * 2] = halfToFloat(d.getUint16(o + 16, false));
        uv0[v * 2 + 1] = halfToFloat(d.getUint16(o + 18, false));
        libUnpack32(d.getUint32(o + 20, false), tangents, v * 3); // Java's word 20, the mesh's tangent, to 28
        uv1[v * 2] = halfToFloat(d.getUint16(o + 24, false));
        uv1[v * 2 + 1] = halfToFloat(d.getUint16(o + 26, false));
      }
    }
    const total = this.indexRuns.reduce((s, r) => s + r.length / 2, 0);
    const indices = new Uint16Array(total);
    let at = 0;
    for (const run of this.indexRuns) {
      for (let i = 0; i < run.length; i += 2) indices[at++] = (run[i] << 8) | run[i + 1];
    }
    const primitives = this.primitives.map((p) => ({ ...p, triangles: unroll(indices, p) }));
    const node: StaticUnknownStruct = {
      min: [this.globalMin[0], this.globalMin[1], this.globalMin[2]],
      structIndexA: -1,
      structIndexB: -1,
      max: [this.globalMax[0], this.globalMax[1], this.globalMax[2]],
      firstPrimitive: 0,
      numPrimitives: (primitives.length << 16) >> 16,
    };
    return { revision, vertexCount, positions, normals, tangents, uvs: [uv0, uv1], primitives, indices, unknownStructs: [node] };
  }
}

/** A matrix times a weight, every element: the blend Java means, its translation weighted too. */
function weigh(mat: Mat4, w: number): Mat4 {
  return { m: mat.m.map((v) => f(v * w)), properties: 0 };
}

/** A run as the triangles `readStaticMesh` would give for it. */
function unroll(indices: Uint16Array, p: StaticPrimitive): Uint32Array {
  const run = indices.subarray(p.indexStart, p.indexStart + p.numIndices);
  const out: number[] = [];
  const push = (a: number, b: number, c: number): void => {
    if (a === b || b === c || a === c) return;
    out.push(a + p.vertexStart, b + p.vertexStart, c + p.vertexStart);
  };
  if (p.type !== PRIMITIVE_TRIANGLE_STRIP) {
    for (let i = 0; i + 2 < run.length; i += 3) push(run[i], run[i + 1], run[i + 2]);
    return Uint32Array.from(out);
  }
  let parity = 0;
  for (let i = 0; i + 2 < run.length; i += 1) {
    const [a, b, c] = [run[i], run[i + 1], run[i + 2]];
    if (a === 0xffff || b === 0xffff || c === 0xffff) {
      parity = c === 0xffff ? 0 : b === 0xffff ? 1 : 0;
      continue;
    }
    if (parity % 2 === 0) push(a, b, c);
    else push(a, c, b);
    parity += 1;
  }
  return Uint32Array.from(out);
}
