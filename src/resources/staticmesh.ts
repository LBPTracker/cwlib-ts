/**
 * `RStaticMesh` -- a level's backdrop: magic `SMHb`, dependency type 44, FileDB
 * paths `…/palettes/….smh`, named by `PLevelSettings.backdropMesh`.
 *
 * ❗ **Its container differs from every other resource's.** Where the branch
 * pair, the compression flags and the compressed bool would be, a static mesh
 * carries a `StaticMeshInfo` -- the backdrop's texture maps, its primitives and
 * the sizes of its buffers -- serialised plainly, and the chunk table follows
 * it with no compressed flag. cwlib's `SerializedResource` and
 * `structs/staticmesh/` (toolkit `fee22399`); measured on every `SMHb` in LBP3
 * PS4 01.00's four FARCs (`dev/staticmesh-census.ts`) -- steering/level-files.md,
 * *Backdrops*.
 *
 * The payload is the vertex stream, 32 bytes a vertex, then the index buffer
 * as big-endian `u16`s to the end.
 */

import { inflateChunkTable, magicOf, type Inflate } from '../io/resource.ts';
import { Serializer, SerializerError, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';
import { PRIMITIVE_TRIANGLES, PRIMITIVE_TRIANGLE_STRIP } from './mesh.ts';
import { halfToFloat } from '../io/stream.ts';

export interface StaticPrimitive {
  readonly min: readonly [number, number, number, number];
  readonly max: readonly [number, number, number, number];
  /** The `RGfxMaterial` (`GMTb`). */
  readonly material?: ResourceRef;
  /** Added to every index of the run: see steering, *Backdrops*. */
  readonly vertexStart: number;
  readonly indexStart: number;
  readonly numIndices: number;
  /** `PRIMITIVE_TRIANGLES` or `PRIMITIVE_TRIANGLE_STRIP`. */
  readonly type: number;
  /** The run as a triangle list into the mesh's vertices, strips unrolled, degenerates dropped. */
  readonly triangles: Uint32Array;
}

export interface StaticMesh {
  readonly revision: RevisionInfo;
  /** The backdrop's baked lighting maps, `RTexture`s. */
  readonly lightmap?: ResourceRef;
  readonly risemap?: ResourceRef;
  readonly fallmap?: ResourceRef;
  readonly vertexCount: number;
  /** `vertexCount * 3`. */
  readonly positions: Float32Array;
  /** `vertexCount * 3`, from cwlib's `unpackNormal32`. */
  readonly normals: Float32Array;
  /**
   * `vertexCount * 3`: the direction UV 0's `u` runs, the pack at 28 --
   * cwlib's "smooth normal" -- unpacked like the normal. ✔ Within 0.9 of the
   * tangent made from positions and UV 0 on 6,586,039 of the 7,400,001 vertices
   * it can be made on over the game's 47 backdrops (6,375,295 the same way),
   * and across the normal on 71.5% of all; the pack at 20, cwlib's "tangent",
   * lines up on 8%. No handedness is stored (`uvHandedness`).
   */
  readonly tangents: Float32Array;
  /** `vertexCount * 2` each: two channels of half floats. */
  readonly uvs: [Float32Array, Float32Array];
  readonly primitives: StaticPrimitive[];
}

export class StaticMeshFormatError extends Error {}

/** cwlib's `Bytes.unpackNormal32`: x and y in 10 bits with a sign bit, z in 9 with one. */
function unpackNormal32(value: number, out: Float32Array, at: number): void {
  const x = value & 0x3ff;
  const y = (value >>> 11) & 0x3ff;
  const z = (value >>> 22) & 0x1ff;
  out[at] = (value >>> 10) & 1 ? -((1023 - x) / 1023) : x / 1023;
  out[at + 1] = (value >>> 21) & 1 ? -((1023 - y) / 1023) : y / 1023;
  out[at + 2] = (value >>> 31) & 1 ? -((511 - z) / 511) : z / 511;
}

/** One run of the index buffer as a triangle list, each index offset by `base`. */
function triangles(indices: Uint16Array, first: number, count: number, type: number, base: number): Uint32Array {
  const run = indices.subarray(first, first + count);
  // Sized for every triangle the run could hold, then cut to those kept.
  const out = new Uint32Array(type === PRIMITIVE_TRIANGLES ? run.length - (run.length % 3) : Math.max(0, run.length - 2) * 3);
  let n = 0;
  const push = (a: number, b: number, c: number): void => {
    if (a === b || b === c || a === c) return;
    out[n] = a + base;
    out[n + 1] = b + base;
    out[n + 2] = c + base;
    n += 3;
  };
  if (type === PRIMITIVE_TRIANGLES) {
    for (let i = 0; i + 2 < run.length; i += 3) push(run[i], run[i + 1], run[i + 2]);
    return out.slice(0, n);
  }
  if (type !== PRIMITIVE_TRIANGLE_STRIP) throw new StaticMeshFormatError(`primitive type ${type} is neither a strip nor a list`);
  // A strip restarts on 0xffff and alternates its winding, as `RMesh`'s do.
  let parity = 0;
  for (let i = 0; i + 2 < run.length; i += 1) {
    const a = run[i];
    const b = run[i + 1];
    const c = run[i + 2];
    if (a === 0xffff || b === 0xffff || c === 0xffff) {
      parity = c === 0xffff ? 0 : b === 0xffff ? 1 : 0;
      continue;
    }
    if (parity % 2 === 0) push(a, b, c);
    else push(a, c, b);
    parity += 1;
  }
  return out.slice(0, n);
}

/**
 * `StaticMeshInfo`, the header between the dependency offset and the chunk
 * table, through its `HELP` marker. Exported for `archives/hashinate.ts`,
 * which reads it on a tape to rewrite the descriptors in it.
 */
export function readStaticMeshInfo(s: Serializer) {
  const lightmap = s.resource();
  const risemap = s.resource();
  const fallmap = s.resource();
  s.i32(); // primitiveCount
  s.i32(); // unknownStructCount
  const indexBufferSize = s.i32();
  const vertexStreamSize = s.i32();
  const raw = s.array((p) => ({
    min: p.vector4(),
    max: p.vector4(),
    material: p.resource(),
    vertexStart: p.i32(),
    indexStart: p.i32(),
    numIndices: p.i32(),
    type: p.u8(),
  }));
  s.array((u) => {
    u.skipVector3(); // min
    u.i16(); // structIndexA
    u.i16(); // structIndexB
    u.skipVector3(); // max
    u.i16(); // firstPrimitive
    u.i16(); // numPrimitives
  });
  const marker = s.u32(true);
  if (marker !== 0x48454c50) throw new StaticMeshFormatError(`the header ends in 0x${marker.toString(16)}, not "HELP"`);
  return { lightmap, risemap, fallmap, indexBufferSize, vertexStreamSize, raw };
}

export async function readStaticMesh(bytes: Uint8Array, inflate: Inflate): Promise<StaticMesh> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x10 || magicOf(bytes) !== 'SMHb') {
    throw new StaticMeshFormatError('not a static mesh');
  }
  const head = view.getUint32(4, false);
  const revision: RevisionInfo = { version: head & 0xffff, subVersion: head >>> 16, branchId: 0, branchRevision: 0 };
  if (revision.version < 0x109) throw new StaticMeshFormatError(`static mesh head 0x${head.toString(16)}: no dependency offset`);
  const dependencyTableOffset = view.getUint32(8, false);

  // The header's `StaticMeshInfo`, read plainly (no compressed integers) from 0x0c.
  const s = new Serializer(bytes.subarray(0x0c, dependencyTableOffset), revision, 0);
  const { lightmap, risemap, fallmap, indexBufferSize, vertexStreamSize, raw } = readStaticMeshInfo(s);

  // The chunk table, straight after: always compressed.
  const { data, end } = await inflateChunkTable(bytes, 0x0c + s.position, inflate, { error: StaticMeshFormatError });
  if (end !== dependencyTableOffset) {
    throw new StaticMeshFormatError(`chunk data ends at 0x${end.toString(16)}, the dependency table is at 0x${dependencyTableOffset.toString(16)}`);
  }

  // The vertex stream, 32 bytes a vertex, then the indices to the end.
  if (vertexStreamSize % 0x20 !== 0 || vertexStreamSize > data.length) {
    throw new StaticMeshFormatError(`a vertex stream of ${vertexStreamSize} bytes in ${data.length}`);
  }
  if (data.length - vertexStreamSize !== indexBufferSize) {
    throw new StaticMeshFormatError(`${data.length - vertexStreamSize} bytes of indices, the header says ${indexBufferSize}`);
  }
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const vertexCount = vertexStreamSize / 0x20;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const uv0 = new Float32Array(vertexCount * 2);
  const uv1 = new Float32Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v += 1) {
    const o = v * 0x20;
    positions[v * 3] = d.getFloat32(o, false);
    positions[v * 3 + 1] = d.getFloat32(o + 4, false);
    positions[v * 3 + 2] = d.getFloat32(o + 8, false);
    unpackNormal32(d.getUint32(o + 12, false), normals, v * 3);
    uv0[v * 2] = halfToFloat(d.getUint16(o + 16, false));
    uv0[v * 2 + 1] = halfToFloat(d.getUint16(o + 18, false));
    // o + 20: cwlib's "tangent", which is none (`StaticMesh.tangents`), not returned; o + 28 the tangent.
    unpackNormal32(d.getUint32(o + 28, false), tangents, v * 3);
    uv1[v * 2] = halfToFloat(d.getUint16(o + 24, false));
    uv1[v * 2 + 1] = halfToFloat(d.getUint16(o + 26, false));
  }
  const indices = new Uint16Array(indexBufferSize / 2);
  for (let i = 0; i < indices.length; i += 1) indices[i] = d.getUint16(vertexStreamSize + i * 2, false);
  const primitives: StaticPrimitive[] = raw.map((p) => {
    if (p.indexStart < 0 || p.indexStart + p.numIndices > indices.length) {
      throw new StaticMeshFormatError(`a primitive's run ${p.indexStart}+${p.numIndices} is outside ${indices.length} indices`);
    }
    return { ...p, triangles: triangles(indices, p.indexStart, p.numIndices, p.type, p.vertexStart) };
  });
  return { revision, lightmap, risemap, fallmap, vertexCount, positions, normals, tangents, uvs: [uv0, uv1], primitives };
}

/** For the census: one run's raw indices, to test what `vertexStart` is. */
export { triangles as staticTriangles };

export { SerializerError };
