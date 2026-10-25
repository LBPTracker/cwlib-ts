/** `PHYSICS_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/**
 * `PPhysicsTweak`: the movement tweaker.
 *
 * ⚠️ Two of its blocks are **data-dependent**, not revision-dependent: the move
 * recording appears only when `configuration` is 0xd, and the attract-o-gel
 * block only when it is 0xe. A reader that ignores the value it just read will
 * work on every level that happens not to use those tools.
 */
/** `PPhysicsTweak`, kept: what a mover, a gravity or a follower tweaker does to a Thing. */
export interface PhysicsTweakPart {
  readonly tweakGravity: number;
  readonly tweakBuoyancy: number;
  /** cwlib's `TweakConfiguration`; the walk branches on 0xd (a recording follows) and 0xe. */
  readonly configuration: number;
  readonly hideInPlayMode: boolean;
  readonly colorIndex: number;
  readonly name: string;
  readonly behavior: number;
  readonly input: readonly [number, number, number];
  readonly middleVel: readonly [number, number, number];
  readonly accelStrength?: number;
  readonly directionModifier?: number;
  readonly movementModifier?: number;
  readonly localSpace: boolean;
  readonly followerPlayerMode?: number;
  readonly allowInOut?: boolean;
  readonly allowUpDown?: boolean;
  readonly minRange?: number;
  readonly maxRange?: number;
  readonly followKey?: boolean;
  readonly shardDephysicalised?: boolean;
  readonly shardPhysicsAudio?: boolean;
  readonly maximumMass?: number;
  readonly canPush?: boolean;
  readonly zBehavior?: number;
  readonly lastKnownActivation?: number;
  readonly waitingToMove?: boolean;
  readonly recording?: ResourceRef;
  readonly playHead?: number;
  readonly type?: number;
  readonly dir?: number;
  readonly prevDesiredPos?: readonly [number, number, number];
  readonly prevDesiredPosSet?: number;
  readonly startOrientation?: Float32Array;
  readonly speed?: number;
  readonly gridSnap?: number;
  readonly gridStrength?: number;
  readonly tweakDampening?: readonly [number, number, number];
  readonly velRange?: number;
  readonly decelStrength?: number;
  readonly angleRange?: number;
  readonly flee?: boolean;
  readonly stabiliser?: boolean;
  readonly isLBP2PhysicsTweak?: boolean;
  readonly zPhase?: number;
  readonly pathIsAbsolute?: number;
  readonly usePanel?: number;
  readonly followType?: number;
  readonly followerDeceleration?: number;
  readonly playerFilter?: number;
  readonly gridGoalW?: number;
  readonly gridGoal?: readonly [number, number, number];
  /** Below version 0x3e8, or below subVersion 0x132. */
  readonly teamFilter?: number;
}

export function readPhysicsTweak(s: Serializer, readers: ReadonlyMap<string, PartReader>): PhysicsTweakPart {
  const { version, subVersion } = s.revision;
  let tweakDampening: readonly [number, number, number] | undefined;
  let velRange: number | undefined;
  let decelStrength: number | undefined;
  let angleRange: number | undefined;
  let flee: boolean | undefined;
  let stabiliser: boolean | undefined;
  let isLBP2PhysicsTweak: boolean | undefined;
  let zPhase: number | undefined;
  let pathIsAbsolute: number | undefined;
  let usePanel: number | undefined;
  let followType: number | undefined;
  let followerDeceleration: number | undefined;
  let playerFilter: number | undefined;
  let gridGoalW: number | undefined;
  let gridGoal: readonly [number, number, number] | undefined;
  let accelStrength: number | undefined;
  let directionModifier: number | undefined;
  let movementModifier: number | undefined;
  let followerPlayerMode: number | undefined;
  let teamFilter: number | undefined;
  let allowInOut: boolean | undefined;
  let allowUpDown: boolean | undefined;
  let minRange: number | undefined;
  let maxRange: number | undefined;
  let followKey: boolean | undefined;
  let shardDephysicalised: boolean | undefined;
  let shardPhysicsAudio: boolean | undefined;
  let maximumMass: number | undefined;
  let canPush: boolean | undefined;
  let zBehavior: number | undefined;
  let lastKnownActivation: number | undefined;
  let waitingToMove: boolean | undefined;
  let recording: ResourceRef | undefined;
  let playHead: number | undefined;
  let type: number | undefined;
  let dir: number | undefined;
  let prevDesiredPos: readonly [number, number, number] | undefined;
  let prevDesiredPosSet: number | undefined;
  let startOrientation: Float32Array | undefined;
  let speed: number | undefined;
  let gridSnap: number | undefined;
  let gridStrength: number | undefined;
  let [tweakBuoyancy, colorIndex, behavior] = [0, 0, 0];
  let hideInPlayMode = false;
  let name = '';
  // Below 0x281 the movement is in cwlib's `legacy` fields, interleaved with the rest.
  const legacy = version < 0x281;
  if (version < 0x2c4) s.f32(); // activation
  const tweakGravity = s.f32();
  if (version > 0x2ff) tweakBuoyancy = s.f32();
  if (legacy) s.f32(); // legacyTweakDampening
  if (version > 0x280) tweakDampening = s.vector3();
  const input = s.vector3();
  const middleVel = s.vector3();
  if (legacy) s.skipVector3(); // legacyDeceleration
  if (version > 0x280) velRange = s.f32();
  if (legacy) s.skipVector3(); // legacyAcceleration
  if (version > 0x280) {
    accelStrength = s.f32();
    if (version > 0x285) decelStrength = s.f32();
  }
  if (legacy) {
    s.skipVector3(); // legacyDeceleration again
    s.i32(); // legacyTurnToFace
  }
  if (subVersion > 0xa3) {
    directionModifier = s.u8();
    movementModifier = s.u8();
  }
  const localSpace = s.bool();
  let configuration = 0;
  if (version > 0x278) configuration = s.i32();
  // ❗ A Thing between 0x27a and 0x326, which cwlib reads and does not name; the
  // LBP2 plans at 0x300 and 0x319 ran one byte short without it.
  if (version >= 0x27a && version < 0x327) readThingRef(s, readers);
  if (version > 0x282) hideInPlayMode = s.bool();
  if (version > 0x28d) colorIndex = s.i32();
  if (version > 0x2db) name = s.wstr();
  if (version < 0x3e8) {
    if (version > 0x2ad) teamFilter = s.u8();
  } else if (subVersion < 0x132) {
    if (version >= 0x2ae) teamFilter = s.u8();
  } else {
    followerPlayerMode = s.i32();
  }
  if (version > 0x2c5) behavior = s.i32();
  if (version > 0x2dc) {
    allowInOut = s.bool();
    allowUpDown = s.bool();
    minRange = s.f32();
    maxRange = s.f32();
    followKey = s.bool();
  }
  if (version > 0x381) angleRange = s.f32();
  if (version > 0x2fe) flee = s.bool();
  if (subVersion > 0x6f) stabiliser = s.bool();
  if (subVersion > 0x12f) {
    shardDephysicalised = s.bool();
    shardPhysicsAudio = s.bool();
  }
  if (subVersion > 0x43) isLBP2PhysicsTweak = s.bool();
  if (version > 0x36a) {
    maximumMass = s.f32();
    canPush = s.bool();
    zBehavior = s.s32();
    lastKnownActivation = s.f32();
    waitingToMove = s.bool();
  }
  if (subVersion > 0xf6) zPhase = s.u8();
  if (version > 0x3b8 && configuration === 0xd) {
    recording = s.resource();
    playHead = s.f32();
    if (version < 0x3c4) s.u8();
    type = s.u8();
    dir = s.u8();
    prevDesiredPos = s.vector3();
    prevDesiredPosSet = s.u8();
    startOrientation = s.matrix();
    speed = s.f32();
    if (version > 0x3c4) pathIsAbsolute = s.u8();
  }
  const vita = vitaRevision(s.revision);
  if (vita >= 0x11) usePanel = s.i32();
  if (vita >= 0x11 && vita < 0x4b) s.u8();
  if (vita >= 0x1f) followType = s.i32();
  if (vita >= 0x4b) followerDeceleration = s.f32();
  if (vita >= 0x55) playerFilter = s.u8();
  // Two blocks cwlib writes as constants and this reader lacked: nine `s32`s
  // from subVersion 0x1 and a float and two bytes from 0x5, both gone at 0x17
  // (`PPhysicsTweak.java` at `d6a2ef8`). No file read here sits between.
  if (subVersion >= 0x1 && subVersion < 0x17) for (let i = 0; i < 9; i += 1) s.s32();
  if (subVersion >= 0x5 && subVersion < 0x17) {
    s.f32();
    s.u8();
    s.u8();
  }
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
    gridSnap = s.i16();
    gridStrength = s.i16();
  }
  if (subVersion > 0x99) gridGoalW = s.f32();
  if (subVersion > 0x98) gridGoal = s.vector3();
  return {
    tweakGravity, tweakBuoyancy, configuration, hideInPlayMode, colorIndex, name, behavior, input,
    middleVel, accelStrength, directionModifier, movementModifier, localSpace, followerPlayerMode,
    allowInOut, allowUpDown, minRange, maxRange, followKey, shardDephysicalised, shardPhysicsAudio,
    maximumMass, canPush, zBehavior, lastKnownActivation, waitingToMove, recording, playHead, type,
    dir, prevDesiredPos, prevDesiredPosSet, startOrientation, speed, gridSnap, gridStrength,
    tweakDampening, velRange, decelStrength, angleRange, flee, stabiliser, isLBP2PhysicsTweak,
    zPhase, pathIsAbsolute, usePanel, followType, followerDeceleration, playerFilter, gridGoalW,
    gridGoal, teamFilter,
  };
}
