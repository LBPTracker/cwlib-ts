/** `TRIGGER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray, writeThingArray } from './common.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  /**
   * Below version 0x1d5: a word cwlib writes as 0 and calls `zLayers?`. Kept because
   * the game's files hold other values there (one LBP1 chunk, 0x19f, of the install).
   */
  readonly zLayers?: number;
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
  const zLayers = version < 0x1d5 ? s.i32() : undefined;
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
    enabled, zOffset, scoreValue, inThingActions, zLayers,
  };
}

/** `readTrigger`'s mirror. */
export function writeTrigger(w: Writer, v: TriggerPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const vita = vitaRevision(w.revision);
  w.u8(v.triggerType);
  if (vita >= 0x17) {
    w.i32(v.inThings.length);
    v.inThings.forEach((thing, i) => {
      ctx.thing(w, thing);
      w.s32(v.inThingActions?.[i] ?? 0);
    });
  } else writeThingArray(w, ctx, v.inThings);
  w.f32(v.radiusMultiplier);
  if (version < 0x1d5) w.i32(v.zLayers ?? 0);
  if (subVersion >= 0x2a) w.u8(v.zRangeHundreds);
  w.bool(v.allZLayers);
  if (version >= 0x19b) {
    w.f32(v.hysteresisMultiplier);
    w.bool(v.enabled);
  }
  if (version >= 0x322) w.f32(v.zOffset);
  if (subVersion >= 0x90 || vita >= 0x30) w.s32(v.scoreValue);
}
