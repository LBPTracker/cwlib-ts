/**
 * Java cwlib's `CgAssembler` and the compile half of `GfxAssembler` (toolkit
 * `d6a2ef8`, MIT): what happens to `assembleShaderSource`'s text on its way
 * into a `GMTb`'s shader slots, up to and after the compiler this library
 * cannot run.
 *
 * The pipeline, as `CgAssembler.compile(source, gmat, shader)` runs it:
 *
 * 1. **Variants** (`assembleShaderVariants`, ported): one copy of the source
 *    per shader slot, `ENV.COMPILE_FLAGS` replaced by that slot's flags --
 *    the game's pass (decals, water, spritelights, baked or dynamic shadows
 *    and AO, LBP1's deferred passes, the Vita's lights and blending), ORed
 *    with the material's receive-shadows / sun / spritelights bits.
 * 2. **Compilation** (`shaderCompileCommand` describes it; *not* run): the
 *    variant's text is written to `<working directory>/shader` and one of
 *    Sony's SDK compilers turns it into `<working directory>/compiled`:
 *    - PS3 (LBP1, its private beta, LBP2 and its pre-alpha):
 *      `sce/sce-cgc.exe -profile sce_fp_rsx`, LBP2's two with
 *      `-mcgb --nofastmath --nofastprecision --O0`; then, when present,
 *      `sce/sce-cgcstrip.exe -semantic -param -sampler -varying <out>`.
 *    - PS4 (LBP3): `sce/orbis-wave-psslc.exe -profile sce_ps_orbis
 *      -nodx10clamp -write-constant-block -sbiversion 0
 *      -dont-strip-default-cb`, no stripper. The template turns into PSSL
 *      under the `ORBIS` flag (bit 15), which the variant carries.
 *    - Vita: `psp2cgc.dll`, `gxt_conversion.dll` and `SceLib.Gxm.dll` loaded
 *      in-process by `scelib.Gxm.compile` when all three are in `sce/`;
 *      otherwise `sce/psp2cgc.exe -profile sce_fp_psp2` and the stripper as
 *      `-o <out> <out>`.
 *    `sce/` is beside the toolkit's jar (`CwlibConfiguration.JAR_DIRECTORY`).
 *    None of these is redistributable, and none is on this machine.
 * 3. **LBP2's shared code pool** (`poolCellShaders`, ported): every PS3
 *    `sce_fp_rsx` program's 16-byte instructions are pooled, sorted unsigned,
 *    into the material's `code` blob, and each shader is rewritten to index
 *    the pool. Every other target keeps its compiled blobs whole, `code` null.
 *
 * Step 1 is text and step 3 bytes, both deterministic and both here; step 2 is
 * the only part that needs the SDK.
 */

/** cwlib's `GameShader`: which game, and so which compiler and variant table. */
export type GameShader = 'LBP1' | 'LBP_STUPID_BUILD' | 'LBP2_PRE_ALPHA' | 'LBP2' | 'LBP3_PS4' | 'VITA';

/** `GameShader.getShaderCount()`: how many slots a target's `GMTb` holds. */
export const SHADER_COUNT: Readonly<Record<GameShader, number>> = {
  LBP1: 4, LBP_STUPID_BUILD: 3, LBP2: 10, LBP3_PS4: 10, LBP2_PRE_ALPHA: 4, VITA: 24,
};

/** `CgAssembler`'s compile-flag bits, as the templates `#define` them. */
export const CgFlag = {
  NO_FLAGS: 0, DECALS: 1 << 0, WATER_TWEAKS: 1 << 1, SPRITELIGHT: 1 << 2, BAKED_AO: 1 << 3,
  DYNAMIC_AO: 1 << 4, BAKED_SHADOWS: 1 << 5, DYNAMIC_SHADOWS: 1 << 6, LEGACY: 1 << 7,
  LEGACY_NORMAL_PASS: 1 << 8, SPECULAR: 1 << 9, NORMAL: 1 << 10, ALPHA: 1 << 11, REFRACT: 1 << 12,
  GLOW: 1 << 13, GLASSY: 1 << 14, ORBIS: 1 << 15, BLEND: 1 << 25, LIGHT1: 1 << 26, LIGHT2: 1 << 27,
  LAYER_TEST: 1 << 28, FRESNEL: 1 << 29,
} as const;

const F = CgFlag;
const AO = F.BAKED_AO | F.DYNAMIC_AO;
const SHADOWS = F.BAKED_SHADOWS | F.DYNAMIC_SHADOWS;

/** `CgAssembler.LBP2_FLAGS`: the ten LBP2/LBP3 slots. */
export const LBP2_FLAGS: readonly number[] = [
  F.BAKED_AO | F.BAKED_SHADOWS,
  F.SPRITELIGHT | F.DYNAMIC_SHADOWS | F.DYNAMIC_AO | F.DECALS,
  F.SPRITELIGHT | F.DYNAMIC_SHADOWS | F.DYNAMIC_AO,
  F.SPRITELIGHT | SHADOWS | AO,
  F.WATER_TWEAKS | F.BAKED_AO | F.BAKED_SHADOWS,
  F.WATER_TWEAKS | F.SPRITELIGHT | F.DYNAMIC_SHADOWS | F.DYNAMIC_AO | F.DECALS,
  F.WATER_TWEAKS | F.SPRITELIGHT | F.DYNAMIC_SHADOWS | F.DYNAMIC_AO,
  F.WATER_TWEAKS | F.SPRITELIGHT | SHADOWS | AO,
  F.NO_FLAGS,
  F.DECALS,
];

/** `CgAssembler.LBP1_FLAGS`. */
export const LBP1_FLAGS: readonly number[] = [
  F.LEGACY | F.LEGACY_NORMAL_PASS, F.LEGACY, F.LEGACY | F.DECALS, F.LEGACY | F.WATER_TWEAKS,
];

const lights = [F.NO_FLAGS, F.DECALS, F.LIGHT1, F.LIGHT1 | F.DECALS, F.LIGHT1 | F.LIGHT2, F.LIGHT1 | F.LIGHT2 | F.DECALS];
/** `CgAssembler.LBPV_BLEND_FLAGS`: the Vita's twelve, for a material that blends. */
export const LBPV_BLEND_FLAGS: readonly number[] = [
  ...lights.map((l) => F.BLEND | l), ...lights.map((l) => F.LAYER_TEST | F.BLEND | l),
];
/** `CgAssembler.LBPV_FLAGS`: the Vita's twenty-four, for an opaque one. */
export const LBPV_FLAGS: readonly number[] = [
  ...lights, ...lights.map((l) => F.BLEND | l), ...lights.map((l) => F.LAYER_TEST | l),
  ...lights.map((l) => F.LAYER_TEST | F.BLEND | l),
];

const RECEIVE_SHADOWS = 0x100;
const RECEIVE_SUN = 0x200;
const RECEIVE_SPRITELIGHTS = 0x400;

/**
 * The flags `CgAssembler.compileShaderVariant` writes into slot `index`.
 * `alphaMode` is the one the source was generated with
 * (`AssembledShaderSource.alphaMode`). Throws where Java's table lookup would
 * run off its end -- as a Vita target of 24 slots does for a blending material,
 * whose table has twelve.
 */
export function variantFlags(material: { readonly flags: number }, alphaMode: number, index: number, shader: GameShader): number {
  const table = shader === 'LBP1' || shader === 'LBP_STUPID_BUILD'
    ? LBP1_FLAGS
    : shader === 'VITA' ? (alphaMode === 0 ? LBPV_FLAGS : LBPV_BLEND_FLAGS) : LBP2_FLAGS;
  if (index < 0 || index >= table.length) {
    throw new RangeError(`Index ${index} out of bounds for length ${table.length} (java.lang.ArrayIndexOutOfBoundsException)`);
  }
  let flags = table[index];
  if (shader === 'LBP3_PS4') flags |= F.ORBIS;
  if (shader === 'LBP2_PRE_ALPHA') flags |= F.WATER_TWEAKS;
  const m = material.flags;
  if (m & RECEIVE_SHADOWS) flags |= 1 << 22;
  if (m & RECEIVE_SUN) flags |= 1 << 23;
  if (m & RECEIVE_SPRITELIGHTS) flags |= 1 << 24;
  if (m & 0x4000) flags |= 1 << 29;
  return flags;
}

/**
 * The source of each shader slot, exactly what Java writes to the compiler's
 * input file: `source` (from `assembleShaderSource` with its default `flags`
 * of -1) with every `ENV.COMPILE_FLAGS` -- Java's `String.replace` -- replaced
 * by the slot's flags. `count` is the slot count of the `GMTb` being written;
 * the target's own by default.
 */
export function assembleShaderVariants(
  source: string,
  material: { readonly flags: number },
  alphaMode: number,
  shader: GameShader,
  count = SHADER_COUNT[shader],
): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(source.split('ENV.COMPILE_FLAGS').join(`${variantFlags(material, alphaMode, i, shader)}`));
  }
  return out;
}

export interface ShaderCompileCommand {
  /** Relative to the toolkit jar's folder. */
  readonly compiler: string;
  readonly profile: string;
  /** The arguments, with `{in}` and `{out}` for the two files. */
  readonly args: readonly string[];
  /** The optional stripper run on `{out}` afterwards, when it exists. */
  readonly stripper?: { readonly executable: string; readonly args: readonly string[] };
  /** Vita: the in-process route Java prefers when its three DLLs are present. */
  readonly inProcess?: readonly string[];
}

/** `GfxAssembler.getShader`'s command for a target -- a description; nothing here runs it. */
export function shaderCompileCommand(shader: GameShader): ShaderCompileCommand {
  if (shader === 'LBP3_PS4') {
    return {
      compiler: 'sce/orbis-wave-psslc.exe', profile: 'sce_ps_orbis',
      args: ['-profile', 'sce_ps_orbis', '-o', '{out}', '{in}', '-nodx10clamp', '-write-constant-block', '-sbiversion', '0', '-dont-strip-default-cb'],
    };
  }
  if (shader === 'VITA') {
    return {
      compiler: 'sce/psp2cgc.exe', profile: 'sce_fp_psp2',
      args: ['-profile', 'sce_fp_psp2', '-o', '{out}', '{in}'],
      stripper: { executable: 'sce/sce-cgcstrip.exe', args: ['-o', '{out}', '{out}'] },
      inProcess: ['sce/psp2cgc.dll', 'sce/gxt_conversion.dll', 'sce/SceLib.Gxm.dll'],
    };
  }
  const strip = { executable: 'sce/sce-cgcstrip.exe', args: ['-semantic', '-param', '-sampler', '-varying', '{out}'] };
  if (shader === 'LBP2' || shader === 'LBP2_PRE_ALPHA') {
    return {
      compiler: 'sce/sce-cgc.exe', profile: 'sce_fp_rsx',
      args: ['-profile', 'sce_fp_rsx', '-o', '{out}', '{in}', '-mcgb', '--nofastmath', '--nofastprecision', '--O0'],
      stripper: strip,
    };
  }
  return { compiler: 'sce/sce-cgc.exe', profile: 'sce_fp_rsx', args: ['-profile', 'sce_fp_rsx', '-o', '{out}', '{in}'], stripper: strip };
}

/** `CgAssembler.getBytecode`: a compiled `sce_fp_rsx` program's instructions, as u64 halves. */
export function cellBytecode(cgb: Uint8Array): bigint[] {
  const count = ((cgb[8] << 8) | cgb[9]) >> 4;
  const view = new DataView(cgb.buffer, cgb.byteOffset, cgb.byteLength);
  const code: bigint[] = [];
  for (let i = 0; i < count * 2; i += 1) code.push(view.getBigUint64(0x20 + i * 8, false));
  return code;
}

const pad16 = (n: number): number => (n % 16 === 0 ? n : n + 16 - (n % 16));

/** `CgAssembler.convert`: one program rewritten to index the shared pool. */
function convertCell(shader: Uint8Array, pool: bigint[]): Uint8Array {
  const code = cellBytecode(shader);
  const header = shader.slice(0, 0x20);
  header[0x4] = 0x80;
  header[0x8] = (code.length >>> 8) & 0xff;
  header[0x9] = code.length & 0xff;
  header[0x1f] = header[0x1c];
  const cgbSize = shader.length - code.length * 8 - 0x20;
  const cgb = new Uint8Array(pad16(cgbSize));
  cgb.set(shader.subarray(0x20 + code.length * 8, 0x20 + code.length * 8 + cgbSize));
  header[0x1c] = (cgb.length >>> 8) & 0xff;
  header[0x1d] = cgb.length & 0xff;
  const lookup = new Uint8Array(pad16(code.length * 2));
  const at = new Map<bigint, number>();
  pool.forEach((c, i) => { if (!at.has(c)) at.set(c, i); });
  for (let i = 0; i < code.length; i += 1) {
    const index = at.get(code[i]) ?? -1;
    lookup[i * 2] = (index >>> 8) & 0xff;
    lookup[i * 2 + 1] = index & 0xff;
  }
  const out = new Uint8Array(header.length + cgb.length + lookup.length);
  out.set(header, 0);
  out.set(cgb, header.length);
  out.set(lookup, header.length + cgb.length);
  return out;
}

/**
 * `CgAssembler.compile`'s LBP2 step after the compiler: the instructions of
 * every compiled slot pooled (distinct, sorted unsigned) into `code`, and each
 * slot rewritten to index the pool. Only LBP2 (`GameShader.LBP2`) does this.
 */
export function poolCellShaders(compiled: readonly Uint8Array[]): { shaders: Uint8Array[]; code: Uint8Array } {
  const unique = new Set<bigint>();
  for (const s of compiled) for (const c of cellBytecode(s)) unique.add(c);
  const pool = [...unique].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const code = new Uint8Array(pool.length * 8);
  const view = new DataView(code.buffer);
  pool.forEach((c, i) => view.setBigUint64(i * 8, c, false));
  return { shaders: compiled.map((s) => convertCell(s, pool)), code };
}
