/** `NPC`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `InputRecording`: a captured controller performance. */
function readInputRecording(s: Serializer): void {
  const { version } = s.revision;
  if (version > 0x28f) {
    s.skip(s.i32()); // inputBuffer
    s.intVector(); // offsetBuffer
  }
  if (version > 0x2a5) s.intVector(); // absoluteExpressionBuffer
  if (version > 0x2dd) {
    s.skipMatrix(); // startWorldTransform
    const count = s.count();
    for (let i = 0; i < count; i += 1) s.skipMatrix(); // startLocalSceneGraph
  }
  if (version > 0x2df) s.skipVector3(); // startFootPos
  if (version > 0x2e0) {
    const count = s.count();
    for (let i = 0; i < count; i += 1) s.skipVector3(); // startVelocities
  }
  if (version > 0x3c4) s.bool(); // recordingContainsMoveData
}

/** `ActingData`: what a sackbot is performing. */
function readActingData(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  const thing = () => readThingRef(s, readers);
  if (version > 0x2d9) {
    s.i32(); // state
    thing(); // recordingNpc
  }
  if (version > 0x295) {
    readInputRecording(s);
    thing(); // recordingPlayer
    s.i32(); // currentFrame
  }
  if (version > 0x2a5) s.s32(); // recordingCountdown
  if (version >= 0x33e) s.resource(); // VoIPRecording
  if (subVersion >= 0xb6) s.bool(); // transformOnRestart
  if (subVersion >= 0xbd) s.u8(); // previousState
}

/** `NpcBehavior`: how a sackbot patrols, follows or acts. */
export function readNpcBehavior(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  if (version <= 0x293) return;
  const thing = () => readThingRef(s, readers);
  thing(); // npc
  thing(); // targetThing
  s.s32(); // type
  s.i32(); // attributes
  s.f32(); // maxMoveSpeed
  s.s32(); // maxWaitTime
  if (version > 0x2e5) s.wstr(); // waypointKeyName
  if (version > 0x2d4) s.s32(); // waypointKeyColorIndex
  if (version > 0x2e5) {
    s.wstr(); // poiKeyName
    s.s32(); // poiKeyColorIndex
  }
  if (version > 0x295) s.reference((self) => readActingData(self, readers));
  if (version > 0x2ac) {
    s.f32(); // awarenessRadius
    s.i32(); // sharedStateTimer
    s.skipVector3(); // idleLookAtPos
  }
  if (version > 0x2d7) s.skipVector3(); // lastGoodPosition
  if (version > 0x2d8) s.bool(); // lastPositionValid
  if (version > 0x2ce) {
    s.skipVector3(); // patrolDirection
    for (let i = 0; i < 8; i += 1) s.s32(); // the patrol grid counters
  }
  if (version > 0x2e6) s.s32(); // animSet
  if (version > 0x371) {
    s.u8(); // expressionType
    s.u8(); // expressionLevel
  }
  if (version > 0x375) s.bool(); // willRecordAudio
  if (subVersion > 0xc6) s.i32(); // awarenessRange
  if (subVersion > 0x10e) s.f32(); // lookAtSpeed
  if (subVersion > 0x175) s.bool(); // showAdvancedOptions
}

/** `NpcJumpSolver`: where a sackbot is jumping to. */
function readNpcJumpSolver(s: Serializer): void {
  if (s.revision.version > 0x2cd) {
    s.bool(); // isCurrentJumpFlipped
    s.skipVector3(); // curSource
    s.skipVector3(); // curTarget0
    s.skipVector3(); // curTarget1
    s.s32(); // currentJump
    s.i32(); // currentJumpPos
  }
}

/** `PNpc`: a sackbot's runtime state. */
export function readNpc(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  if (version < 0x273) return;
  readNpcJumpSolver(s);
  if (subVersion < 0x118) s.skip(s.i32()); // soundRecording
  s.intVector(); // soundRecordingDataNbytes
  s.i32(); // soundRecordingPacket
  s.i32(); // soundRecordingPacketOffset
  s.intVector(); // sackbotRecordingTimes
  if (version > 0x2da || (version < 0x29b && version > 0x294)) {
    s.reference((self) => readNpcBehavior(self, readers));
  }
  if (version > 0x2ac) {
    s.i32(); // flags
    if (version < 0x2ce) s.s32();
  }
  if (version > 0x29a) readThingRef(s, readers); // behaviorThing
  if (version > 0x2d5) readThingRef(s, readers); // rootBehaviorThing
  if (version > 0x2cd && version < 0x36e) {
    s.i32();
    s.i32();
    s.i32();
  }
  if (version > 0x2ac) {
    s.skipVector3(); // moveTarget
    if (version < 0x36e) s.skipVector3(); // lookAt
    if (version > 0x2d6 && version < 0x2e6) s.skipVector3();
    if (version < 0x2ce) s.s32();
    s.s32(); // waitTime
    if (version < 0x2ce) s.f32();
  }
  if (version > 0x2ae) s.i32(); // playerNumber
  if (version > 0x2aa && version < 0x2d5) s.i32();
  if (version > 0x338) s.wstr(); // actorName
  if (version > 0x353) {
    if (version === 0x354 || version === 0x355) {
      s.f32();
      s.f32();
    } else {
      s.i32(); // lastTimeThrown
      s.i32(); // lastTimeHitTheGround
    }
    s.i32(); // lastThrower
  }
  if (version > 0x391) s.u8(); // costumeToCopy
  if (subVersion > 0x1a5) s.bool(); // copyFormAsWell
}
