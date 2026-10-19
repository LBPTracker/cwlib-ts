/**
 * `RGfxMaterial` -- how a mesh primitive is shaded: magic `GMTb`, dependency
 * type 7, FileDB paths `gamedata_orbis/gmat/….gmat`.
 *
 * The field list is cwlib's `resources/RGfxMaterial.java` and `structs/gmat/`
 * (toolkit `fee22399`), a hypothesis until measured on **every `GMTb` in LBP3
 * PS4 1.28's four FARCs, 11,011 of them** (`dev/material-census.ts`) --
 * steering/level-files.md, *The game's materials*. ❗ The walk ends on the
 * payload's last byte in all of them, which is the proof; `readMaterial` throws
 * when it does not.
 *
 * What the reader returns is the graph as stored -- boxes, wires, parameters,
 * the eight texture slots -- and the compiled shaders as opaque blobs.
 * `materialSummary` on top is a renderer's starting point: which of it is
 * measured and which is a reading of the graph is said on each field.
 */

import { loadResource, type Inflate } from './resource.ts';
import { Serializer, SerializerError, type ResourceRef, type RevisionInfo } from './serializer.ts';

/** cwlib's `BoxType`; the ids the game's materials use are tallied in steering. */
export const BOX_OUTPUT = 0;
export const BOX_TEXTURE_SAMPLE = 1;
export const BOX_THING_COLOR = 2;
export const BOX_COLOR = 3;
export const BOX_CONSTANT = 4;
export const BOX_CONSTANT2 = 5;
export const BOX_CONSTANT3 = 6;
export const BOX_CONSTANT4 = 7;
export const BOX_MULTIPLY_ADD = 9;
export const BOX_MULTIPLY = 10;
export const BOX_ADD = 11;
export const BOX_MIX = 12;
export const BOX_MAKE_FLOAT2 = 13;
export const BOX_MAKE_FLOAT3 = 14;
export const BOX_MAKE_FLOAT4 = 15;
export const BOX_BLEND = 16;
export const BOX_EXPONENT = 19;

/** cwlib's `BrdfPort`: the output box's input ports. */
export const PORT_DIFFUSE = 0;
export const PORT_ALPHA_CLIP = 1;
export const PORT_SPECULAR = 2;
export const PORT_BUMP = 3;
export const PORT_GLOW = 4;
export const PORT_REFLECTION = 6;

/** cwlib's `GfxMaterialFlags`. */
export const GFX_TWO_SIDED = 0x1;
export const GFX_FURRY = 0x2;
export const GFX_WIRE = 0x4;
export const GFX_MAX_PRIORITY = 0x8;
export const GFX_SQUISHY = 0x10;
export const GFX_NO_INSTANCE_TEXTURE = 0x20;
export const GFX_RECEIVE_SHADOWS = 0x100;
export const GFX_RECEIVE_SUN = 0x200;
export const GFX_RECEIVE_SPRITELIGHTS = 0x400;
export const GFX_ALPHA_CLIP = 0x800;

export const MAX_TEXTURES = 8;

/** A keyed animation of one box parameter -- cwlib's `MaterialParameterAnimation`. */
export interface MaterialParameterAnimation {
  readonly baseValue: readonly [number, number, number, number];
  /** One `[x, y, z, w]` per key; components not animated keep `baseValue`'s. */
  readonly keys: [number, number, number, number][];
  /** Up to three characters. */
  readonly name: string;
  /** Bit i set: component i is animated. */
  readonly componentsAnimated: number;
}

export interface MaterialBox {
  readonly type: number;
  /**
   * The eight parameters as the raw 32-bit words they are stored as -- floats
   * for most boxes (`floatParams`), integers for a texture sample's channel and
   * slot. Integers when compressed, so the bits of a float survive.
   */
  readonly params: readonly number[];
  /** `params` read as IEEE floats. */
  readonly floatParams: readonly number[];
  /** Where the box sits in the editor that drew the graph. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** On a texture sample, 1 means `params` is a 2x3 matrix rather than scale and offset. */
  readonly subType: number;
  readonly anim: MaterialParameterAnimation;
  readonly anim2: MaterialParameterAnimation;
}

export interface MaterialWire {
  readonly boxFrom: number;
  readonly boxTo: number;
  readonly portFrom: number;
  readonly portTo: number;
  /**
   * Which components of the source the wire carries: up to four of `r g b a`
   * in five NUL-padded ASCII bytes, empty for all of them. Measured: of 53,278
   * wires in the game, 52,834 carry `""`, 404 `"a"`, 20 `"r"`, 11 `"b"`, 8
   * `"g"` and one `"rgb"` -- no other byte occurs.
   */
  readonly swizzle: string;
}

export interface GfxMaterial {
  readonly revision: RevisionInfo;
  /** `GFX_*`. */
  readonly flags: number;
  readonly alphaTestLevel: number;
  readonly alphaLayer: number;
  readonly alphaMode: number;
  /** 0 off, 1 on, 2 alpha -- cwlib's `ShadowCastMode`. */
  readonly shadowCastMode: number;
  readonly bumpLevel: number;
  readonly cosinePower: number;
  readonly reflectionBlur: number;
  readonly refractiveIndex: number;
  readonly refractiveFresnelFalloffPower: number;
  readonly refractiveFresnelMultiplier: number;
  readonly refractiveFresnelOffset: number;
  readonly refractiveFresnelShift: number;
  readonly fuzzLengthAndRefractiveFlag: number;
  readonly translucencyDensity: number;
  readonly fuzzSwirlAngle: number;
  readonly fuzzSwirlAmplitude: number;
  readonly fuzzLightingBias: number;
  readonly fuzzLightingScale: number;
  readonly iridesenceRoughness: number;
  /**
   * The compiled shaders, one per offset -- PS4 `Shdr` blobs, opaque here --
   * and whatever the code blob holds after the last of them.
   */
  readonly shaders: Uint8Array[];
  readonly code: Uint8Array;
  /** The eight texture slots a sample box names by `params[5]`. GUIDs in the game. */
  readonly textures: (ResourceRef | undefined)[];
  /** One per slot: cwlib's `TextureWrap`, 1 wrap, 2 mirror, 3 clamp to edge, 4 border, 5 clamp. */
  readonly wrapS: number[];
  readonly wrapT: number[];
  readonly boxes: MaterialBox[];
  readonly wires: MaterialWire[];
  readonly soundEnum: number;
  readonly parameterAnimations: MaterialParameterAnimation[];
}

const FLOAT = new DataView(new ArrayBuffer(4));
const asFloat = (word: number): number => {
  FLOAT.setUint32(0, word >>> 0, false);
  return FLOAT.getFloat32(0, false);
};

function readAnimation(s: Serializer): MaterialParameterAnimation {
  const baseValue = s.vector4();
  const components = s.array((x) => x.f32());
  // ⚠️ The name's length is a plain i32, not the zigzagged s32 `str` reads.
  const name = String.fromCharCode(...s.bytes(s.i32()));
  const componentsAnimated = s.u8();
  const animated = [0, 1, 2, 3].filter((c) => componentsAnimated & (1 << c));
  const keys: [number, number, number, number][] = [];
  if (components.length > 0) {
    if (animated.length === 0 || components.length % animated.length !== 0) {
      throw new SerializerError(`${components.length} animation values over components 0b${componentsAnimated.toString(2)}`);
    }
    const count = components.length / animated.length;
    for (let k = 0; k < count; k += 1) keys.push([...baseValue]);
    let at = 0;
    for (const c of animated) for (let k = 0; k < count; k += 1) keys[k][c] = components[at++];
  }
  return { baseValue, keys, name, componentsAnimated };
}

function readBox(s: Serializer): MaterialBox {
  const type = s.i32();
  // Head >= 0x2a4: a count, always 8, and then the parameters.
  const count = s.i32();
  if (count !== 8) throw new SerializerError(`a material box with ${count} parameters`);
  const params: number[] = [];
  for (let i = 0; i < count; i += 1) params.push(s.u32());
  const [x, y, w, h] = s.vector4();
  const subType = s.i32();
  const anim = readAnimation(s);
  const anim2 = readAnimation(s);
  return { type, params, floatParams: params.map(asFloat), x, y, w, h, subType, anim, anim2 };
}

function readWire(s: Serializer): MaterialWire {
  const boxFrom = s.s32();
  const boxTo = s.s32();
  const portFrom = s.u8();
  const portTo = s.u8();
  const raw = s.bytes(5);
  const end = raw.indexOf(0);
  const swizzle = String.fromCharCode(...raw.subarray(0, end < 0 ? 5 : end));
  return { boxFrom, boxTo, portFrom, portTo, swizzle };
}

/**
 * Read a `GMTb`. Throws on anything else, on a revision outside the range the
 * game's own materials span (`0x3ef`--`0x3f9`, the only one measured), and when
 * the walk does not end exactly on the payload's last byte.
 */
export async function readMaterial(bytes: Uint8Array, inflate: Inflate): Promise<GfxMaterial> {
  const resource = await loadResource(bytes, inflate);
  if (resource.magic !== 'GMTb') throw new SerializerError(`not a material: "${resource.magic}"`);
  const revision: RevisionInfo = {
    version: resource.revision.version,
    subVersion: resource.revision.branch,
    branchId: resource.branchId,
    branchRevision: resource.branchRevision,
  };
  const { version, subVersion } = revision;
  // cwlib gates the shader blob count and the box layout on versions below
  // this, and the Vita and toolkit branches differ again; none of those is in
  // the game's archives, so they are refused rather than guessed.
  if (version < 0x3ef || version > 0x3ff || subVersion < 0x16b || revision.branchId !== 0) {
    throw new SerializerError(
      `GMTb revision 0x${version.toString(16)} sub 0x${subVersion.toString(16)} branch 0x${
        revision.branchId.toString(16)}: only LBP3's own (0x3ef..0x3f9, sub >= 0x16b) is measured`,
    );
  }
  const s = new Serializer(resource.data, revision, resource.compressionFlags);

  const flags = s.i32();
  const alphaTestLevel = s.f32();
  const alphaLayer = s.u8();
  const alphaMode = s.u8();
  const shadowCastMode = s.u8();
  const bumpLevel = s.f32();
  const cosinePower = s.f32();
  const reflectionBlur = s.f32();
  const refractiveIndex = s.f32();
  const refractiveFresnelFalloffPower = s.f32();
  const refractiveFresnelMultiplier = s.f32();
  const refractiveFresnelOffset = s.f32();
  const refractiveFresnelShift = s.f32();
  const fuzzLengthAndRefractiveFlag = s.u8();
  // cwlib's FUZZ_LIGHTING, subVersion 0x17c: absent on the three 0x177
  // materials, which then end on their last byte; cwlib's defaults stand in.
  const lighting = subVersion >= 0x17c;
  const translucencyDensity = lighting ? s.u8() : 0xff;
  const fuzzSwirlAngle = lighting ? s.u8() : 0xff;
  const fuzzSwirlAmplitude = lighting ? s.u8() : 0;
  const fuzzLightingBias = lighting ? s.u8() : 0x7f;
  const fuzzLightingScale = lighting ? s.u8() : 0x7f;
  const iridesenceRoughness = lighting ? s.u8() : 0;

  // Ten shader offsets on a non-Vita build from 0x393 (cwlib's
  // `getBlobOffsetCount`); each is where its shader ends in the code blob.
  const offsets: number[] = [];
  for (let i = 0; i < 10; i += 1) offsets.push(s.i32());
  const blob = s.bytes(s.i32());
  const shaders: Uint8Array[] = [];
  let start = 0;
  for (const end of offsets) {
    if (end < start || end > blob.length) throw new SerializerError(`shader offset ${end} outside ${start}..${blob.length}`);
    shaders.push(blob.subarray(start, end));
    start = end;
  }
  const code = blob.subarray(start);

  const textures: (ResourceRef | undefined)[] = [];
  for (let i = 0; i < MAX_TEXTURES; i += 1) textures.push(s.resource());
  const wrapS = s.array((x) => x.u8());
  const wrapT = s.array((x) => x.u8());
  const boxes = s.array(readBox);
  const wires = s.array(readWire);
  const soundEnum = s.i32();
  const parameterAnimations = s.array(readAnimation);

  if (s.remaining !== 0) {
    throw new SerializerError(`GMTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, flags, alphaTestLevel, alphaLayer, alphaMode, shadowCastMode, bumpLevel, cosinePower,
    reflectionBlur, refractiveIndex, refractiveFresnelFalloffPower, refractiveFresnelMultiplier,
    refractiveFresnelOffset, refractiveFresnelShift, fuzzLengthAndRefractiveFlag, translucencyDensity,
    fuzzSwirlAngle, fuzzSwirlAmplitude, fuzzLightingBias, fuzzLightingScale, iridesenceRoughness,
    shaders, code, textures, wrapS, wrapT, boxes, wires, soundEnum, parameterAnimations,
  };
}

/* ------------------------------------------------------------- summary */

/** One texture sample box, its slot resolved. */
export interface SampleSummary {
  /** The box's index in `boxes`. */
  readonly box: number;
  /** `params[5]`: the index into `textures`. */
  readonly slot: number;
  readonly texture?: ResourceRef;
  /**
   * `params[4]`: which of the mesh's UV channels (`Mesh.uvs`) the sample reads.
   * ✔ Measured: below the channel count of every mesh primitive that names
   * the material -- `dev/material-census.ts`.
   */
  readonly uvChannel: number;
  /**
   * `[a, b, c, d, e, f]`: `u' = a·u + b·v + c`, `v' = d·u + e·v + f`. From
   * `params` 0--3 as scale and offset when `subType` is 0, from params 0, 1, 2,
   * 3, 6, 7 as a 2x3 matrix when it is 1 -- cwlib's reading, not measured.
   * ✔ `v' = 0` is the texture's first row as stored, with no flip
   * (`dev/uv-census.ts`, steering/level-files.md).
   */
  readonly uvTransform: readonly [number, number, number, number, number, number];
  /** `TextureWrap` of the slot, 1 wrap … 5 clamp. */
  readonly wrapS: number;
  readonly wrapT: number;
}

/** What feeds one input port of the output box. */
export interface PortSummary {
  /**
   * The graph's shape, as far as this helper follows it: `texture` a sample
   * wired straight in, `texture*colour` a multiply of a sample and a colour box,
   * `colour` a colour box alone, `thing` the Thing's own colour box (type 2)
   * alone or multiplied by a sample, `graph` anything else -- for which `sample`
   * and `colour` are only the first of each found upstream.
   */
  readonly shape: 'texture' | 'texture*colour' | 'colour' | 'thing' | 'graph';
  /** The first texture sample upstream, inputs taken in port order. */
  readonly sample?: SampleSummary;
  /** The first colour box (type 3) upstream: `params` 0--3 as floats, RGBA. */
  readonly colour?: readonly [number, number, number, number];
  /** A Thing-colour box (type 2) is upstream: the Thing's tint takes part. */
  readonly thingColour: boolean;
  /** The swizzle on the wire into the port: `"a"` when alpha is taken from a texture. */
  readonly swizzle: string;
}

export interface MaterialSummary {
  /** Port 0, cwlib's `DIFFUSE`. */
  readonly diffuse?: PortSummary;
  /** Port 1, cwlib's `ALPHA_CLIP`. */
  readonly alphaClip?: PortSummary;
  /** Port 3, cwlib's `BUMP`: the normal map. */
  readonly bump?: PortSummary;
  /** `GFX_TWO_SIDED`: draw both faces. */
  readonly twoSided: boolean;
  /** `GFX_ALPHA_CLIP`, with `alphaTestLevel` the threshold. */
  readonly alphaClipEnabled: boolean;
  readonly alphaTestLevel: number;
  /**
   * The raw blend mode, 0--5, and layer, 0 / 1 / 128 / 192. Not understood: the
   * steering tallies them against the materials' names (`_alpha`, `_glassy`,
   * `_refract`), which is a correlation, not a meaning.
   */
  readonly alphaMode: number;
  readonly alphaLayer: number;
}

function sampleOf(m: GfxMaterial, index: number): SampleSummary {
  const box = m.boxes[index];
  const p = box.floatParams;
  const slot = box.params[5];
  const uvTransform: SampleSummary['uvTransform'] = box.subType === 1
    ? [p[0], p[1], p[2], p[3], p[6], p[7]]
    : [p[0], 0, p[2], 0, p[1], p[3]];
  return {
    box: index, slot, texture: m.textures[slot], uvChannel: box.params[4], uvTransform,
    wrapS: m.wrapS[slot] ?? 1, wrapT: m.wrapT[slot] ?? 1,
  };
}

function port(m: GfxMaterial, output: number, which: number): PortSummary | undefined {
  const wire = m.wires.find((w) => w.boxTo === output && w.portTo === which);
  if (!wire) return undefined;
  const inputs = (box: number): number[] =>
    m.wires.filter((w) => w.boxTo === box).sort((a, b) => a.portTo - b.portTo).map((w) => w.boxFrom);
  // Depth-first upstream, inputs in port order, each box once.
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (box: number): void => {
    if (seen.has(box) || !m.boxes[box]) return;
    seen.add(box);
    order.push(box);
    for (const from of inputs(box)) visit(from);
  };
  visit(wire.boxFrom);
  const types = order.map((b) => m.boxes[b].type);
  const first = (type: number): number | undefined => order.find((b) => m.boxes[b].type === type);
  const sampleBox = first(BOX_TEXTURE_SAMPLE);
  const colourBox = first(BOX_COLOR);
  const head = types[0];
  const rest = types.slice(1).sort().join(',');
  let shape: PortSummary['shape'] = 'graph';
  if (head === BOX_TEXTURE_SAMPLE && order.length === 1) shape = 'texture';
  else if (head === BOX_COLOR && order.length === 1) shape = 'colour';
  else if (head === BOX_THING_COLOR && order.length === 1) shape = 'thing';
  else if (head === BOX_MULTIPLY && order.length === 3) {
    if (rest === `${BOX_TEXTURE_SAMPLE},${BOX_COLOR}`) shape = 'texture*colour';
    else if (rest === `${BOX_TEXTURE_SAMPLE},${BOX_THING_COLOR}`) shape = 'thing';
  }
  return {
    shape,
    sample: sampleBox === undefined ? undefined : sampleOf(m, sampleBox),
    colour: colourBox === undefined ? undefined : (m.boxes[colourBox].floatParams.slice(0, 4) as unknown as [number, number, number, number]),
    thingColour: types.includes(BOX_THING_COLOR),
    swizzle: wire.swizzle,
  };
}

/**
 * A renderer's starting point: the diffuse texture and how it is sampled, the
 * constant colour, the alpha and the culling. ❗ It follows the graph only as
 * far as the common shapes, which the steering counts; a port whose `shape` is
 * `graph` needs the boxes themselves.
 */
export function materialSummary(m: GfxMaterial): MaterialSummary {
  const output = m.boxes.findIndex((b) => b.type === BOX_OUTPUT);
  return {
    diffuse: output < 0 ? undefined : port(m, output, PORT_DIFFUSE),
    alphaClip: output < 0 ? undefined : port(m, output, PORT_ALPHA_CLIP),
    bump: output < 0 ? undefined : port(m, output, PORT_BUMP),
    twoSided: (m.flags & GFX_TWO_SIDED) !== 0,
    alphaClipEnabled: (m.flags & GFX_ALPHA_CLIP) !== 0,
    alphaTestLevel: m.alphaTestLevel,
    alphaMode: m.alphaMode,
    alphaLayer: m.alphaLayer,
  };
}
