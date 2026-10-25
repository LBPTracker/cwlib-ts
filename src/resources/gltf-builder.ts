/**
 * What every glTF export here shares (`mesh-gltf.ts`, `staticmesh-gltf.ts`):
 * one binary buffer of 4-aligned views, accessors over them, materials as
 * `gltfMaterials` made them with their images embedded once, and the `.glb`
 * container -- a JSON chunk padded with spaces, a BIN chunk padded with zeros.
 */

import type { ResourceRef } from '../io/serializer.ts';
import { refKey, type GltfMaterial, type GltfTexture } from './gltf-material.ts';

export const FLOAT = 5126;
export const UNSIGNED_BYTE = 5121;
export const UNSIGNED_SHORT = 5123;
export const UNSIGNED_INT = 5125;
export const ARRAY_BUFFER = 34962;
export const ELEMENT_ARRAY_BUFFER = 34963;
const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

export interface GltfOptions {
  /** Each material by `refKey`, as `gltfMaterials` makes them. */
  readonly materials?: ReadonlyMap<string, GltfMaterial>;
  /** A material's name where `materials` has none; by default `g<GUID>` or its hash in hex. */
  readonly materialName?: (material: ResourceRef) => string | undefined;
  /**
   * Keys a second a material's texture animation plays at, which the file does
   * not say: 30 by default, cwlib's `FromMaterialAnimation`.
   */
  readonly materialKeysPerSecond?: number;
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
export const finite = (values: Float32Array): Float32Array =>
  (values.some(Number.isNaN) ? values.map((v) => (Number.isNaN(v) ? 0 : v)) : values);

export const bytesOf = (array: Float32Array | Uint8Array | Uint16Array | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export class GltfBuilder {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private readonly bufferViews: Record<string, unknown>[] = [];
  private readonly accessors: Record<string, unknown>[] = [];
  private readonly images: Record<string, unknown>[] = [];
  private readonly imageIndex = new Map<Uint8Array, number>();
  private readonly samplers: { wrapS: number; wrapT: number }[] = [];
  private readonly textures: Record<string, unknown>[] = [];
  private readonly textureIndex = new Map<string, number>();
  private readonly materials: Record<string, unknown>[] = [];
  private readonly materialIndex = new Map<string, number>();
  private readonly extensions = new Set<string>();
  /** The materials' texture animations, through `KHR_animation_pointer`. */
  private readonly animations: Record<string, unknown>[] = [];

  private readonly options: GltfOptions;

  constructor(options: GltfOptions = {}) {
    this.options = options;
  }

  /** A view onto bytes appended to the buffer, 4-aligned; its index. */
  view(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad > 0) {
      this.parts.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...(target ? { target } : {}) });
    this.parts.push(bytes);
    this.length += bytes.length;
    return this.bufferViews.length - 1;
  }

  accessor(bufferView: number, componentType: number, type: string, count: number, extra: Record<string, unknown> = {}): number {
    this.accessors.push({ bufferView, componentType, count, type, ...extra });
    return this.accessors.length - 1;
  }

  /** Floats as an accessor of `type`, NaN written 0; with `min`/`max` when asked. */
  floats(values: Float32Array, type: string, target: number | undefined, withBounds = false): number {
    const clean = finite(values);
    const per = COMPONENTS[type];
    const count = clean.length / per;
    let extra = {};
    if (withBounds) {
      const min = new Array<number>(per).fill(Infinity);
      const max = new Array<number>(per).fill(-Infinity);
      for (let i = 0; i < clean.length; i += 1) {
        if (clean[i] < min[i % per]) min[i % per] = clean[i];
        if (clean[i] > max[i % per]) max[i % per] = clean[i];
      }
      extra = { min, max };
    }
    return this.accessor(this.view(bytesOf(clean), target), FLOAT, type, count, extra);
  }

  /** A triangle list's indices, as 16 bits where they fit. */
  indices(triangles: Uint16Array | Uint32Array): number {
    const narrow = triangles instanceof Uint16Array || triangles.every((i) => i <= 0xffff) ? Uint16Array.from(triangles) : triangles;
    return this.accessor(this.view(bytesOf(narrow), ELEMENT_ARRAY_BUFFER), narrow instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT, 'SCALAR', narrow.length);
  }

  /**
   * A texture's scale and offset keyed over time, as an animation of its
   * `KHR_texture_transform` through `KHR_animation_pointer` -- what cwlib's
   * `FromMaterialAnimation` does for a material's first animation, here for
   * each animated sample a material exports, offset and scale each only where
   * they move. `path` is the texture info's JSON pointer.
   */
  private animateTexture(texture: GltfTexture, path: string, name: string): void {
    const keys = texture.uvKeys;
    if (!keys || keys.length < 2) return;
    const moves = texture.uvKeysAnimated ?? 0xf;
    const perSecond = this.options.materialKeysPerSecond ?? 30;
    const time = this.floats(Float32Array.from(keys, (_, k) => k / perSecond), 'SCALAR', undefined, true);
    const channels: Record<string, unknown>[] = [];
    const samplers: Record<string, unknown>[] = [];
    for (const [property, at] of [['scale', 0], ['offset', 2]] as const) {
      if ((moves & (3 << at)) === 0) continue;
      const values = new Float32Array(keys.length * 2);
      keys.forEach((key, k) => {
        values[k * 2] = key[at]!;
        values[k * 2 + 1] = key[at + 1]!;
      });
      samplers.push({ input: time, output: this.floats(values, 'VEC2', undefined), interpolation: 'LINEAR' });
      channels.push({
        sampler: samplers.length - 1,
        target: { path: 'pointer', extensions: { KHR_animation_pointer: { pointer: `${path}/extensions/KHR_texture_transform/${property}` } } },
      });
    }
    if (channels.length === 0) return;
    this.extensions.add('KHR_animation_pointer');
    this.animations.push({ name, channels, samplers });
  }

  private textureInfo(texture: GltfTexture): Record<string, unknown> {
    let image = this.imageIndex.get(texture.png);
    if (image === undefined) {
      this.images.push({ name: texture.name, mimeType: 'image/png', bufferView: this.view(texture.png) });
      image = this.images.length - 1;
      this.imageIndex.set(texture.png, image);
    }
    const wrapS = wrapOf(texture.wrapS);
    const wrapT = wrapOf(texture.wrapT);
    let sampler = this.samplers.findIndex((s) => s.wrapS === wrapS && s.wrapT === wrapT);
    if (sampler < 0) sampler = this.samplers.push({ wrapS, wrapT }) - 1;
    const key = `${image}/${sampler}`;
    let index = this.textureIndex.get(key);
    if (index === undefined) {
      index = this.textures.push({ source: image, sampler }) - 1;
      this.textureIndex.set(key, index);
    }
    // An animated transform is written even where it starts at the identity, for the pointer to land on.
    const transform = textureTransform(texture.uvTransform) ?? (texture.uvKeys ? { offset: [0, 0], scale: [1, 1] } : undefined);
    if (transform) this.extensions.add('KHR_texture_transform');
    return {
      index,
      ...(texture.texCoord !== 0 ? { texCoord: texture.texCoord } : {}),
      ...(transform ? { extensions: { KHR_texture_transform: transform } } : {}),
    };
  }

  /** A specular colour, the extension it needs noted. */
  private specular(colour: readonly [number, number, number]): number[] {
    this.extensions.add('KHR_materials_specular');
    return colour.map((c) => Math.max(0, c));
  }

  /** A material's index: as `options.materials` made it, else a name and a white base colour. */
  material(ref: ResourceRef): number {
    const key = refKey(ref);
    let index = this.materialIndex.get(key);
    if (index === undefined) {
      index = this.materials.length;
      const made = this.options.materials?.get(key);
      this.materials.push(made === undefined
        ? { name: this.options.materialName?.(ref) ?? key, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0 } }
        : {
          name: made.name,
          pbrMetallicRoughness: {
            baseColorFactor: made.baseColorFactor ?? [1, 1, 1, 1],
            metallicFactor: 0,
            ...(made.baseColorTexture ? { baseColorTexture: this.textureInfo(made.baseColorTexture) } : {}),
          },
          ...(made.normalTexture ? { normalTexture: this.textureInfo(made.normalTexture) } : {}),
          ...(made.occlusionTexture ? { occlusionTexture: this.textureInfo(made.occlusionTexture) } : {}),
          ...(made.specularColor ? { extensions: { KHR_materials_specular: { specularColorFactor: this.specular(made.specularColor) } } } : {}),
          ...(made.doubleSided ? { doubleSided: true } : {}),
          ...(made.alphaCutoff !== undefined ? { alphaMode: 'MASK', alphaCutoff: made.alphaCutoff } : {}),
        });
      if (made) {
        const at = `/materials/${index}`;
        if (made.baseColorTexture) this.animateTexture(made.baseColorTexture, `${at}/pbrMetallicRoughness/baseColorTexture`, made.name);
        if (made.normalTexture) this.animateTexture(made.normalTexture, `${at}/normalTexture`, made.name);
        if (made.occlusionTexture) this.animateTexture(made.occlusionTexture, `${at}/occlusionTexture`, made.name);
      }
      this.materialIndex.set(key, index);
    }
    return index;
  }

  /** The `.glb`: the scene's own objects, and everything the builder made. */
  glb(generator: string, scene: Record<string, unknown>): Uint8Array {
    const animations = [...((scene.animations as unknown[] | undefined) ?? []), ...this.animations];
    const json = {
      asset: { version: '2.0', generator },
      ...(this.extensions.size > 0 ? { extensionsUsed: [...this.extensions] } : {}),
      ...scene,
      ...(animations.length > 0 ? { animations } : {}),
      ...(this.materials.length > 0 ? { materials: this.materials } : {}),
      ...(this.textures.length > 0 ? { textures: this.textures, images: this.images, samplers: this.samplers } : {}),
      ...(this.accessors.length > 0 ? { accessors: this.accessors } : {}),
      ...(this.bufferViews.length > 0 ? { bufferViews: this.bufferViews, buffers: [{ byteLength: this.length }] } : {}),
    };
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = Math.ceil(text.length / 4) * 4;
    const binLength = Math.ceil(this.length / 4) * 4;
    const out = new Uint8Array(12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0));
    const dv = new DataView(out.buffer);
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.length, true);
    dv.setUint32(12, jsonLength, true);
    dv.setUint32(16, JSON_CHUNK, true);
    out.set(text, 20);
    out.fill(0x20, 20 + text.length, 20 + jsonLength);
    if (binLength === 0) return out;
    let at = 20 + jsonLength;
    dv.setUint32(at, binLength, true);
    dv.setUint32(at + 4, BIN_CHUNK, true);
    at += 8;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}
