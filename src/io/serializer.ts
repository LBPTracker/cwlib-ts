/**
 * The LBP serialiser's primitives, read side only.
 *
 * Everything inside a resource's decompressed payload goes through these. They
 * are not a generic binary reader: **two things outside the field itself decide
 * how a field is encoded**, and both have to be threaded through every struct.
 *
 * - **The revision.** Fields are gated on it, and reading a gated field that is
 *   not present desynchronises the whole stream after it, silently.
 * - **The compression flags**, a byte in the resource header. With
 *   `COMPRESSED_INTEGERS` set, every 32- and 64-bit integer is a LEB128 varint
 *   rather than four or eight bytes; signed ones are zigzagged. Reading one as
 *   fixed-width when it is a varint desynchronises just as badly.
 *
 * ## Scope: LBP3 only, and the bound is now measured
 *
 * ⚠️ **This used to say the older branches had been stripped in the port. They
 * were not.** the part readers (`src/things/parts/`) carry **238 distinct version gates spanning
 * `0x137`–`0x3f0`** and 163 subVersion gates — cwlib's own, ported with the
 * branches intact. What the bound below protects is therefore not a reader that
 * only knows LBP3; it is a reader whose *older* branches have never been run
 * against an older file.
 *
 * ❗ **And that protection is measured, 2026-09-05, over 103 archive levels**
 * sampled from `dry.db` across all three games:
 *
 * | version | parse |
 * |---|---|
 * | `0x3b7` | **4 of 4** |
 * | `0x3b8`–`0x3f9` | **78 of 78** |
 * | `0x272` (LEERDAMMER, branch `4c44`) | **2 of 19** |
 *
 * So the wall is real and it is at LBP1, not at `0x3b8`. `0x3b8` was where the
 * ten-level corpus happened to start. **cwlib has exactly one gate at `0x3b8`
 * in its whole tree** — `PPhysicsTweak`'s `version > 0x3b8 && configuration ==
 * 0xd` — and `readPhysicsTweak` has it, so a `0x3b7` file takes the older branch
 * because the branch is there.
 *
 * The bound stays an assertion for the reason it always was: `requireLbp3`
 * refuses anything outside it rather than reading an older layout with newer
 * rules and producing plausible nonsense. What the 5-of-19 says is that at
 * `0x272` it would do exactly that: every one of the fourteen failures is the
 * stream diverging outright — negative string lengths, reads past the end — and
 * none of them is a part this reader is merely missing.
 */

/**
 * Bytes as a string, one character per byte: the format's ASCII, and the
 * four-character tags inside a payload. `untilNul` stops at the first zero,
 * for the fixed-width fields padded with NULs.
 *
 * ⚠️ **In slices, not `String.fromCharCode(...bytes)`.** Spreading passes
 * every byte as an argument, and a length read out of the file is enough to
 * exhaust the stack with a `RangeError` instead of a `SerializerError`.
 */
export function latin1(bytes: Uint8Array, untilNul = false): string {
  let end = untilNul ? bytes.indexOf(0) : -1;
  if (end < 0) end = bytes.length;
  let out = '';
  for (let at = 0; at < end; at += 0x2000) {
    out += String.fromCharCode.apply(null, bytes.subarray(at, Math.min(end, at + 0x2000)) as unknown as number[]);
  }
  return out;
}

export const COMPRESSED_INTEGERS = 1;
export const COMPRESSED_VECTORS = 2;
export const COMPRESSED_MATRICES = 4;

/**
 * The version range this reader implements.
 *
 * ❗ **`0x3b7`, not `0x3b8`, and the difference is 4 archive levels of 103.**
 * See the header: the bound was the ten-level corpus's own floor, and the one
 * field cwlib changes at `0x3b8` is implemented, so the revision below it reads
 * on the older branch as it should. Going further down is a different question
 * and the measurement says no.
 */
export const LBP3_MIN_VERSION = 0x3b7;
export const LBP3_MAX_VERSION = 0x3ff;

export class SerializerError extends Error {}

/**
 * A resource revision.
 *
 * ⚠️ The high half of the head word is the **subVersion**, not a branch id.
 * Steering and `Revision` in `stream.ts` called it a branch for a long time;
 * the branch is a separate `(id, revision)` pair later in the header. LBP3
 * fields gate on `subVersion` as often as on `version`, so the distinction is
 * not cosmetic.
 */
export interface RevisionInfo {
  /** Low half of the head word. */
  readonly version: number;
  /** High half of the head word. */
  readonly subVersion: number;
  readonly branchId: number;
  readonly branchRevision: number;
}

/** cwlib's `Branch.DOUBLE11`: the Vita's branch id. */
export const DOUBLE11 = 0x4431;

/**
 * The Vita branch's revision, or -1 off it: cwlib's `Revision.isVita()`, which
 * is the branch id **and** a head from `0x3c1` to `0x3e2`, so a `has(DOUBLE11, n)`
 * gate there is `vitaRevision(r) >= n`. The game's crossplay levels are on it
 * at `0x3e2`, branch revisions `0x54`--`0x87`.
 */
export function vitaRevision(r: RevisionInfo): number {
  return r.branchId === DOUBLE11 && r.version >= 0x3c1 && r.version <= 0x3e2 ? r.branchRevision : -1;
}

export function requireLbp3(revision: RevisionInfo): void {
  if (revision.version < LBP3_MIN_VERSION || revision.version > LBP3_MAX_VERSION) {
    throw new SerializerError(
      `revision 0x${revision.version.toString(16)} is outside the LBP3 range this ` +
        `reader implements (0x${LBP3_MIN_VERSION.toString(16)}..` +
        `0x${LBP3_MAX_VERSION.toString(16)}); older layouts differ field by field`,
    );
  }
}

/** A reference to another resource: a GUID, a hash, or nothing. */
export interface ResourceRef {
  readonly guid: number;
  /** 20 bytes, or undefined. A hash means the resource ships inside the level. */
  readonly hash?: Uint8Array;
}

/**
 * Reads one decompressed payload.
 *
 * Object references are ids that expand inline the first time they appear, so
 * the reader has to remember what it has already built — `referenced` is that
 * table, and it is per-stream rather than per-call.
 */
export class Serializer {
  readonly data: Uint8Array;
  readonly view: DataView;
  readonly revision: RevisionInfo;
  readonly compressionFlags: number;
  position = 0;
  /** Reference id → the object built for it. */
  readonly referenced = new Map<number, unknown>();
  /**
   * Pointer id → the object at it, for the one structure that uses pointers
   * rather than references.
   *
   * ⚠️ `ScriptInstance`'s field layout is shared this way: the id is a raw `i32`
   * with no inline expansion rule, and a repeat means "the layout you already
   * have". It is a separate table from `referenced` because the id spaces are
   * separate.
   */
  readonly pointers = new Map<number, unknown>();

  constructor(data: Uint8Array, revision: RevisionInfo, compressionFlags: number) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.revision = revision;
    this.compressionFlags = compressionFlags;
  }

  get compressedIntegers(): boolean {
    return (this.compressionFlags & COMPRESSED_INTEGERS) !== 0;
  }

  get remaining(): number {
    return this.data.length - this.position;
  }

  private need(n: number): number {
    // ⚠️ `n` is often a length read out of the file, and a negative one passed
    // the check below and moved the cursor BACKWARDS -- a misread that then
    // failed somewhere else entirely instead of here.
    if (!Number.isInteger(n) || n < 0) {
      throw new SerializerError(`read of ${n} bytes at 0x${this.position.toString(16)}`);
    }
    if (this.position + n > this.data.length) {
      throw new SerializerError(
        `read of ${n} at 0x${this.position.toString(16)} runs past the end ` +
          `(${this.data.length} bytes)`,
      );
    }
    const at = this.position;
    this.position += n;
    return at;
  }

  bytes(n: number): Uint8Array {
    return this.data.subarray(this.need(n), this.position);
  }

  u8(): number {
    return this.data[this.need(1)];
  }

  i8(): number {
    return (this.u8() << 24) >> 24;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    return this.view.getUint16(this.need(2), false);
  }

  i16(): number {
    return this.view.getInt16(this.need(2), false);
  }

  f32(): number {
    return this.view.getFloat32(this.need(4), false);
  }

  /** LEB128, least-significant group first. Bounded so a runaway cannot spin. */
  uleb128(): number {
    let result = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
    }
    throw new SerializerError('LEB128 value longer than 64 bits');
  }

  /** A 32-bit integer, varint when the flags say so. `force` overrides. */
  i32(force = false): number {
    if (force || !this.compressedIntegers) {
      return this.view.getInt32(this.need(4), false);
    }
    return this.uleb128() | 0;
  }

  u32(force = false): number {
    if (force || !this.compressedIntegers) {
      return this.view.getUint32(this.need(4), false);
    }
    return this.uleb128();
  }

  /**
   * A **zigzagged** 32-bit integer.
   *
   * ⚠️ `s32` and `i32` are different encodings of the same width, and the
   * struct decides which. Reading one as the other gives a wrong number that
   * still consumes plausible bytes, so it desynchronises a few fields later
   * rather than here.
   */
  s32(): number {
    if (!this.compressedIntegers) return this.i32(true);
    const v = this.uleb128() | 0;
    return (v >>> 1) ^ -(v & 1);
  }

  u64(force = false): number {
    if (force || !this.compressedIntegers) {
      const at = this.need(8);
      return Number(this.view.getBigUint64(at, false));
    }
    return this.uleb128();
  }

  /**
   * The same value as `u64`, but **exact above 2^53**.
   *
   * ❗ **`u64` returns a `number` and a `number` cannot hold 64 bits.** A double
   * has 53 bits of mantissa, so `0x20000008040039` -- a real Thing's part mask,
   * bit 53 set alongside bits 0, 3, 4, 5, 18 and 27 -- comes back as
   * `0x20000008040038` and **bit 0 is silently gone**. That Thing lost its
   * `BODY`, the walk read five parts where there were six, and the level failed
   * 560 bytes later at the next Thing's marker. Measured on `69318581` from the
   * public archive, Thing 14249 at byte 10563.
   *
   * ⚠️ Converting after the fact does not help: `BigInt(s.u64())` widens a value
   * that has already been rounded. The bits have to survive the accumulation,
   * which is what this does and `uleb128` cannot.
   */
  u64Big(force = false): bigint {
    if (force || !this.compressedIntegers) {
      const at = this.need(8);
      return this.view.getBigUint64(at, false);
    }
    let result = 0n;
    for (let shift = 0n; shift < 64n; shift += 7n) {
      const byte = this.u8();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
    }
    throw new SerializerError('LEB128 value longer than 64 bits');
  }

  /**
   * A **signed** 64-bit integer, exact: zigzagged when the flags compress
   * integers, as `s32` is, and two's complement in eight bytes when they do not
   * (cwlib's `MemoryInputStream.s64`). A `Pack`'s timestamp is one.
   */
  s64Big(): bigint {
    if (!this.compressedIntegers) return BigInt.asIntN(64, this.u64Big(true));
    const raw = this.u64Big();
    return (raw >> 1n) ^ -(raw & 1n);
  }

  /** Length-prefixed ASCII. The length is an `s32`, so it is a varint too. */
  str(): string {
    const length = this.s32();
    if (length < 0) throw new SerializerError(`negative string length ${length}`);
    return latin1(this.bytes(length));
  }

  /**
   * Length-prefixed UTF-16, **big-endian**, and the length counts characters
   * rather than bytes.
   */
  wstr(): string {
    const length = this.s32();
    if (length < 0) throw new SerializerError(`negative wstring length ${length}`);
    const raw = this.bytes(length * 2);
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += String.fromCharCode((raw[i * 2] << 8) | raw[i * 2 + 1]);
    }
    return out;
  }

  guid(): number {
    return this.u32();
  }

  sha1(): Uint8Array {
    return this.bytes(20);
  }

  /**
   * A resource reference.
   *
   * `isDescriptor` suppresses the leading flags word; the callers that need it
   * are the ones serialising a descriptor rather than a live reference. The
   * flag byte is `0` for none, `1` for a hash and `2` for a GUID — and **the two
   * swap below version `0x191`** (cwlib's `Serializer.resource`), which the
   * game's 44 bevels at `0x132`--`0x188` need: read the other way, their four
   * material slots come out as a GUID and three garbage hashes.
   */
  resource(isDescriptor = false, includeType = false): ResourceRef | undefined {
    if (this.revision.version > 0x22e && !isDescriptor) this.i32();
    const flag = this.u8();
    // ✔ **A null descriptor still carries its type when the type is inline.**
    // `ChunkFile.userResources` is the one place `includeType` is set; over the
    // 117 LBP3 worlds in the install it holds 1,393 non-null descriptors and one
    // null -- Manglewood hub's container, where the flag 0 is followed by the
    // type 7, and skipping it cost one byte, read the next chunk entry as a null
    // and left every one of the level's 1,157 chunks unplaced (lbprender's
    // `dev/storyrun.ts`, 2026-10-22). An earlier comment here said the opposite,
    // unmeasured.
    if (flag === 0) {
      if (includeType) this.i32(); // the resource type, written inline
      return undefined;
    }
    let guid = 0;
    let hash: Uint8Array | undefined;
    const [GUID, HASH] = this.revision.version < 0x191 ? [1, 2] : [2, 1];
    if ((flag & GUID) !== 0) guid = this.guid();
    if ((flag & HASH) !== 0) hash = this.sha1();
    if (includeType) this.i32(); // the resource type, written inline
    return guid === 0 && !hash ? undefined : { guid, hash };
  }

  /**
   * A reference to another object in the same stream.
   *
   * The wire format is an id: `0` is null, an unseen id means the object
   * follows **inline right here**, and a seen one is a back-reference to
   * something already built. That is why nothing in this format can be
   * skipped — the bytes for an object live at its first mention, wherever
   * that happens to be.
   */
  reference<T>(build: (self: Serializer) => T): T | undefined {
    const id = this.i32();
    if (id === 0) return undefined;
    if (this.referenced.has(id)) return this.referenced.get(id) as T;
    // The entry has to exist before `build` runs: an object that refers back to
    // itself, directly or through a child, would otherwise recurse forever.
    const placeholder = {} as T;
    this.referenced.set(id, placeholder);
    const value = build(this);
    this.referenced.set(id, value);
    return value;
  }

  /**
   * A reference whose object exists **before** its body is read.
   *
   * ⚠️ `reference` registers a bare `{}` while `build` runs, so anything that
   * refers back to the object under construction — a Thing's `parent`, a
   * creature's `head` — receives that empty placeholder and not the real thing.
   * For Things that is not acceptable: a level is full of cycles, and a consumer
   * walking `thing.parts` on one of those placeholders gets `undefined`.
   *
   * `create` makes the shell, which is registered immediately; `fill` populates
   * it. Callers that do not care can keep using `reference`.
   */
  referenceInto<T>(create: () => T, fill: (self: Serializer, value: T) => void): T | undefined {
    const id = this.i32();
    if (id === 0) return undefined;
    const seen = this.referenced.get(id);
    if (seen !== undefined) return seen as T;
    const value = create();
    this.referenced.set(id, value);
    fill(this, value);
    return value;
  }

  /**
   * An element count: an `i32`, varint when compressed, refused when negative.
   * A negative count would otherwise loop zero times and misparse silently.
   */
  count(): number {
    const count = this.i32();
    if (count < 0) throw new SerializerError(`negative count ${count} at 0x${this.position.toString(16)}`);
    return count;
  }

  /** A length-prefixed array. The count is an `i32`, varint when compressed. */
  array<T>(read: (self: Serializer) => T): T[] {
    const count = this.i32();
    if (count < 0) throw new SerializerError(`negative array length ${count}`);
    const out: T[] = [];
    for (let i = 0; i < count; i += 1) out.push(read(this));
    return out;
  }

  /** An array of references, which is what most Thing lists are. */
  references<T>(build: (self: Serializer) => T): (T | undefined)[] {
    const count = this.i32();
    if (count < 0) throw new SerializerError(`negative array length ${count}`);
    const out: (T | undefined)[] = [];
    for (let i = 0; i < count; i += 1) out.push(this.reference(build));
    return out;
  }

  /**
   * A **byte-plane transposed** integer vector.
   *
   * ⚠️ Not an array of integers, and mistaking it for one is a silent
   * desynchronisation: with `COMPRESSED_VECTORS` set the wire format is a count,
   * then a *byte width*, then `width * count` bytes written plane by plane --
   * every value's byte 0, then every value's byte 1, and so on. A width of 0
   * means every value is zero and no bytes follow.
   *
   * Without the flag it degrades to a plain `i32` array. `PShape`'s polygon
   * `loops` is the one this project met first; reading it as an array put the
   * walk hundreds of bytes into a vertex list and the Thing marker caught it.
   */
  intVector(): number[] {
    if ((this.compressionFlags & COMPRESSED_VECTORS) === 0) {
      return this.array((self) => self.i32());
    }
    const count = this.i32();
    if (count < 0) throw new SerializerError(`negative vector length ${count}`);
    if (count === 0) return [];
    const width = this.u8();
    const out = new Array<number>(count).fill(0);
    for (let plane = 0; plane < width; plane += 1) {
      for (let i = 0; i < count; i += 1) out[i] |= this.u8() << (plane * 8);
    }
    return out;
  }

  /**
   * `intVector` for 64-bit values, exact: the same byte planes, up to eight,
   * and without `COMPRESSED_VECTORS` a plain array of `u64`s (cwlib's
   * `Serializer.longvector`). A script's integer constants are one.
   */
  longVector(): bigint[] {
    if ((this.compressionFlags & COMPRESSED_VECTORS) === 0) {
      return this.array((self) => self.u64Big());
    }
    const count = this.count();
    if (count === 0) return [];
    const width = this.u8();
    if (width > 8) throw new SerializerError(`a 64-bit vector ${width} bytes wide`);
    const out = new Array<bigint>(count).fill(0n);
    for (let plane = 0; plane < width; plane += 1) {
      for (let i = 0; i < count; i += 1) out[i]! |= BigInt(this.u8()) << BigInt(plane * 8);
    }
    return out;
  }

  /** Step over `n` bytes nothing keeps. */
  skip(n: number): void {
    this.need(n);
  }

  /** A `vector3()` nothing keeps: twelve bytes, `f32` being fixed-width. */
  skipVector3(): void {
    this.need(12);
  }

  /** A `vector4()` nothing keeps: sixteen bytes. */
  skipVector4(): void {
    this.need(16);
  }

  /** A `matrix()` nothing keeps: its mask when compressed, then four bytes per component it names. */
  skipMatrix(): void {
    let mask = 0xffff;
    if ((this.compressionFlags & COMPRESSED_MATRICES) !== 0) mask = this.u16();
    let present = 0;
    for (let m = mask; m !== 0; m &= m - 1) present += 1;
    this.need(present * 4);
  }

  vector3(): [number, number, number] {
    return [this.f32(), this.f32(), this.f32()];
  }

  vector4(): [number, number, number, number] {
    return [this.f32(), this.f32(), this.f32(), this.f32()];
  }

  /**
   * A 4x4 matrix.
   *
   * With `COMPRESSED_MATRICES` a `u16` says which of the sixteen components are
   * present; the rest come from the identity. Without it, all sixteen are
   * written.
   */
  matrix(): Float32Array {
    // One allocation: a `Float32Array` of a literal built the array twice.
    const out = new Float32Array(16);
    out[0] = out[5] = out[10] = out[15] = 1;
    let mask = 0xffff;
    if ((this.compressionFlags & COMPRESSED_MATRICES) !== 0) mask = this.u16();
    for (let i = 0; i < 16; i += 1) {
      if ((mask & (1 << i)) !== 0) out[i] = this.f32();
    }
    return out;
  }
}
