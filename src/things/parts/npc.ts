/** `NPC`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';
import { tapeObjectOf } from '../../io/tape.ts';

type V3 = readonly [number, number, number];

/**
 * The id each struct read through `readKept` had in its file. ❗ The game does
 * not number its references in first-mention order, so a struct written back
 * under a fresh id differs from the file in its id alone -- 21 of the 242 NPCs in
 * the game's first 3000 levels and plans did -- and `Writer.reference` takes the
 * id kept here to write it as it was.
 */
const fileIds = new WeakMap<object, number>();

/** `s.reference(build)`, keeping the id the struct had in the file for `writeKept`. */
export function readKept<T extends object>(s: Serializer, build: (self: Serializer) => T): T | undefined {
  return s.reference((self) => {
    // `Serializer.reference` enters the new id last, as a placeholder, before it builds.
    let id = 0;
    for (const key of self.referenced.keys()) id = key;
    const value = build(self);
    fileIds.set(value, id);
    return value;
  });
}

/** `readKept`'s mirror: `w.reference` under the struct's id from its file, where it has one. */
export function writeKept<T extends object>(w: Writer, value: T | undefined, write: (self: Writer, value: T) => void): void {
  // Under the tape's object where the struct has one: the tape writes it under that key wherever another Thing names it.
  if (!value) {
    w.reference(undefined, () => {});
    return;
  }
  const object = tapeObjectOf(value);
  w.reference<object>(object ?? value, (self) => write(self, value), object?.id ?? fileIds.get(value));
}

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
  if (version > 0x295) out.actingData = readKept(s, (self) => readActingData(self, readers));
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
  /**
   * The byte behind `isCurrentJumpFlipped`, where it is neither 0 nor 1: the game
   * writes a true one as 13 -- every one of the 29 set in its first 400 levels and
   * plans (`dev/part-census.ts`) -- and only it writes the part back as it was.
   */
  readonly isCurrentJumpFlippedByte?: number;
  readonly curSource: V3;
  readonly curTarget0: V3;
  readonly curTarget1: V3;
  readonly currentJump: number;
  readonly currentJumpPos: number;
}

function readNpcJumpSolver(s: Serializer): NpcJumpSolver | undefined {
  if (s.revision.version <= 0x2cd) return undefined;
  const flipped = s.u8();
  return {
    isCurrentJumpFlipped: flipped !== 0,
    ...(flipped > 1 ? { isCurrentJumpFlippedByte: flipped } : {}),
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
    out.behavior = readKept(s, (self) => readNpcBehavior(self, readers));
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

const ZERO3 = [0, 0, 0] as const;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function writeInputRecording(w: Writer, v: InputRecording): void {
  const { version } = w.revision;
  if (version > 0x28f) {
    const input = v.inputBuffer ?? new Uint8Array(0);
    w.i32(input.length);
    w.bytes(input);
    w.intVector(v.offsetBuffer ?? []);
  }
  if (version > 0x2a5) w.intVector(v.absoluteExpressionBuffer ?? []);
  if (version > 0x2dd) {
    w.matrix(v.startWorldTransform ?? IDENTITY);
    const graph = v.startLocalSceneGraph ?? [];
    w.i32(graph.length);
    for (const m of graph) w.matrix(m);
  }
  if (version > 0x2df) w.vector3(v.startFootPos ?? ZERO3);
  if (version > 0x2e0) {
    const vels = v.startVelocities ?? [];
    w.i32(vels.length);
    for (const vel of vels) w.vector3(vel);
  }
  if (version > 0x3c4) w.bool(v.recordingContainsMoveData ?? false);
  if (vitaRevision(w.revision) >= 0x3a) w.bool(v.recordingContainsVitaData ?? false);
}

function writeActingData(w: Writer, v: ActingData, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  if (version > 0x2d9) {
    w.i32(v.state ?? 0);
    ctx.thing(w, v.recordingNpc);
  }
  if (version > 0x295) {
    writeInputRecording(w, v.recording ?? {});
    ctx.thing(w, v.recordingPlayer);
    w.i32(v.currentFrame ?? 0);
  }
  if (version > 0x2a5) w.s32(v.recordingCountdown ?? 0);
  if (version >= 0x33e) w.ref(v.voipRecording);
  if (subVersion >= 0xb6) w.bool(v.transformOnRestart ?? false);
  if (subVersion >= 0xbd) w.u8(v.previousState ?? 0);
}

/** `readNpcBehavior`'s mirror. */
export function writeNpcBehavior(w: Writer, v: NpcBehavior, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  if (version <= 0x293) return;
  ctx.thing(w, v.npc);
  ctx.thing(w, v.targetThing);
  w.s32(v.type ?? 0);
  w.i32(v.attributes ?? 0);
  w.f32(v.maxMoveSpeed ?? 0);
  w.s32(v.maxWaitTime ?? 0);
  if (version > 0x2e5) w.wstr(v.waypointKeyName ?? '');
  if (version > 0x2d4) w.s32(v.waypointKeyColorIndex ?? 0);
  if (version > 0x2e5) {
    w.wstr(v.poiKeyName ?? '');
    w.s32(v.poiKeyColorIndex ?? 0);
  }
  if (version > 0x295) writeKept(w, v.actingData, (self, data) => writeActingData(self, data, ctx));
  if (version > 0x2ac) {
    w.f32(v.awarenessRadius ?? 0);
    w.i32(v.sharedStateTimer ?? 0);
    w.vector3(v.idleLookAtPos ?? ZERO3);
  }
  if (version > 0x2d7) w.vector3(v.lastGoodPosition ?? ZERO3);
  if (version > 0x2d8) w.bool(v.lastPositionValid ?? false);
  if (version > 0x2ce) {
    w.vector3(v.patrolDirection ?? ZERO3);
    for (let i = 0; i < 8; i += 1) w.s32(v.patrolGrid?.[i] ?? 0);
  }
  if (version > 0x2e6) w.s32(v.animSet ?? 0);
  if (version > 0x371) {
    w.u8(v.expressionType ?? 0);
    w.u8(v.expressionLevel ?? 0);
  }
  if (version > 0x375) w.bool(v.willRecordAudio ?? false);
  if (vitaRevision(w.revision) >= 0x16) w.u8(v.multiJumpLevel ?? 0);
  if (subVersion > 0xc6) w.i32(v.awarenessRange ?? 0);
  if (subVersion > 0x10e) w.f32(v.lookAtSpeed ?? 0);
  if (subVersion > 0x175) w.bool(v.showAdvancedOptions ?? false);
}

/** `readNpc`'s mirror; the reads it discards are written as cwlib writes them, 0. */
export function writeNpc(w: Writer, v: NpcPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  if (version < 0x273) return;
  if (version > 0x2cd) {
    const j = v.jumpSolver;
    w.u8(j?.isCurrentJumpFlipped ? (j.isCurrentJumpFlippedByte ?? 1) : 0);
    w.vector3(j?.curSource ?? ZERO3);
    w.vector3(j?.curTarget0 ?? ZERO3);
    w.vector3(j?.curTarget1 ?? ZERO3);
    w.s32(j?.currentJump ?? 0);
    w.i32(j?.currentJumpPos ?? 0);
  }
  if (subVersion < 0x118) {
    const sound = v.soundRecording ?? new Uint8Array(0);
    w.i32(sound.length);
    w.bytes(sound);
  }
  w.intVector(v.soundRecordingDataNbytes ?? []);
  w.i32(v.soundRecordingPacket ?? 0);
  w.i32(v.soundRecordingPacketOffset ?? 0);
  w.intVector(v.sackbotRecordingTimes ?? []);
  if (version > 0x2da || (version < 0x29b && version > 0x294)) {
    writeKept(w, v.behavior, (self, behavior) => writeNpcBehavior(self, behavior, ctx));
  }
  if (version > 0x2ac) {
    w.i32(v.flags ?? 0);
    if (version < 0x2ce) w.s32(0);
  }
  if (version > 0x29a) ctx.thing(w, v.behaviorThing);
  if (version > 0x2d5) ctx.thing(w, v.rootBehaviorThing);
  if (version > 0x2cd && version < 0x36e) {
    w.i32(0);
    w.i32(0);
    w.i32(0);
  }
  if (version > 0x2ac) {
    w.vector3(v.moveTarget ?? ZERO3);
    if (version < 0x36e) w.vector3(v.lookAt ?? ZERO3);
    if (version > 0x2d6 && version < 0x2e6) w.vector3(ZERO3);
    if (version < 0x2ce) w.s32(0);
    w.s32(v.waitTime ?? 0);
    if (version < 0x2ce) w.f32(0);
  }
  if (version > 0x2ae) w.i32(v.playerNumber);
  if (version > 0x2aa && version < 0x2d5) w.i32(0);
  if (version > 0x338) w.wstr(v.actorName);
  if (version > 0x353) {
    if (version === 0x354 || version === 0x355) {
      w.f32(0);
      w.f32(0);
    } else {
      w.i32(v.lastTimeThrown ?? 0);
      w.i32(v.lastTimeHitTheGround ?? 0);
    }
    w.i32(v.lastThrower ?? 0);
  }
  if (version > 0x391) w.u8(v.costumeToCopy ?? 0);
  if (subVersion > 0x1a5) w.bool(v.copyFormAsWell ?? false);
}
