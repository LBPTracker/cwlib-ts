/** `SWITCH_INPUT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';
import { readNpcBehavior } from './npc.ts';
import { readSwitchSignal } from './switch.ts';
import { hasPlayerMode } from './common.ts';

/** `PSwitchInput`: an input port on a circuit board. */
export function readSwitchInput(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version } = s.revision;
  const thing = () => readThingRef(s, readers);
  if (version < 0x2c4) {
    readSwitchSignal(s);
    s.i32(); // updateFrame
  }
  thing(); // dataSource
  if (version > 0x273) s.i32(); // updateType
  if (version > 0x274) s.i32(); // lethalType
  if (version > 0x277 && version < 0x327) thing(); // portThing
  if (version > 0x287) s.bool(); // includeRigidConnectors
  if (version > 0x28a) {
    s.i32(); // lethalActivationFrame
    s.bool(); // lethalInverted
  }
  if (version > 0x297) s.bool(); // hideInPlayMode
  if (version > 0x298 && version < 0x2c4) s.bool(); // oneShot
  if (version > 0x38f) s.bool(); // disableLethalAudio
  if (version > 0x29a) s.reference((self) => readNpcBehavior(self, readers));
  if (version > 0x2aa && version < 0x2d5) s.i32(); // sackbotColor
  if (version > 0x2d4) s.s32(); // sackbotObjectColorIndex
  if (version > 0x2c3) s.i32(); // behavior
  if (version > 0x308) s.i32(); // effectDestroy
  if (hasPlayerMode(version)) s.u8(); // playerMode
}
