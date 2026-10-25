/** `NPC`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

type V3 = readonly [number, number, number];

/** `InputRecording`: a captured controller performance. */
export interface InputRecording {
  readonly inputBuffer?: Uint8Array;
  readonly offsetBuffer?: readonly number[];
  readonly absoluteExpressionBuffer?: readonly number[];
  readonly startWorldTransform?: Float32Array;
  readonly startLocalSceneGraph?: readonly Float32Array[];
  readonly startFootPos?: V3;
  readonly startVelocities?: readonly V3[];
  readonly recordingContainsMoveData?: boolean;
  readonly recordingContainsVitaData?: boolean;
}

function readInputRecording(s: Serializer): InputRecording {
  const { version } = s.revision;
  const out: { -readonly [K in keyof InputRecording]: InputRecording[K] } = {};
  if (version > 0x28f) {
    out.inputBuffer = s.bytes(s.i32());
    out.offsetBuffer = s.intVector();
  }
  if (version > 0x2a5) out.absoluteExpressionBuffer = s.intVector();
  if (version > 0x2dd) {
    out.startWorldTransform = s.matrix();
    out.startLocalSceneGraph = Array.from({ length: s.count() }, () => s.matrix());
  }
  if (version > 0x2df) out.startFootPos = s.vector3();
  if (version > 0x2e0) out.startVelocities = Array.from({ length: s.count() }, () => s.vector3());
  if (version > 0x3c4) out.recordingContainsMoveData = s.bool();
  if (vitaRevision(s.revision) >= 0x3a) out.recordingContainsVitaData = s.bool();
  return out;
}

/** `ActingData`: what a sackbot is performing. */
export interface ActingData {
  readonly state?: number;
  readonly recordingNpc?: Thing;
  readonly recording?: InputRecording;
  readonly recordingPlayer?: Thing;
  readonly currentFrame?: number;
  readonly recordingCountdown?: number;
  /** An `RVoipRecording`. */
  readonly voipRecording?: ResourceRef;
  readonly transformOnRestart?: boolean;
  readonly previousState?: number;
}

function readActingData(s: Serializer, readers: ReadonlyMap<string, PartReader>): ActingData {
  const { version, subVersion } = s.revision;
  const thing = () => readThingRef(s, readers);
  const out: { -readonly [K in keyof ActingData]: ActingData[K] } = {};
  if (version > 0x2d9) {
    out.state = s.i32();
    out.recordingNpc = thing();
  }
  if (version > 0x295) {
    out.recording = readInputRecording(s);
    out.recordingPlayer = thing();
    out.currentFrame = s.i32();
  }
  if (version > 0x2a5) out.recordingCountdown = s.s32();
  if (version >= 0x33e) out.voipRecording = s.resource();
  if (subVersion >= 0xb6) out.transformOnRestart = s.bool();
  if (subVersion >= 0xbd) out.previousState = s.u8();
  return out;
}

/** `NpcBehavior`: how a sackbot patrols, follows or acts; nothing below version `0x294`. */
export interface NpcBehavior {
  readonly npc?: Thing;
  readonly targetThing?: Thing;
  readonly type?: number;
  readonly attributes?: number;
  readonly maxMoveSpeed?: number;
  readonly maxWaitTime?: number;
  readonly waypointKeyName?: string;
  readonly waypointKeyColorIndex?: number;
  readonly poiKeyName?: string;
  readonly poiKeyColorIndex?: number;
  readonly actingData?: ActingData;
  readonly awarenessRadius?: number;
  readonly sharedStateTimer?: number;
  readonly idleLookAtPos?: V3;
  readonly lastGoodPosition?: V3;
  readonly lastPositionValid?: boolean;
  readonly patrolDirection?: V3;
  /** The eight patrol grid counters. */
  readonly patrolGrid?: readonly number[];
  readonly animSet?: number;
  readonly expressionType?: number;
  readonly expressionLevel?: number;
  readonly willRecordAudio?: boolean;
  readonly multiJumpLevel?: number;
  readonly awarenessRange?: number;
  readonly lookAtSpeed?: number;
  readonly showAdvancedOptions?: boolean;
}

export function readNpcBehavior(s: Serializer, readers: ReadonlyMap<string, PartReader>): NpcBehavior {
  const { version, subVersion } = s.revision;
  const out: { -readonly [K in keyof NpcBehavior]: NpcBehavior[K] } = {};
  if (version <= 0x293) return out;
  const thing = () => readThingRef(s, readers);
  out.npc = thing();
  out.targetThing = thing();
  out.type = s.s32();
  out.attributes = s.i32();
  out.maxMoveSpeed = s.f32();
  out.maxWaitTime = s.s32();
  if (version > 0x2e5) out.waypointKeyName = s.wstr();
  if (version > 0x2d4) out.waypointKeyColorIndex = s.s32();
  if (version > 0x2e5) {
    out.poiKeyName = s.wstr();
    out.poiKeyColorIndex = s.s32();
  }
  if (version > 0x295) out.actingData = s.reference((self) => readActingData(self, readers));
  if (version > 0x2ac) {
    out.awarenessRadius = s.f32();
    out.sharedStateTimer = s.i32();
    out.idleLookAtPos = s.vector3();
  }
  if (version > 0x2d7) out.lastGoodPosition = s.vector3();
  if (version > 0x2d8) out.lastPositionValid = s.bool();
  if (version > 0x2ce) {
    out.patrolDirection = s.vector3();
    out.patrolGrid = Array.from({ length: 8 }, () => s.s32());
  }
  if (version > 0x2e6) out.animSet = s.s32();
  if (version > 0x371) {
    out.expressionType = s.u8();
    out.expressionLevel = s.u8();
  }
  if (version > 0x375) out.willRecordAudio = s.bool();
  if (vitaRevision(s.revision) >= 0x16) out.multiJumpLevel = s.u8();
  if (subVersion > 0xc6) out.awarenessRange = s.i32();
  if (subVersion > 0x10e) out.lookAtSpeed = s.f32();
  if (subVersion > 0x175) out.showAdvancedOptions = s.bool();
  return out;
}

/** `NpcJumpSolver`: where a sackbot is jumping to. */
export interface NpcJumpSolver {
  readonly isCurrentJumpFlipped: boolean;
  readonly curSource: V3;
  readonly curTarget0: V3;
  readonly curTarget1: V3;
  readonly currentJump: number;
  readonly currentJumpPos: number;
}

function readNpcJumpSolver(s: Serializer): NpcJumpSolver | undefined {
  if (s.revision.version <= 0x2cd) return undefined;
  return {
    isCurrentJumpFlipped: s.bool(),
    curSource: s.vector3(),
    curTarget0: s.vector3(),
    curTarget1: s.vector3(),
    currentJump: s.s32(),
    currentJumpPos: s.i32(),
  };
}

/**
 * `PNpc`: a sackbot's player and name, the Things that drive its behaviour,
 * and the runtime state cwlib names. A field gated off by the file's revision
 * is absent; the few the reader steps over unnamed are not returned.
 */
export interface NpcPart {
  readonly behaviorThing?: Thing;
  readonly rootBehaviorThing?: Thing;
  readonly playerNumber: number;
  readonly actorName: string;
  readonly jumpSolver?: NpcJumpSolver;
  /** Below subVersion `0x118`. */
  readonly soundRecording?: Uint8Array;
  readonly soundRecordingDataNbytes?: readonly number[];
  readonly soundRecordingPacket?: number;
  readonly soundRecordingPacketOffset?: number;
  readonly sackbotRecordingTimes?: readonly number[];
  readonly behavior?: NpcBehavior;
  readonly flags?: number;
  readonly moveTarget?: V3;
  readonly lookAt?: V3;
  readonly waitTime?: number;
  readonly lastTimeThrown?: number;
  readonly lastTimeHitTheGround?: number;
  readonly lastThrower?: number;
  readonly costumeToCopy?: number;
  readonly copyFormAsWell?: boolean;
}

export function readNpc(s: Serializer, readers: ReadonlyMap<string, PartReader>): NpcPart {
  const { version, subVersion } = s.revision;
  const out: { -readonly [K in keyof NpcPart]: NpcPart[K] } = { playerNumber: 0, actorName: '' };
  if (version < 0x273) return out;
  out.jumpSolver = readNpcJumpSolver(s);
  if (subVersion < 0x118) out.soundRecording = s.bytes(s.i32());
  out.soundRecordingDataNbytes = s.intVector();
  out.soundRecordingPacket = s.i32();
  out.soundRecordingPacketOffset = s.i32();
  out.sackbotRecordingTimes = s.intVector();
  if (version > 0x2da || (version < 0x29b && version > 0x294)) {
    out.behavior = s.reference((self) => readNpcBehavior(self, readers));
  }
  if (version > 0x2ac) {
    out.flags = s.i32();
    if (version < 0x2ce) s.s32();
  }
  if (version > 0x29a) out.behaviorThing = readThingRef(s, readers);
  if (version > 0x2d5) out.rootBehaviorThing = readThingRef(s, readers);
  if (version > 0x2cd && version < 0x36e) {
    s.i32();
    s.i32();
    s.i32();
  }
  if (version > 0x2ac) {
    out.moveTarget = s.vector3();
    if (version < 0x36e) out.lookAt = s.vector3();
    if (version > 0x2d6 && version < 0x2e6) s.skipVector3();
    if (version < 0x2ce) s.s32();
    out.waitTime = s.s32();
    if (version < 0x2ce) s.f32();
  }
  if (version > 0x2ae) out.playerNumber = s.i32();
  if (version > 0x2aa && version < 0x2d5) s.i32();
  if (version > 0x338) out.actorName = s.wstr();
  if (version > 0x353) {
    if (version === 0x354 || version === 0x355) {
      s.f32();
      s.f32();
    } else {
      out.lastTimeThrown = s.i32();
      out.lastTimeHitTheGround = s.i32();
    }
    out.lastThrower = s.i32();
  }
  if (version > 0x391) out.costumeToCopy = s.u8();
  if (subVersion > 0x1a5) out.copyFormAsWell = s.bool();
  return out;
}
