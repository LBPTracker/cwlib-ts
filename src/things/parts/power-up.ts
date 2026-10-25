/** `POWER_UP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PPowerUp`: a power-up a player is holding, at subVersion >= 0x18d. */
/** `PPowerUp`, kept: the power-up a Thing gives, and the Things it spawned. */
export interface PowerUpPart {
  readonly plan?: ResourceRef;
  readonly powerUpThing?: Thing;
  readonly powerUpHandle?: Thing;
  readonly flipped: boolean;
  readonly spawnedRootMatrix: Float32Array;
  readonly spawnedChipMatrix: Float32Array;
  readonly rootHandle: readonly [number, number, number, number];
  readonly justFlipped: boolean;
  readonly fireStartTime: number;
  readonly initialRotation: number;
  readonly deterministicPosition: readonly [number, number, number];
  readonly deterministicRotation: number;
  readonly offsetForEmitters: number;
  readonly prevAngle: number;
  readonly currAngle: number;
}

export function readPowerUp(s: Serializer, readers: ReadonlyMap<string, PartReader>): PowerUpPart {
  const spawnedRootMatrix = s.matrix();
  const spawnedChipMatrix = s.matrix();
  const rootHandle = s.vector4();
  const plan = s.resource(true);
  const powerUpThing = readThingRef(s, readers);
  const powerUpHandle = readThingRef(s, readers);
  const flipped = s.bool();
  const justFlipped = s.bool();
  const fireStartTime = s.i32();
  const initialRotation = s.f32();
  const deterministicPosition = s.vector3();
  const deterministicRotation = s.f32();
  const offsetForEmitters = s.f32();
  const prevAngle = s.f32();
  const currAngle = s.f32();
  return {
    plan, powerUpThing, powerUpHandle, flipped, spawnedRootMatrix, spawnedChipMatrix, rootHandle,
    justFlipped, fireStartTime, initialRotation, deterministicPosition, deterministicRotation,
    offsetForEmitters, prevAngle, currAngle,
  };
}

/** `readPowerUp`'s mirror. */
export function writePowerUp(w: Writer, v: PowerUpPart, ctx: PartWriteContext): void {
  w.matrix(v.spawnedRootMatrix);
  w.matrix(v.spawnedChipMatrix);
  w.vector4(v.rootHandle);
  w.ref(v.plan, { descriptor: true });
  ctx.thing(w, v.powerUpThing);
  ctx.thing(w, v.powerUpHandle);
  w.bool(v.flipped);
  w.bool(v.justFlipped);
  w.i32(v.fireStartTime);
  w.f32(v.initialRotation);
  w.vector3(v.deterministicPosition);
  w.f32(v.deterministicRotation);
  w.f32(v.offsetForEmitters);
  w.f32(v.prevAngle);
  w.f32(v.currAngle);
}
