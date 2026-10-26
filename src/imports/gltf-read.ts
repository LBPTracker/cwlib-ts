/**
 * Just enough glTF 2.0 for the importers: a `.glb` (or a `.gltf` whose buffers
 * are `data:` URIs) opened into its JSON and accessors read out of its
 * buffers. Java cwlib reads the same through jgltf (`GltfModelReader`); this is
 * no general glTF library -- no images, no extensions, no external files.
 *
 * Accessors are read whole, honouring `byteStride` and `sparse`; `values`
 * hands back the stored numbers, `floats` the glTF meaning of them (a
 * normalized integer over its maximum, as the specification has it).
 */

export class GltfReadError extends Error {}

export interface GltfAccessor {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly normalized?: boolean;
  readonly count: number;
  readonly type: string;
  readonly min?: number[];
  readonly max?: number[];
  readonly sparse?: {
    readonly count: number;
    readonly indices: { readonly bufferView: number; readonly byteOffset?: number; readonly componentType: number };
    readonly values: { readonly bufferView: number; readonly byteOffset?: number };
  };
}

export interface GltfPrimitive {
  readonly attributes: Record<string, number>;
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
  readonly targets?: Record<string, number>[];
}

export interface GltfMesh {
  readonly name?: string;
  readonly primitives: GltfPrimitive[];
  readonly weights?: number[];
  readonly extras?: { readonly targetNames?: string[] } & Record<string, unknown>;
}

export interface GltfNode {
  readonly name?: string;
  readonly mesh?: number;
  readonly skin?: number;
  readonly children?: number[];
  readonly translation?: number[];
  readonly rotation?: number[];
  readonly scale?: number[];
  readonly matrix?: number[];
}

export interface GltfSkin {
  readonly joints: number[];
  readonly inverseBindMatrices?: number;
  readonly skeleton?: number;
  readonly name?: string;
}

export interface GltfAnimation {
  readonly name?: string;
  readonly channels: { readonly sampler: number; readonly target: { readonly node?: number; readonly path: string } }[];
  readonly samplers: { readonly input: number; readonly output: number; readonly interpolation?: string }[];
  readonly extras?: Record<string, unknown>;
}

export interface GltfJson {
  readonly asset: { readonly version: string };
  readonly nodes?: GltfNode[];
  readonly meshes?: GltfMesh[];
  readonly skins?: GltfSkin[];
  readonly animations?: GltfAnimation[];
  readonly materials?: { readonly name?: string }[];
  readonly accessors?: GltfAccessor[];
  readonly bufferViews?: { readonly buffer: number; readonly byteOffset?: number; readonly byteLength: number; readonly byteStride?: number }[];
  readonly buffers?: { readonly byteLength: number; readonly uri?: string }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export const COMPONENT_BYTE = 5120;
export const COMPONENT_UNSIGNED_BYTE = 5121;
export const COMPONENT_SHORT = 5122;
export const COMPONENT_UNSIGNED_SHORT = 5123;
export const COMPONENT_UNSIGNED_INT = 5125;
export const COMPONENT_FLOAT = 5126;

function readComponent(view: DataView, at: number, type: number): number {
  switch (type) {
    case 5120: return view.getInt8(at);
    case 5121: return view.getUint8(at);
    case 5122: return view.getInt16(at, true);
    case 5123: return view.getUint16(at, true);
    case 5125: return view.getUint32(at, true);
    case 5126: return view.getFloat32(at, true);
    default: throw new GltfReadError(`accessor component type ${type}`);
  }
}

/** A normalized integer as the float glTF means by it. */
function normalize(value: number, type: number): number {
  switch (type) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

function base64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export class Gltf {
  readonly json: GltfJson;
  private readonly buffers: Uint8Array[];

  private constructor(json: GltfJson, buffers: Uint8Array[]) {
    this.json = json;
    this.buffers = buffers;
  }

  /** A `.glb`, or the bytes of a `.gltf` JSON with embedded buffers. */
  static read(bytes: Uint8Array): Gltf {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length >= 12 && view.getUint32(0, true) === 0x46546c67) {
      if (view.getUint32(4, true) !== 2) throw new GltfReadError(`glb version ${view.getUint32(4, true)}`);
      const total = Math.min(view.getUint32(8, true), bytes.length);
      let at = 12;
      let json: GltfJson | undefined;
      let bin: Uint8Array | undefined;
      while (at + 8 <= total) {
        const length = view.getUint32(at, true);
        const type = view.getUint32(at + 4, true);
        const data = bytes.subarray(at + 8, at + 8 + length);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
        else if (type === 0x004e4942 && bin === undefined) bin = data;
        at += 8 + length;
      }
      if (!json) throw new GltfReadError('a glb with no JSON chunk');
      return new Gltf(json, Gltf.buffersOf(json, bin));
    }
    const json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    return new Gltf(json, Gltf.buffersOf(json, undefined));
  }

  private static buffersOf(json: GltfJson, bin: Uint8Array | undefined): Uint8Array[] {
    return (json.buffers ?? []).map((buffer, i) => {
      if (buffer.uri === undefined) {
        if (i === 0 && bin) return bin;
        throw new GltfReadError(`buffer ${i} has no data`);
      }
      const match = /^data:[^,]*;base64,(.*)$/s.exec(buffer.uri);
      if (!match) throw new GltfReadError(`buffer ${i} is an external file (${buffer.uri}), which this reader does not open`);
      return base64(match[1]);
    });
  }

  get nodes(): GltfNode[] {
    return this.json.nodes ?? [];
  }

  get meshes(): GltfMesh[] {
    return this.json.meshes ?? [];
  }

  get skins(): GltfSkin[] {
    return this.json.skins ?? [];
  }

  get animations(): GltfAnimation[] {
    return this.json.animations ?? [];
  }

  accessor(index: number): GltfAccessor {
    const a = this.json.accessors?.[index];
    if (!a) throw new GltfReadError(`no accessor ${index}`);
    return a;
  }

  /** How many components an element of the accessor has. */
  components(index: number): number {
    const per = COMPONENTS[this.accessor(index).type];
    if (per === undefined) throw new GltfReadError(`accessor type ${this.accessor(index).type}`);
    return per;
  }

  private viewOf(index: number, byteOffset = 0): { view: DataView; stride: number | undefined } {
    const bv = this.json.bufferViews?.[index];
    if (!bv) throw new GltfReadError(`no buffer view ${index}`);
    const buffer = this.buffers[bv.buffer];
    if (!buffer) throw new GltfReadError(`no buffer ${bv.buffer}`);
    const start = (bv.byteOffset ?? 0) + byteOffset;
    if ((bv.byteOffset ?? 0) + bv.byteLength > buffer.length) throw new GltfReadError(`buffer view ${index} runs past its buffer`);
    return { view: new DataView(buffer.buffer, buffer.byteOffset + start, bv.byteLength - byteOffset), stride: bv.byteStride };
  }

  /** The accessor's numbers as stored, `count * components` of them. */
  values(index: number): Float64Array {
    const a = this.accessor(index);
    const per = this.components(index);
    const size = SIZE[a.componentType];
    if (size === undefined) throw new GltfReadError(`accessor component type ${a.componentType}`);
    const out = new Float64Array(a.count * per);
    if (a.bufferView !== undefined) {
      const { view, stride } = this.viewOf(a.bufferView, a.byteOffset ?? 0);
      // Matrices' columns are 4-aligned; only MAT2/MAT3 of small components pad, which nothing here reads.
      const step = stride ?? size * per;
      for (let e = 0; e < a.count; e += 1) {
        for (let c = 0; c < per; c += 1) out[e * per + c] = readComponent(view, e * step + c * size, a.componentType);
      }
    }
    if (a.sparse) {
      const { view: iv } = this.viewOf(a.sparse.indices.bufferView, a.sparse.indices.byteOffset ?? 0);
      const { view: vv } = this.viewOf(a.sparse.values.bufferView, a.sparse.values.byteOffset ?? 0);
      const isize = SIZE[a.sparse.indices.componentType];
      for (let k = 0; k < a.sparse.count; k += 1) {
        const e = readComponent(iv, k * isize, a.sparse.indices.componentType);
        for (let c = 0; c < per; c += 1) out[e * per + c] = readComponent(vv, (k * per + c) * size, a.componentType);
      }
    }
    return out;
  }

  /** The accessor as floats: a normalized integer accessor over its maximum, any other as stored. */
  floats(index: number): Float32Array {
    const a = this.accessor(index);
    const raw = this.values(index);
    if (!a.normalized) return Float32Array.from(raw);
    return Float32Array.from(raw, (v) => normalize(v, a.componentType));
  }

  /** The accessor's floats as the specification reads them whatever the flag says: integers of COLOR_n and WEIGHTS_n are normalized. */
  unitFloats(index: number): Float32Array {
    const a = this.accessor(index);
    const raw = this.values(index);
    if (a.componentType === COMPONENT_FLOAT) return Float32Array.from(raw);
    return Float32Array.from(raw, (v) => normalize(v, a.componentType));
  }
}
