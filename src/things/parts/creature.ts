/** `CREATURE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { LD_ANY, LD_SUBMERGED, onLeerdammer, readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray, things, writeThingArray } from './common.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';
import { readKept, writeKept } from './npc.ts';

type V3 = readonly [number, number, number];

/** `WhipSim`: the grappling hook's state, shared by pointer. */
export interface WhipSim {
  readonly creatureThing?: Thing;
  readonly baseHandleMatrix: Float32Array;
  readonly prevDir: V3;
  readonly currDir: V3;
  readonly stateTimer: number;
  readonly state: number;
  readonly attachedThing?: Thing;
  readonly attachedLocalPos: V3;
  readonly attachedLocalNormal: V3;
  readonly attachedLocalAngle: number;
  readonly attachedScale: number;
  readonly playedFailToFireSound: boolean;
  readonly attachedZOffset: number;
}

function readWhipSim(s: Serializer, readers: ReadonlyMap<string, PartReader>): WhipSim {
  const thing = () => readThingRef(s, readers);
  return {
    creatureThing: thing(),
    baseHandleMatrix: s.matrix(),
    prevDir: s.vector3(),
    currDir: s.vector3(),
    stateTimer: s.i32(),
    state: s.i8(), // an `i8` in cwlib's `WhipSim`, which this read as an `i32`
    attachedThing: thing(),
    attachedLocalPos: s.vector3(),
    attachedLocalNormal: s.vector3(),
    attachedLocalAngle: s.f32(),
    attachedScale: s.f32(),
    playedFailToFireSound: s.bool(),
    attachedZOffset: s.f32(),
  };
}

/** The spring a creature is on, shared by pointer. */
export interface CreatureSpring {
  readonly springThing?: Thing;
  readonly springTimer: number;
  readonly springDirection: V3;
  readonly springThingPosition: V3;
}

/**
 * `PCreature`: a sackboy or sackbot.
 *
 * The longest part after `PSwitch`, and almost all of it is live state rather
 * than authored settings — where the creature is looking, how long it has been
 * in the air, which bullet emitter is next. It is here because it has to be
 * stepped over, not because anything reads it.
 */
/** `PCreature`, kept: a creature's settings and the Things it is built of. */
export interface CreaturePart {
  /** Its `RSettingsCharacter`. */
  readonly config?: ResourceRef;
  readonly state: number;
  readonly speedModifier: number;
  readonly jumpModifier: number;
  readonly strengthModifier: number;
  /** The Things that are its legs, its life sources, its eyes and its brains (`PEnemy` parts). */
  readonly legs: readonly (Thing | undefined)[];
  readonly lifeSources: readonly (Thing | undefined)[];
  readonly eyes: readonly (Thing | undefined)[];
  readonly brainsAi: readonly (Thing | undefined)[];
  readonly brainsLife: readonly (Thing | undefined)[];
  readonly jumpFrame: number;
  readonly groundDistance: number;
  readonly groundNormal: readonly [number, number, number];
  readonly grabJoint: Thing | undefined;
  readonly jumpingOff: Thing | undefined;
  readonly stateTimer: number;
  readonly zMode: number;
  readonly playerAwareness: number;
  readonly moveDirection: number;
  readonly forceThatSmashedCreature: readonly [number, number, number];
  readonly crushFrames: number;
  readonly awarenessRadius: number;
  readonly bouncepadThingUIDs?: readonly number[];
  readonly grabbedThingUIDs?: readonly number[];
  readonly lifeCreature?: Thing;
  readonly aiCreature?: Thing;
  readonly jumpInterval?: number;
  readonly jumpIntervalPhase?: number;
  readonly oldAnimMatrix?: Float32Array;
  readonly animOffset?: number;
  readonly groundNormalSmooth?: readonly [number, number, number];
  readonly bodyAdjustApplied?: number;
  readonly maxBulletCount?: number;
  readonly ammoFillFactor?: number;
  readonly fireRate?: number;
  readonly gunAccuracy?: number;
  readonly bulletEmitOffset?: readonly [number, number, number];
  readonly bulletEmitRotation?: number;
  readonly gunThing?: Thing;
  readonly gunTrigger?: Thing;
  readonly lastGunTriggerUID?: number;
  readonly amountBodySubmerged?: number;
  readonly amountHeadSubmerged?: number;
  readonly headPiece?: ResourceRef;
  readonly head?: Thing;
  readonly toolTetherJoint?: Thing;
  readonly toolTetherWidth?: number;
  readonly jetpack?: Thing;
  readonly wallJumpDir?: number;
  readonly wallJumpPos?: readonly [number, number, number];
  readonly gunType?: number;
  readonly wallJumpMat?: boolean;
  readonly smoothedDirectControlStick?: readonly [number, number, number];
  readonly directControlAnimFrame?: number;
  readonly directControlAnimState?: number;
  readonly responsiblePlayer?: number;
  readonly responsibleFramesLeft?: number;
  readonly flyingLegScale?: number;
  readonly flyingVels?: readonly [number, number, number, number];
  readonly flyingFlapLockout?: boolean;
  readonly flyingFallLockout?: boolean;
  readonly flyingInWind?: boolean;
  readonly flyingThrustLatched?: boolean;
  readonly glidingTime?: number;
  readonly springState?: number;
  readonly springHasSprung?: boolean;
  readonly springPower?: number;
  readonly springSeparateForces?: boolean;
  readonly springForce?: number;
  readonly springStateTimer?: number;
  readonly subState?: number;
  readonly airTime?: number;
  readonly haveNotTouchedGroundSinceUsingJetpack?: boolean;
  readonly meshDirty?: boolean;
  readonly reactToLethal?: boolean;
  readonly groundNormalRaw?: readonly [number, number, number];
  readonly switchScale?: number;
  readonly gunDirAndDashVec?: readonly [number, number, number];
  readonly gunDirAndDashVecW?: number;
  readonly resourceThing?: Thing;
  readonly gunFireFrame?: number;
  readonly bulletCount?: number;
  readonly bulletImmuneTimer?: number;
  readonly bulletEmitter0?: Thing;
  readonly bulletEmitter1?: Thing;
  readonly bulletPosIndex?: number;
  readonly gunDirPrecisionMode?: boolean;
  readonly airTimeLeft?: number;
  readonly hasScubaGear?: boolean;
  readonly outOfWaterJumpBoost?: boolean;
  readonly handPiece?: ResourceRef;
  readonly lastDirectControlPrompt?: Thing;
  readonly directControlPrompt?: Thing;
  readonly directControlMode?: number;
  readonly canDropPowerup?: boolean;
  readonly capeExtraMaxVelocityCap?: number;
  readonly behavior?: number;
  readonly effectDestroy?: number;
  readonly shootAtTouch?: number;
  readonly alternateFormWorld?: Thing;
  readonly hookHatState?: number;
  readonly hookHatBogey?: Thing;
  readonly whipSim?: WhipSim;
  readonly spring?: CreatureSpring;
  readonly bootContactForceList?: readonly V3[];
  /**
   * The four bytes of the float versions 0x178..0x1e2 hold after the brains, which
   * cwlib reads unnamed and writes as 0, kept where they are not all zero: one
   * creature in the game's first 400 levels and plans holds `ff 7f ff ff` there,
   * a NaN, so they are kept as bytes rather than as a float.
   */
  readonly retiredFloat0x178?: Uint8Array;
  /** The seven flying timers, as cwlib reads them, one after another. */
  readonly flyingTimers?: readonly number[];
}

export function readCreature(s: Serializer, readers: ReadonlyMap<string, PartReader>): CreaturePart {
  const { version, subVersion } = s.revision;
  let whipSim: WhipSim | undefined;
  let bootContactForceList: V3[] | undefined;
  let flyingTimers: number[] | undefined;
  let spring: CreatureSpring | undefined;
  let subState: number | undefined;
  let airTime: number | undefined;
  let haveNotTouchedGroundSinceUsingJetpack: boolean | undefined;
  let meshDirty: boolean | undefined;
  let reactToLethal: boolean | undefined;
  let groundNormalRaw: readonly [number, number, number] | undefined;
  let switchScale: number | undefined;
  let gunDirAndDashVec: readonly [number, number, number] | undefined;
  let gunDirAndDashVecW: number | undefined;
  let resourceThing: Thing | undefined;
  let gunFireFrame: number | undefined;
  let bulletCount: number | undefined;
  let bulletImmuneTimer: number | undefined;
  let bulletEmitter0: Thing | undefined;
  let bulletEmitter1: Thing | undefined;
  let bulletPosIndex: number | undefined;
  let gunDirPrecisionMode: boolean | undefined;
  let airTimeLeft: number | undefined;
  let hasScubaGear: boolean | undefined;
  let outOfWaterJumpBoost: boolean | undefined;
  let handPiece: ResourceRef | undefined;
  let lastDirectControlPrompt: Thing | undefined;
  let directControlPrompt: Thing | undefined;
  let directControlMode: number | undefined;
  let canDropPowerup: boolean | undefined;
  let capeExtraMaxVelocityCap: number | undefined;
  let behavior: number | undefined;
  let effectDestroy: number | undefined;
  let shootAtTouch: number | undefined;
  let alternateFormWorld: Thing | undefined;
  let hookHatState: number | undefined;
  let hookHatBogey: Thing | undefined;
  let bouncepadThingUIDs: readonly number[] | undefined;
  let grabbedThingUIDs: readonly number[] | undefined;
  let lifeCreature: Thing | undefined;
  let aiCreature: Thing | undefined;
  let jumpInterval: number | undefined;
  let jumpIntervalPhase: number | undefined;
  let oldAnimMatrix: Float32Array | undefined;
  let animOffset: number | undefined;
  let groundNormalSmooth: readonly [number, number, number] | undefined;
  let bodyAdjustApplied: number | undefined;
  let maxBulletCount: number | undefined;
  let ammoFillFactor: number | undefined;
  let fireRate: number | undefined;
  let gunAccuracy: number | undefined;
  let bulletEmitOffset: readonly [number, number, number] | undefined;
  let bulletEmitRotation: number | undefined;
  let gunThing: Thing | undefined;
  let gunTrigger: Thing | undefined;
  let lastGunTriggerUID: number | undefined;
  let amountBodySubmerged: number | undefined;
  let amountHeadSubmerged: number | undefined;
  let headPiece: ResourceRef | undefined;
  let head: Thing | undefined;
  let toolTetherJoint: Thing | undefined;
  let toolTetherWidth: number | undefined;
  let jetpack: Thing | undefined;
  let wallJumpDir: number | undefined;
  let wallJumpPos: readonly [number, number, number] | undefined;
  let gunType: number | undefined;
  let wallJumpMat: boolean | undefined;
  let smoothedDirectControlStick: readonly [number, number, number] | undefined;
  let directControlAnimFrame: number | undefined;
  let directControlAnimState: number | undefined;
  let responsiblePlayer: number | undefined;
  let responsibleFramesLeft: number | undefined;
  let flyingLegScale: number | undefined;
  let flyingVels: readonly [number, number, number, number] | undefined;
  let flyingFlapLockout: boolean | undefined;
  let flyingFallLockout: boolean | undefined;
  let flyingInWind: boolean | undefined;
  let flyingThrustLatched: boolean | undefined;
  let glidingTime: number | undefined;
  let springState: number | undefined;
  let springHasSprung: boolean | undefined;
  let springPower: number | undefined;
  let springSeparateForces: boolean | undefined;
  let springForce: number | undefined;
  let springStateTimer: number | undefined;
  let legs: (Thing | undefined)[] = [];
  let lifeSources: (Thing | undefined)[] = [];
  let eyes: (Thing | undefined)[] = [];
  let brainsAi: (Thing | undefined)[] = [];
  let brainsLife: (Thing | undefined)[] = [];
  const thing = () => readThingRef(s, readers);

  // The reads cwlib's `PCreature` makes for old revisions and does not name, each at
  // its own gate: 26 bytes of them at 0x1e2 and 4 at 0x207 were missing here.
  const config = s.resource();
  if (version < 0x155) s.array((self) => self.vector3());
  const jumpFrame = s.s32();
  const groundDistance = s.f32();
  const groundNormal = s.vector3();
  const grabJoint = thing();
  if (version < 0x13c) thing();
  const jumpingOff = thing();
  const state = s.i32();
  if (subVersion >= 0x132) subState = s.i32();
  const stateTimer = s.i32();
  const speedModifier = s.f32();
  const jumpModifier = s.f32();
  const strengthModifier = s.f32();
  if (version < 0x142) s.skipVector4();
  const zMode = s.i32();
  if (version < 0x146) s.i32();
  if (version > 0x145 && version < 0x1f0) {
    s.i32();
    s.i32();
    s.bool();
    s.bool();
    s.i32();
  }
  const playerAwareness = s.s32();
  const moveDirection = s.s32();
  if (version < 0x15d) s.u8();
  if (version < 0x1f0) {
    s.i32(); // the count of a Thing array cwlib writes empty, read bare as cwlib reads it
    s.f32();
  }
  const forceThatSmashedCreature = s.vector3();
  const crushFrames = s.i32();
  const awarenessRadius = s.f32();
  if (version >= 0x1df) airTime = s.i32();
  if (version >= 0x354) {
    bouncepadThingUIDs = s.intVector();
    grabbedThingUIDs = s.intVector();
  }
  if (version >= 0x221) haveNotTouchedGroundSinceUsingJetpack = s.bool();
  if (version >= 0x15d) {
    legs = thingArray(s, readers);
    if (version < 0x166) {
      thingArray(s, readers);
      thingArray(s, readers);
    }
    lifeSources = thingArray(s, readers);
    lifeCreature = thing();
    aiCreature = thing();
  }
  if (version >= 0x163) {
    jumpInterval = s.i32();
    jumpIntervalPhase = s.i32();
  }
  if (version > 0x162 && version < 0x16d) s.bool();
  if (version >= 0x169) meshDirty = s.bool();
  if (version >= 0x166) {
    eyes = thingArray(s, readers);
    brainsAi = thingArray(s, readers);
    brainsLife = thingArray(s, readers);
  }
  let retiredFloat0x178: Uint8Array | undefined;
  if (version > 0x177 && version < 0x1e3) {
    const raw = s.bytes(4);
    if (raw.some((b) => b !== 0)) retiredFloat0x178 = raw.slice();
  }
  if (version >= 0x19c) reactToLethal = s.bool();
  if (version >= 0x1a9) {
    oldAnimMatrix = s.matrix();
    animOffset = s.f32();
  }
  if (version > 0x1ed && version < 0x225) s.s32();
  if (version >= 0x1fc) groundNormalRaw = s.vector3();
  if (version >= 0x212) {
    groundNormalSmooth = s.vector3();
    bodyAdjustApplied = s.f32();
  }
  if (version >= 0x240 && version < 0x2c4) switchScale = s.f32();
  if (version > 0x242 && version < 0x24d) s.resource(); // a plan
  if (version >= 0x243) gunDirAndDashVec = s.vector3();
  if (subVersion >= 0x19e) gunDirAndDashVecW = s.f32();
  if (version >= 0x246) resourceThing = thing();
  if (version >= 0x247) gunFireFrame = s.i32();
  if (version >= 0x248) bulletCount = s.i32();
  if (version >= 0x24a) bulletImmuneTimer = s.i32();
  if (version >= 0x24d) bulletEmitter0 = thing();
  if (version >= 0x3a2) bulletEmitter1 = thing();
  if (version >= 0x24e) bulletPosIndex = s.i32();
  if (version >= 0x24f) {
    maxBulletCount = s.i32();
    ammoFillFactor = s.f32();
  }
  if (version >= 0x252) gunDirPrecisionMode = s.bool();
  if (version >= 0x320) {
    fireRate = s.i32();
    gunAccuracy = s.f32();
    bulletEmitOffset = s.vector3();
    bulletEmitRotation = s.f32();
    gunThing = thing();
    gunTrigger = thing();
    lastGunTriggerUID = s.i32();
  }
  if (version >= 0x272) airTimeLeft = s.i32();
  // ❗ **Three branch gates wearing version gates' clothes.** LEERDAMMER got the
  // submerged pair at its revision 15 and the two water bools at any revision at
  // all, so a 0x272 file on that branch carries ten bytes this reader used to
  // skip. `headPiece` is the mirror image: LEERDAMMER *removed* it at revision
  // 12, so a 0x17 file does not have it either way.
  if (version >= 0x2c9 || onLeerdammer(s.revision, LD_SUBMERGED)) {
    amountBodySubmerged = s.f32();
    amountHeadSubmerged = s.f32();
  }
  if (version >= 0x289 || onLeerdammer(s.revision, LD_ANY)) hasScubaGear = s.bool();
  // cwlib `before(LEERDAMMER, LD_REMOVED_HEAD_PIECE)`: on the branch and older than 12.
  const headPieceGone = onLeerdammer(s.revision, LD_ANY) && s.revision.branchRevision >= 0xc;
  if ((version >= 0x289 && version < 0x2c8) || (onLeerdammer(s.revision, LD_ANY) && !headPieceGone)) {
    headPiece = s.resource();
  }
  if (version >= 0x289 || onLeerdammer(s.revision, LD_ANY)) outOfWaterJumpBoost = s.bool();
  if (version >= 0x2a9) handPiece = s.resource();
  if (version >= 0x273) {
    head = thing();
    toolTetherJoint = thing();
    toolTetherWidth = s.f32();
    jetpack = thing();
    wallJumpDir = s.s32();
    wallJumpPos = s.vector3();
    bootContactForceList = Array.from({ length: s.count() }, () => s.vector3());
    gunType = s.s32();
    wallJumpMat = s.bool();
  }
  if (version >= 0x29e && version < 0x336) lastDirectControlPrompt = thing();
  if (version > 0x2e4) directControlPrompt = thing();
  if (version >= 0x29e && version < 0x336) {
    smoothedDirectControlStick = s.vector3();
    directControlAnimFrame = s.i16();
    directControlAnimState = s.u8();
  }
  if (version >= 0x29f && version < 0x2c1) directControlMode = s.u8();
  if (version >= 0x2c1 && version < 0x336) s.u8();
  if (version >= 0x2a5) {
    responsiblePlayer = s.i32();
    responsibleFramesLeft = s.i32();
  }
  if (version >= 0x32c) canDropPowerup = s.bool();
  if (version >= 0x3f0) capeExtraMaxVelocityCap = s.u8();
  if (version >= 0x35a) behavior = s.i32();
  if (version >= 0x373) effectDestroy = s.i32();
  if (version >= 0x3c0) whipSim = readKept(s, (self) => readWhipSim(self, readers));
  const vita = vitaRevision(s.revision);
  if (vita >= 0 && vita < 0x53) s.u8();
  if (vita >= 0x53) shootAtTouch = s.i32();
  if (subVersion >= 0x88 && subVersion <= 0xa4) s.resource();
  if (subVersion >= 0xaa) alternateFormWorld = thing();
  if (subVersion >= 0xd7) hookHatState = s.i32();
  if (subVersion >= 0xd7 && subVersion < 0xea) {
    thing();
    thing();
  }
  if (subVersion >= 0xdf) hookHatBogey = thing();
  if (subVersion >= 0x196) {
    flyingTimers = Array.from({ length: 7 }, () => s.i32());
    flyingLegScale = s.f32();
    flyingVels = s.vector4();
    flyingFlapLockout = s.bool();
    flyingFallLockout = s.bool();
    flyingInWind = s.bool();
    flyingThrustLatched = s.bool();
    glidingTime = s.i16();
  }
  if (subVersion >= 0x20c) {
    springState = s.u8();
    springHasSprung = s.bool();
    spring = readKept(s, (self): CreatureSpring => ({
      springThing: readThingRef(self, readers),
      springTimer: self.i32(),
      springDirection: self.vector3(),
      springThingPosition: self.vector3(),
    }));
    springPower = s.u8();
    springSeparateForces = s.bool();
    springForce = s.u8();
    springStateTimer = s.u8();
  }
  return {
    config, state, speedModifier, jumpModifier, strengthModifier, legs, lifeSources, eyes, brainsAi,
    brainsLife, jumpFrame, groundDistance, groundNormal, grabJoint, jumpingOff, stateTimer, zMode,
    playerAwareness, moveDirection, forceThatSmashedCreature, crushFrames, awarenessRadius,
    bouncepadThingUIDs, grabbedThingUIDs, lifeCreature, aiCreature, jumpInterval, jumpIntervalPhase,
    oldAnimMatrix, animOffset, groundNormalSmooth, bodyAdjustApplied, maxBulletCount,
    ammoFillFactor, fireRate, gunAccuracy, bulletEmitOffset, bulletEmitRotation, gunThing,
    gunTrigger, lastGunTriggerUID, amountBodySubmerged, amountHeadSubmerged, headPiece, head,
    toolTetherJoint, toolTetherWidth, jetpack, wallJumpDir, wallJumpPos, gunType, wallJumpMat,
    smoothedDirectControlStick, directControlAnimFrame, directControlAnimState, responsiblePlayer,
    responsibleFramesLeft, flyingLegScale, flyingVels, flyingFlapLockout, flyingFallLockout,
    flyingInWind, flyingThrustLatched, glidingTime, springState, springHasSprung, springPower,
    springSeparateForces, springForce, springStateTimer, subState, airTime,
    haveNotTouchedGroundSinceUsingJetpack, meshDirty, reactToLethal, groundNormalRaw, switchScale,
    gunDirAndDashVec, gunDirAndDashVecW, resourceThing, gunFireFrame, bulletCount,
    bulletImmuneTimer, bulletEmitter0, bulletEmitter1, bulletPosIndex, gunDirPrecisionMode,
    airTimeLeft, hasScubaGear, outOfWaterJumpBoost, handPiece, lastDirectControlPrompt,
    directControlPrompt, directControlMode, canDropPowerup, capeExtraMaxVelocityCap, behavior,
    effectDestroy, shootAtTouch, alternateFormWorld, hookHatState, hookHatBogey, whipSim, spring, bootContactForceList, flyingTimers,
    ...(retiredFloat0x178 ? { retiredFloat0x178 } : {}),
  };
}

function writeWhipSim(w: Writer, v: WhipSim, ctx: PartWriteContext): void {
  ctx.thing(w, v.creatureThing);
  w.matrix(v.baseHandleMatrix);
  w.vector3(v.prevDir);
  w.vector3(v.currDir);
  w.i32(v.stateTimer);
  w.i8(v.state);
  ctx.thing(w, v.attachedThing);
  w.vector3(v.attachedLocalPos);
  w.vector3(v.attachedLocalNormal);
  w.f32(v.attachedLocalAngle);
  w.f32(v.attachedScale);
  w.bool(v.playedFailToFireSound);
  w.f32(v.attachedZOffset);
}

const ZERO3 = [0, 0, 0] as const;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** `readCreature`'s mirror; the reads it discards are written as cwlib writes them, 0, false or null. */
export function writeCreature(w: Writer, v: CreaturePart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const thing = (t: Thing | undefined) => ctx.thing(w, t);
  w.ref(v.config);
  if (version < 0x155) w.i32(0);
  w.s32(v.jumpFrame);
  w.f32(v.groundDistance);
  w.vector3(v.groundNormal);
  thing(v.grabJoint);
  if (version < 0x13c) thing(undefined);
  thing(v.jumpingOff);
  w.i32(v.state);
  if (subVersion >= 0x132) w.i32(v.subState ?? 0);
  w.i32(v.stateTimer);
  w.f32(v.speedModifier);
  w.f32(v.jumpModifier);
  w.f32(v.strengthModifier);
  if (version < 0x142) w.vector4([0, 0, 0, 0]);
  w.i32(v.zMode);
  if (version < 0x146) w.i32(0);
  if (version > 0x145 && version < 0x1f0) {
    w.i32(0);
    w.i32(0);
    w.bool(false);
    w.bool(false);
    w.i32(0);
  }
  w.s32(v.playerAwareness);
  w.s32(v.moveDirection);
  if (version < 0x15d) w.u8(0);
  if (version < 0x1f0) {
    w.i32(0);
    w.f32(0);
  }
  w.vector3(v.forceThatSmashedCreature);
  w.i32(v.crushFrames);
  w.f32(v.awarenessRadius);
  if (version >= 0x1df) w.i32(v.airTime ?? 0);
  if (version >= 0x354) {
    w.intVector(v.bouncepadThingUIDs ?? []);
    w.intVector(v.grabbedThingUIDs ?? []);
  }
  if (version >= 0x221) w.bool(v.haveNotTouchedGroundSinceUsingJetpack ?? false);
  if (version >= 0x15d) {
    writeThingArray(w, ctx, v.legs);
    if (version < 0x166) {
      writeThingArray(w, ctx, []);
      writeThingArray(w, ctx, []);
    }
    writeThingArray(w, ctx, v.lifeSources);
    thing(v.lifeCreature);
    thing(v.aiCreature);
  }
  if (version >= 0x163) {
    w.i32(v.jumpInterval ?? 0);
    w.i32(v.jumpIntervalPhase ?? 0);
  }
  if (version > 0x162 && version < 0x16d) w.bool(false);
  if (version >= 0x169) w.bool(v.meshDirty ?? false);
  if (version >= 0x166) {
    writeThingArray(w, ctx, v.eyes);
    writeThingArray(w, ctx, v.brainsAi);
    writeThingArray(w, ctx, v.brainsLife);
  }
  if (version > 0x177 && version < 0x1e3) w.bytes(v.retiredFloat0x178 ?? new Uint8Array(4));
  if (version >= 0x19c) w.bool(v.reactToLethal ?? false);
  if (version >= 0x1a9) {
    w.matrix(v.oldAnimMatrix ?? IDENTITY);
    w.f32(v.animOffset ?? 0);
  }
  if (version > 0x1ed && version < 0x225) w.s32(0);
  if (version >= 0x1fc) w.vector3(v.groundNormalRaw ?? ZERO3);
  if (version >= 0x212) {
    w.vector3(v.groundNormalSmooth ?? ZERO3);
    w.f32(v.bodyAdjustApplied ?? 0);
  }
  if (version >= 0x240 && version < 0x2c4) w.f32(v.switchScale ?? 0);
  if (version > 0x242 && version < 0x24d) w.ref(undefined);
  if (version >= 0x243) w.vector3(v.gunDirAndDashVec ?? ZERO3);
  if (subVersion >= 0x19e) w.f32(v.gunDirAndDashVecW ?? 0);
  if (version >= 0x246) thing(v.resourceThing);
  if (version >= 0x247) w.i32(v.gunFireFrame ?? 0);
  if (version >= 0x248) w.i32(v.bulletCount ?? 0);
  if (version >= 0x24a) w.i32(v.bulletImmuneTimer ?? 0);
  if (version >= 0x24d) thing(v.bulletEmitter0);
  if (version >= 0x3a2) thing(v.bulletEmitter1);
  if (version >= 0x24e) w.i32(v.bulletPosIndex ?? 0);
  if (version >= 0x24f) {
    w.i32(v.maxBulletCount ?? 0);
    w.f32(v.ammoFillFactor ?? 0);
  }
  if (version >= 0x252) w.bool(v.gunDirPrecisionMode ?? false);
  if (version >= 0x320) {
    w.i32(v.fireRate ?? 0);
    w.f32(v.gunAccuracy ?? 0);
    w.vector3(v.bulletEmitOffset ?? ZERO3);
    w.f32(v.bulletEmitRotation ?? 0);
    thing(v.gunThing);
    thing(v.gunTrigger);
    w.i32(v.lastGunTriggerUID ?? 0);
  }
  if (version >= 0x272) w.i32(v.airTimeLeft ?? 0);
  if (version >= 0x2c9 || onLeerdammer(w.revision, LD_SUBMERGED)) {
    w.f32(v.amountBodySubmerged ?? 0);
    w.f32(v.amountHeadSubmerged ?? 0);
  }
  if (version >= 0x289 || onLeerdammer(w.revision, LD_ANY)) w.bool(v.hasScubaGear ?? false);
  const headPieceGone = onLeerdammer(w.revision, LD_ANY) && w.revision.branchRevision >= 0xc;
  if ((version >= 0x289 && version < 0x2c8) || (onLeerdammer(w.revision, LD_ANY) && !headPieceGone)) {
    w.ref(v.headPiece);
  }
  if (version >= 0x289 || onLeerdammer(w.revision, LD_ANY)) w.bool(v.outOfWaterJumpBoost ?? false);
  if (version >= 0x2a9) w.ref(v.handPiece);
  if (version >= 0x273) {
    thing(v.head);
    thing(v.toolTetherJoint);
    w.f32(v.toolTetherWidth ?? 0);
    thing(v.jetpack);
    w.s32(v.wallJumpDir ?? 0);
    w.vector3(v.wallJumpPos ?? ZERO3);
    const forces = v.bootContactForceList ?? [];
    w.i32(forces.length);
    for (const force of forces) w.vector3(force);
    w.s32(v.gunType ?? 0);
    w.bool(v.wallJumpMat ?? false);
  }
  if (version >= 0x29e && version < 0x336) thing(v.lastDirectControlPrompt);
  if (version > 0x2e4) thing(v.directControlPrompt);
  if (version >= 0x29e && version < 0x336) {
    w.vector3(v.smoothedDirectControlStick ?? ZERO3);
    w.i16(v.directControlAnimFrame ?? 0);
    w.u8(v.directControlAnimState ?? 0);
  }
  if (version >= 0x29f && version < 0x2c1) w.u8(v.directControlMode ?? 0);
  if (version >= 0x2c1 && version < 0x336) w.u8(0);
  if (version >= 0x2a5) {
    w.i32(v.responsiblePlayer ?? 0);
    w.i32(v.responsibleFramesLeft ?? 0);
  }
  if (version >= 0x32c) w.bool(v.canDropPowerup ?? false);
  if (version >= 0x3f0) w.u8(v.capeExtraMaxVelocityCap ?? 0);
  if (version >= 0x35a) w.i32(v.behavior ?? 0);
  if (version >= 0x373) w.i32(v.effectDestroy ?? 0);
  if (version >= 0x3c0) writeKept(w, v.whipSim, (self, sim) => writeWhipSim(self, sim, ctx));
  const vita = vitaRevision(w.revision);
  if (vita >= 0 && vita < 0x53) w.u8(0);
  if (vita >= 0x53) w.i32(v.shootAtTouch ?? 0);
  if (subVersion >= 0x88 && subVersion <= 0xa4) w.ref(undefined);
  if (subVersion >= 0xaa) thing(v.alternateFormWorld);
  if (subVersion >= 0xd7) w.i32(v.hookHatState ?? 0);
  if (subVersion >= 0xd7 && subVersion < 0xea) {
    thing(undefined);
    thing(undefined);
  }
  if (subVersion >= 0xdf) thing(v.hookHatBogey);
  if (subVersion >= 0x196) {
    for (let i = 0; i < 7; i += 1) w.i32(v.flyingTimers?.[i] ?? 0);
    w.f32(v.flyingLegScale ?? 0);
    w.vector4(v.flyingVels ?? [0, 0, 0, 0]);
    w.bool(v.flyingFlapLockout ?? false);
    w.bool(v.flyingFallLockout ?? false);
    w.bool(v.flyingInWind ?? false);
    w.bool(v.flyingThrustLatched ?? false);
    w.i16(v.glidingTime ?? 0);
  }
  if (subVersion >= 0x20c) {
    w.u8(v.springState ?? 0);
    w.bool(v.springHasSprung ?? false);
    writeKept(w, v.spring, (self, spring) => {
      ctx.thing(self, spring.springThing);
      self.i32(spring.springTimer);
      self.vector3(spring.springDirection);
      self.vector3(spring.springThingPosition);
    });
    w.u8(v.springPower ?? 0);
    w.bool(v.springSeparateForces ?? false);
    w.u8(v.springForce ?? 0);
    w.u8(v.springStateTimer ?? 0);
  }
}
