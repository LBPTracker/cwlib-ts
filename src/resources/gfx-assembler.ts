/**
 * A material's shader **source**, generated from its box graph exactly as Java
 * cwlib's `cwlib.util.gfx.GfxAssembler` writes it (toolkit `d6a2ef8`, MIT,
 * github.com/ennuo/toolkit): `generateShaderSource` and
 * `generateBakedShaderSource`, the box-by-box `resolve` and the per-port
 * `setupPath` under them, and the templates they fill
 * (`gfx-assembler-templates.ts`).
 *
 * What it is not: a compiler. Java hands this text to Sony's SDK compilers
 * (`sce-cgc`, `orbis-wave-psslc`, `psp2cgc`), which are proprietary, absent
 * here and not ours to ship; where that step starts and what it needs is
 * `gfx-assembler-cg.ts`, which also ports what `CgAssembler` does to the text
 * before it (one copy per compile-flag variant) and to the bytes after it.
 *
 * ✔ Byte for byte against the Java over the game's 11,011 `GMTb`s and a
 * synthetic set covering every box type, in seven modes --
 * `dev/gfx-assembler-census.ts`.
 *
 * Faithfulness notes -- each is Java's behaviour, kept on purpose:
 * - Java's numbers: `%f` is six places half-up, `%s` of a float is
 *   `Float.toString` (`gfx-assembler-java.ts`).
 * - A texture sample's 2x3 matrix form (`subType` 1) is formatted with the
 *   JVM's *default* locale, not `Locale.ROOT`: under an Italian locale its
 *   numbers come out `1,000000`. `defaultLocaleDecimalSeparator` picks which.
 * - The templates are re-joined with `System.lineSeparator()`; generated
 *   lines always end in `\n`. `lineSeparator` picks which.
 * - A glassy material (`alphaLayer` 0xc0, or `forceGenerateAsGlassy`) whose
 *   `alphaMode` is 0 is *changed* to 1 by the Java before `ENV.ALPHA_MODE` is
 *   filled; the material here is never written to, the mode used is returned.
 * - An ADD box missing its second input prints debugging lines in Java and
 *   resolves ports 0 to 15 again -- which numbers later variables -- and that
 *   re-resolution is kept.
 * - Java's failures are errors here: `GfxAssemblerError.javaClass` names the
 *   Java exception (`java.lang.RuntimeException` with Java's own message, or
 *   the `NullPointerException` / `IndexOutOfBoundsException` its code would
 *   hit). A graph with a cycle recurses until the stack runs out, as there.
 */

import type { GfxMaterial, MaterialBox, MaterialWire } from './material.ts';
import { javaByte, javaFloatBits, javaFloatToString, javaFormatF, javaJoinLines } from './gfx-assembler-java.ts';
import { ALPHA_BAKE_GLSL, BAKE_GLSL, BRDF_CG, BRDF_GLSL, BRDF_VITA_CG } from './gfx-assembler-templates.ts';

/** cwlib's `BoxType`, all of it: `material.ts` exports the game's subset. */
export const BoxType = {
  OUTPUT: 0, TEXTURE_SAMPLE: 1, THING_COLOR: 2, COLOR: 3, CONSTANT: 4, CONSTANT2: 5, CONSTANT3: 6,
  CONSTANT4: 7, MULTIPLY_ADD: 9, MULTIPLY: 10, ADD: 11, MIX: 12, MAKE_FLOAT2: 13, MAKE_FLOAT3: 14,
  MAKE_FLOAT4: 15, BLEND: 16, FRESNEL: 18, EXPONENT: 19,
  BL_GENERIC: 128, BL_MAPPING: 129, BL_UV_MAP: 130, BL_TEXTURE_SAMPLE: 131, BL_MIX: 132,
  BL_EXTENDED_INFO: 133, BL_DATA_BLOB: 134, BL_BLENDER_INFO: 135, BL_INVERT_COLOR: 136,
  BL_TEXTURE_COORDINATE: 137, BL_SEPARATE_XYZ: 138, BL_NORMAL_MAP: 139, BL_VECTORMATH: 140,
  BL_MATH: 141, BL_VALUE: 142,
} as const;

/** cwlib's `BrdfPort`: the output box's input ports. */
export const BrdfPort = {
  DIFFUSE: 0, OPACITY: 1, SPECULAR: 2, BUMP: 3, SELF_ILLUMINATION: 4, RIM_LIGHT: 5, REFLECT: 6,
  UNKNOWN: 7, ANISO: 170, TRANS: 171, COLOR_CORRECTION: 172, FUZZ: 173, BRDF_REFLECTANCE: 174,
  TOON_RAMP: 175,
} as const;

/** Java's `GfxAssembler` `flags` argument that selects the GLSL template. */
export const GLSL_FLAGS = 0xdeadbeef | 0;

const GFX_ALPHA_CLIP = 0x800;

/** The fields of a material the assembler reads; a `GfxMaterial` is one. */
export type AssemblerMaterial = Pick<GfxMaterial,
  | 'flags' | 'alphaTestLevel' | 'alphaLayer' | 'alphaMode' | 'bumpLevel' | 'cosinePower'
  | 'reflectionBlur' | 'refractiveIndex' | 'refractiveFresnelFalloffPower'
  | 'refractiveFresnelMultiplier' | 'refractiveFresnelOffset' | 'refractiveFresnelShift'
  | 'fuzzLightingBias' | 'fuzzLightingScale' | 'iridesenceRoughness' | 'boxes' | 'wires'
  | 'parameterAnimations' | 'code'>;

export interface ShaderSourceOptions {
  /**
   * Java's `flags`: `-1` (the default, what every caller but the GLSL path
   * passes) leaves `ENV.COMPILE_FLAGS` for `CgAssembler` to fill per variant;
   * `GLSL_FLAGS` selects the GLSL template; anything else is written in.
   */
  readonly flags?: number;
  /**
   * Java's `useEnvironmentVariables`: true leaves the `ENV.*` material
   * constants (alpha test level, cosine power, bump level, ...) unfilled, as
   * the toolkit's material editor does. False (the default) fills them.
   */
  readonly useEnvironmentVariables?: boolean;
  /** `RGfxMaterial.useVitaShaderSource`: the Vita template, cosine power ×88 instead of ×22. */
  readonly useVitaShaderSource?: boolean;
  /** `RGfxMaterial.forceGenerateAsGlassy`, set by the Blender importer. */
  readonly forceGenerateAsGlassy?: boolean;
  /** `GfxAssembler.USE_NORMAL_MAPS`: the bump port through `NormalMap` rather than `BumpMap`. */
  readonly useNormalMaps?: boolean;
  /**
   * The template text in place of the built-in one, used as is -- Java's
   * `sourceShaderName`, read raw from `SHADER_SOURCE_DIRECTORY/<name>.cg`.
   */
  readonly template?: string;
  /** `System.lineSeparator()` of the JVM the text is matched against: `\n` (default) or `\r\n`. */
  readonly lineSeparator?: string;
  /** The JVM default locale's decimal separator, which `subType` 1 samples use: `.` (default) or `,`. */
  readonly defaultLocaleDecimalSeparator?: string;
}

export interface AssembledShaderSource {
  /** The text Java's `generateShaderSource` returns. */
  readonly source: string;
  /** The `ENV.MATERIAL_PROPERTIES` names, in order: `FRESNEL`, `ALPHA`, `SPECULAR`, ... */
  readonly properties: readonly string[];
  /**
   * The alpha mode the source was generated with: the material's, or 1 where
   * Java turns a glassy material's 0 into 1. `CgAssembler`'s Vita variants
   * read this one (`gfx-assembler-cg.ts`).
   */
  readonly alphaMode: number;
}

/** A Java exception, by class, that `GfxAssembler` would have thrown. */
export class GfxAssemblerError extends Error {
  readonly javaClass: string;
  constructor(javaClass: string, message: string) {
    super(message);
    this.name = 'GfxAssemblerError';
    this.javaClass = javaClass;
  }
}

const runtime = (message: string): GfxAssemblerError => new GfxAssemblerError('java.lang.RuntimeException', message);
const npe = (what: string): GfxAssemblerError => new GfxAssemblerError('java.lang.NullPointerException', what);

/** `GfxAssembler.Variable`: an expression and its width, 1 to 4. */
interface Variable {
  readonly value: string;
  readonly type: number;
}

/** Everything Java keeps in `GfxAssembler`'s statics, per call. */
interface Context {
  readonly m: AssemblerMaterial;
  readonly blob: Uint8Array | undefined;
  readonly glsl: boolean;
  readonly baker: boolean;
  readonly blender: boolean;
  readonly normalMaps: boolean;
  readonly vita: boolean;
  /** `Locale.getDefault()`'s decimal separator. */
  readonly comma: string;
  lookup: Map<MaterialBox, Variable>;
  attribute: number;
}

const FLOAT = new DataView(new ArrayBuffer(4));
const asFloat = (word: number): number => {
  FLOAT.setUint32(0, word >>> 0, false);
  return FLOAT.getFloat32(0, false);
};

/** `String.format(Locale.ROOT, "%f", f)`. */
const f6 = (f: number): string => javaFormatF(f);
/** `Float.toString(f)`, `"%s"` of a float. */
const fs = (f: number): string => javaFloatToString(f);

const nameOf = (anim: { readonly name: string }): string => anim.name.replace(/\0/g, '');

const outputBox = (m: AssemblerMaterial): number => m.boxes.findIndex((b) => b.type === BoxType.OUTPUT);
const isBlender = (m: AssemblerMaterial): boolean => m.boxes.some((b) => b.type === BoxType.BL_EXTENDED_INFO);

function boxAt(m: AssemblerMaterial, index: number): MaterialBox {
  const box = m.boxes[index];
  if (index < 0 || box === undefined) {
    throw new GfxAssemblerError('java.lang.IndexOutOfBoundsException', `Index ${index} out of bounds for length ${m.boxes.length}`);
  }
  return box;
}

/** `getWireConnectedToPort(int, int)`: the first wire into that port. */
function wireInto(m: AssemblerMaterial, box: number, port: number): MaterialWire | undefined {
  return m.wires.find((w) => w.boxTo === box && (w.portTo & 0xff) === port);
}

/** `getBoxConnectedToPort(int, int)`. */
function boxInto(m: AssemblerMaterial, box: number, port: number): MaterialBox | undefined {
  const wire = wireInto(m, box, port);
  return wire === undefined ? undefined : boxAt(m, wire.boxFrom);
}

/**
 * The extended data blob a Blender-made material carries, as Java's reader
 * cuts it: `params[4]` bytes off the end of the code blob, on a material with
 * an extended-info box (133). The game's own materials have none.
 */
function extendedBlob(m: AssemblerMaterial): Uint8Array | undefined {
  const info = m.boxes.find((b) => b.type === BoxType.BL_EXTENDED_INFO);
  if (!info) return undefined;
  const size = info.params[4] | 0;
  if (size === 0 || m.code.length === 0) return undefined;
  if (size < 0 || size > m.code.length) {
    throw new GfxAssemblerError('java.lang.ArrayIndexOutOfBoundsException', `extended blob of ${size} bytes in ${m.code.length}`);
  }
  return m.code.subarray(m.code.length - size);
}

function blobWord(ctx: Context, offset: number): number {
  if (!ctx.blob) throw npe("Can't read data type from null byte array!");
  if (offset < 0 || offset + 4 > ctx.blob.length) {
    throw new GfxAssemblerError('java.lang.ArrayIndexOutOfBoundsException', `Index ${offset} out of bounds for length ${ctx.blob.length}`);
  }
  const b = ctx.blob;
  return ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;
}
/** `RGfxMaterial.getFloat3` / `getFloat4`: big-endian floats in the blob. */
const blobFloats = (ctx: Context, offset: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => asFloat(blobWord(ctx, (offset | 0) + i * 4)));

/** `RGfxMaterial.getString`: NUL-terminated, UTF-8. */
function blobString(ctx: Context, offset: number): string {
  if (!ctx.blob) throw npe('Cannot load from byte array because "this.blob" is null');
  let end = offset;
  while (true) {
    if (end < 0 || end >= ctx.blob.length) {
      throw new GfxAssemblerError('java.lang.ArrayIndexOutOfBoundsException', `Index ${end} out of bounds for length ${ctx.blob.length}`);
    }
    if (ctx.blob[end] === 0) break;
    end += 1;
  }
  return new TextDecoder().decode(ctx.blob.subarray(offset, end));
}

/** joml's `Vector3f.equals`: component bits, so -0 is not 0. */
const sameFloats = (a: readonly number[], b: readonly number[]): boolean =>
  a.every((x, i) => javaFloatBits(x) === javaFloatBits(b[i]));

const COMPONENTS = ['.x', '.y', '.z', '.w'];

function getWithSwizzle(ctx: Context, shader: { text: string }, box: MaterialBox, port: number, type: number): Variable | undefined {
  const wire = wireInto(ctx.m, ctx.m.boxes.indexOf(box), port);
  if (wire === undefined) return undefined;
  const variable = resolve(ctx, shader, boxAt(ctx.m, wire.boxFrom), type, javaByte(wire.portFrom));
  const swizzle = wire.swizzle.replace(/\0/g, '');
  if (swizzle.length !== 0) return { value: `${variable.value}.${swizzle}`, type: swizzle.length };
  return variable;
}

/** `GfxAssembler.resolve`: one box's expression, appending its variable to `shader`. */
function resolve(ctx: Context, shader: { text: string }, box: MaterialBox, type: number, toPort: number): Variable {
  const cached = ctx.lookup.get(box);
  if (cached) return cached;

  const { m } = ctx;
  const index = ctx.attribute++;
  const params = box.params.map((p) => p | 0);
  const fp = (i: number): number => asFloat(params[i]);
  let returnType = 4;
  let variableName: string;
  let assignment: string;
  switch (box.type) {
    case BoxType.OUTPUT:
      throw runtime('Why?');
    case BoxType.TEXTURE_SAMPLE: {
      const texVar = `s${params[5]}`;
      variableName = `smp${index}`;
      const channel = params[4] === 1 ? 'zw' : 'xy';
      if (type === BrdfPort.REFLECT) {
        assignment = ctx.glsl
          ? `SAMPLE_2D_BIAS(${texVar}, iReflectCoord, ReflectionBlur)`
          : `SAMPLE_2D_BIAS(${texVar}, iUV, ReflectionBlur)`;
        break;
      }
      let uv = `iUV.${channel}`;
      const anim1 = nameOf(box.anim);
      const anim2 = nameOf(box.anim2);
      if (box.subType === 0) {
        if (anim1 !== '' && anim2 !== '') {
          uv = `float2(dot(t${anim1}.xyz, float3(${uv}, 1.0)), dot(t${anim2}.xyz, float3(${uv}, 1.0)))`;
        } else if (anim1 !== '') {
          uv = `((${uv} - t${anim1}.zw) * t${anim1}.xy)`;
        } else {
          const sx = fp(0);
          const sy = fp(1);
          if (sx !== 1 || sy !== 1) uv = `(${uv} * float2(${f6(sx)}, ${f6(sy)}))`;
          const ox = fp(2);
          const oy = fp(3);
          if (ox !== 0 || oy !== 0) uv += ` + float2(${f6(ox)}, ${f6(oy)})`;
          const widen = (v: Variable): string => (v.value.indexOf('.') === -1 && v.type !== 1 ? `${v.value}.xy` : v.value);
          const add = getWithSwizzle(ctx, shader, box, 0, type);
          if (add) uv = `(${uv}) + ${widen(add)}`;
          const scale = getWithSwizzle(ctx, shader, box, 1, type);
          if (scale) uv = `(${uv}) * ${widen(scale)}`;
          const sub = getWithSwizzle(ctx, shader, box, 2, type);
          if (sub) uv = `(${uv}) - ${widen(sub)}`;
        }
      } else if (box.subType === 1) {
        // ❗ Java's String.format without a locale: the JVM default's separator.
        const fd = (f: number): string => javaFormatF(f, ctx.comma);
        let x = `dot(float3(${uv}, 1.0), float3(${fd(fp(0))}, ${fd(fp(1))}, ${fd(fp(2))}))`;
        if (anim1 !== '') x = `dot(float3(${uv}, 1.0), t${anim1}.xyz)`;
        let y = `dot(float3(${uv}, 1.0), float3(${fd(fp(3))}, ${fd(fp(6))}, ${fd(fp(7))}))`;
        if (anim2 !== '') y = `dot(float3(${uv}, 1.0), t${anim2}.xyz)`;
        uv = `float2(${x}, ${y})`;
      }
      assignment = `SAMPLE_2D(${texVar}, ${uv})`;
      if (type === BrdfPort.FUZZ) {
        shader.text += `\tfloat4 ${variableName} = float4(${assignment}.x, SAMPLE_2D(${texVar}, iUV.zw).yz, 0.0);\n`;
        return { value: variableName, type: 4 };
      }
      break;
    }
    case BoxType.THING_COLOR:
      return { value: 'iColor', type: 4 };
    case BoxType.COLOR:
      variableName = `col${index}`;
      assignment = nameOf(box.anim) === ''
        ? `float4(${f6(fp(0))}, ${f6(fp(1))}, ${f6(fp(2))}, ${f6(fp(3))})`
        : `t${nameOf(box.anim)}`;
      break;
    case BoxType.CONSTANT:
      return { value: f6(fp(0)), type: 1 };
    case BoxType.CONSTANT2:
      return { value: `float2(${f6(fp(0))}, ${f6(fp(1))})`, type: 2 };
    case BoxType.CONSTANT3:
      return { value: `float3(${f6(fp(0))}, ${f6(fp(1))}, ${f6(fp(2))})`, type: 3 };
    case BoxType.CONSTANT4:
      return { value: `float4(${f6(fp(0))}, ${f6(fp(1))}, ${f6(fp(2))}, ${f6(fp(3))})`, type: 4 };
    case BoxType.MULTIPLY_ADD: {
      if (boxInto(m, m.boxes.indexOf(box), 0) === undefined) throw runtime('MAD node is supposed to take one input!');
      const input = getWithSwizzle(ctx, shader, box, 0, type)!;
      returnType = input.type;
      variableName = `mad${index}`;
      assignment = `((${input.value} * ${f6(fp(0))}) + ${f6(fp(1))})`;
      break;
    }
    case BoxType.MULTIPLY: {
      const l = getWithSwizzle(ctx, shader, box, 0, type);
      const r = getWithSwizzle(ctx, shader, box, 1, type);
      if (!l || !r) throw runtime('Multiply node is supposed to take two inputs!');
      returnType = r.type > l.type ? r.type : l.type;
      variableName = `mul${index}`;
      assignment = type === BrdfPort.BUMP ? `((${l.value} - 0.5) + ${r.value})` : `(${l.value} * ${r.value})`;
      break;
    }
    case BoxType.ADD: {
      const l = getWithSwizzle(ctx, shader, box, 0, type);
      const r = getWithSwizzle(ctx, shader, box, 1, type);
      if (!l || !r) {
        // Java's debugging loop: it prints, and it resolves every wired port again.
        for (let i = 0; i < 16; i += 1) getWithSwizzle(ctx, shader, box, i, type);
        if (l) {
          variableName = `sum${index}`;
          assignment = l.value;
          returnType = l.type;
          break;
        }
        throw runtime('Add node is supposed to take two inputs!');
      }
      returnType = r.type > l.type ? r.type : l.type;
      variableName = `sum${index}`;
      assignment = `(${l.value} + ${r.value})`;
      break;
    }
    case BoxType.MIX: {
      const l = getWithSwizzle(ctx, shader, box, 0, type);
      const r = getWithSwizzle(ctx, shader, box, 1, type);
      if (!l || !r) throw runtime('Mix node is supposed to take two inputs!');
      returnType = r.type > l.type ? r.type : l.type;
      let f = f6(fp(0));
      const w = getWithSwizzle(ctx, shader, box, 2, type);
      if (w) f = w.value;
      variableName = `mix${index}`;
      assignment = `(((${r.value} - ${l.value}) * ${f}) + ${l.value})`;
      break;
    }
    case BoxType.MAKE_FLOAT2:
    case BoxType.MAKE_FLOAT3:
    case BoxType.MAKE_FLOAT4: {
      const count = box.type - 11;
      const inputs: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const variable = getWithSwizzle(ctx, shader, box, i, type);
        if (variable) {
          let input = variable.value;
          if (variable.type === 3) input = `((${variable.value}.x + ${variable.value}.y + ${variable.value}.z) / 3.0)`;
          if (variable.type === 4) input = `luminance(${variable.value})`;
          inputs.push(input);
        } else inputs.push(f6(fp(i)));
      }
      return { value: `float${count}(${inputs.join(', ')})`, type: count };
    }
    case BoxType.BLEND: {
      const input1 = getWithSwizzle(ctx, shader, box, 0, type);
      const input2 = getWithSwizzle(ctx, shader, box, 1, type);
      const input3 = getWithSwizzle(ctx, shader, box, 2, type);
      if (!input1) throw npe('Cannot read field "type" because "input1" is null');
      returnType = input1.type;
      if (!input2) throw npe('Cannot read field "type" because "input2" is null');
      if (input2.type > returnType) returnType = input2.type;
      if (!input3) throw npe('Cannot read field "type" because "input3" is null');
      if (input3.type > returnType) returnType = input3.type;
      variableName = `blnd${index}`;
      assignment = `((${input2.value} - ${input1.value}) * saturate(${input3.value}.x * 100.0 - 15.0) + ${input1.value})`;
      break;
    }
    case BoxType.FRESNEL:
      variableName = `fresnel${index}`;
      assignment = 'pow(saturate(1.0 - (dot(-iNormal.xyz, iVec2Eye.xyz) / length(iVec2Eye.xyz))), FresnelPower)';
      break;
    case BoxType.EXPONENT: {
      if (boxInto(m, m.boxes.indexOf(box), 0) === undefined) throw runtime('MAD node is supposed to take one input!');
      const input = getWithSwizzle(ctx, shader, box, 0, type)!;
      returnType = input.type;
      variableName = `ex${index}`;
      assignment = `pow(${input.value}, ${fs(fp(0))})`;
      break;
    }
    case BoxType.BL_SEPARATE_XYZ: {
      const input = getWithSwizzle(ctx, shader, box, 0, type);
      if (!input) throw npe('Cannot invoke "cwlib.util.gfx.GfxAssembler$Variable.toString()" because "input" is null');
      const component = COMPONENTS[toPort];
      if (component === undefined) {
        throw new GfxAssemblerError('java.lang.ArrayIndexOutOfBoundsException', `Index ${toPort} out of bounds for length 4`);
      }
      return { value: `${input.value}${component}`, type: 1 };
    }
    case BoxType.BL_TEXTURE_COORDINATE:
      switch (toPort) {
        case 1: return { value: 'iNormal', type: 3 };
        case 2: return { value: 'float3(iUV.xy, 0.0)', type: 3 };
        case 5:
          return {
            value: '((float3(0.0, 1.0, 0.0) - (iPosition.xyz * float3(0.00078125, 0.00138889, 1.0))) * (float3(2.0, 2.0, 1.0) * float3(1.0, 0.5625, 1.0)))',
            type: 3,
          };
      }
      throw runtime(`Unsupported texture coordinate port! ${toPort}`);
    case BoxType.BL_MAPPING: {
      if (params[0] !== 0) throw runtime('Only mapping types of POINT are supported!');
      returnType = 3;
      const defaultVector = blobFloats(ctx, params[1], 3);
      const defaultLocation = blobFloats(ctx, params[2], 3);
      const defaultRotation = blobFloats(ctx, params[3], 3);
      const defaultScale = blobFloats(ctx, params[4], 3);
      const vectorInput = getWithSwizzle(ctx, shader, box, 0, type);
      const locationInput = getWithSwizzle(ctx, shader, box, 1, type);
      const rotationInput = getWithSwizzle(ctx, shader, box, 2, type);
      const scaleInput = getWithSwizzle(ctx, shader, box, 3, type);
      const f3 = (v: number[]): string => `float3(${f6(v[0])}, ${f6(v[1])}, ${f6(v[2])})`;
      const vector = vectorInput ? vectorInput.value : f3(defaultVector);
      const location = locationInput ? locationInput.value : f3(defaultLocation);
      const rotation = rotationInput ? rotationInput.value : f3(defaultRotation);
      const scale = scaleInput ? scaleInput.value : f3(defaultScale);
      variableName = `mapping${index}`;
      const ZERO = [0, 0, 0];
      const ONE = [1, 1, 1];
      if (!rotationInput && sameFloats(defaultRotation, ZERO)) {
        if (!scaleInput && !locationInput) {
          if (sameFloats(defaultScale, ONE) && sameFloats(defaultLocation, ZERO)) {
            if (!vectorInput) throw npe('Cannot invoke "cwlib.util.gfx.GfxAssembler$Variable.toString()" because "vectorInput" is null');
            assignment = vectorInput.value;
          } else if (sameFloats(defaultScale, ONE)) assignment = `(${vector} + ${location})`;
          else assignment = `(${vector} * ${scale})`;
        } else if (!locationInput) {
          assignment = sameFloats(defaultLocation, ZERO) ? `(${vector} * ${scale})` : `((${vector} * ${scale}) + ${location})`;
        } else {
          assignment = sameFloats(defaultScale, ONE) ? `(${vector} + ${location})` : `(${vector} * ${scale}) + ${location}`;
        }
      } else {
        assignment = `(rotate((${vector} * ${scale}), ${rotation}) + ${location})`;
      }
      break;
    }
    case BoxType.BL_TEXTURE_SAMPLE: {
      const sampler = `s${params[0]}`;
      let vector = 'iUV.xy';
      const input = getWithSwizzle(ctx, shader, box, 0, type);
      if (input) {
        vector = input.value;
        if (input.type > 2) vector = `${vector}.xy`;
        else if (input.type === 1) vector = `float2(${vector})`;
      }
      assignment = `SAMPLE_2D(${sampler}, ${vector})`;
      variableName = `smp${index}`;
      break;
    }
    case BoxType.BL_MIX: {
      const blendType = params[0];
      const defaultFactor = fp(2);
      const defaultA = blobFloats(ctx, params[3], 4);
      const defaultB = blobFloats(ctx, params[4], 4);
      const factorInput = getWithSwizzle(ctx, shader, box, 0, type);
      const aInput = getWithSwizzle(ctx, shader, box, 1, type);
      const bInput = getWithSwizzle(ctx, shader, box, 2, type);
      if (factorInput && factorInput.type !== 1) throw runtime('factor input must be 1!!!');
      const f4 = (v: number[]): string => `float4(${f6(v[0])},${f6(v[1])},${f6(v[2])},${f6(v[3])})`;
      let a = aInput ? aInput.value : f4(defaultA);
      let b = bInput ? bInput.value : f4(defaultB);
      const factor = factorInput ? factorInput.value : fs(defaultFactor);
      if (aInput && aInput.type !== 4) {
        if (aInput.type !== 1) throw runtime('invalid cast');
        a = `float4(${a})`;
      }
      if (bInput && bInput.type !== 4) {
        if (bInput.type !== 1) throw runtime('invalid cast');
        b = `float4(${b})`;
      }
      switch (blendType) {
        case 0:
          variableName = `mix${index}`;
          assignment = `((1.0 - ${factor}) * ${a} + ${factor} * ${b})`;
          break;
        case 2:
          variableName = `mul${index}`;
          assignment = `(${a} * ((1.0 - ${factor}) + ${factor} * ${b}))`;
          break;
        case 7:
          variableName = `add${index}`;
          assignment = `(${a} + (${factor} * ${b}))`;
          break;
        default:
          throw runtime(`Unsupported blend type for mix node! ${blendType}`);
      }
      break;
    }
    case BoxType.BL_MATH: {
      returnType = 1;
      const aVariable = getWithSwizzle(ctx, shader, box, 0, type);
      const bVariable = getWithSwizzle(ctx, shader, box, 1, type);
      const cVariable = getWithSwizzle(ctx, shader, box, 2, type);
      if (aVariable && aVariable.type !== 1) throw runtime('TEMP FAIL!');
      if (bVariable && bVariable.type !== 1) throw runtime('TEMP FAIL!');
      if (cVariable && cVariable.type !== 1) throw runtime('TEMP FAIL!');
      const a = aVariable ? aVariable.value : fs(fp(2));
      const b = bVariable ? bVariable.value : fs(fp(3));
      const operation = blobString(ctx, params[0]);
      variableName = operation.toLowerCase() + index;
      switch (operation) {
        case 'ADD': assignment = `(${a} + ${b})`; break;
        case 'MULTIPLY': assignment = `(${a} * ${b})`; break;
        case 'POWER': assignment = `pow(${a}, ${b})`; break;
        default: throw runtime(`${operation} is not a supported math operation!`);
      }
      break;
    }
    case BoxType.BL_VECTORMATH: {
      returnType = 3;
      const aValue = blobFloats(ctx, params[1], 3);
      const bValue = blobFloats(ctx, params[2], 3);
      let aVariable = getWithSwizzle(ctx, shader, box, 0, type);
      let bVariable = getWithSwizzle(ctx, shader, box, 1, type);
      if (aVariable && aVariable.type === 4) aVariable = { value: `${aVariable.value}.xyz`, type: 3 };
      if (bVariable && bVariable.type === 4) bVariable = { value: `${bVariable.value}.xyz`, type: 3 };
      const f3 = (v: number[]): string => `float3(${f6(v[0])}, ${f6(v[1])}, ${f6(v[2])})`;
      const a = aVariable ? aVariable.value : f3(aValue);
      const b = bVariable ? bVariable.value : f3(bValue);
      const operation = blobString(ctx, params[0]);
      variableName = operation.toLowerCase() + index;
      switch (operation) {
        case 'NORMALIZE': assignment = `normalize(${a})`; break;
        case 'ADD': assignment = `(${a} + ${b})`; break;
        case 'DOT_PRODUCT':
          returnType = 1;
          assignment = `dot(${a}, ${b})`;
          break;
        case 'CROSS_PRODUCT': assignment = `cross(${a}, ${b})`; break;
        default: throw runtime(`${operation} is not a supported math operation!`);
      }
      break;
    }
    case BoxType.BL_VALUE:
      return { value: fs(fp(1)), type: 1 };
    case BoxType.BL_NORMAL_MAP: {
      returnType = 3;
      const strengthVariable = getWithSwizzle(ctx, shader, box, 0, type);
      const colorValue = blobFloats(ctx, params[1], 4);
      const colorVariable = getWithSwizzle(ctx, shader, box, 1, type);
      const strength = strengthVariable ? strengthVariable.value : fs(fp(0));
      const color = colorVariable ? colorVariable.value : `float4(${colorValue.map(fs).join(', ')})`;
      variableName = `nrm${index}`;
      assignment = `NormalMap(iNormal, iTangent, ${color}, ${strength})`;
      break;
    }
    default:
      throw runtime(`Unhandled box type! (${box.type})`);
  }

  const variable = { value: variableName, type: returnType };
  ctx.lookup.set(box, variable);
  shader.text += `\tfloat${returnType} ${variableName} = ${assignment};\n`;
  return variable;
}

/** `GfxAssembler.setupPath`: the body that fills one `ENV.AUTO_*_SETUP`. */
function setupPath(ctx: Context, box: MaterialBox | undefined, port: number): string {
  const { m } = ctx;
  if (box === undefined && isBlender(m)) {
    const output = boxAt(m, outputBox(m));
    const p = output.params.map((x) => x | 0);
    const constant = (offset: number): string => `\treturn float4(${blobFloats(ctx, offset, 4).map(fs).join(', ')});`;
    if (port === BrdfPort.DIFFUSE && p[0] !== 0) return constant(p[0]);
    if (port === BrdfPort.SELF_ILLUMINATION && p[1] !== 0) return constant(p[1]);
    if (port === BrdfPort.SPECULAR && p[2] !== 0) return constant(p[2]);
  }

  ctx.attribute = 0;
  ctx.lookup = new Map();
  if (box !== undefined) {
    const builder = { text: '' };
    const wire = wireInto(m, outputBox(m), port);
    const variable = resolve(ctx, builder, box, port, wire ? javaByte(wire.portFrom) : 0);
    if (port === BrdfPort.BUMP && !ctx.blender) {
      if (ctx.vita) builder.text += `\treturn ${variable.value};`;
      else if (!ctx.baker) {
        builder.text += `\treturn ${ctx.normalMaps ? 'NormalMap' : 'BumpMap'}(iNormal, iTangent, ${variable.value}, BumpLevel);`;
      } else builder.text += `\treturn float4(1.0 - ${variable.value}.w, ${variable.value}.y, 1.0, 1.0);`;
    } else if ((port === BrdfPort.BUMP && ctx.blender) || variable.type === 4) {
      builder.text += `\treturn ${variable.value};`;
    } else if (variable.type === 3) builder.text += `\treturn float4(${variable.value}, 1.0);`;
    else builder.text += `\treturn float4(${variable.value});`;
    return builder.text.split('float1').join('float');
  }

  if (port === BrdfPort.BUMP && ctx.glsl) return '\treturn float4(normalize(normal), 1.0);';
  if (port === BrdfPort.OPACITY) return '\treturn float4(1.0); // This material does not have alpha masking';
  if (port === BrdfPort.SPECULAR && ctx.baker) return '\treturn float4(1.0, 1.0, 1.0, 1.0);\n';
  return "\treturn float4(0.0); // This material doesn't use this.";
}

/** Java's `String.replace(target, replacement)`: every occurrence, literally. */
const replace = (text: string, target: string, replacement: string): string => text.split(target).join(replacement);

const GLSL_RENAMES: [string, string][] = [
  ['iUV', 'uv'], ['iDecalUV', 'decal_uv'], ['iVec2Eye', 'vec2eye'], ['iTangent', 'tangent'],
  ['iNormal', 'normal'], ['iColor', 'thing_color'],
];

function context(m: AssemblerMaterial, options: ShaderSourceOptions, glsl: boolean, baker: boolean, blender: boolean): Context {
  return {
    m, blob: extendedBlob(m), glsl, baker, blender, normalMaps: options.useNormalMaps ?? false,
    vita: options.useVitaShaderSource ?? false, comma: options.defaultLocaleDecimalSeparator ?? '.',
    lookup: new Map(), attribute: 0,
  };
}

/**
 * Java's `GfxAssembler.generateShaderSource(material, flags,
 * useEnvironmentVariables)`: the BRDF template with the graph's code in every
 * `ENV.AUTO_*_SETUP`, the material's properties and, unless
 * `useEnvironmentVariables`, its constants. `ENV.COMPILE_FLAGS` stays in
 * (with the default `flags` of -1) for `assembleShaderVariants`.
 */
export function assembleShaderSource(m: AssemblerMaterial, options: ShaderSourceOptions = {}): AssembledShaderSource {
  const flags = (options.flags ?? -1) | 0;
  const glsl = flags === GLSL_FLAGS;
  const blender = isBlender(m);
  const ctx = context(m, options, glsl, false, blender);
  const vita = options.useVitaShaderSource ?? false;
  const separator = options.lineSeparator ?? '\n';

  let shader = options.template ?? javaJoinLines(vita ? BRDF_VITA_CG : glsl ? BRDF_GLSL : BRDF_CG, separator);

  if (!glsl && m.parameterAnimations.length !== 0) {
    shader = `\n${shader}`;
    for (const a of m.parameterAnimations) {
      const [x, y, z, w] = a.baseValue;
      shader = `uniform float4 t${nameOf(a)} = float4(${f6(x)}, ${f6(y)}, ${f6(z)}, ${f6(w)});\n${shader}`;
    }
    shader = `// Parameter animation uniforms \n${shader}`;
  }

  const output = outputBox(m);
  const at = (port: number): MaterialBox | undefined => boxInto(m, output, port);
  const properties: string[] = [];
  const normal = at(BrdfPort.BUMP);
  const diffuse = at(BrdfPort.DIFFUSE);
  let alpha = at(BrdfPort.OPACITY);
  const fuzz = at(BrdfPort.FUZZ);
  const aniso = at(BrdfPort.ANISO);
  const cc = at(BrdfPort.COLOR_CORRECTION);
  const ramp = at(BrdfPort.TOON_RAMP);
  const unknown = at(BrdfPort.UNKNOWN);
  const specular = at(BrdfPort.SPECULAR);
  const glow = at(BrdfPort.SELF_ILLUMINATION);
  const reflection = at(BrdfPort.REFLECT);
  const outputParam = (i: number): number => boxAt(m, output).params[i] | 0;

  if (m.boxes.some((b) => b.type === BoxType.FRESNEL)) properties.push('FRESNEL');
  if (alpha) properties.push('ALPHA');
  else if ((m.flags & GFX_ALPHA_CLIP) !== 0) {
    alpha = diffuse;
    properties.push('ALPHA');
  }
  if (specular || (blender && outputParam(2) !== 0)) properties.push('SPECULAR');
  if (normal) properties.push('NORMAL');
  if (glow || (blender && outputParam(1) !== 0)) properties.push('GLOW');
  if (reflection) properties.push('REFRACT');
  let alphaMode = m.alphaMode;
  if ((m.alphaLayer & 0xff) === 0xc0 || options.forceGenerateAsGlassy) {
    properties.push('GLASS');
    if (alphaMode === 0) alphaMode = 1;
  }
  if (unknown) properties.push('ST7');
  if (aniso) properties.push('ANISO');
  if (cc) properties.push('COLOR_CORRECTION');
  if (fuzz) properties.push('FUZZ');
  if (ramp) properties.push('LIGHTING_RAMP');
  if (properties.length === 0) properties.push('NO_FLAGS');

  // Every setup is generated, in Java's order, whether the template names it or not.
  const setups: [string, MaterialBox | undefined, number][] = [
    ['ENV.AUTO_NORMAL_SETUP', normal, BrdfPort.BUMP],
    ['ENV.AUTO_REFLECTION_SETUP', reflection, BrdfPort.REFLECT],
    ['ENV.AUTO_SPECULAR_SETUP', specular, BrdfPort.SPECULAR],
    ['ENV.AUTO_DIFFUSE_SETUP', diffuse, BrdfPort.DIFFUSE],
    ['ENV.AUTO_GLOW_SETUP', glow, BrdfPort.SELF_ILLUMINATION],
    ['ENV.AUTO_ALPHA_SETUP', alpha, BrdfPort.OPACITY],
    ['ENV.AUTO_ST7_SETUP', unknown, BrdfPort.UNKNOWN],
    ['ENV.AUTO_FUZZ_SETUP', fuzz, BrdfPort.FUZZ],
    ['ENV.AUTO_ANISO_SETUP', aniso, BrdfPort.ANISO],
    ['ENV.AUTO_COLOR_CORRECTION_SETUP', cc, BrdfPort.COLOR_CORRECTION],
    ['ENV.AUTO_RAMP_SETUP', ramp, BrdfPort.TOON_RAMP],
  ];
  for (const [token, box, port] of setups) shader = replace(shader, token, setupPath(ctx, box, port));

  if (flags !== -1) shader = replace(shader, 'ENV.COMPILE_FLAGS', `${flags}`);
  shader = replace(shader, 'ENV.MATERIAL_PROPERTIES', `(${properties.join(' | ')})`);

  if (!(options.useEnvironmentVariables ?? false)) {
    const fresnel = m.boxes.find((b) => b.type === BoxType.FRESNEL);
    const byte255 = (b: number): number => Math.fround((b & 0xff) / 255);
    const constants: [string, string][] = [
      ['ENV.ALPHA_TEST_LEVEL', f6(m.alphaTestLevel)],
      ['ENV.ALPHA_MODE', `${javaByte(alphaMode)}`],
      ['ENV.COSINE_POWER', f6(Math.fround(m.cosinePower * (vita ? 88 : 22)))],
      ['ENV.BUMP_LEVEL', f6(Math.fround(m.bumpLevel * 2))],
      ['ENV.FRESNEL_POWER', f6(fresnel ? asFloat(fresnel.params[0]) : 1)],
      ['ENV.REFLECTION_BLUR', f6(Math.fround(m.reflectionBlur - 1))],
      ['ENV.REFRACTIVE_INDEX', f6(m.refractiveIndex)],
      ['ENV.FRESNEL_FALLOFF_POWER', f6(m.refractiveFresnelFalloffPower)],
      ['ENV.FRESNEL_MULTIPLIER', f6(m.refractiveFresnelMultiplier)],
      ['ENV.FRESNEL_OFFSET', f6(m.refractiveFresnelOffset)],
      ['ENV.FRESNEL_SHIFT', f6(m.refractiveFresnelShift)],
      ['ENV.FUZZ_LIGHTING_BIAS', f6(byte255(m.fuzzLightingBias))],
      ['ENV.FUZZ_LIGHTING_SCALE', f6(byte255(m.fuzzLightingScale))],
      ['ENV.IRIDESCENCE_ROUGHNESS', f6(byte255(m.iridesenceRoughness))],
    ];
    for (const [token, value] of constants) shader = replace(shader, token, value);
  }

  if (glsl) for (const [from, to] of GLSL_RENAMES) shader = replace(shader, from, to);
  return { source: shader, properties, alphaMode };
}

export interface BakedShaderOptions {
  /** `System.lineSeparator()`, as for `assembleShaderSource`. */
  readonly lineSeparator?: string;
  readonly defaultLocaleDecimalSeparator?: string;
  /**
   * Java's `IS_BLENDER` as the previous `generateShaderSource` call left it --
   * the baker does not set it. False, its initial value, by default.
   */
  readonly isBlender?: boolean;
  /** `RGfxMaterial.useVitaShaderSource`: the bump port's value returned bare. */
  readonly useVitaShaderSource?: boolean;
}

/**
 * Java's `GfxAssembler.generateBakedShaderSource(material, port,
 * doAlphaClip)`: cwlib-gl's GLSL texture baker for one output port, the
 * alpha-clip template when `doAlphaClip` (its alpha from the opacity port, or
 * the diffuse one when there is none).
 */
export function assembleBakedShaderSource(m: AssemblerMaterial, port: number, doAlphaClip: boolean, options: BakedShaderOptions = {}): string {
  const ctx = context(m, {
    defaultLocaleDecimalSeparator: options.defaultLocaleDecimalSeparator, useVitaShaderSource: options.useVitaShaderSource,
  }, true, true, options.isBlender ?? false);
  const separator = options.lineSeparator ?? '\n';
  const output = outputBox(m);
  const box = boxInto(m, output, port);

  let constants = '';
  if (m.parameterAnimations.length !== 0) {
    constants = `\n${constants}`;
    for (const a of m.parameterAnimations) {
      const [x, y, z, w] = a.baseValue;
      constants = `vec4 t${nameOf(a)} = vec4(${f6(x)}, ${f6(y)}, ${f6(z)}, ${f6(w)});\n${constants}`;
    }
    constants = `// Parameter animation uniforms \n${constants}`;
  }

  let shader = javaJoinLines(BAKE_GLSL, separator);
  if (doAlphaClip) {
    shader = replace(javaJoinLines(ALPHA_BAKE_GLSL, separator), 'ENV.ALPHA_TEST_LEVEL', f6(m.alphaTestLevel));
    let alphaPort: number = BrdfPort.OPACITY;
    let alpha = boxInto(m, output, BrdfPort.OPACITY);
    if (alpha === undefined) {
      alphaPort = BrdfPort.DIFFUSE;
      alpha = boxInto(m, output, BrdfPort.DIFFUSE);
    }
    shader = replace(shader, 'ENV.ALPHA_SETUP', constants + setupPath(ctx, alpha, alphaPort));
  }
  shader = replace(shader, 'ENV.SAMPLE_SETUP', constants + setupPath(ctx, box, port));
  for (const [from, to] of GLSL_RENAMES) shader = replace(shader, from, to);
  return shader;
}
