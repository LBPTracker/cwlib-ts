/** `PHYSICS_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';

/**
 * `PPhysicsTweak`: the movement tweaker.
 *
 * ⚠️ Two of its blocks are **data-dependent**, not revision-dependent: the move
 * recording appears only when `configuration` is 0xd, and the attract-o-gel
 * block only when it is 0xe. A reader that ignores the value it just read will
 * work on every level that happens not to use those tools.
 */
export function readPhysicsTweak(s: Serializer): void {
  const { version, subVersion } = s.revision;
  s.f32(); // tweakGravity
  if (version > 0x2ff) s.f32(); // tweakBuoyancy
  if (version > 0x280) s.skipVector3(); // tweakDampening
  s.skipVector3(); // input
  s.skipVector3(); // middleVel
  if (version > 0x280) s.f32(); // velRange
  if (version > 0x280) {
    s.f32(); // accelStrength
    if (version > 0x285) s.f32(); // decelStrength
  }
  if (subVersion > 0xa3) {
    s.u8(); // directionModifier
    s.u8(); // movementModifier
  }
  s.bool(); // localSpace
  let configuration = 0;
  if (version > 0x278) configuration = s.i32();
  if (version > 0x282) s.bool(); // hideInPlayMode
  if (version > 0x28d) s.i32(); // colorIndex
  if (version > 0x2db) s.wstr(); // name
  if (version < 0x3e8) {
    if (version > 0x2ad) s.u8(); // teamFilter
  } else if (subVersion < 0x132) {
    if (version >= 0x2ae) s.u8(); // teamFilter
  } else {
    s.i32(); // followerPlayerMode
  }
  if (version > 0x2c5) s.i32(); // behavior
  if (version > 0x2dc) {
    s.bool(); // allowInOut
    s.bool(); // allowUpDown
    s.f32(); // minRange
    s.f32(); // maxRange
    s.bool(); // followKey
  }
  if (version > 0x381) s.f32(); // angleRange
  if (version > 0x2fe) s.bool(); // flee
  if (subVersion > 0x6f) s.bool(); // stabiliser
  if (subVersion > 0x12f) {
    s.bool(); // shardDephysicalised
    s.bool(); // shardPhysicsAudio
  }
  if (subVersion > 0x43) s.bool(); // isLBP2PhysicsTweak
  if (version > 0x36a) {
    s.f32(); // maximumMass
    s.bool(); // canPush
    s.s32(); // zBehavior
    s.f32(); // lastKnownActivation
    s.bool(); // waitingToMove
  }
  if (subVersion > 0xf6) s.u8(); // zPhase
  if (version > 0x3b8 && configuration === 0xd) {
    s.resource(); // recording
    s.f32(); // playHead
    if (version < 0x3c4) s.u8();
    s.u8(); // type
    s.u8(); // dir
    s.skipVector3(); // prevDesiredPos
    s.u8(); // prevDesiredPosSet
    s.skipMatrix(); // startOrientation
    s.f32(); // speed
    if (version > 0x3c4) s.u8(); // pathIsAbsolute
  }
  const vita = vitaRevision(s.revision);
  if (vita >= 0x11) s.i32(); // usePanel
  if (vita >= 0x11 && vita < 0x4b) s.u8();
  if (vita >= 0x1f) s.i32(); // followType
  if (vita >= 0x4b) s.f32(); // followerDeceleration
  if (vita >= 0x55) s.u8(); // playerFilter
  if (configuration === 0xe && version > 0x3e3) {
    s.f32();
    s.i32();
    s.f32();
    s.f32();
    s.i32();
    s.f32();
    s.f32();
    s.u8();
    s.u8();
    s.u8();
    s.u8();
  }
  if (subVersion > 0x56) {
    s.i16(); // gridSnap
    s.i16(); // gridStrength
  }
  if (subVersion > 0x99) s.f32(); // gridGoalW
  if (subVersion > 0x98) s.skipVector3(); // gridGoal
}
