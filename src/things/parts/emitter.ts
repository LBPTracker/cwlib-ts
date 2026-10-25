/** `EMITTER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray } from './common.ts';

/** `EmittedObjectSource`: Things already in the level an emitter copies, and a plan. */
export interface EmittedObjectSource {
  readonly things: readonly (Thing | undefined)[];
  readonly plan?: ResourceRef;
}

/** `PEmitter`, kept: what it emits, how often, how many and where. */
export interface EmitterPart {
  /** The plan it emits. */
  readonly plan?: ResourceRef;
  readonly angVel: number;
  /** Frames between two emissions, the first at `phase`, each living `lifetime` frames. */
  readonly frequency: number;
  readonly phase: number;
  readonly lifetime: number;
  readonly maxEmitted: number;
  readonly maxEmittedAtOnce: number;
  readonly emitScale: number;
  readonly linearVel: number;
  /** Where the emitted object appears, relative to the emitter. */
  readonly parentRelativeOffset?: readonly [number, number, number, number];
  readonly parentRelativeRotation: number;
  readonly worldZ: number;
  readonly zOffset: number;
  /** cwlib's `EmitterBehavior`. */
  readonly behavior: number;
  readonly source?: EmittedObjectSource;
}
import { readSwitchSignal } from './switch.ts';

/** `EmittedObjectSource`: what an emitter emits. */
function readEmittedObjectSource(s: Serializer, readers: ReadonlyMap<string, PartReader>): EmittedObjectSource {
  const things = thingArray(s, readers);
  const plan = s.resource();
  if (s.revision.subVersion > 0xcc) {
    for (let i = 0; i < 6; i += 1) s.f32();
    s.u8();
  }
  return { things, plan };
}

/**
 * `PEmitter`: the object emitter.
 *
 * ⚠️ Seven of its booleans are written **twice over** in cwlib — once under a
 * `version >= n && subVersion < 0x64` gate and again under `subVersion > 0x64`.
 * Only one of the two can fire for any given revision, so each is exactly one
 * byte; writing both conditions out is the only way to keep that true across the
 * corpus, and collapsing them to an unconditional read would break the older
 * files.
 */
export function readEmitter(s: Serializer, readers: ReadonlyMap<string, PartReader>): EmitterPart {
  const { version, subVersion } = s.revision;
  /** One of the doubled booleans described above. */
  const doubled = (since: number) => {
    if ((version >= since && subVersion < 0x64) || subVersion > 0x64) s.bool();
  };

  if (version < 0x368) s.skipVector3(); // posVel
  const angVel = s.f32();
  const frequency = s.i32();
  const phase = s.i32();
  const lifetime = s.i32();
  doubled(0x2fe); // recycleEmittedObjects
  const plan = s.resource();
  const maxEmitted = s.i32();
  const maxEmittedAtOnce = version >= 0x1c8 ? s.i32() : 0;
  s.f32(); // speedScaleStartFrame
  s.f32(); // speedScaleDeltaFrames
  readSwitchSignal(s); // speedScale
  if (version < 0x2c4) s.f32(); // lastUpdateFrame
  let emitScale = 1;
  let linearVel = 0;
  if (version >= 0x137) {
    if (version < 0x314) {
      s.skipVector4(); // worldOffset
      s.f32(); // worldRotation
    }
    if (version >= 0x38e) s.f32(); // worldRotationForEditorEmitters
    emitScale = s.f32();
    linearVel = s.f32();
    if (version < 0x314) readThingRef(s, readers);
  }
  if (version >= 0x13f) s.i32(); // currentEmitted
  doubled(0x144); // emitFlip
  let parentRelativeOffset: [number, number, number, number] | undefined;
  let parentRelativeRotation = 0;
  let worldZ = 0;
  let zOffset = 0;
  if (version >= 0x1ce) {
    parentRelativeOffset = s.vector4();
    parentRelativeRotation = s.f32();
    worldZ = s.f32();
    zOffset = s.f32();
    s.f32(); // emitFrontZ
    s.f32(); // emitBackZ
  }
  doubled(0x226); // hideInPlayMode
  if (version >= 0x230 && version < 0x2c4) s.bool(); // modScaleActive
  const behavior = version >= 0x2c4 ? s.i32() : 0;
  if (version >= 0x308) {
    if (version >= 0x38d) {
      s.u8(); // effectCreate
      s.u8(); // effectDestroy
    } else {
      s.i32();
      s.i32();
    }
  }
  doubled(0x32e); // ignoreParentsVelocity
  const source = version >= 0x340 ? s.reference((self) => readEmittedObjectSource(self, readers)) : undefined;
  doubled(0x361); // editorEmitter
  doubled(0x38d); // isLimboFlippedForGunEmitter
  if (version >= 0x3ae) s.f32(); // the z offset cwlib names less politely
  const vita = vitaRevision(s.revision);
  if (vita >= 0xf) s.u8(); // emitNode
  if (vita >= 0x2f) s.u8(); // cleanUpOnDestroyed
  if (subVersion >= 0x18e) s.bool();
  if ((subVersion >= 0x31 && subVersion < 0x65) || subVersion >= 0x65) s.bool(); // soundEnabled
  if (subVersion >= 0x41 && subVersion < 0x1a7) s.bool();
  if (subVersion > 0x64) s.bool(); // emitByReferenceInPlayMode
  if (subVersion > 0x75) s.bool(); // emitToNearestRearLayer
  return {
    plan, angVel, frequency, phase, lifetime, maxEmitted, maxEmittedAtOnce, emitScale, linearVel,
    parentRelativeOffset, parentRelativeRotation, worldZ, zOffset, behavior, source,
  };
}
