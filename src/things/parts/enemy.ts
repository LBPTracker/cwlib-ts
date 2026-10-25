/** `ENEMY`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

/** `PEnemy`, kept: which part of a creature this Thing is, and how it is posed and drawn. */
export interface EnemyPart {
  /**
   * cwlib's `EnemyPart`: 0 leg, 1 eye, 2 brain, 3 wheel, 4 rocket, 5 paint.
   * Needlepoint Peaks has 24 eyes and 5 rockets.
   */
  readonly partType: number;
  readonly radius: number;
  readonly snapVertex: number;
  readonly centerOffset?: readonly [number, number, number];
  /** The Thing whose animation drives this part. */
  readonly animThing?: Thing;
  readonly animSpeed: number;
  readonly smokeColor: number;
  readonly smokeBrightness: number;
}

/** `PEnemy`: one part of a creature. */
export function readEnemy(s: Serializer, readers: ReadonlyMap<string, PartReader>): EnemyPart {
  const { version } = s.revision;
  const partType = version >= 0x15d ? s.i32() : 0;
  const radius = version >= 0x16d ? s.f32() : 0;
  const snapVertex = version >= 0x19f ? s.i32() : 0;
  let centerOffset: [number, number, number] | undefined;
  let animThing: Thing | undefined;
  let animSpeed = 0;
  if (version >= 0x1a9) {
    centerOffset = s.vector3();
    animThing = readThingRef(s, readers);
    animSpeed = s.f32();
  }
  if (version >= 0x246) s.i32(); // sourcePlayerNumber
  if (version >= 0x265) s.bool(); // newWalkConstraintMass
  const smokeColor = version >= 0x31e ? s.i32() : 0;
  const smokeBrightness = version >= 0x39a ? s.f32() : 0;
  const vita = vitaRevision(s.revision);
  if (vita >= 0x2) s.bool(); // touchSensitive
  if (vita >= 0x3) s.i32(); // touchType
  return { partType, radius, snapVertex, centerOffset, animThing, animSpeed, smokeColor, smokeBrightness };
}
