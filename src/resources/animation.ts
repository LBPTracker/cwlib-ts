/**
 * `RAnimation` -- a skeletal animation: magic `ANMb`, FileDB paths `….anim`
 * (`dwarf_look_updown.anim`). Per bone a base pose, then for each frame after
 * the first the rotation, position, scale and morph weight of only the bones
 * and morphs that move.
 *
 * The walk is cwlib's `resources/RAnimation.java` (ennuo/toolkit `d6a2ef8`):
 * below version `0x378` arrays of floats, from it a small header and one byte
 * block of packed values -- rotations as three 15-bit components and the sign
 * of the fourth, everything else half floats. What the game's own files prove
 * of it is steering/level-files.md, *Animations* (`dev/animation-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { ByteReader, halfToFloat } from '../io/stream.ts';
import { Writer } from '../io/writer.ts';

export interface AnimBone {
  /** cwlib's `calculateAnimationHash` of the bone's name; matches `MeshBone.animHash`. */
  readonly animHash: number;
  /** Indices into `bones`, -1 for none. */
  readonly parent: number;
  readonly firstChild: number;
  readonly nextSibling: number;
}

/** A point the animation names: a footstep, a sound, a particle. */
export interface AnimLocator {
  readonly position: readonly [number, number, number];
  readonly name: string;
  readonly looping: number;
  readonly type: number;
}

export interface Animation {
  readonly revision: RevisionInfo;
  readonly bones: readonly AnimBone[];
  readonly numFrames: number;
  readonly fps: number;
  /** Version `0x378` on; 0 before. */
  readonly loopStart: number;
  readonly morphCount: number;
  /** Which bones (indices into `bones`) move in rotation, position and scale, and which morphs move. */
  readonly rotBonesAnimated: Uint8Array;
  readonly posBonesAnimated: Uint8Array;
  readonly scaleBonesAnimated: Uint8Array;
  readonly morphsAnimated: Uint8Array;
  /**
   * `x, y, z, w` per entry: the first `bones.length` are the base pose, then
   * `rotBonesAnimated.length` per frame for frames 1 to `numFrames - 1`.
   */
  readonly rotations: Float32Array;
  /** `x, y, z` per entry, laid out as `rotations`, over `posBonesAnimated`. */
  readonly positions: Float32Array;
  /** `x, y, z` per entry, laid out as `rotations`, over `scaleBonesAnimated`. */
  readonly scales: Float32Array;
  /** One per entry: the first `morphCount` the base weights, then `morphsAnimated.length` per frame. */
  readonly morphs: Float32Array;
  /** Version `0x38c` on: identity before. cwlib reads them and does not apply them. */
  readonly posOffset: readonly [number, number, number, number];
  readonly posScale: readonly [number, number, number, number];
  /** Version `0x3b2` on. cwlib's comment calls it "fat", 4-byte elements; it reads 2 either way. */
  readonly fat: number;
  readonly locators: readonly AnimLocator[];
  /**
   * Version `0x378` on: the `4 * locatorKeys` bytes after the bones in the
   * packed block, which cwlib skips ("short - index? byte, padded to 4") and so
   * does this reader. Kept as stored so `encodeAnimation` writes them, and the
   * header's `locatorKeys` count, back; absent is none.
   */
  readonly locatorKeyData?: Uint8Array;
  /**
   * Version `0x378` on: the zero bytes the block carries past the multiple of
   * 16 its values are padded to -- 0 or 16, with nothing in the header to say
   * which (see `unpack`). Kept so the block is written back at its length;
   * absent is 0.
   */
  readonly extraPadding?: number;
}

function readLocator(s: Serializer): AnimLocator {
  return { position: s.vector3(), name: s.str(), looping: s.i8(), type: s.i8() };
}

/** Four bytes to read x's word as a float once its low bit, w's sign, is cleared. */
const SCRATCH = new DataView(new ArrayBuffer(4));

/** The packed block of a version `0x378` and later animation; its integers are fixed-width. */
function unpack(block: Uint8Array, head: {
  boneCount: number; rot: number; pos: number; scale: number; morph: number; locatorKeys: number;
  numFrames: number; morphCount: number; fat: boolean;
}): Omit<Animation, 'revision' | 'numFrames' | 'fps' | 'loopStart' | 'morphCount' | 'posOffset' | 'posScale' | 'fat' | 'locators'> & { extraPadding: number } {
  const r = new ByteReader(block);
  const bones: AnimBone[] = [];
  for (let i = 0; i < head.boneCount; i += 1) {
    bones.push({ animHash: r.i32(), parent: r.i8(), firstChild: r.i8(), nextSibling: r.i8() });
    r.u8(); // padding
  }
  const locatorKeyData = r.slice(4 * head.locatorKeys).slice(); // cwlib: "short - index? byte, padded to 4" -- kept, not read
  const rotBonesAnimated = r.slice(head.rot).slice();
  const posBonesAnimated = r.slice(head.pos).slice();
  const scaleBonesAnimated = r.slice(head.scale).slice();
  const morphsAnimated = r.slice(head.morph).slice();
  if (r.position % 2 !== 0) r.u8(); // alignment

  // ❗ **`fat` makes every value four bytes**, which cwlib's comment says and its
  // reader ignores: the two animations of the game's 2,664 with `fat` 1 fill
  // their blocks to the byte only with f32 positions, scales and morphs and
  // rotations of three f32, and read as two-byte values leave 48,060 and
  // 66,162 bytes over. The sign of w still rides in the low bit of x's word:
  // set on 10 of 3,236 non-zero x, against half of y's and z's.
  const word = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const frames = head.numFrames - 1;
  const rotations = new Float32Array((head.boneCount + head.rot * frames) * 4);
  for (let i = 0; i < rotations.length; i += 4) {
    let x: number;
    let y: number;
    let z: number;
    let negative: boolean;
    if (head.fat) {
      const at = r.position;
      r.slice(12);
      const xBits = word.getUint32(at, false);
      negative = (xBits & 1) !== 0;
      SCRATCH.setUint32(0, xBits & ~1, false);
      x = SCRATCH.getFloat32(0, false);
      y = word.getFloat32(at + 4, false);
      z = word.getFloat32(at + 8, false);
    } else {
      const xBits = r.i16();
      negative = (xBits & 1) !== 0; // the sign of w rides in x's low bit
      x = (xBits & ~1) / 0x7fff;
      y = r.i16() / 0x7fff;
      z = r.i16() / 0x7fff;
    }
    const w = Math.sqrt(Math.max(0, 1 - (x * x + y * y + z * z)));
    rotations[i] = x;
    rotations[i + 1] = y;
    rotations[i + 2] = z;
    rotations[i + 3] = negative ? -w : w;
  }
  const values = (count: number): Float32Array => {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      if (head.fat) {
        const at = r.position;
        r.slice(4);
        out[i] = word.getFloat32(at, false);
      } else out[i] = halfToFloat(r.u16());
    }
    return out;
  };
  const positions = values((head.boneCount + head.pos * frames) * 3);
  const scales = values((head.boneCount + head.scale * frames) * 3);
  const morphs = values(head.morphCount + head.morph * frames);
  // ⚠️ **What is left is zero padding, of one of two lengths**: to the next
  // multiple of 16 (1,554 of the game's animations), or that and 16 more zero
  // bytes (1,103), with nothing in the header to tell which. Anything else --
  // a non-zero byte, or more -- is a misread.
  const padded = Math.ceil(r.position / 16) * 16;
  if ((block.length !== padded && block.length !== padded + 16) || block.subarray(r.position).some((b) => b !== 0)) {
    throw new SerializerError(`the animation block has ${r.remaining} bytes past its values, not zero padding`);
  }
  return {
    bones, rotBonesAnimated, posBonesAnimated, scaleBonesAnimated, morphsAnimated, rotations, positions, scales, morphs,
    locatorKeyData, extraPadding: block.length - padded,
  };
}

/** Read an `ANMb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readAnimation(bytes: Uint8Array, inflate: Inflate): Promise<Animation> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'ANMb') throw new SerializerError(`not an animation: "${resource.magic}"`);
  const { version } = revision;
  let out: Animation;

  if (version < 0x378) {
    const bones = s.array((x): AnimBone => ({ animHash: x.i32(), parent: x.s32(), firstChild: x.s32(), nextSibling: x.s32() }));
    const numFrames = s.i32();
    const fps = s.i32();
    const morphCount = s.i32();
    const shorts = (): Uint8Array => Uint8Array.from(s.array((x) => x.i16() & 0xff));
    const rotBonesAnimated = shorts();
    const posBonesAnimated = shorts();
    const scaleBonesAnimated = shorts();
    const morphsAnimated = shorts();
    const vectors = (width: 3 | 4): Float32Array => {
      const list = s.array((x) => x.vector4());
      const flat = new Float32Array(list.length * width);
      list.forEach((v, i) => flat.set(v.slice(0, width), i * width));
      return flat;
    };
    const rotations = vectors(4);
    const positions = vectors(3);
    const scales = vectors(3);
    const morphs = Float32Array.from(s.array((x) => x.f32()));
    // ⚠️ **Two more bytes, zero on every file the game has.** cwlib stops here
    // with "TODO: Locators when revision > 0x311"; all five of the game's
    // animations below 0x378 (0x34c) end in `00 00`, which an empty locator
    // array and a byte, or a 16-bit `loopStart` as the newer layout has, would
    // both write. Taken as zeros and refused otherwise, so a file that holds
    // something here is not read as if it did not.
    if (version > 0x311 && s.u16() !== 0) {
      throw new SerializerError('an animation below 0x378 with something after its morphs: unmeasured');
    }
    out = {
      revision, bones, numFrames, fps, loopStart: 0, morphCount, rotBonesAnimated, posBonesAnimated,
      scaleBonesAnimated, morphsAnimated, rotations, positions, scales, morphs,
      posOffset: [0, 0, 0, 1], posScale: [1, 1, 1, 1], fat: 0, locators: [],
    };
  } else {
    const numFrames = s.i16();
    const fps = s.i16();
    const loopStart = s.i16();
    const morphCount = s.i8();
    const boneCount = s.u8();
    const rot = s.u8();
    const pos = s.u8();
    const scale = s.u8();
    const morph = s.u8();
    const locatorKeys = s.u16();
    let posOffset: Animation['posOffset'] = [0, 0, 0, 1];
    let posScale: Animation['posScale'] = [1, 1, 1, 1];
    let fat = 0;
    if (version > 0x38b) {
      posOffset = s.vector4();
      posScale = s.vector4();
      if (version > 0x3b1) fat = s.i8();
    }
    const block = s.bytes(s.count());
    const locators = s.array(readLocator);
    const packed = unpack(block, { boneCount, rot, pos, scale, morph, locatorKeys, numFrames, morphCount, fat: fat !== 0 });
    out = { revision, numFrames, fps, loopStart, morphCount, posOffset, posScale, fat, locators, ...packed };
  }

  if (s.remaining !== 0) {
    throw new SerializerError(`ANMb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return out;
}

/**
 * The IEEE 754 half float nearest a number, ties to even: `halfToFloat`'s
 * inverse, exact on every value that came out of it but NaN, whose payload a
 * number does not carry (written as the quiet NaN `0x7e00`).
 */
export function floatToHalf(value: number): number {
  SCRATCH.setFloat32(0, value, false);
  const bits = SCRATCH.getUint32(0, false);
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  const e = exponent - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mantissa |= 0x800000;
    const shift = 14 - e;
    let half = mantissa >>> shift;
    const rest = mantissa & ((1 << shift) - 1);
    const middle = 1 << (shift - 1);
    if (rest > middle || (rest === middle && (half & 1) !== 0)) half += 1;
    return sign | half;
  }
  let half = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1) !== 0)) half += 1;
  return sign | half;
}

/** Big-endian bytes into a buffer that grows: the packed block. */
class BlockWriter {
  private buffer = new Uint8Array(0x1000);
  private view = new DataView(this.buffer.buffer);
  length = 0;

  private need(n: number): number {
    if (this.length + n > this.buffer.length) {
      let size = this.buffer.length * 2;
      while (size < this.length + n) size *= 2;
      const grown = new Uint8Array(size);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
      this.view = new DataView(grown.buffer);
    }
    const at = this.length;
    this.length += n;
    return at;
  }

  u8(v: number): void { const at = this.need(1); this.buffer[at] = v & 0xff; }
  u16(v: number): void { const at = this.need(2); this.view.setUint16(at, v & 0xffff, false); }
  i32(v: number): void { const at = this.need(4); this.view.setInt32(at, v | 0, false); }
  u32(v: number): void { const at = this.need(4); this.view.setUint32(at, v >>> 0, false); }
  f32(v: number): void { const at = this.need(4); this.view.setFloat32(at, v, false); }
  bytes(v: Uint8Array): void { const at = this.need(v.length); this.buffer.set(v, at); }
  done(): Uint8Array { return this.buffer.slice(0, this.length); }
}

const isNegative = (w: number): boolean => w < 0 || Object.is(w, -0);
const component = (v: number): number => Math.max(-0x8000, Math.min(0x7fff, Math.round(v * 0x7fff)));

/** `unpack`'s inverse: the block of a version `0x378` and later animation, from its values. */
function pack(a: Animation): Uint8Array {
  const b = new BlockWriter();
  const fat = a.fat !== 0;
  for (const bone of a.bones) {
    b.i32(bone.animHash);
    b.u8(bone.parent);
    b.u8(bone.firstChild);
    b.u8(bone.nextSibling);
    b.u8(0);
  }
  b.bytes(a.locatorKeyData ?? new Uint8Array(0));
  b.bytes(a.rotBonesAnimated);
  b.bytes(a.posBonesAnimated);
  b.bytes(a.scaleBonesAnimated);
  b.bytes(a.morphsAnimated);
  if (b.length % 2 !== 0) b.u8(0);
  const r = a.rotations;
  for (let i = 0; i < r.length; i += 4) {
    const sign = isNegative(r[i + 3]) ? 1 : 0;
    if (fat) {
      SCRATCH.setFloat32(0, r[i], false);
      b.u32((SCRATCH.getUint32(0, false) & ~1) | sign);
      b.f32(r[i + 1]);
      b.f32(r[i + 2]);
    } else {
      b.u16((component(r[i]) & ~1) | sign);
      b.u16(component(r[i + 1]));
      b.u16(component(r[i + 2]));
    }
  }
  for (const values of [a.positions, a.scales, a.morphs]) {
    for (const v of values) {
      if (fat) b.f32(v);
      else b.u16(floatToHalf(v));
    }
  }
  const end = Math.ceil(b.length / 16) * 16 + (a.extraPadding ?? 0);
  while (b.length < end) b.u8(0);
  return b.done();
}

/**
 * `readAnimation`'s inverse: the payload (`loadResource(bytes).data`) from the
 * value. Rotations are written back from their three stored components and
 * w's sign, half floats by `floatToHalf` -- both exact on values the reader
 * made; a rotation replaced by one off the 15-bit grid is rounded onto it.
 */
export function encodeAnimation(value: Animation, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const a = value;
  if (header.revision.version < 0x378) {
    w.i32(a.bones.length);
    for (const bone of a.bones) {
      w.i32(bone.animHash);
      w.s32(bone.parent);
      w.s32(bone.firstChild);
      w.s32(bone.nextSibling);
    }
    w.i32(a.numFrames);
    w.i32(a.fps);
    w.i32(a.morphCount);
    for (const list of [a.rotBonesAnimated, a.posBonesAnimated, a.scaleBonesAnimated, a.morphsAnimated]) {
      w.i32(list.length);
      for (const v of list) w.i16(v);
    }
    // ✔ The w the reader drops from positions and scales is 1.0 in every one
    // of the game's five animations below 0x378 (`dev/resource-census-write.ts`).
    const vectors = (flat: Float32Array, width: 3 | 4): void => {
      w.i32(flat.length / width);
      for (let i = 0; i < flat.length; i += width) {
        w.vector4([flat[i], flat[i + 1], flat[i + 2], width === 4 ? flat[i + 3] : 1]);
      }
    };
    vectors(a.rotations, 4);
    vectors(a.positions, 3);
    vectors(a.scales, 3);
    w.i32(a.morphs.length);
    for (const v of a.morphs) w.f32(v);
    if (header.revision.version > 0x311) w.u16(0);
    return w.done();
  }
  const keys = a.locatorKeyData?.length ?? 0;
  if (keys % 4 !== 0) throw new SerializerError(`${keys} bytes of locator keys, not a multiple of 4`);
  w.i16(a.numFrames);
  w.i16(a.fps);
  w.i16(a.loopStart);
  w.i8(a.morphCount);
  w.u8(a.bones.length);
  w.u8(a.rotBonesAnimated.length);
  w.u8(a.posBonesAnimated.length);
  w.u8(a.scaleBonesAnimated.length);
  w.u8(a.morphsAnimated.length);
  w.u16(keys / 4);
  if (header.revision.version > 0x38b) {
    w.vector4(a.posOffset);
    w.vector4(a.posScale);
    if (header.revision.version > 0x3b1) w.i8(a.fat);
  }
  const block = pack(a);
  w.i32(block.length);
  w.bytes(block);
  w.i32(a.locators.length);
  for (const l of a.locators) {
    w.vector3(l.position);
    w.str(l.name);
    w.i8(l.looping);
    w.i8(l.type);
  }
  return w.done();
}
