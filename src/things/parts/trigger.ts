/** `TRIGGER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray } from './common.ts';

/** `PTrigger`, kept: the volume's kind and size, and the Things in it when saved. */
export interface TriggerPart {
  /** cwlib's `TriggerType`, an enum8: 0 radius, 1 rect, 2 switch, 3 touch, 4 radius 3D. */
  readonly triggerType: number;
  readonly inThings: readonly (Thing | undefined)[];
  readonly radiusMultiplier: number;
  readonly zRangeHundreds: number;
  readonly allZLayers: boolean;
  readonly hysteresisMultiplier: number;
  readonly enabled: boolean;
  readonly zOffset: number;
  readonly scoreValue: number;
  /** The Vita's, from its revision 0x17: each of `inThings`' action. */
  readonly inThingActions?: readonly number[];
}

/** `PTrigger`: the volume a switch senses in. */
export function readTrigger(s: Serializer, readers: ReadonlyMap<string, PartReader>): TriggerPart {
  const { version, subVersion } = s.revision;
  const vita = vitaRevision(s.revision);
  const triggerType = s.u8(); // enum8
  let inThings: (Thing | undefined)[];
  let inThingActions: number[] | undefined;
  if (vita >= 0x17) {
    // The Vita's inThings: each with an action.
    const pairs = s.array((self) => ({ thing: readThingRef(self, readers), action: self.s32() }));
    inThings = pairs.map((p) => p.thing);
    inThingActions = pairs.map((p) => p.action);
  } else inThings = thingArray(s, readers);
  const radiusMultiplier = s.f32();
  if (version < 0x1d5) s.i32();
  const zRangeHundreds = subVersion >= 0x2a ? s.u8() : 0;
  const allZLayers = s.bool();
  let hysteresisMultiplier = 0;
  let enabled = true;
  if (version >= 0x19b) {
    hysteresisMultiplier = s.f32();
    enabled = s.bool();
  }
  const zOffset = version >= 0x322 ? s.f32() : 0;
  const scoreValue = subVersion >= 0x90 || vita >= 0x30 ? s.s32() : 0;
  return {
    triggerType, inThings, radiusMultiplier, zRangeHundreds, allZLayers, hysteresisMultiplier,
    enabled, zOffset, scoreValue, inThingActions,
  };
}
