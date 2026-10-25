/** `SWITCH_INPUT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { readNpcBehavior } from './npc.ts';
import { readSwitchSignal } from './switch.ts';
import { hasPlayerMode } from './common.ts';

/** `PSwitchInput`: an input port on a circuit board. */
/** `PSwitchInput`, kept: what a sensor reads from, and how it looks. */
export interface SwitchInputPart {
  readonly dataSource?: Thing;
  readonly updateType: number;
  readonly hideInPlayMode: boolean;
  readonly sackbotObjectColorIndex: number;
  readonly behavior: number;
}

export function readSwitchInput(s: Serializer, readers: ReadonlyMap<string, PartReader>): SwitchInputPart {
  const { version } = s.revision;
  let [updateType, sackbotObjectColorIndex, behavior] = [0, 0, 0];
  let hideInPlayMode = false;
  const thing = () => readThingRef(s, readers);
  if (version < 0x2c4) {
    readSwitchSignal(s);
    s.i32(); // updateFrame
  }
  const dataSource = thing();
  if (version > 0x273) updateType = s.i32();
  if (version > 0x274) s.i32(); // lethalType
  if (version > 0x277 && version < 0x327) thing(); // portThing
  if (version > 0x287) s.bool(); // includeRigidConnectors
  if (version > 0x28a) {
    s.i32(); // lethalActivationFrame
    s.bool(); // lethalInverted
  }
  if (version > 0x297) hideInPlayMode = s.bool();
  if (version > 0x298 && version < 0x2c4) s.bool(); // oneShot
  if (version > 0x38f) s.bool(); // disableLethalAudio
  if (version > 0x29a) s.reference((self) => readNpcBehavior(self, readers));
  if (version > 0x2aa && version < 0x2d5) s.i32(); // sackbotColor
  if (version > 0x2d4) sackbotObjectColorIndex = s.s32();
  if (version > 0x2c3) behavior = s.i32();
  if (version > 0x308) s.i32(); // effectDestroy
  if (hasPlayerMode(version)) s.u8(); // playerMode
  return { dataSource, updateType, hideInPlayMode, sackbotObjectColorIndex, behavior };
}
