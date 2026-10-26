/**
 * `assembleShaderSource` and `assembleBakedShaderSource` against Java's
 * `GfxAssembler` (toolkit `d6a2ef8`), byte for byte:
 *
 *   node dev/gfx-assembler-census.ts [random-count] [--numbers numbers.tsv]
 *       LBP_GAME for the game's materials (without it, only the synthetic ones);
 *       GFX_ORACLE_JAVA and GFX_ORACLE_CP for the Java side (without them, ours only)
 *
 * The corpus is every `GMTb` in the game's four FARCs, then `random-count`
 * (default 4,000) synthetic materials drawn from a fixed seed over **every box
 * type `resolve` knows and some it does not** -- the game uses 17 of them,
 * none of the Blender ones -- with random wires (acyclic, plus a few cycles),
 * swizzles, parameter animations, flags and an extended data blob where a
 * Blender box needs one. Each is written as a `GMTb` (`encodeMaterial`,
 * `writeResource`) so the Java reads the same bytes.
 *
 * Each material is generated in seven modes -- `cg` (`flags` -1, constants
 * filled: what converting a material does), `cg-env` (the material editor's,
 * constants left as `ENV.*`), `vita`, `glsl` (`flags` 0xDEADBEEF), `bake`,
 * `bake-alpha` (port 0) and `cg-normalmaps` -- under two JVM set-ups: an Italian
 * default locale with CRLF templates (this machine's own), and a US one with LF.
 * A row is `same` when both produced text of the same SHA-256, or both threw
 * the same Java exception class (and, for a `RuntimeException`, the same
 * message); `differ` otherwise.
 *
 * The Java side is a small class, `GfxOracle` (`GfxOracle hash <pack> <out>
 * <lf|crlf> <it|us>`: per material a `*\tunread` line when cwlib's reader
 * refuses it, else one `ok <sha256> <bytes>` / `threw <class>: <message>` line
 * per mode), calling only `generateShaderSource` / `generateBakedShaderSource`
 * -- never `CgAssembler.compile` or `getShader`. ❗ The `sequencerdump` jar's
 * cwlib is bb79e81, whose `GfxAssembler` is 565 lines short of d6a2ef8's (no
 * Blender boxes, no Vita template), so it is not the oracle: d6a2ef8's
 * `lib/cwlib/src/main/java` (`git archive d6a2ef8`) is compiled with JDK 25
 * against that jar for its dependencies, with four empty stand-ins for the
 * `org.ejml` classes `RMesh` names and the jar lacks. `GFX_ORACLE_CP` is
 * `GfxOracle`'s folder, those classes, d6a2ef8's `lib/cwlib` and
 * `lib/cwlib-gl` `src/main/resources` (the templates; ahead of the jar, whose
 * own `brdf.cg` is older), then the jar. The CRLF / Italian set-up is the
 * JVM's own here; for LF / US, `GfxOracle` re-reads the five public template
 * fields with `\n` and calls `Locale.setDefault`.
 *
 * `--numbers` checks `javaFloatToString` / `javaFormatF` against a file of
 * `hexbits \t Float.toString \t %f (ROOT) \t %f (it)` lines from the same JVM.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { loadResource, magicOf } from '../src/io/resource.ts';
import type { RevisionInfo } from '../src/io/serializer.ts';
import { writeResource } from '../src/io/writer.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import {
  BoxType, GfxAssemblerError, assembleBakedShaderSource, assembleShaderSource, GLSL_FLAGS,
} from '../src/resources/gfx-assembler.ts';
import { javaFloatToString, javaFormatF } from '../src/resources/gfx-assembler-java.ts';
import {
  encodeMaterial, readMaterial, type GfxMaterial, type MaterialBox, type MaterialParameterAnimation, type MaterialWire,
} from '../src/resources/material.ts';

const args = process.argv.slice(2);
const numbersAt = args.indexOf('--numbers');
if (numbersAt >= 0) {
  const dv = new DataView(new ArrayBuffer(4));
  let n = 0;
  let bad = 0;
  for (const line of readFileSync(args[numbersAt + 1], 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const [hex, ts, f, fit] = line.split('\t');
    dv.setUint32(0, parseInt(hex, 16));
    const v = dv.getFloat32(0);
    n += 1;
    const ours = [javaFloatToString(v), javaFormatF(v), javaFormatF(v, ',')];
    if (ours[0] !== ts || ours[1] !== f || ours[2] !== fit) {
      if (bad++ < 10) console.log(`  ${hex}: java ${JSON.stringify([ts, f, fit])} ours ${JSON.stringify(ours)}`);
    }
  }
  console.log(`numbers: ${n} floats, ${n - bad} same, ${bad} differ`);
  args.splice(numbersAt, 2);
}
const randomCount = Number(args[0] ?? 4000);

/* ------------------------------------------------------------- corpus */

interface Entry { readonly name: string; readonly bytes: Uint8Array; readonly m: GfxMaterial }
const corpus: Entry[] = [];
let base: { revision: RevisionInfo; compressionFlags: number } = {
  revision: { version: 0x3f8, subVersion: 0x17c, branchId: 0, branchRevision: 0 }, compressionFlags: 7,
};

const GAME = process.env.LBP_GAME;
let gameCount = 0;
if (GAME && existsSync(GAME)) {
  // Imported only here: game.ts refuses to load without LBP_GAME.
  const { FARCS } = await import('./game.ts');
  const seen = new Set<string>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (entry.size < 20 || seen.has(entry.sha1)) continue;
      const bytes = (await farc.get(entry.sha1))!;
      if (magicOf(bytes) !== 'GMTb') continue;
      seen.add(entry.sha1);
      const m = await readMaterial(bytes, nodeInflate);
      if (gameCount === 0) {
        const r = await loadResource(bytes, nodeInflate);
        base = { revision: r.revisionInfo, compressionFlags: r.compressionFlags };
      }
      corpus.push({ name: `${file}:${entry.sha1}`, bytes, m });
      gameCount += 1;
    }
    await access.close();
  }
}

/** mulberry32: a fixed, portable sequence. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = random(0x5eed);
const int = (n: number): number => Math.floor(rnd() * n);
const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
const F32 = new DataView(new ArrayBuffer(4));
const bitsOf = (f: number): number => {
  F32.setFloat32(0, f, false);
  return F32.getUint32(0, false);
};
const NICE = [0, 1, 1, 1, 0.5, 2, -1, 0.25, 0.1, 1 / 3, 0.0000005, 0.0000015, 1e7, 123456.789, -0, 0.15, 0.16, 3.3];
const niceFloat = (): number => (rnd() < 0.85 ? pick(NICE) : rnd() < 0.5 ? (int(2000001) - 1000000) / 10 ** int(8) : NaN);
const floatWord = (): number => (rnd() < 0.05 ? (int(0x100000000) >>> 0) : bitsOf(niceFloat()));
const NO_ANIM: MaterialParameterAnimation = { baseValue: [0, 0, 0, 0], keys: [], name: '', componentsAnimated: 0 };

/** The extended blob: float vectors at 4..95, then NUL-terminated operation names. */
const VECTORS = [[0, 0, 0, 0], [1, 1, 1, 1], [0.5, -2, 0.25, 1], [0, 0, 0, 1], [1, 1, 1, 0.5], [-0, 0, 0, 0]];
const STRINGS = ['ADD', 'MULTIPLY', 'POWER', 'NORMALIZE', 'DOT_PRODUCT', 'CROSS_PRODUCT', 'SUBTRACT'];
const blob = (() => {
  const bytes: number[] = [0, 0, 0, 0];
  for (const v of VECTORS) for (const f of v) {
    const w = bitsOf(f);
    bytes.push(w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255);
  }
  const strings: number[] = [];
  for (const s of STRINGS) {
    strings.push(bytes.length);
    for (const c of s) bytes.push(c.charCodeAt(0));
    bytes.push(0);
  }
  return { bytes: Uint8Array.from(bytes), vectors: VECTORS.map((_, i) => 4 + i * 16), strings };
})();

const HANDLED = [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 9, 10, 10, 11, 11, 12, 13, 14, 15, 16, 18, 19];
const BLENDER = [129, 131, 132, 137, 138, 139, 140, 141, 142];

function randomMaterial(index: number): GfxMaterial {
  const blender = rnd() < 0.4;
  const anims: MaterialParameterAnimation[] = [];
  for (let i = int(3); i > 0; i -= 1) {
    anims.push({ baseValue: [niceFloat(), niceFloat(), niceFloat(), niceFloat()].map(Math.fround) as unknown as [number, number, number, number], keys: [], name: pick(['a', 'b1', 'xyz', 'q\0']), componentsAnimated: 0 });
  }
  const animName = (): string => (anims.length && rnd() < 0.25 ? pick(anims).name : '');
  const count = 1 + int(9);
  const boxes: MaterialBox[] = [];
  const outputParams = [0, 0, 0, 0, 0, 0, 0, 0];
  if (blender) for (let i = 0; i < 3; i += 1) if (rnd() < 0.4) outputParams[i] = pick(blob.vectors);
  boxes.push({ type: 0, params: outputParams, floatParams: [], x: 0, y: 0, w: 0, h: 0, subType: 0, anim: NO_ANIM, anim2: NO_ANIM });
  for (let i = 0; i < count; i += 1) {
    const type = rnd() < 0.02 ? pick([0, 8, 130, 17]) : blender && rnd() < 0.5 ? pick(BLENDER) : pick(HANDLED);
    const p = Array.from({ length: 8 }, floatWord);
    if (type === 1) {
      p[4] = int(3);
      p[5] = int(8);
    } else if (type === 129) {
      p[0] = rnd() < 0.9 ? 0 : 1;
      for (let k = 1; k <= 4; k += 1) p[k] = pick(blob.vectors);
    } else if (type === 131) p[0] = int(8);
    else if (type === 132) {
      p[0] = pick([0, 2, 7, 7, 0, 1]);
      p[3] = pick(blob.vectors);
      p[4] = pick(blob.vectors);
    } else if (type === 141) p[0] = pick([blob.strings[0], blob.strings[1], blob.strings[2], blob.strings[6]]);
    else if (type === 140) {
      p[0] = pick(blob.strings.slice(0, 7).filter((_, k) => k !== 1 && k !== 2));
      p[1] = pick(blob.vectors);
      p[2] = pick(blob.vectors);
    } else if (type === 139) p[1] = pick(blob.vectors);
    const subType = type === 1 ? pick([0, 0, 1, 1, 2]) : 0;
    const name1 = animName();
    const name2 = animName();
    boxes.push({
      type, params: p.map((x) => x >>> 0), floatParams: [], x: 0, y: 0, w: 0, h: 0, subType,
      anim: name1 ? { ...NO_ANIM, name: name1 } : NO_ANIM, anim2: name2 ? { ...NO_ANIM, name: name2 } : NO_ANIM,
    });
  }
  if (blender) {
    const info = [0, 0, 0, 0, blob.bytes.length, 0, 0, 0];
    boxes.push({ type: 133, params: info, floatParams: [], x: 0, y: 0, w: 0, h: 0, subType: 0, anim: NO_ANIM, anim2: NO_ANIM });
  }
  const swizzle = (): string => (rnd() < 0.8 ? '' : pick(['a', 'r', 'g', 'b', 'rgb', 'xy', 'rg']));
  const wires: MaterialWire[] = [];
  for (const port of [0, 1, 2, 3, 4, 6, 7, 170, 172, 173, 175]) {
    if (rnd() < (port < 4 ? 0.6 : 0.12)) {
      wires.push({ boxFrom: 1 + int(count), boxTo: 0, portFrom: rnd() < 0.8 ? 0 : pick([1, 2, 3, 5]), portTo: port, swizzle: swizzle() });
    }
  }
  for (let i = 1; i <= count; i += 1) {
    for (let port = 0; port < 4; port += 1) {
      if (i < count && rnd() < 0.8) {
        const from = i + 1 + int(count - i);
        wires.push({ boxFrom: from, boxTo: i, portFrom: rnd() < 0.7 ? 0 : pick([0, 1, 2, 3, 5, 4]), portTo: port, swizzle: swizzle() });
      }
    }
  }
  // A few cycles, and a wire from beyond the boxes.
  if (index % 397 === 0 && count > 1) wires.push({ boxFrom: 1, boxTo: count, portFrom: 0, portTo: 0, swizzle: '' });
  if (index % 1009 === 0) wires.push({ boxFrom: count + 7, boxTo: 1, portFrom: 0, portTo: 1, swizzle: '' });
  const f = (): number => Math.fround(niceFloat());
  return {
    revision: base.revision,
    flags: int(0x10000) | (rnd() < 0.3 ? 0x800 : 0),
    alphaTestLevel: f(), alphaLayer: pick([0, 1, 128, 192]), alphaMode: pick([0, 0, 1, 2, 200]), shadowCastMode: 1,
    bumpLevel: f(), cosinePower: f(), reflectionBlur: f(), refractiveIndex: f(),
    refractiveFresnelFalloffPower: f(), refractiveFresnelMultiplier: f(), refractiveFresnelOffset: f(), refractiveFresnelShift: f(),
    fuzzLengthAndRefractiveFlag: 0, translucencyDensity: 255, fuzzSwirlAngle: 255, fuzzSwirlAmplitude: 0,
    fuzzLightingBias: int(256), fuzzLightingScale: int(256), iridesenceRoughness: int(256),
    // Java's reader takes `offset % code.length`: the blob is never empty.
    shaders: Array.from({ length: 10 }, () => new Uint8Array(0)),
    code: blender ? blob.bytes : new Uint8Array(16),
    textures: Array.from({ length: 8 }, () => undefined), wrapS: [1, 1, 1, 1, 1, 1, 1, 1], wrapT: [1, 1, 1, 1, 1, 1, 1, 1],
    boxes, wires, soundEnum: 0, parameterAnimations: anims,
  };
}

for (let i = 0; i < randomCount; i += 1) {
  const value = randomMaterial(i);
  const payload = encodeMaterial(value, base);
  const bytes = await writeResource({ magic: 'GMTb', revision: base.revision, compressionFlags: base.compressionFlags, payload, dependencies: [] }, nodeDeflate);
  // What the Java reads is what this reads back, not the value it was made from.
  corpus.push({ name: `random:${i}`, bytes, m: await readMaterial(bytes, nodeInflate) });
}
console.log(`corpus: ${gameCount} game materials, ${randomCount} synthetic`);

/* -------------------------------------------------------------- ours */

const MODES = ['cg', 'cg-env', 'vita', 'glsl', 'bake', 'bake-alpha', 'cg-normalmaps'] as const;
type Setup = { readonly label: string; readonly sep: 'lf' | 'crlf'; readonly locale: 'it' | 'us' };
const SETUPS: Setup[] = [
  { label: 'it_IT, CRLF', sep: 'crlf', locale: 'it' },
  { label: 'en_US, LF', sep: 'lf', locale: 'us' },
];

function ours(m: GfxMaterial, mode: (typeof MODES)[number], setup: Setup): string {
  const lineSeparator = setup.sep === 'lf' ? '\n' : '\r\n';
  const defaultLocaleDecimalSeparator = setup.locale === 'it' ? ',' : '.';
  const o = { lineSeparator, defaultLocaleDecimalSeparator };
  let text: string;
  try {
    switch (mode) {
      case 'cg': text = assembleShaderSource(m, o).source; break;
      case 'cg-env': text = assembleShaderSource(m, { ...o, useEnvironmentVariables: true }).source; break;
      case 'vita': text = assembleShaderSource(m, { ...o, useVitaShaderSource: true }).source; break;
      case 'glsl': text = assembleShaderSource(m, { ...o, flags: GLSL_FLAGS }).source; break;
      case 'bake': text = assembleBakedShaderSource(m, 0, false, o); break;
      case 'bake-alpha': text = assembleBakedShaderSource(m, 0, true, o); break;
      case 'cg-normalmaps': text = assembleShaderSource(m, { ...o, useNormalMaps: true }).source; break;
    }
  } catch (error) {
    if (error instanceof GfxAssemblerError) return `threw ${error.javaClass}: ${error.message}`;
    if (error instanceof RangeError && /call stack/.test(error.message)) return 'threw java.lang.StackOverflowError: null';
    return `threw ts:${(error as Error).name}: ${(error as Error).message}`;
  }
  const utf8 = Buffer.from(text, 'utf8');
  return `ok ${createHash('sha256').update(utf8).digest('hex')} ${utf8.length}`;
}

const JAVA = process.env.GFX_ORACLE_JAVA;
const CP = process.env.GFX_ORACLE_CP;
const work = mkdtempSync(path.join(os.tmpdir(), 'gfx-census-'));
const packFile = path.join(work, 'materials.pack');
{
  const parts: Buffer[] = [];
  for (const e of corpus) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(e.bytes.length);
    parts.push(len, Buffer.from(e.bytes));
  }
  writeFileSync(packFile, Buffer.concat(parts));
}

const sameRow = (a: string, b: string): boolean => {
  if (a === b) return true;
  const ta = /^threw ([^:]+)/.exec(a)?.[1];
  const tb = /^threw ([^:]+)/.exec(b)?.[1];
  return ta !== undefined && ta === tb && ta !== 'java.lang.RuntimeException';
};

for (const setup of SETUPS) {
  console.log(`\n== ${setup.label}`);
  let java: Map<string, string> | undefined;
  if (JAVA && CP) {
    const out = path.join(work, `java-${setup.sep}-${setup.locale}.tsv`);
    execFileSync(JAVA, ['-Xss8m', '-cp', CP, 'GfxOracle', 'hash', packFile, out, setup.sep, setup.locale], { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 26 });
    java = new Map();
    for (const line of readFileSync(out, 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      const [i, mode, result] = line.split('\t');
      java.set(`${i}\t${mode}`, result);
    }
  }
  for (const group of ['game', 'random'] as const) {
    const members = corpus.map((e, i) => [e, i] as const).filter(([e]) => (group === 'game') === !e.name.startsWith('random:'));
    if (members.length === 0) continue;
    let unread = 0;
    const row = new Map<string, { same: number; sameThrow: number; differ: number; threw: number; examples: string[] }>();
    const throws = new Map<string, number>();
    for (const [e, i] of members) {
      const javaUnread = java?.get(`${i}\t*`);
      if (javaUnread) {
        unread += 1;
        continue;
      }
      for (const mode of MODES) {
        const r = row.get(mode) ?? { same: 0, sameThrow: 0, differ: 0, threw: 0, examples: [] };
        row.set(mode, r);
        const mine = ours(e.m, mode, setup);
        if (mine.startsWith('threw')) {
          r.threw += 1;
          throws.set(`${mode} ${mine}`, (throws.get(`${mode} ${mine}`) ?? 0) + 1);
        }
        if (!java) continue;
        const theirs = java.get(`${i}\t${mode}`) ?? 'missing';
        if (sameRow(mine, theirs)) {
          r.same += 1;
          if (mine.startsWith('threw')) r.sameThrow += 1;
        }
        else {
          r.differ += 1;
          if (r.examples.length < 3) r.examples.push(`${i} ${e.name}: java ${theirs.slice(0, 160)} | ours ${mine.slice(0, 160)}`);
        }
      }
    }
    console.log(`${group}: ${members.length} materials${unread ? `, ${unread} Java's reader refused` : ''}`);
    for (const [mode, r] of row) {
      console.log(`  ${mode.padEnd(14)} same ${String(r.same).padStart(6)} (${r.same - r.sameThrow} text, ${r.sameThrow} the same throw)  differ ${String(r.differ).padStart(5)}  threw (ours) ${r.threw}`);
      for (const x of r.examples) console.log(`    ${x}`);
    }
    if (group === 'game') for (const [what, n] of throws) console.log(`  ${n} x ${what}`);
  }
}

// Which box types the synthetic corpus put through `resolve` without either side failing.
const types = new Map<number, number>();
for (const e of corpus) {
  if (!e.name.startsWith('random:')) continue;
  if (ours(e.m, 'cg', SETUPS[1]).startsWith('threw')) continue;
  for (const b of new Set(e.m.boxes.map((x) => x.type))) types.set(b, (types.get(b) ?? 0) + 1);
}
const typeName = new Map(Object.entries(BoxType).map(([k, v]) => [v as number, k]));
console.log(`\nsynthetic materials that generate, by box type present: ${[...types].sort((a, b) => a[0] - b[0]).map(([t, n]) => `${typeName.get(t) ?? t} ${n}`).join(', ')}`);
rmSync(work, { recursive: true, force: true });
