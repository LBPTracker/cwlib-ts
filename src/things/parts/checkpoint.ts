/** `CHECKPOINT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { type PartReader } from '../thing.ts';
import { things } from './common.ts';

/** `PCheckpoint`: a spawn point. Almost all of its later fields are subVersion-gated. */
export function readCheckpoint(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  if (subVersion > 0x101) s.u8();
  else s.bool(); // activeFlags
  s.i32(); // activationFrame
  if (version >= 0x1a7) s.s32(); // spawnsLeft
  if (version >= 0x1c6) s.s32(); // maxSpawnsLeft
  if (version >= 0x1eb) s.bool(); // instanceInfiniteSpawns
  if (version >= 0x1f3) {
    things(s, readers); // spawningList
    s.i32(); // spawningDelay
  }
  if (version >= 0x1fa) s.i32(); // lifeMultiplier
  if (version >= 0x2ae && subVersion < 0x100) s.i32(); // teamFilter
  if (subVersion >= 0x1 && subVersion < 0x127) s.u8(); // persistPoint
  if (subVersion >= 0x88) {
    if (subVersion <= 0x12a) s.resource();
    if (subVersion >= 0xc5) s.s32(); // creatureToSpawnAs
  }
  if (subVersion >= 0xcb) s.bool(); // isStartPoint
  if (subVersion >= 0xd5) s.bool(); // linkVisibleOnPlanet
  if (subVersion >= 0x108 && subVersion < 0x129) s.u8();
  if (subVersion >= 0xcb) s.wstr(); // name
  if (subVersion >= 0xe4) s.i32();
  if (subVersion >= 0xd1) s.wstr();
  if (subVersion >= 0x101) {
    s.i32(); // checkpointType
    s.i32(); // teamFlags
  }
  if (subVersion >= 0x15a) s.bool(); // enableAudio
  if (subVersion >= 0x191) s.bool(); // continueMusic
  if (subVersion >= 0x199) {
    s.i32(); // creatureToChangeBackTo
    s.bool(); // changeBackGate
  }
  if (subVersion >= 0x19b) s.bool(); // persistLives
}
