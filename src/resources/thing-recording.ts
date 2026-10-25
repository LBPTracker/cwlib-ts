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
 * version >= 0x3d4   u8 data[]          packed, decoded by v0x921b40 -- not here
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
   * From version 0x3d4: the frames packed, as the game stores them. ⚠️ Not
   * decoded: it opens with a `u32` and three `f32`, which read as a frame count
   * and a starting position like the layout before it.
   */
  readonly packed?: Uint8Array;
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
    recording = { revision, packed: s.bytes(s.i32()) };
  }
  if (s.remaining !== 0) throw new SerializerError(`RECb read ended ${s.remaining} bytes before the end of its payload`);
  return recording;
}
