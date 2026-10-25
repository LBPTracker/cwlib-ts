/** `SWITCH_INPUT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { readNpcBehavior, writeNpcBehavior, type NpcBehavior } from './npc.ts';
import { keyOf, readSwitchSignal, writeSwitchSignal, type SwitchSignal } from './switch.ts';
import { hasPlayerMode } from './common.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PSwitchInput`: an input port on a circuit board. */
/** `PSwitchInput`, kept: what a sensor reads from, and how it looks. */
export interface SwitchInputPart {
  /** A sackbot's behaviour, the switch's input from it. */
  readonly npcBehavior?: NpcBehavior;
  /** The reference id the file gave `npcBehavior`, kept so it is written back under it. */
  readonly npcBehaviorId?: number;
  /** cwlib's `activation`; below version 0x2c4. */
  readonly activation?: SwitchSignal;
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
  let activation: SwitchSignal | undefined;
  let npcBehaviorId: number | undefined;
  let updateFrame: number | undefined;
  let lethalActivationFrame: number | undefined;
  let lethalInverted: boolean | undefined;
  let [updateType, sackbotObjectColorIndex, behavior] = [0, 0, 0];
  let hideInPlayMode = false;
  const thing = () => readThingRef(s, readers);
  if (version < 0x2c4) {
    activation = readSwitchSignal(s);
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
  if (version > 0x29a) {
    const at = s.position;
    const id = s.i32();
    s.position = at;
    npcBehavior = s.reference((self) => readNpcBehavior(self, readers));
    if (id !== 0) npcBehaviorId = id;
  }
  if (version > 0x2aa && version < 0x2d5) sackbotColor = s.i32();
  if (version > 0x2d4) sackbotObjectColorIndex = s.s32();
  if (version > 0x2c3) behavior = s.i32();
  if (version > 0x308) effectDestroy = s.i32();
  if (hasPlayerMode(version)) playerMode = s.u8();
  return {
    dataSource, updateType, hideInPlayMode, sackbotObjectColorIndex, behavior, updateFrame,
    lethalActivationFrame, lethalInverted, lethalType, portThing, includeRigidConnectors, oneShot,
    disableLethalAudio, sackbotColor, effectDestroy, playerMode, npcBehavior, npcBehaviorId, activation,
  };
}

/** `readSwitchInput`'s mirror. */
export function writeSwitchInput(w: Writer, v: SwitchInputPart, ctx: PartWriteContext): void {
  const { version } = w.revision;
  if (version < 0x2c4) {
    writeSwitchSignal(w, v.activation);
    w.i32(v.updateFrame ?? 0);
  }
  ctx.thing(w, v.dataSource);
  if (version > 0x273) w.i32(v.updateType);
  if (version > 0x274) w.i32(v.lethalType ?? 0);
  if (version > 0x277 && version < 0x327) ctx.thing(w, v.portThing);
  if (version > 0x287) w.bool(v.includeRigidConnectors ?? false);
  if (version > 0x28a) {
    w.i32(v.lethalActivationFrame ?? 0);
    w.bool(v.lethalInverted ?? false);
  }
  if (version > 0x297) w.bool(v.hideInPlayMode);
  if (version > 0x298 && version < 0x2c4) w.bool(v.oneShot ?? false);
  if (version > 0x38f) w.bool(v.disableLethalAudio ?? false);
  if (version > 0x29a) {
    const behavior = v.npcBehavior;
    const key = behavior && keyOf(behavior);
    w.reference(key, (self) => writeNpcBehavior(self, behavior!, ctx), v.npcBehaviorId ?? (key as { id?: number } | undefined)?.id);
  }
  if (version > 0x2aa && version < 0x2d5) w.i32(v.sackbotColor ?? 0);
  if (version > 0x2d4) w.s32(v.sackbotObjectColorIndex);
  if (version > 0x2c3) w.i32(v.behavior);
  if (version > 0x308) w.i32(v.effectDestroy ?? 0);
  if (hasPlayerMode(version)) w.u8(v.playerMode ?? 0);
}
