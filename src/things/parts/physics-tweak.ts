/** `PHYSICS_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * cwlib's `attractorData`: the attract-o-gel block, present when `configuration`
 * is 0xe. cwlib reads it as constants and names only some fields (its comments);
 * the two unnamed `i32`s are `unknown1` and `unknown2` here.
 */
export interface AttractorData {
  readonly attractDistance: number;
  readonly unknown1: number;
  readonly visualEffectBrightnessOn: number;
  readonly visualEffectSpeedOn: number;
  readonly unknown2: number;
  readonly visualEffectBrightnessOff: number;
  readonly visualEffectSpeedOff: number;
  readonly attractorManualDetach: number;
  readonly attractorSoundEffects: number;
  readonly attractorVisualEffect: number;
  readonly attractorAffectConnected: number;
}

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
  /**
   * The Thing between versions 0x27a and 0x326 that cwlib reads and writes as
   * null and does not name. Not always null: 5 of the FARCs' LBP2 tweakers hold
   * one, a whole Thing inline (`dev/part-census.ts`, 2026-10-25).
   */
  readonly legacyThing?: Thing;
  /** The attract-o-gel block, when `configuration` is 0xe from version 0x3e4. */
  readonly attractorData?: AttractorData;
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
  const legacyThing = version >= 0x27a && version < 0x327 ? readThingRef(s, readers) : undefined;
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
  let attractorData: AttractorData | undefined;
  if (configuration === 0xe && version > 0x3e3) {
    attractorData = {
      attractDistance: s.f32(),
      unknown1: s.i32(),
      visualEffectBrightnessOn: s.f32(),
      visualEffectSpeedOn: s.f32(),
      unknown2: s.i32(),
      visualEffectBrightnessOff: s.f32(),
      visualEffectSpeedOff: s.f32(),
      attractorManualDetach: s.u8(),
      attractorSoundEffects: s.u8(),
      attractorVisualEffect: s.u8(),
      attractorAffectConnected: s.u8(),
    };
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
    gridGoal, teamFilter, attractorData, legacyThing,
  };
}

/**
 * `readPhysicsTweak`'s mirror. The reads it drops -- the legacy movement below
 * 0x281, the constant blocks -- are written as cwlib writes them.
 */
export function writePhysicsTweak(w: Writer, value: PhysicsTweakPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const legacy = version < 0x281;
  const zero3 = [0, 0, 0] as const;
  if (version < 0x2c4) w.f32(0); // activation
  w.f32(value.tweakGravity);
  if (version > 0x2ff) w.f32(value.tweakBuoyancy);
  if (legacy) w.f32(0); // legacyTweakDampening
  if (version > 0x280) w.vector3(value.tweakDampening ?? zero3);
  w.vector3(value.input);
  w.vector3(value.middleVel);
  if (legacy) w.vector3(zero3);
  if (version > 0x280) w.f32(value.velRange ?? 0);
  if (legacy) w.vector3(zero3);
  if (version > 0x280) {
    w.f32(value.accelStrength ?? 0);
    if (version > 0x285) w.f32(value.decelStrength ?? 0);
  }
  if (legacy) {
    w.vector3(zero3);
    w.i32(0);
  }
  if (subVersion > 0xa3) {
    w.u8(value.directionModifier ?? 0);
    w.u8(value.movementModifier ?? 0);
  }
  w.bool(value.localSpace);
  if (version > 0x278) w.i32(value.configuration);
  if (version >= 0x27a && version < 0x327) ctx.thing(w, value.legacyThing);
  if (version > 0x282) w.bool(value.hideInPlayMode);
  if (version > 0x28d) w.i32(value.colorIndex);
  if (version > 0x2db) w.wstr(value.name);
  if (version < 0x3e8) {
    if (version > 0x2ad) w.u8(value.teamFilter ?? 0);
  } else if (subVersion < 0x132) {
    if (version >= 0x2ae) w.u8(value.teamFilter ?? 0);
  } else {
    w.i32(value.followerPlayerMode ?? 0);
  }
  if (version > 0x2c5) w.i32(value.behavior);
  if (version > 0x2dc) {
    w.bool(value.allowInOut ?? false);
    w.bool(value.allowUpDown ?? false);
    w.f32(value.minRange ?? 0);
    w.f32(value.maxRange ?? 0);
    w.bool(value.followKey ?? false);
  }
  if (version > 0x381) w.f32(value.angleRange ?? 0);
  if (version > 0x2fe) w.bool(value.flee ?? false);
  if (subVersion > 0x6f) w.bool(value.stabiliser ?? false);
  if (subVersion > 0x12f) {
    w.bool(value.shardDephysicalised ?? false);
    w.bool(value.shardPhysicsAudio ?? false);
  }
  if (subVersion > 0x43) w.bool(value.isLBP2PhysicsTweak ?? false);
  if (version > 0x36a) {
    w.f32(value.maximumMass ?? 0);
    w.bool(value.canPush ?? false);
    w.s32(value.zBehavior ?? 0);
    w.f32(value.lastKnownActivation ?? 0);
    w.bool(value.waitingToMove ?? false);
  }
  if (subVersion > 0xf6) w.u8(value.zPhase ?? 0);
  if (version > 0x3b8 && value.configuration === 0xd) {
    w.ref(value.recording);
    w.f32(value.playHead ?? 0);
    if (version < 0x3c4) w.u8(0);
    w.u8(value.type ?? 0);
    w.u8(value.dir ?? 0);
    w.vector3(value.prevDesiredPos ?? zero3);
    w.u8(value.prevDesiredPosSet ?? 0);
    w.matrix(value.startOrientation ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    w.f32(value.speed ?? 0);
    if (version > 0x3c4) w.u8(value.pathIsAbsolute ?? 0);
  }
  const vita = vitaRevision(w.revision);
  if (vita >= 0x11) w.i32(value.usePanel ?? 0);
  if (vita >= 0x11 && vita < 0x4b) w.u8(0);
  if (vita >= 0x1f) w.i32(value.followType ?? 0);
  if (vita >= 0x4b) w.f32(value.followerDeceleration ?? 0);
  if (vita >= 0x55) w.u8(value.playerFilter ?? 0);
  if (subVersion >= 0x1 && subVersion < 0x17) for (let i = 0; i < 9; i += 1) w.s32(0);
  if (subVersion >= 0x5 && subVersion < 0x17) {
    w.f32(0);
    w.u8(0);
    w.u8(0);
  }
  if (value.configuration === 0xe && version > 0x3e3) {
    const a = value.attractorData;
    w.f32(a?.attractDistance ?? 0);
    w.i32(a?.unknown1 ?? 0);
    w.f32(a?.visualEffectBrightnessOn ?? 0);
    w.f32(a?.visualEffectSpeedOn ?? 0);
    w.i32(a?.unknown2 ?? 0);
    w.f32(a?.visualEffectBrightnessOff ?? 0);
    w.f32(a?.visualEffectSpeedOff ?? 0);
    w.u8(a?.attractorManualDetach ?? 0);
    w.u8(a?.attractorSoundEffects ?? 0);
    w.u8(a?.attractorVisualEffect ?? 0);
    w.u8(a?.attractorAffectConnected ?? 0);
  }
  if (subVersion > 0x56) {
    w.i16(value.gridSnap ?? 0);
    w.i16(value.gridStrength ?? 0);
  }
  if (subVersion > 0x99) w.f32(value.gridGoalW ?? 0);
  if (subVersion > 0x98) w.vector3(value.gridGoal ?? zero3);
}
