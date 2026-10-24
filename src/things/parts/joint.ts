/** `JOINT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

/**
 * `PJoint`: a bolt, spring, piston, string or the like between two Things.
 * steering/level-files.md, *Joints*, says what of it is measured.
 */
export interface JointPart {
  readonly a?: Thing;
  readonly b?: Thing;
  /** Where the joint holds each Thing, in that Thing's own space. */
  readonly aContact: [number, number, number];
  readonly bContact: [number, number, number];
  readonly length: number;
  readonly angle: number;
  /** cwlib's `JointType`. */
  readonly type: number;
  readonly renderScale: number;
  /** false when the revision has no field. */
  readonly hideInPlayMode: boolean;
  /** cwlib's `settings`: steering/level-files.md, *Joints*, says what it names. */
  readonly settings?: ResourceRef;
}

/** `PJoint`: the connector between two Things. Long, and all of it fixed-width. */
export function readJoint(s: Serializer, readers: ReadonlyMap<string, PartReader>): JointPart {
  const a = readThingRef(s, readers);
  const b = readThingRef(s, readers);
  const aContact = s.vector3();
  const bContact = s.vector3();
  const length = s.f32();
  const angle = s.f32();
  s.f32(); // offsetTime
  s.bool(); // invertAngle
  const settings = s.resource();
  s.array((self) => self.i32()); // boneIdx
  s.skipVector4(); // boneLengths
  const type = s.i32();
  s.f32(); // strength
  s.bool(); // stiff
  s.skipVector3(); // slideDir
  s.i32(); // animationPattern
  s.f32(); // animationRange
  s.f32(); // animationTime
  s.f32(); // animationPhase
  s.f32(); // animationSpeed
  s.f32(); // animationPause
  s.f32(); // aAngleOffset
  s.f32(); // bAngleOffset
  s.f32(); // modStartFrames
  s.f32(); // modDeltaFrames
  s.f32(); // modScale
  const { version: jv } = s.revision;
  if (jv < 0x2c4) s.bool(); // modDriven
  if (jv < 0x307) {
    s.u8(); // interactPlayMode
    s.u8(); // interactEditMode
  }
  const renderScale = s.f32();
  if (jv > 0x169) s.i32(); // jointSoundEnum
  // ❗ A pair of floats above 0x280 and a pair of **integers** at or below it.
  // Same width on paper, different width in a compressed stream: the ints are
  // varints and the floats are four bytes each.
  if (jv > 0x280) {
    s.f32(); // tweakTargetMaxLength
    s.f32(); // tweakTargetMinLength
  } else if (jv > 0x21c) {
    s.i32();
    s.i32();
  }
  if (jv > 0x21e) s.bool(); // currentlyEditing
  if (jv > 0x22f && jv < 0x2c4) s.bool(); // modScaleActive
  const hideInPlayMode = jv > 0x25c ? s.bool() : false;
  if (jv > 0x2c3) s.i32(); // behaviour
  if (s.revision.subVersion >= 0xed) {
    const count = s.count();
    for (let i = 0; i < count; i += 1) s.skipVector3(); // railKnotVector
  }
  if (s.revision.subVersion >= 0x197) s.u8(); // railInteractions
  if (s.revision.subVersion >= 0x19f) {
    s.bool(); // canBeTweakedByPoppetPowerup
    s.bool(); // createdByPoppetPowerup
  }
  if (s.revision.subVersion >= 0x1a4) s.bool(); // oldJointOutputBehavior
  return { a, b, aContact, bContact, length, angle, type, renderScale, hideInPlayMode, settings };
}
