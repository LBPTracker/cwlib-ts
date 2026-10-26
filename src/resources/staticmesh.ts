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

import { fromHex } from '../io/hex.ts';
import { inflateChunkTable, magicOf, readDependencies, type Dependency, type Inflate } from '../io/resource.ts';
import { Writer, dependencyKey, writeDependencyTable, type Deflate, type DependencyOut } from '../io/writer.ts';
import { floatToHalf } from './animation.ts';
import { writeChunkTable } from './texture.ts';
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
  /**
   * The index buffer as stored, big-endian `u16`s the primitives' runs index
   * into (strip restarts `0xffff` included): what `triangles` is made from,
   * kept so `writeStaticMesh` can write it back.
   */
  readonly indices?: Uint16Array;
  /** `StaticMeshInfo`'s second array, which nothing here uses: kept for `writeStaticMesh`. */
  readonly unknownStructs?: readonly StaticUnknownStruct[];
}

/** cwlib's `UnknownStruct` of `StaticMeshInfo` (toolkit `fee22399`), field names its own. */
export interface StaticUnknownStruct {
  readonly min: readonly [number, number, number];
  readonly structIndexA: number;
  readonly structIndexB: number;
  readonly max: readonly [number, number, number];
  readonly firstPrimitive: number;
  readonly numPrimitives: number;
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
  const unknownStructs = s.array((u): StaticUnknownStruct => ({
    min: u.vector3(),
    structIndexA: u.i16(),
    structIndexB: u.i16(),
    max: u.vector3(),
    firstPrimitive: u.i16(),
    numPrimitives: u.i16(),
  }));
  const marker = s.u32(true);
  if (marker !== 0x48454c50) throw new StaticMeshFormatError(`the header ends in 0x${marker.toString(16)}, not "HELP"`);
  return { lightmap, risemap, fallmap, indexBufferSize, vertexStreamSize, raw, unknownStructs };
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
  const { lightmap, risemap, fallmap, indexBufferSize, vertexStreamSize, raw, unknownStructs } = readStaticMeshInfo(s);

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
  const mesh: StaticMesh = {
    revision, lightmap, risemap, fallmap, vertexCount, positions, normals, tangents, uvs: [uv0, uv1], primitives,
    indices, unknownStructs,
  };
  // The stream and the table as stored, out of sight: what `writeStaticMesh`
  // writes back wherever the values still decode from them (`STORED`).
  const stored: StoredMesh = { vertexStream: data.slice(0, vertexStreamSize), dependencies: readDependencies(bytes) };
  Object.defineProperty(mesh, STORED, { value: stored });
  return mesh;
}

/** For the census: one run's raw indices, to test what `vertexStart` is. */
export { triangles as staticTriangles };

export { SerializerError };

/** A non-enumerable property of a read `StaticMesh`: the stored vertex stream and dependency table. */
const STORED = 'stored';

/** Resource types of a static mesh's dependencies: its maps' (`TEXTURE`) and its materials' (`GFX_MATERIAL`). */
const TYPE_TEXTURE = 1;
const TYPE_MATERIAL = 7;

/** `unpackNormal32`'s inverse, to the nearest step: each component's sign bit and magnitude. */
function packNormal32(x: number, y: number, z: number): number {
  const part = (v: number, steps: number, signBit: number): number => {
    const clamped = Math.max(-1, Math.min(1, v || 0));
    if (clamped < 0) return (steps - Math.round(-clamped * steps)) | signBit;
    return Math.round(clamped * steps);
  };
  return (part(x, 1023, 0x400) | (part(y, 1023, 0x400) << 11) | (part(z, 511, 0x200) << 22)) >>> 0;
}

const same = (a: number, b: number): boolean => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * `readStaticMesh`'s inverse: the whole `SMHb` file from the value -- the
 * `StaticMeshInfo` header, the chunk table and its chunks, the dependency
 * table.
 *
 * Normals, tangents and UVs are stored packed (10/10/9-bit normals, half
 * floats) and do not decode back bit for bit, so a mesh that came out of
 * `readStaticMesh` keeps its stored stream: each packed field is written as
 * stored while it still decodes to the value, and packed from the value
 * where it was changed -- as is the word at 20, cwlib's "tangent", which no
 * value carries. The index buffer is `indices`, the dependency table the one
 * the file had, or else one made from the maps and the materials.
 */
export async function writeStaticMesh(value: StaticMesh, deflate: Deflate): Promise<Uint8Array> {
  const { revision } = value;
  const stored = (value as unknown as Record<string, StoredMesh | undefined>)[STORED];
  if (!value.indices) throw new StaticMeshFormatError('a static mesh without its index buffer cannot be written');
  const indices = value.indices;
  const n = value.vertexCount;

  // The vertex stream.
  const keep = stored !== undefined && stored.vertexStream.length === n * 0x20;
  const stream = keep ? stored.vertexStream.slice() : new Uint8Array(n * 0x20);
  const d = new DataView(stream.buffer);
  const scratch = new Float32Array(3);
  const packed = (at: number, values: Float32Array, v: number): void => {
    const [x, y, z] = [values[v * 3], values[v * 3 + 1], values[v * 3 + 2]];
    if (keep) {
      unpackNormal32(d.getUint32(at, false), scratch, 0);
      if (same(scratch[0], x) && same(scratch[1], y) && same(scratch[2], z)) return;
    }
    d.setUint32(at, packNormal32(x, y, z), false);
  };
  const halfAt = (at: number, v: number): void => {
    if (keep && same(halfToFloat(d.getUint16(at, false)), Math.fround(v))) return;
    d.setUint16(at, floatToHalf(v), false);
  };
  for (let v = 0; v < n; v += 1) {
    const o = v * 0x20;
    d.setFloat32(o, value.positions[v * 3], false);
    d.setFloat32(o + 4, value.positions[v * 3 + 1], false);
    d.setFloat32(o + 8, value.positions[v * 3 + 2], false);
    packed(o + 12, value.normals, v);
    halfAt(o + 16, value.uvs[0][v * 2]);
    halfAt(o + 18, value.uvs[0][v * 2 + 1]);
    halfAt(o + 24, value.uvs[1][v * 2]);
    halfAt(o + 26, value.uvs[1][v * 2 + 1]);
    packed(o + 28, value.tangents, v);
  }
  const payload = new Uint8Array(stream.length + indices.length * 2);
  payload.set(stream);
  const pv = new DataView(payload.buffer);
  for (let i = 0; i < indices.length; i += 1) pv.setUint16(stream.length + i * 2, indices[i], false);

  // `StaticMeshInfo`, plainly.
  const w = new Writer(revision, 0);
  w.ref(value.lightmap);
  w.ref(value.risemap);
  w.ref(value.fallmap);
  const unknown = value.unknownStructs ?? [];
  w.i32(value.primitives.length);
  w.i32(unknown.length);
  w.i32(indices.length * 2);
  w.i32(stream.length);
  w.i32(value.primitives.length);
  for (const p of value.primitives) {
    w.vector4(p.min);
    w.vector4(p.max);
    w.ref(p.material);
    w.i32(p.vertexStart);
    w.i32(p.indexStart);
    w.i32(p.numIndices);
    w.u8(p.type);
  }
  w.i32(unknown.length);
  for (const u of unknown) {
    w.vector3(u.min);
    w.i16(u.structIndexA);
    w.i16(u.structIndexB);
    w.vector3(u.max);
    w.i16(u.firstPrimitive);
    w.i16(u.numPrimitives);
  }
  w.u32(0x48454c50, true); // "HELP"
  const info = w.done();

  let dependencies: DependencyOut[];
  if (stored) {
    dependencies = stored.dependencies.map((row) => row.kind === 'guid'
      ? { guid: row.guid, type: row.type }
      : { hash: fromHex(row.sha1), type: row.type });
  } else {
    const seen = new Map<string, DependencyOut>();
    const add = (ref: ResourceRef | undefined, type: number): void => {
      if (!ref) return;
      const row: DependencyOut = ref.hash ? { hash: ref.hash, type } : { guid: ref.guid, type };
      const key = dependencyKey(row);
      if (!seen.has(key)) seen.set(key, row);
    };
    add(value.lightmap, TYPE_TEXTURE);
    add(value.risemap, TYPE_TEXTURE);
    add(value.fallmap, TYPE_TEXTURE);
    // ✔ Made so, the table is the game's on 46 of its 47 backdrops, the seven
    // at 0x335 listing the three maps alone. One at 0x3f4 lists GUID 432587 where
    // its 21st material names 3501656723. Hence the stored table first.
    if (revision.version > 0x335) for (const p of value.primitives) add(p.material, TYPE_MATERIAL);
    dependencies = [...seen.values()];
  }
  const table = writeDependencyTable(dependencies);
  const chunks = await writeChunkTable(payload, deflate);

  const out = new Uint8Array(0x0c + info.length + chunks.length + table.length);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) out[i] = 'SMHb'.charCodeAt(i);
  view.setUint32(4, ((revision.subVersion << 16) | revision.version) >>> 0, false);
  view.setUint32(8, 0x0c + info.length + chunks.length, false);
  out.set(info, 0x0c);
  out.set(chunks, 0x0c + info.length);
  out.set(table, 0x0c + info.length + chunks.length);
  return out;
}

interface StoredMesh {
  readonly vertexStream: Uint8Array;
  readonly dependencies: Dependency[];
}
