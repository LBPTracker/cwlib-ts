/** `TRIGGER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';
import { things } from './common.ts';

/** `PTrigger`: the volume a switch senses in. */
export function readTrigger(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  const vita = vitaRevision(s.revision);
  s.u8(); // triggerType, enum8
  if (vita >= 0x17) {
    // The Vita's inThings: each with an action.
    const count = s.count();
    for (let i = 0; i < count; i += 1) {
      readThingRef(s, readers);
      s.s32(); // thingAction
    }
  } else things(s, readers); // inThings
  s.f32(); // radiusMultiplier
  if (version < 0x1d5) s.i32();
  if (subVersion >= 0x2a) s.u8(); // zRangeHundreds
  s.bool(); // allZLayers
  if (version >= 0x19b) {
    s.f32(); // hysteresisMultiplier
    s.bool(); // enabled
  }
  if (version >= 0x322) s.f32(); // zOffset
  if (subVersion >= 0x90 || vita >= 0x30) s.s32(); // scoreValue
}
