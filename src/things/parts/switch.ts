/** `SWITCH`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { hasPlayerMode, thingArray, writeThingArray } from './common.ts';
import { readNetworkOnlineIdKept, writeNetworkOnlineId, type NetworkId } from '../../structs/network.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `SwitchType` values this reader has to branch on. */
const SWITCH_STICKER = 5;

const SWITCH_MICROCHIP = 36;

const SWITCH_POCKET_ITEM = 50;

const SWITCH_DATA_SAMPLER = 65;

const SWITCH_GAME_LIVE_STREAMING_CHOICE = 75;

/** `SwitchSignal`: an activation level, a ternary state and a player index. */
export interface SwitchSignal {
  readonly activation: number;
  /** Version `0x310` on. */
  readonly ternary?: number;
  /** Version `0x2a3` on. */
  readonly player?: number;
}

export function readSwitchSignal(s: Serializer): SwitchSignal {
  const { version } = s.revision;
  const activation = s.f32();
  const ternary = version >= 0x310 ? s.s32() : undefined;
  const player = version >= 0x2a3 ? s.i32() : undefined;
  return { activation, ternary, player };
}

/** `readSwitchSignal`'s mirror. */
export function writeSwitchSignal(w: Writer, signal: SwitchSignal | undefined): void {
  const { version } = w.revision;
  w.f32(signal?.activation ?? 0);
  if (version >= 0x310) w.s32(signal?.ternary ?? 0);
  if (version >= 0x2a3) w.i32(signal?.player ?? 0);
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

function writeSwitchTarget(w: Writer, target: SwitchTarget, ctx: PartWriteContext): void {
  ctx.thing(w, target.thing);
  if (w.revision.version > 0x326) w.i32(target.port ?? 0);
}

/** `SwitchOutput`: one output port, its signal, everything wired to it, and its name. */
export interface SwitchOutput {
  readonly activation: SwitchSignal;
  readonly targets: SwitchTarget[];
  /** Version `0x34d` on. */
  readonly userDefinedName?: string;
}

function readSwitchOutput(s: Serializer, readers: ReadonlyMap<string, PartReader>): SwitchOutput {
  const activation = readSwitchSignal(s);
  const count = s.count();
  const targets: SwitchTarget[] = [];
  for (let i = 0; i < count; i += 1) targets.push(readSwitchTarget(s, readers));
  const userDefinedName = s.revision.version >= 0x34d ? s.wstr() : undefined;
  return { activation, targets, userDefinedName };
}

function writeSwitchOutput(w: Writer, output: SwitchOutput, ctx: PartWriteContext): void {
  writeSwitchSignal(w, output.activation);
  w.i32(output.targets.length);
  for (const target of output.targets) writeSwitchTarget(w, target, ctx);
  if (w.revision.version >= 0x34d) w.wstr(output.userDefinedName ?? '');
}

/** `PSwitch`, what a renderer needs of it: its kind and its wires. steering/level-files.md, *Wires*. */
export interface SwitchPart {
  /** cwlib's `SwitchType`; 0 below `0x1a5`. */
  readonly type: number;
  readonly hideInPlayMode: boolean;
  /**
   * The byte `hideInPlayMode` was read from, where it is neither 0 nor 1 (0x48
   * on two switches of `base_001.farc` `b27f0573`): only it writes the part back
   * as it was.
   */
  readonly hideInPlayModeByte?: number;
  /** Each output port's wires, in port order; one output below `0x329`. */
  readonly outputs: SwitchTarget[][];
  /** Each output's signal and name, as `outputs` orders them; from version `0x329`. */
  readonly outputPorts?: readonly (SwitchOutput | undefined)[];
  readonly inverted: boolean;
  readonly radius: number;
  readonly colorIndex: number;
  readonly behaviorOld: number;
  readonly portPosOffset?: readonly [number, number, number, number];
  readonly looseConnectorPos?: readonly [number, number, number, number];
  readonly looseConnectorBaseOffset?: readonly [number, number, number, number];
  readonly angleRange?: number;
  /**
   * cwlib's `stickerPlan`, wherever the file holds one: below 0x398 always (from
   * 0x140), from it on a sticker switch, a pocket item, or a microchip whose
   * `includeTouching` is 1.
   */
  readonly stickerPlan?: ResourceRef;
  /** cwlib's `referenceThing`; version 0x1a5 on. */
  readonly referenceThing?: Thing;
  /** cwlib's `manualActivation`; version 0x1a5 on. */
  readonly manualActivation?: SwitchSignal;
  /** Below 0x329: the single output's activation (cwlib `outputs[0].activation.activation`). */
  readonly singleOutputActivation?: number;
  /** The connector block, versions 0x1fb..0x326 (cwlib `connectorPos`, `connectorGrabbed`, `looseConnectorGrabbed`). */
  readonly connectorPos?: readonly (readonly [number, number, number, number])[];
  readonly connectorGrabbed?: readonly boolean[];
  readonly looseConnectorGrabbed?: boolean;
  /** cwlib's `includeTouching`; version 0x23e on. */
  readonly includeTouching?: number;
  /** A live-streaming choice's five option labels (cwlib throws there). */
  readonly liveStreamingChoiceLabels?: readonly string[];
  /** cwlib's `inputList`; version 0x273 on. */
  readonly inputList?: readonly (Thing | undefined)[];
  /** cwlib's `portThing`; versions 0x277..0x326. */
  readonly portThing?: Thing;
  readonly customPortOffset?: readonly [number, number, number, number];
  readonly customConnectorOffset?: readonly [number, number, number, number];
  readonly timerCount?: number;
  readonly randomBehavior?: number;
  readonly randomPattern?: number;
  readonly randomOnTimeMin?: number;
  readonly randomOnTimeMax?: number;
  readonly randomOffTimeMin?: number;
  readonly randomOffTimeMax?: number;
  readonly randomPhaseOn?: number;
  readonly randomPhaseTime?: number;
  readonly retardedOldJoint?: boolean;
  readonly userDefinedColour?: number;
  readonly wiresVisible?: boolean;
  readonly labelIndex?: number;
  /** A data sampler's label: the Vita's from its revision `0x46`, the game's on its own type. */
  readonly labelName?: string;
  /** The Vita's data sampler: its analogue values (one below revision `0x33`) and ternary states. */
  readonly analogue?: readonly number[];
  readonly ternary?: readonly number[];
  /** The Vita's, from its revision 0x43: the glow's front, back and active colours. */
  readonly glowColours?: readonly number[];
  /** A data sampler's creator, an online id. */
  readonly creatorID?: string;
  /** `creatorID`'s `NetworkOnlineID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly creatorIDBytes?: Uint8Array;
  /** cwlib's `SwitchBehavior`, an enum32; version 0x2c4 on. */
  readonly behavior?: number;
  readonly breakSound?: boolean;
  readonly colorTimer?: number;
  readonly minRadius?: number;
  readonly name?: string;
  readonly crappyOldLbp1Switch?: boolean;
  readonly player?: number;
  readonly platformVisualFactor?: number;
  readonly oldActivation?: number;
  readonly activationHoldTime?: number;
  readonly requireAll?: boolean;
  readonly impactSensorMode?: number;
  readonly bulletsRequired?: number;
  readonly bulletsDetected?: number;
  readonly bulletPlayerNumber?: number;
  readonly bulletRefreshTime?: number;
  readonly resetWhenFull?: boolean;
  readonly hideConnectors?: boolean;
  readonly logicType?: number;
  readonly updateFrame?: number;
  readonly includeRigidConnectors?: boolean;
  readonly timerAutoCount?: number;
  readonly teamFilter?: number;
  readonly keySensorMode?: number;
  readonly bulletTypes?: number;
  readonly detectUnspawnedPlayers?: boolean;
  readonly unspawnedBehavior?: number;
  readonly playSwitchAudio?: boolean;
  readonly switchTouchType?: number;
  readonly cursorInteractionType?: number;
  /** The Vita's: a `u32` cut to a byte below its revision 0x2c, an `i8` from it (cwlib `PSwitch`). */
  readonly cursorScreenArea?: number;
  readonly cursorTouchPanels?: number;
  readonly cursorTouchIndex?: number;
  readonly flags?: number;
  readonly outputAndOr?: number;
  readonly includeSameChipTags?: number;
  readonly playerFilter?: number;
  readonly playerMode?: number;
  readonly relativeToSequencer?: boolean;
  readonly layerRange?: number;
  readonly isLbp3Switch?: boolean;
  readonly randomNonRepeating?: boolean;
  readonly stickerSwitchMode?: number;
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
  let minRadius: number | undefined;
  let name: string | undefined;
  let crappyOldLbp1Switch: boolean | undefined;
  let player: number | undefined;
  let platformVisualFactor: number | undefined;
  let oldActivation: number | undefined;
  let activationHoldTime: number | undefined;
  let requireAll: boolean | undefined;
  let impactSensorMode: number | undefined;
  let bulletsRequired: number | undefined;
  let bulletsDetected: number | undefined;
  let bulletPlayerNumber: number | undefined;
  let bulletRefreshTime: number | undefined;
  let resetWhenFull: boolean | undefined;
  let hideConnectors: boolean | undefined;
  let logicType: number | undefined;
  let updateFrame: number | undefined;
  let includeRigidConnectors: boolean | undefined;
  let timerAutoCount: number | undefined;
  let teamFilter: number | undefined;
  let keySensorMode: number | undefined;
  let bulletTypes: number | undefined;
  let detectUnspawnedPlayers: boolean | undefined;
  let unspawnedBehavior: number | undefined;
  let playSwitchAudio: boolean | undefined;
  let switchTouchType: number | undefined;
  let cursorInteractionType: number | undefined;
  let cursorScreenArea: number | undefined;
  let cursorTouchPanels: number | undefined;
  let cursorTouchIndex: number | undefined;
  let flags: number | undefined;
  let outputAndOr: number | undefined;
  let includeSameChipTags: number | undefined;
  let playerFilter: number | undefined;
  let playerMode: number | undefined;
  let relativeToSequencer: boolean | undefined;
  let layerRange: number | undefined;
  let isLbp3Switch: boolean | undefined;
  let randomNonRepeating: boolean | undefined;
  let stickerSwitchMode: number | undefined;
  let portPosOffset: readonly [number, number, number, number] | undefined;
  let looseConnectorPos: readonly [number, number, number, number] | undefined;
  let looseConnectorBaseOffset: readonly [number, number, number, number] | undefined;
  let angleRange: number | undefined;
  let stickerPlan: ResourceRef | undefined;
  let customPortOffset: readonly [number, number, number, number] | undefined;
  let customConnectorOffset: readonly [number, number, number, number] | undefined;
  let timerCount: number | undefined;
  let randomBehavior: number | undefined;
  let randomPattern: number | undefined;
  let randomOnTimeMin: number | undefined;
  let randomOnTimeMax: number | undefined;
  let randomOffTimeMin: number | undefined;
  let randomOffTimeMax: number | undefined;
  let randomPhaseOn: number | undefined;
  let randomPhaseTime: number | undefined;
  let retardedOldJoint: boolean | undefined;
  let userDefinedColour: number | undefined;
  let wiresVisible: boolean | undefined;
  let labelIndex: number | undefined;
  let labelName: string | undefined;
  let glowColours: number[] | undefined;
  let creatorID: string | undefined;
  let creatorIDBytes: Uint8Array | undefined;
  const creator = (id: NetworkId): void => {
    creatorID = id.handle;
    creatorIDBytes = id.bytes;
  };
  let behavior: number | undefined;
  let referenceThing: Thing | undefined;
  let manualActivation: SwitchSignal | undefined;
  let singleOutputActivation: number | undefined;
  let connectorPos: [number, number, number, number][] | undefined;
  let connectorGrabbed: boolean[] | undefined;
  let looseConnectorGrabbed: boolean | undefined;
  let liveStreamingChoiceLabels: string[] | undefined;
  let inputList: (Thing | undefined)[] | undefined;
  let portThing: Thing | undefined;
  let analogue: number[] | undefined;
  let ternary: number[] | undefined;
  let breakSound: boolean | undefined;
  let colorTimer: number | undefined;
  const inverted = s.bool();
  const radius = s.f32();
  if (version >= 0x382) minRadius = s.f32();
  const colorIndex = s.s32();
  if (version >= 0x2dc) name = s.wstr();
  if (version >= 0x38f) crappyOldLbp1Switch = s.bool();
  const behaviorOld = s.s32();

  const outputs: SwitchTarget[][] = [];
  let outputPorts: (SwitchOutput | undefined)[] | undefined;
  if (version < 0x329) {
    singleOutputActivation = s.f32();
    if (version > 0x2a2) player = s.i32();
    const count = s.count();
    const targets: SwitchTarget[] = [];
    for (let i = 0; i < count; i += 1) targets.push(readSwitchTarget(s, readers));
    outputs.push(targets);
  } else {
    const count = s.count();
    outputPorts = [];
    for (let i = 0; i < count; i += 1) {
      const output = s.reference((self) => readSwitchOutput(self, readers));
      outputPorts.push(output);
      outputs.push(output?.targets ?? []);
    }
  }

 
  if (version < 0x398 && version >= 0x140) stickerPlan = s.resource(true);

  const hideByte = version > 0x197 ? s.u8() : 0;
  const hideInPlayMode = hideByte !== 0;
  let type = 0;
  if (version > 0x1a4) {
    // ⚠️ `enum32(type, true)` — the second argument is **signed**, not "force
    // fixed-width", so this is a zigzag varint. Read plainly it still consumes
    // the right number of bytes for small values, which is why seven levels
    // parsed anyway; what it gets wrong is the *value*, and `type` decides
    // whether a sticker plan follows. A wrong type here costs one byte, one
    // Thing later.
    type = s.s32();
    referenceThing = readThingRef(s, readers);
    manualActivation = readSwitchSignal(s);
  }

  // ⚠️ Data-dependent: only a sticker switch (or a pocket item, above subVersion
  // 0x10) carries a plan here.
  if (
    version >= 0x398 &&
    (type === SWITCH_STICKER || (type === SWITCH_POCKET_ITEM && subVersion > 0x10))
  ) {
    stickerPlan = s.resource(true);
  }

  if (version > 0x1a4 && version < 0x368) platformVisualFactor = s.f32();
  if (version > 0x1a4 && version < 0x2a0) oldActivation = s.f32();
  if (version > 0x1a4) activationHoldTime = s.s32();
  if (version > 0x1a4) requireAll = s.bool();
  const vita = vitaRevision(s.revision);
  if (vita >= 0x2a) impactSensorMode = s.u8();
  // ❗ **The connector block, gone at 0x327 and about fifty bytes wide.** Nothing
  // above `LBP3_MIN_VERSION` has it; it is ported for the LBP1 files read with
  // the bound lowered by hand, and leaving it out is most of why an LBP1 switch
  // was read 91 bytes short.
  if (version > 0x1fa && version < 0x327) {
    const positions = s.count();
    // ⚠️ cwlib `vectorarray` returns Vector4f[], so these are v4 and not v3.
    connectorPos = [];
    for (let i = 0; i < positions; i += 1) connectorPos.push(s.vector4());
    const grabbed = s.count();
    connectorGrabbed = [];
    for (let i = 0; i < grabbed; i += 1) connectorGrabbed.push(s.bool());
    portPosOffset = s.vector4();
    looseConnectorPos = s.vector4();
    looseConnectorBaseOffset = s.vector4();
    looseConnectorGrabbed = s.bool();
  }

  let includeTouching: number | undefined;
  if (version > 0x23d) {
    angleRange = s.f32();
    includeTouching = s.s32();
    if (version >= 0x398 && type === SWITCH_MICROCHIP && includeTouching === 1) {
      stickerPlan = s.resource(true);
    }
  }

  // A live-streaming choice's five option labels ("Red" … "White" in the game's
  // one), read by the game's loader `v0xd0510a` in `eboot-v128.bin`; cwlib
  // throws here. steering/level-files.md, *`playerMode` at 0x3eb*.
  if (subVersion > 0x165 && type === SWITCH_GAME_LIVE_STREAMING_CHOICE) {
    liveStreamingChoiceLabels = [];
    for (let i = 0; i < 5; i += 1) liveStreamingChoiceLabels.push(s.wstr());
  }

  if (version > 0x243) bulletsRequired = s.s32();
  if (version === 0x244) s.i32();
  if (version > 0x244) bulletsDetected = s.s32();
  if (version > 0x245 && version < 0x398) bulletPlayerNumber = s.i32();
  if (version > 0x248) bulletRefreshTime = s.i32();
  if (version >= 0x2f5) resetWhenFull = s.bool();
  if (version > 0x24a && version < 0x327) hideConnectors = s.bool();
  if (version > 0x272 && version < 0x398) logicType = s.i32();
  if (version > 0x272 && version < 0x369) updateFrame = s.i32();
  if (version > 0x272) inputList = thingArray(s, readers);
  if (version > 0x276 && version < 0x327) portThing = readThingRef(s, readers);
  if (version > 0x283) includeRigidConnectors = s.bool();
  if (version > 0x284 && version < 0x327) {
    customPortOffset = s.vector4();
    customConnectorOffset = s.vector4();
  }
  if (version > 0x28c) {
    timerCount = s.f32();
    if (version < 0x2c4) timerAutoCount = s.u8();
  }
  if (version > 0x2ad && subVersion < 0x100) teamFilter = s.i32();
  if (version > 0x2c3) behavior = s.i32();
  if (version < 0x329 && version > 0x2c3) s.s32();
  if (version > 0x2c3) {
    randomBehavior = s.i32();
    randomPattern = s.i32();
    randomOnTimeMin = s.i32();
    randomOnTimeMax = s.i32();
    randomOffTimeMin = s.i32();
    randomOffTimeMax = s.i32();
    if (version < 0x3ad) {
      randomPhaseOn = s.u8();
      randomPhaseTime = s.s32();
    }
    retardedOldJoint = s.bool();
  }
  if (version > 0x30f) keySensorMode = s.i32();
  if (version > 0x34c) {
    userDefinedColour = s.i32();
    wiresVisible = s.bool();
  }
  if (version > 0x34f) bulletTypes = s.u8();
  if (version > 0x390) detectUnspawnedPlayers = s.bool();
  if (subVersion > 0x216) unspawnedBehavior = s.u8();
  if (version > 0x3a4) playSwitchAudio = s.bool();
  if (vita >= 0) {
    if (vita >= 0x1) switchTouchType = s.i32();
    if (vita >= 0x6 && vita < 0x36) s.u8();
    if (vita >= 0x9 && vita < 0x2c) cursorScreenArea = (s.u32() << 24) >> 24;
    else if (vita >= 0x2c) cursorScreenArea = s.i8();
    if (vita >= 0xb) cursorInteractionType = s.u8();
    if (vita >= 0xc) cursorTouchPanels = s.u8();
    if (vita >= 0x23) cursorTouchIndex = s.u8();
    if (vita < 0x36) {
      if (vita >= 0x23) s.u8();
      if (vita >= 0x13) s.u8();
      if (vita >= 0x7) s.u8();
      if (vita >= 0x15) s.u8();
      if (vita >= 0x24) s.u8();
    }
    if (vita >= 0x36) flags = s.u8();
    if (vita >= 0x2b) outputAndOr = s.s32();
    if (vita >= 0x2b && vita < 0x36) s.u8();
    if (type === 0x2f) {
      // The Vita's data sampler (cwlib: "although 0x2f shouldn't be the switch type?").
      if (vita >= 0x45) labelIndex = s.i32();
      if (vita >= 0x46) {
        creator(readNetworkOnlineIdKept(s));
        labelName = s.wstr();
      }
      if (vita >= 0x33) analogue = s.array((self) => self.f32());
      else if (vita >= 0x2e) analogue = [s.f32()];
      if (vita >= 0x3c) ternary = s.array((self) => self.u8());
    }
    if (vita >= 0x38 && vita < 0x41) s.u8();
    if (vita >= 0x41) includeSameChipTags = s.u8();
    if (vita >= 0x43) glowColours = Array.from({ length: 3 }, () => s.i32());
    if (vita >= 0x54) playerFilter = s.u8();
  }
  if (hasPlayerMode(version)) playerMode = s.u8();

  // ⚠️ Data-dependent again, and the block is not small.
  if (version > 0x3ee && type === SWITCH_DATA_SAMPLER) {
    labelIndex = s.i32();
    creator(readNetworkOnlineIdKept(s));
    labelName = s.wstr();
    analogue = s.array((self) => self.f32());
    ternary = s.array((self) => self.u8());
  }

  if (subVersion > 0x21) relativeToSequencer = s.bool();
  if (subVersion > 0x2f) layerRange = s.u8();
  if (subVersion > 0x7a) {
    breakSound = s.bool();
    colorTimer = s.s32();
  }
  if (subVersion > 0x67) isLbp3Switch = s.bool();
  if (subVersion > 0x68) randomNonRepeating = s.bool();
  if (subVersion > 0x102) stickerSwitchMode = s.i32();
  return {
    type, hideInPlayMode, outputs, inverted, radius, colorIndex, behaviorOld, portPosOffset,
    looseConnectorPos, looseConnectorBaseOffset, angleRange, stickerPlan, customPortOffset,
    customConnectorOffset, timerCount, randomBehavior, randomPattern, randomOnTimeMin,
    randomOnTimeMax, randomOffTimeMin, randomOffTimeMax, randomPhaseOn, randomPhaseTime,
    retardedOldJoint, userDefinedColour, wiresVisible, labelIndex, breakSound, colorTimer,
    minRadius, name, crappyOldLbp1Switch, player, platformVisualFactor, oldActivation,
    activationHoldTime, requireAll, impactSensorMode, bulletsRequired, bulletsDetected,
    bulletPlayerNumber, bulletRefreshTime, resetWhenFull, hideConnectors, logicType, updateFrame,
    includeRigidConnectors, timerAutoCount, teamFilter, keySensorMode, bulletTypes,
    detectUnspawnedPlayers, unspawnedBehavior, playSwitchAudio, switchTouchType,
    cursorInteractionType, cursorScreenArea, cursorTouchPanels, cursorTouchIndex, flags, outputAndOr,
    includeSameChipTags, playerFilter, playerMode, relativeToSequencer, layerRange, isLbp3Switch,
    randomNonRepeating, stickerSwitchMode, outputPorts, labelName, analogue, ternary, glowColours, creatorID, ...(creatorIDBytes ? { creatorIDBytes } : {}), behavior,
    referenceThing, manualActivation, singleOutputActivation, connectorPos, connectorGrabbed,
    looseConnectorGrabbed, includeTouching, liveStreamingChoiceLabels, inputList, portThing,
    ...(hideByte > 1 ? { hideInPlayModeByte: hideByte } : {}),
  };
}

/**
 * `readSwitch`'s mirror. What the reader steps over is written as cwlib writes
 * it: the `i32` at exactly 0x244, the `s32` from 0x2c4 to 0x328 and the Vita's
 * unnamed bytes as 0.
 */
export function writeSwitch(w: Writer, v: SwitchPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const type = v.type ?? 0;
  w.bool(v.inverted);
  w.f32(v.radius);
  if (version >= 0x382) w.f32(v.minRadius ?? 0);
  w.s32(v.colorIndex);
  if (version >= 0x2dc) w.wstr(v.name ?? '');
  if (version >= 0x38f) w.bool(v.crappyOldLbp1Switch ?? false);
  w.s32(v.behaviorOld);

  if (version < 0x329) {
    w.f32(v.singleOutputActivation ?? v.outputPorts?.[0]?.activation.activation ?? 0);
    if (version > 0x2a2) w.i32(v.player ?? 0);
    const targets = v.outputs[0] ?? [];
    w.i32(targets.length);
    for (const target of targets) writeSwitchTarget(w, target, ctx);
  } else {
    const ports: (SwitchOutput | undefined)[] = v.outputPorts
      ? [...v.outputPorts]
      : v.outputs.map((targets) => ({ activation: { activation: 0, ternary: 0, player: 0 }, targets, userDefinedName: '' }));
    w.i32(ports.length);
    // ❗ An output read onto a tape is the tape's object (`Writer.reference`): a target
    // Thing written inline can refer back to the very output that names it.
    for (const port of ports) w.reference(port, (self, output) => writeSwitchOutput(self, output, ctx));
  }

  if (version < 0x398 && version >= 0x140) w.ref(v.stickerPlan, { descriptor: true });

  if (version > 0x197) w.u8(v.hideInPlayMode ? (v.hideInPlayModeByte ?? 1) : 0);
  if (version > 0x1a4) {
    w.s32(type);
    ctx.thing(w, v.referenceThing);
    writeSwitchSignal(w, v.manualActivation);
  }

  if (
    version >= 0x398 &&
    (type === SWITCH_STICKER || (type === SWITCH_POCKET_ITEM && subVersion > 0x10))
  ) {
    w.ref(v.stickerPlan, { descriptor: true });
  }

  if (version > 0x1a4 && version < 0x368) w.f32(v.platformVisualFactor ?? 0);
  if (version > 0x1a4 && version < 0x2a0) w.f32(v.oldActivation ?? 0);
  if (version > 0x1a4) w.s32(v.activationHoldTime ?? 0);
  if (version > 0x1a4) w.bool(v.requireAll ?? false);
  const vita = vitaRevision(w.revision);
  if (vita >= 0x2a) w.u8(v.impactSensorMode ?? 0);
  if (version > 0x1fa && version < 0x327) {
    const positions = v.connectorPos ?? [];
    w.i32(positions.length);
    for (const position of positions) w.vector4(position);
    const grabbed = v.connectorGrabbed ?? [];
    w.i32(grabbed.length);
    for (const g of grabbed) w.bool(g);
    w.vector4(v.portPosOffset ?? [0, 0, 0, 0]);
    w.vector4(v.looseConnectorPos ?? [0, 0, 0, 0]);
    w.vector4(v.looseConnectorBaseOffset ?? [0, 0, 0, 0]);
    w.bool(v.looseConnectorGrabbed ?? false);
  }

  const includeTouching = v.includeTouching ?? 0;
  if (version > 0x23d) {
    w.f32(v.angleRange ?? 0);
    w.s32(includeTouching);
    if (version >= 0x398 && type === SWITCH_MICROCHIP && includeTouching === 1) {
      w.ref(v.stickerPlan, { descriptor: true });
    }
  }

  if (subVersion > 0x165 && type === SWITCH_GAME_LIVE_STREAMING_CHOICE) {
    for (let i = 0; i < 5; i += 1) w.wstr(v.liveStreamingChoiceLabels?.[i] ?? '');
  }

  if (version > 0x243) w.s32(v.bulletsRequired ?? 0);
  if (version === 0x244) w.i32(0);
  if (version > 0x244) w.s32(v.bulletsDetected ?? 0);
  if (version > 0x245 && version < 0x398) w.i32(v.bulletPlayerNumber ?? 0);
  if (version > 0x248) w.i32(v.bulletRefreshTime ?? 0);
  if (version >= 0x2f5) w.bool(v.resetWhenFull ?? false);
  if (version > 0x24a && version < 0x327) w.bool(v.hideConnectors ?? false);
  if (version > 0x272 && version < 0x398) w.i32(v.logicType ?? 0);
  if (version > 0x272 && version < 0x369) w.i32(v.updateFrame ?? 0);
  if (version > 0x272) writeThingArray(w, ctx, v.inputList);
  if (version > 0x276 && version < 0x327) ctx.thing(w, v.portThing);
  if (version > 0x283) w.bool(v.includeRigidConnectors ?? false);
  if (version > 0x284 && version < 0x327) {
    w.vector4(v.customPortOffset ?? [0, 0, 0, 0]);
    w.vector4(v.customConnectorOffset ?? [0, 0, 0, 0]);
  }
  if (version > 0x28c) {
    w.f32(v.timerCount ?? 0);
    if (version < 0x2c4) w.u8(v.timerAutoCount ?? 0);
  }
  if (version > 0x2ad && subVersion < 0x100) w.i32(v.teamFilter ?? 0);
  if (version > 0x2c3) w.i32(v.behavior ?? 0);
  if (version < 0x329 && version > 0x2c3) w.s32(0);
  if (version > 0x2c3) {
    w.i32(v.randomBehavior ?? 0);
    w.i32(v.randomPattern ?? 0);
    w.i32(v.randomOnTimeMin ?? 0);
    w.i32(v.randomOnTimeMax ?? 0);
    w.i32(v.randomOffTimeMin ?? 0);
    w.i32(v.randomOffTimeMax ?? 0);
    if (version < 0x3ad) {
      w.u8(v.randomPhaseOn ?? 0);
      w.s32(v.randomPhaseTime ?? 0);
    }
    w.bool(v.retardedOldJoint ?? false);
  }
  if (version > 0x30f) w.i32(v.keySensorMode ?? 0);
  if (version > 0x34c) {
    w.i32(v.userDefinedColour ?? 0);
    w.bool(v.wiresVisible ?? false);
  }
  if (version > 0x34f) w.u8(v.bulletTypes ?? 0);
  if (version > 0x390) w.bool(v.detectUnspawnedPlayers ?? false);
  if (subVersion > 0x216) w.u8(v.unspawnedBehavior ?? 0);
  if (version > 0x3a4) w.bool(v.playSwitchAudio ?? false);
  if (vita >= 0) {
    if (vita >= 0x1) w.i32(v.switchTouchType ?? 0);
    if (vita >= 0x6 && vita < 0x36) w.u8(0);
    if (vita >= 0x9 && vita < 0x2c) w.u32((v.cursorScreenArea ?? 0) & 0xff);
    else if (vita >= 0x2c) w.i8(v.cursorScreenArea ?? 0);
    if (vita >= 0xb) w.u8(v.cursorInteractionType ?? 0);
    if (vita >= 0xc) w.u8(v.cursorTouchPanels ?? 0);
    if (vita >= 0x23) w.u8(v.cursorTouchIndex ?? 0);
    if (vita < 0x36) {
      if (vita >= 0x23) w.u8(0);
      if (vita >= 0x13) w.u8(0);
      if (vita >= 0x7) w.u8(0);
      if (vita >= 0x15) w.u8(0);
      if (vita >= 0x24) w.u8(0);
    }
    if (vita >= 0x36) w.u8(v.flags ?? 0);
    if (vita >= 0x2b) w.s32(v.outputAndOr ?? 0);
    if (vita >= 0x2b && vita < 0x36) w.u8(0);
    if (type === 0x2f) {
      if (vita >= 0x45) w.i32(v.labelIndex ?? 0);
      if (vita >= 0x46) {
        writeNetworkOnlineId(w, v.creatorID ?? '', v.creatorIDBytes);
        w.wstr(v.labelName ?? '');
      }
      if (vita >= 0x33) {
        w.i32(v.analogue?.length ?? 0);
        for (const a of v.analogue ?? []) w.f32(a);
      } else if (vita >= 0x2e) w.f32(v.analogue?.[0] ?? 0);
      if (vita >= 0x3c) {
        w.i32(v.ternary?.length ?? 0);
        for (const t of v.ternary ?? []) w.u8(t);
      }
    }
    if (vita >= 0x38 && vita < 0x41) w.u8(0);
    if (vita >= 0x41) w.u8(v.includeSameChipTags ?? 0);
    if (vita >= 0x43) for (let i = 0; i < 3; i += 1) w.i32(v.glowColours?.[i] ?? 0);
    if (vita >= 0x54) w.u8(v.playerFilter ?? 0);
  }
  if (hasPlayerMode(version)) w.u8(v.playerMode ?? 0);

  if (version > 0x3ee && type === SWITCH_DATA_SAMPLER) {
    w.i32(v.labelIndex ?? 0);
    writeNetworkOnlineId(w, v.creatorID ?? '', v.creatorIDBytes);
    w.wstr(v.labelName ?? '');
    w.i32(v.analogue?.length ?? 0);
    for (const a of v.analogue ?? []) w.f32(a);
    w.i32(v.ternary?.length ?? 0);
    for (const t of v.ternary ?? []) w.u8(t);
  }

  if (subVersion > 0x21) w.bool(v.relativeToSequencer ?? false);
  if (subVersion > 0x2f) w.u8(v.layerRange ?? 0);
  if (subVersion > 0x7a) {
    w.bool(v.breakSound ?? false);
    w.s32(v.colorTimer ?? 0);
  }
  if (subVersion > 0x67) w.bool(v.isLbp3Switch ?? false);
  if (subVersion > 0x68) w.bool(v.randomNonRepeating ?? false);
  if (subVersion > 0x102) w.i32(v.stickerSwitchMode ?? 0);
}
