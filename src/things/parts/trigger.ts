/** `TRIGGER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { type PartReader } from '../thing.ts';
import { things } from './common.ts';

/** `PTrigger`: the volume a switch senses in. */
export function readTrigger(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  s.u8(); // triggerType, enum8
  things(s, readers); // inThings
  s.f32(); // radiusMultiplier
  if (version < 0x1d5) s.i32();
  if (subVersion >= 0x2a) s.u8(); // zRangeHundreds
  s.bool(); // allZLayers
  if (version >= 0x19b) {
    s.f32(); // hysteresisMultiplier
    s.bool(); // enabled
  }
  if (version >= 0x322) s.f32(); // zOffset
  if (subVersion >= 0x90) s.s32(); // scoreValue
}
