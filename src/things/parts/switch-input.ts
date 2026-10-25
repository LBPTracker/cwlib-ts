/** `SWITCH_INPUT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { readNpcBehavior, type NpcBehavior } from './npc.ts';
import { readSwitchSignal } from './switch.ts';
import { hasPlayerMode } from './common.ts';

/** `PSwitchInput`: an input port on a circuit board. */
/** `PSwitchInput`, kept: what a sensor reads from, and how it looks. */
export interface SwitchInputPart {
  /** A sackbot's behaviour, the switch's input from it. */
  readonly npcBehavior?: NpcBehavior;
  readonly dataSource?: Thing;
  readonly updateType: number;
  readonly hideInPlayMode: boolean;
  readonly sackbotObjectColorIndex: number;
  readonly behavior: number;
  readonly updateFrame?: number;
  readonly lethalActivationFrame?: number;
  readonly lethalInverted?: boolean;
  readonly lethalType?: number;
  readonly portThing?: Thing;
  readonly includeRigidConnectors?: boolean;
  readonly oneShot?: boolean;
  readonly disableLethalAudio?: boolean;
  readonly sackbotColor?: number;
  readonly effectDestroy?: number;
  readonly playerMode?: number;
}

export function readSwitchInput(s: Serializer, readers: ReadonlyMap<string, PartReader>): SwitchInputPart {
  const { version } = s.revision;
  let lethalType: number | undefined;
  let portThing: Thing | undefined;
  let includeRigidConnectors: boolean | undefined;
  let oneShot: boolean | undefined;
  let disableLethalAudio: boolean | undefined;
  let sackbotColor: number | undefined;
  let effectDestroy: number | undefined;
  let npcBehavior: NpcBehavior | undefined;
  let playerMode: number | undefined;
  let updateFrame: number | undefined;
  let lethalActivationFrame: number | undefined;
  let lethalInverted: boolean | undefined;
  let [updateType, sackbotObjectColorIndex, behavior] = [0, 0, 0];
  let hideInPlayMode = false;
  const thing = () => readThingRef(s, readers);
  if (version < 0x2c4) {
    readSwitchSignal(s);
    updateFrame = s.i32();
  }
  const dataSource = thing();
  if (version > 0x273) updateType = s.i32();
  if (version > 0x274) lethalType = s.i32();
  if (version > 0x277 && version < 0x327) portThing = thing();
  if (version > 0x287) includeRigidConnectors = s.bool();
  if (version > 0x28a) {
    lethalActivationFrame = s.i32();
    lethalInverted = s.bool();
  }
  if (version > 0x297) hideInPlayMode = s.bool();
  if (version > 0x298 && version < 0x2c4) oneShot = s.bool();
  if (version > 0x38f) disableLethalAudio = s.bool();
  if (version > 0x29a) npcBehavior = s.reference((self) => readNpcBehavior(self, readers));
  if (version > 0x2aa && version < 0x2d5) sackbotColor = s.i32();
  if (version > 0x2d4) sackbotObjectColorIndex = s.s32();
  if (version > 0x2c3) behavior = s.i32();
  if (version > 0x308) effectDestroy = s.i32();
  if (hasPlayerMode(version)) playerMode = s.u8();
  return {
    dataSource, updateType, hideInPlayMode, sackbotObjectColorIndex, behavior, updateFrame,
    lethalActivationFrame, lethalInverted, lethalType, portThing, includeRigidConnectors, oneShot,
    disableLethalAudio, sackbotColor, effectDestroy, playerMode, npcBehavior,
  };
}
