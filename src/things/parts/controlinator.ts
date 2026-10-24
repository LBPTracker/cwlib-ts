/** `CONTROLINATOR`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `PControlinator`: the controller seat. */
export function readControlinator(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  const thing = () => readThingRef(s, readers);
  thing(); // attachedPlayer
  thing(); // lastAttachedPlayer
  thing(); // prompt
  thing(); // promptPlayer
  s.i32(); // colorIndex
  s.f32(); // radius
  s.bool(); // sideMode
  s.i32(); // remoteControlState
  s.bool(); // disablePoppetControls
  s.bool(); // autoDock
  s.bool(); // overrideSackbot
  if (subVersion > 0x6e) s.bool(); // killRiderOnCreatureDeath
  thing(); // padSwitch
  const vita = vitaRevision(s.revision);
  if (vita >= 0xd) s.f32(); // tiltMax
  if (vita >= 0xe) s.f32(); // tiltMin
  if (vita >= 0x1d) s.i32(); // remotePlayer
  if (vita >= 0x51) s.bool(); // playAudio
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
    s.u8(); // parentBoneIndex
    s.skipMatrix(); // parentBoneOffset
  }
  if (version > 0x3ec) s.u8(); // playerMode
  if (subVersion > 0x189) s.u8(); // layerRange
}
