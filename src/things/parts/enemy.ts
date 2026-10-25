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
  readonly sourcePlayerNumber?: number;
  readonly newWalkConstraintMass?: boolean;
  readonly touchSensitive?: boolean;
  readonly touchType?: number;
}

/** `PEnemy`: one part of a creature. */
export function readEnemy(s: Serializer, readers: ReadonlyMap<string, PartReader>): EnemyPart {
  const { version } = s.revision;
  let sourcePlayerNumber: number | undefined;
  let newWalkConstraintMass: boolean | undefined;
  let touchSensitive: boolean | undefined;
  let touchType: number | undefined;
  // ❗ A signed enum (cwlib's `enum32(partType, true)`): an `s32`, zigzagged in a
  // compressed stream. Read as an `i32` it came out doubled there -- 2 and 8 for
  // the eyes and rockets of the game's FARC levels -- and right only in the
  // uncompressed story chunks.
  const partType = version >= 0x15d ? s.s32() : 0;
  if (version > 0x15c && version < 0x19f) readThingRef(s, readers);
  const radius = version >= 0x16d ? s.f32() : 0;
  if (version < 0x19e) readThingRef(s, readers); // cwlib's `0x19e > version && version < 0x1a9`
  const snapVertex = version >= 0x19f ? s.i32() : 0;
  let centerOffset: [number, number, number] | undefined;
  let animThing: Thing | undefined;
  let animSpeed = 0;
  if (version >= 0x1a9) {
    centerOffset = s.vector3();
    animThing = readThingRef(s, readers);
    animSpeed = s.f32();
  }
  if (version > 0x1f1 && version < 0x21e) {
    for (let i = 0; i < 4; i += 1) readThingRef(s, readers);
    s.i32();
    readThingRef(s, readers);
    readThingRef(s, readers);
    s.skipVector3();
    s.s32();
    s.skipVector3();
    for (let i = 0; i < 3; i += 1) s.f32();
    s.s32();
    s.s32();
  }
  if (version >= 0x246) sourcePlayerNumber = s.i32();
  if (version >= 0x265) newWalkConstraintMass = s.bool();
  const smokeColor = version >= 0x31e ? s.i32() : 0;
  const smokeBrightness = version >= 0x39a ? s.f32() : 0;
  const vita = vitaRevision(s.revision);
  if (vita >= 0x2) touchSensitive = s.bool();
  if (vita >= 0x3) touchType = s.i32();
  return {
    partType, radius, snapVertex, centerOffset, animThing, animSpeed, smokeColor, smokeBrightness,
    sourcePlayerNumber, newWalkConstraintMass, touchSensitive, touchType,
  };
}
