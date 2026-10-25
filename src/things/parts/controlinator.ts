/** `CONTROLINATOR`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { hasPlayerMode } from './common.ts';

/** `PControlinator`: the controller seat. */
/** `PControlinator`, kept: a controlinator's colour, reach and the switch it drives. */
export interface ControlinatorPart {
  readonly colorIndex: number;
  readonly radius: number;
  readonly sideMode: boolean;
  readonly padSwitch?: Thing;
  readonly attachedPlayer: Thing | undefined;
  readonly lastAttachedPlayer: Thing | undefined;
  readonly prompt: Thing | undefined;
  readonly promptPlayer: Thing | undefined;
  readonly remoteControlState: number;
  readonly disablePoppetControls: boolean;
  readonly autoDock: boolean;
  readonly overrideSackbot: boolean;
  readonly parentBoneIndex?: number;
  readonly parentBoneOffset?: Float32Array;
  readonly killRiderOnCreatureDeath?: boolean;
  readonly tiltMax?: number;
  readonly tiltMin?: number;
  readonly remotePlayer?: number;
  readonly playAudio?: boolean;
  readonly playerMode?: number;
  readonly layerRange?: number;
}

export function readControlinator(s: Serializer, readers: ReadonlyMap<string, PartReader>): ControlinatorPart {
  const { version, subVersion } = s.revision;
  let killRiderOnCreatureDeath: boolean | undefined;
  let tiltMax: number | undefined;
  let tiltMin: number | undefined;
  let remotePlayer: number | undefined;
  let playAudio: boolean | undefined;
  let playerMode: number | undefined;
  let layerRange: number | undefined;
  let parentBoneIndex: number | undefined;
  let parentBoneOffset: Float32Array | undefined;
  const thing = () => readThingRef(s, readers);
  const attachedPlayer = thing();
  const lastAttachedPlayer = thing();
  const prompt = thing();
  const promptPlayer = thing();
  const colorIndex = s.i32();
  const radius = s.f32();
  const sideMode = s.bool();
  const remoteControlState = s.i32();
  const disablePoppetControls = s.bool();
  const autoDock = s.bool();
  const overrideSackbot = s.bool();
  if (subVersion > 0x6e) killRiderOnCreatureDeath = s.bool();
  const padSwitch = thing();
  const vita = vitaRevision(s.revision);
  if (vita >= 0xd) tiltMax = s.f32();
  if (vita >= 0xe) tiltMin = s.f32();
  if (vita >= 0x1d) remotePlayer = s.i32();
  if (vita >= 0x51) playAudio = s.bool();
  if (subVersion > 0x4b) {
    // ⚠️ **One byte, not an `i32`, and the difference only shows in an
    // uncompressed stream.** With `COMPRESSED_INTEGERS` an `i32` of 0 is a
    // single varint byte, so `s.i32()` read this correctly on the whole corpus
    // -- every file in it is `cf7`. In a `cf0` chunk out of the public archive
    // the same call ate four bytes and put the reader three past the next
    // Thing's marker. Measured on chunk `9712345a…` island 48: the field is the
    // `00` at 65640 and `parentBoneOffset` begins at 65641 with `3f 80 00 00`,
    // an identity matrix whose four 1.0s land exactly on m00, m05, m10 and m15.
    // See question 36 in steering/answered-questions.md.
    parentBoneIndex = s.u8();
    parentBoneOffset = s.matrix();
  }
  if (hasPlayerMode(version)) playerMode = s.u8();
  if (subVersion > 0x189) layerRange = s.u8();
  return {
    colorIndex, radius, sideMode, padSwitch, attachedPlayer, lastAttachedPlayer, prompt,
    promptPlayer, remoteControlState, disablePoppetControls, autoDock, overrideSackbot,
    parentBoneIndex, parentBoneOffset, killRiderOnCreatureDeath, tiltMax, tiltMin, remotePlayer,
    playAudio, playerMode, layerRange,
  };
}
