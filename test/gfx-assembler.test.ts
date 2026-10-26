import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BrdfPort, GfxAssemblerError, GLSL_FLAGS, assembleBakedShaderSource, assembleShaderSource, type AssemblerMaterial,
} from '../src/resources/gfx-assembler.ts';
import {
  LBP2_FLAGS, assembleShaderVariants, cellBytecode, poolCellShaders, shaderCompileCommand, variantFlags,
} from '../src/resources/gfx-assembler-cg.ts';
import { javaFloatToString, javaFormatF, javaJoinLines } from '../src/resources/gfx-assembler-java.ts';
import type { MaterialBox, MaterialParameterAnimation, MaterialWire } from '../src/resources/material.ts';

/**
 * The expected text below is Java's: toolkit d6a2ef8's `GfxAssembler` run on
 * this same material (written as a `GMTb`) by the oracle the census uses,
 * `dev/gfx-assembler-census.ts`, which also covers the game's 11,011
 * materials and thousands of synthetic ones.
 */

const F = new DataView(new ArrayBuffer(4));
const w = (f: number): number => {
  F.setFloat32(0, f, false);
  return F.getUint32(0, false);
};
const NO_ANIM: MaterialParameterAnimation = { baseValue: [0, 0, 0, 0], keys: [], name: '', componentsAnimated: 0 };
const box = (type: number, params: number[], extra: Partial<MaterialBox> = {}): MaterialBox => {
  const p = [...params, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 8);
  return { type, params: p, floatParams: [], x: 0, y: 0, w: 0, h: 0, subType: 0, anim: NO_ANIM, anim2: NO_ANIM, ...extra };
};
const wire = (boxFrom: number, boxTo: number, portTo: number, swizzle = '', portFrom = 0): MaterialWire =>
  ({ boxFrom, boxTo, portFrom, portTo, swizzle });

/** A diffuse of texture × colour, its alpha, a matrix-sampled bump, a fresnel glow; glassy. */
const SAMPLE: AssemblerMaterial = {
  flags: 0x708 | 0x4000, alphaTestLevel: 0.5, alphaLayer: 0xc0, alphaMode: 0, bumpLevel: Math.fround(0.2),
  cosinePower: Math.fround(0.3), reflectionBlur: 1, refractiveIndex: Math.fround(0.01),
  refractiveFresnelFalloffPower: 1, refractiveFresnelMultiplier: 1, refractiveFresnelOffset: 0, refractiveFresnelShift: 0,
  fuzzLightingBias: 127, fuzzLightingScale: 127, iridesenceRoughness: 0,
  boxes: [
    box(0, []),
    box(1, [w(2), w(0.5), w(0.25), w(0), 0, 3]),
    box(3, [w(1), w(0.5), w(0.25), w(1)], { anim: { ...NO_ANIM, name: 'p' } }),
    box(10, []),
    box(1, [w(1), w(0), w(0.5), w(0), 1, 1, w(1), w(-0.125)], { subType: 1 }),
    box(18, [w(5)]),
  ],
  wires: [wire(3, 0, 0), wire(1, 3, 0), wire(2, 3, 1), wire(4, 0, 3), wire(1, 0, 1, 'a'), wire(5, 0, 4)],
  parameterAnimations: [{ baseValue: [1, 0.5, 0.25, 1], keys: [], name: 'p', componentsAnimated: 0 }],
  code: new Uint8Array(16),
};

test("Java's numbers: Float.toString and %f", () => {
  assert.equal(javaFloatToString(1), '1.0');
  assert.equal(javaFloatToString(0.1), '0.1');
  assert.equal(javaFloatToString(1e7), '1.0E7');
  assert.equal(javaFloatToString(9999999), '9999999.0');
  assert.equal(javaFloatToString(0.001), '0.001');
  assert.equal(javaFloatToString(Math.fround(0.0009999999)), '9.999999E-4');
  assert.equal(javaFloatToString(1.4e-45), '1.4E-45');
  assert.equal(javaFloatToString(-0), '-0.0');
  assert.equal(javaFloatToString(3.4028234663852886e38), '3.4028235E38');
  assert.equal(javaFormatF(Math.fround(0.1)), '0.100000');
  assert.equal(javaFormatF(-0), '-0.000000');
  assert.equal(javaFormatF(Math.fround(-0.002362576)), '-0.002363');
  // JDK 25, measured: the float nearest 5e-7 is below the half.
  assert.equal(javaFormatF(Math.fround(0.0000005)), '0.000000');
  assert.equal(javaFormatF(Math.fround(0.0000015)), '0.000002');
  assert.equal(javaFormatF(0.0000025), '0.000003');
  assert.equal(javaFormatF(1.5, ','), '1,500000');
  assert.equal(javaFormatF(NaN), 'NaN');
  assert.equal(javaJoinLines('a\r\nb\n\nc\n', '\r\n'), 'a\r\nb\r\n\r\nc');
});

test('the generated code of each port, as Java writes it', () => {
  const { source, properties, alphaMode } = assembleShaderSource(SAMPLE);
  assert.deepEqual(properties, ['FRESNEL', 'ALPHA', 'NORMAL', 'GLOW', 'GLASS']);
  assert.equal(alphaMode, 1, 'a glassy material of alpha mode 0 is generated as mode 1');
  for (const fragment of EXPECTED_CG) assert.ok(source.includes(fragment), `missing ${JSON.stringify(fragment)}`);
  assert.ok(source.includes('ENV.COMPILE_FLAGS'), 'flags -1 leaves the compile flags for the variants');
  assert.ok(!/ENV\.(?!COMPILE_FLAGS)/.test(source), 'every other ENV.* is filled');
  assert.equal(sha256(source), EXPECTED_CG_SHA256);
});

test('the options Java has: environment variables, locale, line ends, GLSL, the baker', () => {
  const env = assembleShaderSource(SAMPLE, { useEnvironmentVariables: true }).source;
  assert.ok(env.includes('ENV.BUMP_LEVEL') && env.includes('ENV.ALPHA_MODE'));
  const italian = assembleShaderSource(SAMPLE, { defaultLocaleDecimalSeparator: ',' }).source;
  assert.ok(italian.includes('float3(1,000000, 0,000000, 0,500000)'), 'subType 1 uses the default locale');
  assert.ok(italian.includes('float2(2.000000, 0.500000)'), 'everything else Locale.ROOT');
  const crlf = assembleShaderSource(SAMPLE, { lineSeparator: '\r\n' }).source;
  assert.ok(crlf.includes('\r\n') && crlf.replace(/\r\n/g, '\n') === assembleShaderSource(SAMPLE).source);
  const glsl = assembleShaderSource(SAMPLE, { flags: GLSL_FLAGS }).source;
  assert.ok(!glsl.includes('iUV') && glsl.includes('SAMPLE_2D(s3, (uv.xy * float2(2.000000, 0.500000)) + float2(0.250000, 0.000000))'));
  assert.equal(sha256(assembleBakedShaderSource(SAMPLE, BrdfPort.DIFFUSE, true)), EXPECTED_BAKE_ALPHA_SHA256);
});

test("Java's failures, by class", () => {
  const broken: AssemblerMaterial = { ...SAMPLE, boxes: [box(0, []), box(10, [])], wires: [wire(1, 0, 0)] };
  assert.throws(() => assembleShaderSource(broken), (e: unknown) =>
    e instanceof GfxAssemblerError && e.javaClass === 'java.lang.RuntimeException' && e.message === 'Multiply node is supposed to take two inputs!');
  const unknown: AssemblerMaterial = { ...SAMPLE, boxes: [box(0, []), box(130, [])], wires: [wire(1, 0, 0)] };
  assert.throws(() => assembleShaderSource(unknown), /Unhandled box type! \(130\)/);
});

test('the compile-flag variants and the compiler they would go to', () => {
  const { source, alphaMode } = assembleShaderSource(SAMPLE);
  const variants = assembleShaderVariants(source, SAMPLE, alphaMode, 'LBP3_PS4');
  assert.equal(variants.length, 10);
  // 0x708: receive shadows, sun, spritelights; 0x4000: bit 29; LBP3 adds ORBIS.
  const extra = (1 << 22) | (1 << 23) | (1 << 24) | (1 << 29) | (1 << 15);
  assert.deepEqual(variants.map((_, i) => variantFlags(SAMPLE, alphaMode, i, 'LBP3_PS4')), LBP2_FLAGS.map((f) => f | extra));
  assert.ok(!variants[0].includes('ENV.COMPILE_FLAGS') && variants[0].includes(`${LBP2_FLAGS[0] | extra}`));
  assert.throws(() => variantFlags(SAMPLE, 1, 12, 'VITA'), /out of bounds for length 12/);
  assert.equal(shaderCompileCommand('LBP3_PS4').compiler, 'sce/orbis-wave-psslc.exe');
  assert.equal(shaderCompileCommand('LBP1').profile, 'sce_fp_rsx');
});

test("LBP2's pooled code: CgAssembler.convert on two programs", () => {
  // Two fake sce_fp_rsx programs: 0x20 header (instruction bytes at 8..9), code, then a tail.
  const program = (words: bigint[], tail: number[]): Uint8Array => {
    const out = new Uint8Array(0x20 + words.length * 8 + tail.length);
    const view = new DataView(out.buffer);
    view.setUint16(8, (words.length / 2) * 16, false);
    out[0x1c] = 0x12;
    words.forEach((x, i) => view.setBigUint64(0x20 + i * 8, x, false));
    out.set(tail, 0x20 + words.length * 8);
    return out;
  };
  const a = program([5n, 0xffffffffffffffffn], [1, 2, 3]);
  const b = program([5n, 2n, 7n, 2n], [9]);
  assert.deepEqual(cellBytecode(b), [5n, 2n, 7n, 2n]);
  const { shaders, code } = poolCellShaders([a, b]);
  assert.equal(code.length, 4 * 8, 'four distinct instructions, sorted unsigned');
  assert.deepEqual([...shaders[1].subarray(0x20 + 16, 0x20 + 16 + 8)], [0, 1, 0, 0, 0, 2, 0, 0]);
  assert.equal(shaders[0][4], 0x80);
  assert.equal(shaders[0][0x1f], 0x12);
  assert.equal(shaders[0][0x1d], 16, 'the tail padded to 16');
});

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const EXPECTED_CG: string[] = [
  "uniform float4 tp = float4(1.000000, 0.500000, 0.250000, 1.000000);\n",
  "#define PROPERTIES (FRESNEL | ALPHA | NORMAL | GLOW | GLASS)",
  "#define ALPHA_MODE 1",
  "float CosinePower = 6.600000;",
  "float BumpLevel = 0.400000;",
  "\tfloat4 smp0 = SAMPLE_2D(s1, float2(dot(float3(iUV.zw, 1.0), float3(1.000000, 0.000000, 0.500000)), dot(float3(iUV.zw, 1.0), float3(0.000000, 1.000000, -0.125000))));\n\treturn BumpMap(iNormal, iTangent, smp0, BumpLevel);",
  "\tfloat4 smp1 = SAMPLE_2D(s3, (iUV.xy * float2(2.000000, 0.500000)) + float2(0.250000, 0.000000));\n\tfloat4 col2 = tp;\n\tfloat4 mul0 = (smp1 * col2);\n\treturn mul0;",
  "\tfloat4 fresnel0 = pow(saturate(1.0 - (dot(-iNormal.xyz, iVec2Eye.xyz) / length(iVec2Eye.xyz))), FresnelPower);\n\treturn fresnel0;",
  "\tfloat4 smp0 = SAMPLE_2D(s3, (iUV.xy * float2(2.000000, 0.500000)) + float2(0.250000, 0.000000));\n\treturn smp0;",
];
/** Java's whole text, LF, Locale.US. */
const EXPECTED_CG_SHA256 = '4935311297aaf1d58bccc676f73f94a71769466cd500a4e7bf5a1903ee081aae';
const EXPECTED_BAKE_ALPHA_SHA256 = 'eb0ef31df085f9bfdfd55133e1729c7e5e7add7de3be72ac9ab8be869357d021';
