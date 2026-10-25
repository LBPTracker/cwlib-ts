/**
 * A mesh's materials for its glTF (`meshToGlb`): cwlib's
 * `MeshExporter.GLB.createMaterial` (ennuo/toolkit `d6a2ef8`), from the graph
 * as `materialSummary` follows it.
 *
 * - Port 0, diffuse: the first texture sample upstream as `baseColorTexture`,
 *   and the colour box's RGBA as `baseColorFactor` when the port is a colour
 *   or a texture times a colour -- as stored, 0 to 1 (8,067 of the game's 8,166
 *   colour boxes; Java divides by 255, which darkens them to nothing), clamped
 *   there as glTF wants: one material's diffuse colour reaches past 1.
 * - Port 3, bump: the first texture sample upstream as `normalTexture`,
 *   converted as Java converts it -- x is 1 − alpha, y is green -- with z rebuilt
 *   as the game's shader rebuilds it, `sqrt(|1 − x² − y²|)` (lbprender's
 *   steering/game-shaders.md), where Java writes 1.
 * - `doubleSided` from `GFX_TWO_SIDED`, where Java sets it on every material;
 *   `MASK` at `alphaTestLevel` when `GFX_ALPHA_CLIP` is set -- cwlib's names,
 *   not measured.
 *
 * - Port 0's texture samples whose path holds `dirt` (`path`, else `name`) as
 *   `occlusionTexture`, as Java has them, and the first other one as the base
 *   colour: 1,522 of the game's 11,011 materials have such a sample before
 *   port 0, where the first sample upstream would otherwise be taken.
 * - A colour box wired straight into port 2, specular, as
 *   `KHR_materials_specular`'s `specularColorFactor` (2,048 materials). Java
 *   writes it as `KHR_materials_pbrSpecularGlossiness`, archived by Khronos.
 *
 * Not ported: Java's `BLEND` for a material whose name holds `decal` -- 18 of
 * the game's 19 such materials have `alphaMode` 0 -- and a cube or volume
 * texture, which glTF has no image for.
 */

import type { Dependency, Inflate } from '../io/resource.ts';
import type { ResourceRef } from '../io/serializer.ts';
import type { Deflate } from '../io/writer.ts';
import { encodePng } from '../io/png.ts';
import { toHex } from '../io/hex.ts';
import { PORT_DIFFUSE, PORT_SPECULAR, materialSummary, portColour, portSamples, readMaterial, type SampleSummary } from './material.ts';
/** Anything with primitives that name materials: an `RMesh`, an `RStaticMesh`. */
export interface WithMaterials {
  readonly primitives: readonly { readonly material?: ResourceRef }[];
}
import { decodeLevel, readTexture } from './texture.ts';

/** One image as a material samples it. */
export interface GltfTexture {
  /** The PNG; the same object for every material that samples the same texture. */
  readonly png: Uint8Array;
  readonly name: string;
  /** The UV channel, `Mesh.uvs` index. */
  readonly texCoord: number;
  /** `[a, b, c, d, e, f]`: `u' = a·u + b·v + c`, `v' = d·u + e·v + f` (`SampleSummary`). */
  readonly uvTransform: readonly [number, number, number, number, number, number];
  /** The sample's scale and offset keyed over time, and which of the four move (`SampleSummary.uvKeys`). */
  readonly uvKeys?: readonly (readonly [number, number, number, number])[];
  readonly uvKeysAnimated?: number;
  /** cwlib's `TextureWrap`, 1 wrap … 5 clamp. */
  readonly wrapS: number;
  readonly wrapT: number;
}

export interface GltfMaterial {
  readonly name: string;
  readonly doubleSided: boolean;
  /** `MASK` at this cutoff; opaque when absent. */
  readonly alphaCutoff?: number;
  readonly baseColorFactor?: readonly [number, number, number, number];
  readonly baseColorTexture?: GltfTexture;
  readonly normalTexture?: GltfTexture;
  /** Port 0's `dirt` texture. */
  readonly occlusionTexture?: GltfTexture;
  /** A colour box on port 2, specular, RGB as stored. */
  readonly specularColor?: readonly [number, number, number];
}

export interface GltfMaterialSource {
  /** A resource's bytes: `openGame`'s `resolve`. */
  readonly resolve: (dependency: Dependency) => Promise<Uint8Array | undefined>;
  readonly inflate: Inflate;
  readonly deflate: Deflate;
  /** A material's or a texture's name; by default `g<GUID>` or its hash. */
  readonly name?: (ref: ResourceRef) => string | undefined;
  /** A texture's FileDB path, where Java looks for `dirt`; `name` when absent. */
  readonly path?: (ref: ResourceRef) => string | undefined;
}

export const refKey = (ref: ResourceRef): string => (ref.hash ? toHex(ref.hash) : `g${ref.guid}`);
const dependency = (ref: ResourceRef, type: number): Dependency =>
  (ref.hash ? { kind: 'sha1', sha1: toHex(ref.hash), type } : { kind: 'guid', guid: ref.guid, type });

const MATERIAL_TYPE = 7;
const TEXTURE_TYPE = 1;

/**
 * Every material a mesh's or a backdrop's primitives name, by `refKey`. A material or texture
 * that does not resolve or read is left out, and its primitives go plain.
 */
export async function gltfMaterials(mesh: WithMaterials, source: GltfMaterialSource): Promise<Map<string, GltfMaterial>> {
  const pngs = new Map<string, Promise<Uint8Array | undefined>>();
  const nameOf = (ref: ResourceRef): string => source.name?.(ref) ?? refKey(ref);

  const image = (ref: ResourceRef, bump: boolean): Promise<Uint8Array | undefined> => {
    const key = `${refKey(ref)}${bump ? '/normal' : ''}`;
    let png = pngs.get(key);
    if (png === undefined) {
      png = (async () => {
        const bytes = await source.resolve(dependency(ref, TEXTURE_TYPE));
        if (bytes === undefined) return undefined;
        const texture = await readTexture(bytes, source.inflate).catch(() => undefined);
        if (texture === undefined || texture.faces !== 1 || texture.depth !== 1) return undefined;
        const level = texture.levels[0][0];
        const rgba = decodeLevel(texture.format, level).slice(0, level.width * level.height * 4);
        if (bump) toNormalMap(rgba);
        return encodePng(level.width, level.height, rgba, source.deflate);
      })();
      pngs.set(key, png);
    }
    return png;
  };
  const sampled = async (sample: SampleSummary | undefined, bump: boolean): Promise<GltfTexture | undefined> => {
    if (sample?.texture === undefined) return undefined;
    const png = await image(sample.texture, bump);
    return png && {
      png, name: nameOf(sample.texture), texCoord: sample.uvChannel, uvTransform: sample.uvTransform,
      ...(sample.uvKeys ? { uvKeys: sample.uvKeys, uvKeysAnimated: sample.uvKeysAnimated } : {}),
      wrapS: sample.wrapS, wrapT: sample.wrapT,
    };
  };

  const out = new Map<string, GltfMaterial>();
  for (const primitive of mesh.primitives) {
    const ref = primitive.material;
    if (ref === undefined || out.has(refKey(ref))) continue;
    const bytes = await source.resolve(dependency(ref, MATERIAL_TYPE));
    const material = bytes && await readMaterial(bytes, source.inflate).catch(() => undefined);
    if (material === undefined) continue;
    const summary = materialSummary(material);
    const diffuse = summary.diffuse;
    const isDirt = (s: SampleSummary): boolean =>
      s.texture !== undefined && ((source.path ?? source.name)?.(s.texture) ?? '').includes('dirt');
    const samples = portSamples(material, PORT_DIFFUSE);
    const baseColorTexture = await sampled(samples.find((s) => !isDirt(s)), false);
    const occlusionTexture = await sampled(samples.find(isDirt), false);
    const specular = portColour(material, PORT_SPECULAR);
    const normalTexture = await sampled(summary.bump?.sample, true);
    const coloured = diffuse?.colour !== undefined && (diffuse.shape === 'colour' || diffuse.shape === 'texture*colour');
    out.set(refKey(ref), {
      name: nameOf(ref),
      doubleSided: summary.twoSided,
      ...(summary.alphaClipEnabled ? { alphaCutoff: summary.alphaTestLevel } : {}),
      ...(coloured ? { baseColorFactor: diffuse.colour!.map((v) => Math.min(1, Math.max(0, v))) as unknown as GltfMaterial['baseColorFactor'] } : {}),
      ...(baseColorTexture ? { baseColorTexture } : {}),
      ...(normalTexture ? { normalTexture } : {}),
      ...(occlusionTexture ? { occlusionTexture } : {}),
      ...(specular ? { specularColor: [specular[0], specular[1], specular[2]] as const } : {}),
    });
  }
  return out;
}

/** A normal map's texels, in place: x = 1 − alpha and y = green, as Java has them, z rebuilt. */
function toNormalMap(rgba: Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const x = (255 - rgba[i + 3]) / 127.5 - 1;
    const y = rgba[i + 1] / 127.5 - 1;
    const z = Math.sqrt(Math.abs(1 - x * x - y * y));
    rgba[i] = 255 - rgba[i + 3];
    rgba[i + 2] = Math.round((Math.min(z, 1) * 0.5 + 0.5) * 255);
    rgba[i + 3] = 255;
  }
}
