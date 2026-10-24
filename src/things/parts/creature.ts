/** `CREATURE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { LD_ANY, LD_SUBMERGED, onLeerdammer, readThingRef, type PartReader } from '../thing.ts';
import { things } from './common.ts';

/** `WhipSim`: the grappling hook's state, shared by pointer. */
function readWhipSim(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const thing = () => readThingRef(s, readers);
  thing(); // creatureThing
  s.skipMatrix(); // baseHandleMatrix
  s.skipVector3(); // prevDir
  s.skipVector3(); // currDir
  s.i32(); // stateTimer
  s.i32(); // state
  thing(); // attachedThing
  s.skipVector3(); // attachedLocalPos
  s.skipVector3(); // attachedLocalNormal
  s.f32(); // attachedLocalAngle
  s.f32(); // attachedScale
  s.bool(); // playedFailToFireSound
  s.f32(); // attachedZOffset
}

/**
 * `PCreature`: a sackboy or sackbot.
 *
 * The longest part after `PSwitch`, and almost all of it is live state rather
 * than authored settings — where the creature is looking, how long it has been
 * in the air, which bullet emitter is next. It is here because it has to be
 * stepped over, not because anything reads it.
 */
export function readCreature(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  const thing = () => readThingRef(s, readers);

  s.resource(); // config
  s.s32(); // jumpFrame
  s.f32(); // groundDistance
  s.skipVector3(); // groundNormal
  thing(); // grabJoint
  thing(); // jumpingOff
  s.i32(); // state
  if (subVersion >= 0x132) s.i32(); // subState
  s.i32(); // stateTimer
  s.f32(); // speedModifier
  s.f32(); // jumpModifier
  s.f32(); // strengthModifier
  s.i32(); // zMode
  s.s32(); // playerAwareness
  s.s32(); // moveDirection
  s.skipVector3(); // forceThatSmashedCreature
  s.i32(); // crushFrames
  s.f32(); // awarenessRadius
  if (version >= 0x1df) s.i32(); // airTime
  if (version >= 0x354) {
    s.intVector(); // bouncepadThingUIDs
    s.intVector(); // grabbedThingUIDs
  }
  if (version >= 0x221) s.bool(); // haveNotTouchedGroundSinceUsingJetpack
  if (version >= 0x15d) {
    things(s, readers); // legList
    things(s, readers); // lifeSourceList
    thing(); // lifeCreature
    thing(); // aiCreature
  }
  if (version >= 0x163) {
    s.i32(); // jumpInterval
    s.i32(); // jumpIntervalPhase
  }
  if (version >= 0x169) s.bool(); // meshDirty
  if (version >= 0x166) {
    things(s, readers); // eyeList
    things(s, readers); // brainAiList
    things(s, readers); // brainLifeList
  }
  if (version >= 0x19c) s.bool(); // reactToLethal
  if (version >= 0x1a9) {
    s.skipMatrix(); // oldAnimMatrix
    s.f32(); // animOffset
  }
  if (version >= 0x1fc) s.skipVector3(); // groundNormalRaw
  if (version >= 0x212) {
    s.skipVector3(); // groundNormalSmooth
    s.f32(); // bodyAdjustApplied
  }
  if (version >= 0x240 && version < 0x2c4) s.f32(); // switchScale
  if (version >= 0x243) s.skipVector3(); // gunDirAndDashVec
  if (subVersion >= 0x19e) s.f32(); // gunDirAndDashVecW
  if (version >= 0x246) thing(); // resourceThing
  if (version >= 0x247) s.i32(); // gunFireFrame
  if (version >= 0x248) s.i32(); // bulletCount
  if (version >= 0x24a) s.i32(); // bulletImmuneTimer
  if (version >= 0x24d) thing(); // bulletEmitter0
  if (version >= 0x3a2) thing(); // bulletEmitter1
  if (version >= 0x24e) s.i32(); // bulletPosIndex
  if (version >= 0x24f) {
    s.i32(); // maxBulletCount
    s.f32(); // ammoFillFactor
  }
  if (version >= 0x252) s.bool(); // gunDirPrecisionMode
  if (version >= 0x320) {
    s.i32(); // fireRate
    s.f32(); // gunAccuracy
    s.skipVector3(); // bulletEmitOffset
    s.f32(); // bulletEmitRotation
    thing(); // gunThing
    thing(); // gunTrigger
    s.i32(); // lastGunTriggerUID
  }
  if (version >= 0x272) s.i32(); // airTimeLeft
  // ❗ **Three branch gates wearing version gates' clothes.** LEERDAMMER got the
  // submerged pair at its revision 15 and the two water bools at any revision at
  // all, so a 0x272 file on that branch carries ten bytes this reader used to
  // skip. `headPiece` is the mirror image: LEERDAMMER *removed* it at revision
  // 12, so a 0x17 file does not have it either way.
  if (version >= 0x2c9 || onLeerdammer(s.revision, LD_SUBMERGED)) {
    s.f32(); // amountBodySubmerged
    s.f32(); // amountHeadSubmerged
  }
  if (version >= 0x289 || onLeerdammer(s.revision, LD_ANY)) s.bool(); // hasScubaGear
  // cwlib `before(LEERDAMMER, LD_REMOVED_HEAD_PIECE)`: on the branch and older than 12.
  const headPieceGone = onLeerdammer(s.revision, LD_ANY) && s.revision.branchRevision >= 0xc;
  if ((version >= 0x289 && version < 0x2c8) || (onLeerdammer(s.revision, LD_ANY) && !headPieceGone)) {
    s.resource(); // headPiece
  }
  if (version >= 0x289 || onLeerdammer(s.revision, LD_ANY)) s.bool(); // outOfWaterJumpBoost
  if (version >= 0x2a9) s.resource(); // handPiece
  if (version >= 0x273) {
    thing(); // head
    thing(); // toolTetherJoint
    s.f32(); // toolTetherWidth
    thing(); // jetpack
    s.s32(); // wallJumpDir
    s.skipVector3(); // wallJumpPos
    const contacts = s.count();
    for (let i = 0; i < contacts; i += 1) s.skipVector3(); // bootContactForceList
    s.s32(); // gunType
    s.bool(); // wallJumpMat
  }
  if (version >= 0x29e && version < 0x336) thing(); // lastDirectControlPrompt
  if (version > 0x2e4) thing(); // directControlPrompt
  if (version >= 0x29e && version < 0x336) {
    s.skipVector3(); // smoothedDirectControlStick
    s.i16(); // directControlAnimFrame
    s.u8(); // directControlAnimState
  }
  if (version >= 0x29f && version < 0x2c1) s.u8(); // directControlMode
  if (version >= 0x2c1 && version < 0x336) s.u8();
  if (version >= 0x2a5) {
    s.i32(); // responsiblePlayer
    s.i32(); // responsibleFramesLeft
  }
  if (version >= 0x32c) s.bool(); // canDropPowerup
  if (version >= 0x3f0) s.u8(); // capeExtraMaxVelocityCap
  if (version >= 0x35a) s.i32(); // behavior
  if (version >= 0x373) s.i32(); // effectDestroy
  if (version >= 0x3c0) s.reference((self) => readWhipSim(self, readers));
  const vita = vitaRevision(s.revision);
  if (vita >= 0 && vita < 0x53) s.u8();
  if (vita >= 0x53) s.i32(); // shootAtTouch
  if (subVersion >= 0x88 && subVersion <= 0xa4) s.resource();
  if (subVersion >= 0xaa) thing(); // alternateFormWorld
  if (subVersion >= 0xd7) s.i32(); // hookHatState
  if (subVersion >= 0xd7 && subVersion < 0xea) {
    thing();
    thing();
  }
  if (subVersion >= 0xdf) thing(); // hookHatBogey
  if (subVersion >= 0x196) {
    for (let i = 0; i < 7; i += 1) s.i32(); // the flying timers
    s.f32(); // flyingLegScale
    s.skipVector4(); // flyingVels
    s.bool(); // flyingFlapLockout
    s.bool(); // flyingFallLockout
    s.bool(); // flyingInWind
    s.bool(); // flyingThrustLatched
    s.i16(); // glidingTime
  }
  if (subVersion >= 0x20c) {
    s.u8(); // springState
    s.bool(); // springHasSprung
    s.reference((self) => {
      readThingRef(self, readers); // springThing
      self.i32(); // springTimer
      self.skipVector3(); // springDirection
      self.skipVector3(); // springThingPosition
    });
    s.u8(); // springPower
    s.bool(); // springSeparateForces
    s.u8(); // springForce
    s.u8(); // springStateTimer
  }
}
