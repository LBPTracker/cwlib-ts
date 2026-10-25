/**
 * `THING_RECORDING` -- a Thing's recorded path: magic `RECb`, FileDB paths
 * `….rec`, the LBP2 Move DLC's cutscenes (`move_cutscene_intro_recording_01.rec`).
 *
 * ❗ cwlib has the type and no class. **Read as the game's loader reads it,
 * `v0xc79610` in `eboot-v128.bin`** (found by its version compares, all inside
 * the recordings' `0x3bd`--`0x3d9`), which has three layouts:
 *
 * ```
 * version <= 0x3c3   matrix[]                       (v0xc924a0)
 * 0x3c4 .. 0x3d3     { f32 x, y, z }[]  positions   (v0xc92340, raw floats)
 *                    u8[]               flags       (v0xc921c0)
 *                    f32[]              angles      (v0xc91ff0)
 * version >= 0x3d4   u8 data[]          the same three, packed (v0xb03b50), and
 *                                       decoded by v0x921b40: `decodePackedFrames`
 * ```
 *
 * All 91 of the game's end on their payload's last byte (steering/level-files.md,
 * *Thing recordings*).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo } from '../io/serializer.ts';

export interface ThingRecording {
  readonly revision: RevisionInfo;
  /** Below version 0x3c4: a transform per frame, column-major like `PPos`. */
  readonly matrices?: readonly Float32Array[];
  /**
   * 0x3c4--0x3d3: per frame, the position, a flag byte and an angle -- one of
   * each, the three arrays as long in all 54. ✔ The positions are world units
   * whose z is a layer's depth (-100, -200, -300), the angles lie in [-pi, pi],
   * and the flag is 0 or 16; what the flag means is not known.
   */
  readonly positions?: readonly (readonly [number, number, number])[];
  readonly flags?: Uint8Array;
  readonly angles?: Float32Array;
  /**
   * From version 0x3d4: the frames as the game stores them, packed. They are
   * decoded into `positions`, `flags` and `angles` as well.
   */
  readonly packed?: Uint8Array;
}

/**
 * The game's quantisers, `v0xadfe20` and `v0xadfe50`, with their bit count
 * `v0xadfde0`: `step` is half the resolution, so a value is `min + 2 * step * q`
 * and `q` takes the fewest bits that hold `(max - min) / (2 * step) + 1` values.
 */
function quantBits(min: number, max: number, step: number): number {
  const values = Math.trunc((max - min) / (2 * step)) + 1;
  let bits = 1;
  while (bits <= 32 && 2 ** bits < values) bits += 1;
  return bits;
}

const dequantise = (q: number, min: number, step: number): number => Math.fround(Math.fround(q * step) * 2 + min);

/** Positions move by up to 1000 units a frame in x and y, at a resolution of 2; z never moves. */
const POSITION = { min: -1000, max: 1000, step: 1 };

/** Angles move by up to 10 radians a frame, at a resolution of 0.00125. */
const ANGLE = { min: -10, max: 10, step: Math.fround(0.000625) };

/**
 * `v0x921b40`, the packed frames' decoder (its read half: the same function
 * writes). Bits are taken lowest first from each byte; a 32-bit value's first
 * eight bits are its top byte, so on a byte boundary it reads as big-endian.
 *
 * ```
 * u32 frames
 * f32 x, y, z                     the first position
 * per later frame  q dx, q dy     10 bits each, POSITION; z keeps the first's
 * f32 angle                       the first
 * per later frame  q dangle       14 bits, ANGLE
 * bit any flags                   if not, every flag is 0
 *   u8 flag                       the first
 *   per later frame  bit changed, then u8 added to the flag before (mod 256)
 * ```
 *
 * ✔ All 36 of the game's packed recordings use their bits to within the last
 * byte's padding (steering/level-files.md, *Thing recordings*).
 */
export function decodePackedFrames(data: Uint8Array): Pick<ThingRecording, 'positions' | 'flags' | 'angles'> {
  let at = 0;
  const bit = (): number => {
    if (at >= data.length * 8) throw new SerializerError('a packed recording runs past its end');
    const value = (data[at >> 3] >> (at & 7)) & 1;
    at += 1;
    return value;
  };
  const bits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) value += bit() * 2 ** i;
    return value;
  };
  const word = (): number => {
    const bytes = [0, 0, 0, 0];
    for (let i = 0; i < 32; i += 1) bytes[3 - (i >> 3)] |= bit() << (i & 7);
    return ((bytes[3] << 24) | (bytes[2] << 16) | (bytes[1] << 8) | bytes[0]) >>> 0;
  };
  const view = new DataView(new ArrayBuffer(4));
  const float = (): number => {
    view.setUint32(0, word());
    return view.getFloat32(0);
  };

  const frames = word();
  const positions: [number, number, number][] = [];
  const angles = new Float32Array(frames);
  const flags = new Uint8Array(frames);
  if (frames === 0) return { positions, flags, angles };
  positions.push([float(), float(), float()]);
  const positionBits = quantBits(POSITION.min, POSITION.max, POSITION.step);
  for (let i = 1; i < frames; i += 1) {
    const dx = dequantise(bits(positionBits), POSITION.min, POSITION.step);
    const dy = dequantise(bits(positionBits), POSITION.min, POSITION.step);
    const [x, y, z] = positions[i - 1];
    positions.push([Math.fround(x + dx), Math.fround(y + dy), z]);
  }
  angles[0] = float();
  const angleBits = quantBits(ANGLE.min, ANGLE.max, ANGLE.step);
  for (let i = 1; i < frames; i += 1) angles[i] = angles[i - 1] + dequantise(bits(angleBits), ANGLE.min, ANGLE.step);
  if (bit()) {
    flags[0] = bits(8);
    for (let i = 1; i < frames; i += 1) flags[i] = bit() ? (flags[i - 1] + bits(8)) & 0xff : flags[i - 1];
  }
  if (data.length * 8 - at >= 8) {
    throw new SerializerError(`a packed recording left ${data.length * 8 - at} bits unread`);
  }
  return { positions, flags, angles };
}

/** Read a `RECb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readThingRecording(bytes: Uint8Array, inflate: Inflate): Promise<ThingRecording> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'RECb') throw new SerializerError(`not a Thing recording: "${resource.magic}"`);
  const { version } = revision;
  let recording: ThingRecording;
  if (version <= 0x3c3) {
    recording = { revision, matrices: s.array((self) => self.matrix()) };
  } else if (version <= 0x3d3) {
    // Fixed-width floats even in a compressed stream: the loader reads them raw.
    const positions = s.array((self): [number, number, number] => [self.f32(), self.f32(), self.f32()]);
    const flags = Uint8Array.from(s.array((self) => self.u8()));
    const angles = Float32Array.from(s.array((self) => self.f32()));
    recording = { revision, positions, flags, angles };
  } else {
    const packed = s.bytes(s.i32());
    recording = { revision, packed, ...decodePackedFrames(packed) };
  }
  if (s.remaining !== 0) throw new SerializerError(`RECb read ended ${s.remaining} bytes before the end of its payload`);
  return recording;
}
