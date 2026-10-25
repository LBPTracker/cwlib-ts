/** `SWITCH`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { hasPlayerMode, things } from './common.ts';
import { readNetworkOnlineId } from '../../structs/network.ts';

/** `SwitchType` values this reader has to branch on. */
const SWITCH_STICKER = 5;

const SWITCH_MICROCHIP = 36;

const SWITCH_POCKET_ITEM = 50;

const SWITCH_DATA_SAMPLER = 65;

const SWITCH_GAME_LIVE_STREAMING_CHOICE = 75;

/** `SwitchSignal`: an activation level, a ternary state and a player index. */
export function readSwitchSignal(s: Serializer): void {
  const { version } = s.revision;
  s.f32(); // activation
  if (version >= 0x310) s.s32(); // ternary
  if (version >= 0x2a3) s.i32(); // player
}

/** `SwitchTarget`: one wire, to a Thing's input port. */
export interface SwitchTarget {
  readonly thing?: Thing;
  /** The input port on that Thing; 0 below `0x327`, which has none. */
  readonly port: number;
}

/** `SwitchTarget`: one Thing a switch drives, and which port on it. */
function readSwitchTarget(s: Serializer, readers: ReadonlyMap<string, PartReader>): SwitchTarget {
  const thing = readThingRef(s, readers);
  const port = s.revision.version > 0x326 ? s.i32() : 0;
  return { thing, port };
}

/** `SwitchOutput`: one output port and everything wired to it. */
function readSwitchOutput(s: Serializer, readers: ReadonlyMap<string, PartReader>): SwitchTarget[] {
  readSwitchSignal(s);
  const count = s.count();
  const targets: SwitchTarget[] = [];
  for (let i = 0; i < count; i += 1) targets.push(readSwitchTarget(s, readers));
  if (s.revision.version >= 0x34d) s.wstr(); // userDefinedName
  return targets;
}

/** `PSwitch`, what a renderer needs of it: its kind and its wires. steering/level-files.md, *Wires*. */
export interface SwitchPart {
  /** cwlib's `SwitchType`; 0 below `0x1a5`. */
  readonly type: number;
  readonly hideInPlayMode: boolean;
  /** Each output port's wires, in port order; one output below `0x329`. */
  readonly outputs: SwitchTarget[][];
}

/**
 * `PSwitch`: the logic behind every switch, sensor and gate on a circuit board.
 *
 * The longest part in the format, and the one with the most branches that depend
 * on **data rather than revision**: `stickerPlan` appears or not according to
 * the switch's own `type` (and, for a microchip, on the value of
 * `includeTouching` read a few fields earlier), and a data sampler carries an
 * extra block. Reading `type` and then ignoring it works on every level that
 * happens to use no stickers.
 */
export function readSwitch(s: Serializer, readers: ReadonlyMap<string, PartReader>): SwitchPart {
  const { version, subVersion } = s.revision;
  s.bool(); // inverted
  s.f32(); // radius
  if (version >= 0x382) s.f32(); // minRadius
  s.s32(); // colorIndex
  if (version >= 0x2dc) s.wstr(); // name
  if (version >= 0x38f) s.bool(); // crappyOldLbp1Switch
  s.s32(); // behaviorOld

  const outputs: SwitchTarget[][] = [];
  if (version < 0x329) {
    s.f32(); // the single output's activation
    if (version > 0x2a2) s.i32(); // player
    const count = s.count();
    const targets: SwitchTarget[] = [];
    for (let i = 0; i < count; i += 1) targets.push(readSwitchTarget(s, readers));
    outputs.push(targets);
  } else {
    const count = s.count();
    for (let i = 0; i < count; i += 1) {
      outputs.push(s.reference((self) => readSwitchOutput(self, readers)) ?? []);
    }
  }

 
  if (version < 0x398 && version >= 0x140) s.resource(true); // stickerPlan

  const hideInPlayMode = version > 0x197 ? s.bool() : false;
  let type = 0;
  if (version > 0x1a4) {
    // ⚠️ `enum32(type, true)` — the second argument is **signed**, not "force
    // fixed-width", so this is a zigzag varint. Read plainly it still consumes
    // the right number of bytes for small values, which is why seven levels
    // parsed anyway; what it gets wrong is the *value*, and `type` decides
    // whether a sticker plan follows. A wrong type here costs one byte, one
    // Thing later.
    type = s.s32();
    readThingRef(s, readers); // referenceThing
    readSwitchSignal(s); // manualActivation
  }

  // ⚠️ Data-dependent: only a sticker switch (or a pocket item, above subVersion
  // 0x10) carries a plan here.
  if (
    version >= 0x398 &&
    (type === SWITCH_STICKER || (type === SWITCH_POCKET_ITEM && subVersion > 0x10))
  ) {
    s.resource(true);
  }

  if (version > 0x1a4 && version < 0x368) s.f32(); // platformVisualFactor
  if (version > 0x1a4 && version < 0x2a0) s.f32(); // oldActivation
  if (version > 0x1a4) s.s32(); // activationHoldTime
  if (version > 0x1a4) s.bool(); // requireAll
  const vita = vitaRevision(s.revision);
  if (vita >= 0x2a) s.u8(); // impactSensorMode
  // ❗ **The connector block, gone at 0x327 and about fifty bytes wide.** Nothing
  // above `LBP3_MIN_VERSION` has it; it is ported for the LBP1 files read with
  // the bound lowered by hand, and leaving it out is most of why an LBP1 switch
  // was read 91 bytes short.
  if (version > 0x1fa && version < 0x327) {
    const positions = s.count();
    // ⚠️ cwlib `vectorarray` returns Vector4f[], so these are v4 and not v3.
    for (let i = 0; i < positions; i += 1) s.skipVector4(); // connectorPos
    const grabbed = s.count();
    for (let i = 0; i < grabbed; i += 1) s.bool(); // connectorGrabbed
    s.skipVector4(); // portPosOffset
    s.skipVector4(); // looseConnectorPos
    s.skipVector4(); // looseConnectorBaseOffset
    s.bool();
  }

  let includeTouching = 0;
  if (version > 0x23d) {
    s.f32(); // angleRange
    includeTouching = s.s32();
    if (version >= 0x398 && type === SWITCH_MICROCHIP && includeTouching === 1) {
      s.resource(true); // stickerPlan
    }
  }

  if (subVersion > 0x165 && type === SWITCH_GAME_LIVE_STREAMING_CHOICE) {
    throw new SerializerError(
      'a live-streaming-choice switch carries fields cwlib does not implement either',
    );
  }

  if (version > 0x243) s.s32(); // bulletsRequired
  if (version === 0x244) s.i32();
  if (version > 0x244) s.s32(); // bulletsDetected
  if (version > 0x245 && version < 0x398) s.i32(); // bulletPlayerNumber
  if (version > 0x248) s.i32(); // bulletRefreshTime
  if (version >= 0x2f5) s.bool(); // resetWhenFull
  if (version > 0x24a && version < 0x327) s.bool(); // hideConnectors
  if (version > 0x272 && version < 0x398) s.i32(); // logicType
  if (version > 0x272 && version < 0x369) s.i32(); // updateFrame
  if (version > 0x272) things(s, readers); // inputList
  if (version > 0x276 && version < 0x327) readThingRef(s, readers);
  if (version > 0x283) s.bool(); // includeRigidConnectors
  if (version > 0x284 && version < 0x327) {
    s.skipVector4(); // customPortOffset
    s.skipVector4(); // customConnectorOffset
  }
  if (version > 0x28c) {
    s.f32(); // timerCount
    if (version < 0x2c4) s.u8(); // timerAutoCount
  }
  if (version > 0x2ad && subVersion < 0x100) s.i32(); // teamFilter
  if (version > 0x2c3) s.i32(); // behavior, enum32
  if (version < 0x329 && version > 0x2c3) s.s32();
  if (version > 0x2c3) {
    s.i32(); // randomBehavior
    s.i32(); // randomPattern
    s.i32(); // randomOnTimeMin
    s.i32(); // randomOnTimeMax
    s.i32(); // randomOffTimeMin
    s.i32(); // randomOffTimeMax
    if (version < 0x3ad) {
      s.u8(); // randomPhaseOn
      s.s32(); // randomPhaseTime
    }
    s.bool(); // retardedOldJoint
  }
  if (version > 0x30f) s.i32(); // keySensorMode
  if (version > 0x34c) {
    s.i32(); // userDefinedColour
    s.bool(); // wiresVisible
  }
  if (version > 0x34f) s.u8(); // bulletTypes
  if (version > 0x390) s.bool(); // detectUnspawnedPlayers
  if (subVersion > 0x216) s.u8(); // unspawnedBehavior
  if (version > 0x3a4) s.bool(); // playSwitchAudio
  if (vita >= 0) {
    if (vita >= 0x1) s.i32(); // switchTouchType
    if (vita >= 0x6 && vita < 0x36) s.u8();
    if (vita >= 0x9 && vita < 0x2c) s.u32(); // cursorScreenArea, wide
    else if (vita >= 0x2c) s.u8(); // cursorScreenArea
    if (vita >= 0xb) s.u8(); // cursorInteractionType
    if (vita >= 0xc) s.u8(); // cursorTouchPanels
    if (vita >= 0x23) s.u8(); // cursorTouchIndex
    if (vita < 0x36) {
      if (vita >= 0x23) s.u8();
      if (vita >= 0x13) s.u8();
      if (vita >= 0x7) s.u8();
      if (vita >= 0x15) s.u8();
      if (vita >= 0x24) s.u8();
    }
    if (vita >= 0x36) s.u8(); // flags
    if (vita >= 0x2b) s.s32(); // outputAndOr
    if (vita >= 0x2b && vita < 0x36) s.u8();
    if (type === 0x2f) {
      // The Vita's data sampler (cwlib: "although 0x2f shouldn't be the switch type?").
      if (vita >= 0x45) s.i32(); // labelIndex
      if (vita >= 0x46) {
        readNetworkOnlineId(s); // creatorID
        s.wstr(); // labelName
      }
      if (vita >= 0x33) s.array((self) => self.f32()); // analogue
      else if (vita >= 0x2e) s.f32(); // analogue, one
      if (vita >= 0x3c) s.array((self) => self.u8()); // ternary
    }
    if (vita >= 0x38 && vita < 0x41) s.u8();
    if (vita >= 0x41) s.u8(); // includeSameChipTags
    if (vita >= 0x43) for (let i = 0; i < 3; i += 1) s.i32(); // glow front, back, active colours
    if (vita >= 0x54) s.u8(); // playerFilter
  }
  if (hasPlayerMode(version)) s.u8(); // playerMode

  // ⚠️ Data-dependent again, and the block is not small.
  if (version > 0x3ee && type === SWITCH_DATA_SAMPLER) {
    s.i32(); // labelIndex
    s.skip(16); // creatorID.data
    s.u8(); // creatorID.term
    s.skip(3); // creatorID.dummy
    s.wstr(); // labelName
    s.array((self) => self.f32()); // analogue
    s.array((self) => self.u8()); // ternary
  }

  if (subVersion > 0x21) s.bool(); // relativeToSequencer
  if (subVersion > 0x2f) s.u8(); // layerRange
  if (subVersion > 0x7a) {
    s.bool(); // breakSound
    s.s32(); // colorTimer
  }
  if (subVersion > 0x67) s.bool(); // isLbp3Switch
  if (subVersion > 0x68) s.bool(); // randomNonRepeating
  if (subVersion > 0x102) s.i32(); // stickerSwitchMode
  return { type, hideInPlayMode, outputs };
}
