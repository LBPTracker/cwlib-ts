/** `EMITTER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray } from './common.ts';

/** `EmittedObjectSource`: Things already in the level an emitter copies, and a plan. */
export interface EmittedObjectSource {
  readonly things: readonly (Thing | undefined)[];
  readonly plan?: ResourceRef;
  /**
   * Six floats and a byte from subVersion 0xcd, under cwlib's own placeholder
   * names (`EmittedObjectSource.java`): nothing names what they are.
   */
  readonly f0?: number;
  readonly f1?: number;
  readonly f2?: number;
  readonly f3?: number;
  readonly f4?: number;
  readonly f5?: number;
  readonly b0?: number;
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
  readonly speedScaleStartFrame: number;
  readonly speedScaleDeltaFrames: number;
  readonly speedScale: SwitchSignal;
  readonly worldOffset?: readonly [number, number, number, number];
  readonly worldRotation?: number;
  readonly emitFrontZ?: number;
  readonly emitBackZ?: number;
  readonly effectCreate?: number;
  readonly effectDestroy?: number;
  readonly posVel?: readonly [number, number, number];
  readonly lastUpdateFrame?: number;
  readonly worldRotationForEditorEmitters?: number;
  readonly currentEmitted?: number;
  readonly modScaleActive?: boolean;
  readonly emitNode?: number;
  readonly cleanUpOnDestroyed?: number;
  readonly soundEnabled?: boolean;
  readonly emitByReferenceInPlayMode?: boolean;
  readonly emitToNearestRearLayer?: boolean;
  /** Version 0x3ae on; and, subVersion 0x18e on, whether the emitter uses it. */
  readonly backupZOffset?: number;
  readonly useBackupZOffset?: boolean;
}
import { readSwitchSignal, type SwitchSignal } from './switch.ts';

/** `EmittedObjectSource`: what an emitter emits. */
function readEmittedObjectSource(s: Serializer, readers: ReadonlyMap<string, PartReader>): EmittedObjectSource {
  const things = thingArray(s, readers);
  const plan = s.resource();
  if (s.revision.subVersion <= 0xcc) return { things, plan };
  return { things, plan, f0: s.f32(), f1: s.f32(), f2: s.f32(), f3: s.f32(), f4: s.f32(), f5: s.f32(), b0: s.i8() };
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
  let posVel: readonly [number, number, number] | undefined;
  let lastUpdateFrame: number | undefined;
  let worldRotationForEditorEmitters: number | undefined;
  let currentEmitted: number | undefined;
  let modScaleActive: boolean | undefined;
  let emitNode: number | undefined;
  let cleanUpOnDestroyed: number | undefined;
  let soundEnabled: boolean | undefined;
  let emitByReferenceInPlayMode: boolean | undefined;
  let emitToNearestRearLayer: boolean | undefined;
  let worldOffset: readonly [number, number, number, number] | undefined;
  let worldRotation: number | undefined;
  let emitFrontZ: number | undefined;
  let emitBackZ: number | undefined;
  let effectCreate: number | undefined;
  let effectDestroy: number | undefined;
  /** One of the doubled booleans described above. */
  const doubled = (since: number) => {
    if ((version >= since && subVersion < 0x64) || subVersion > 0x64) s.bool();
  };

  if (version < 0x368) posVel = s.vector3();
  const angVel = s.f32();
  const frequency = s.i32();
  const phase = s.i32();
  const lifetime = s.i32();
  doubled(0x2fe); // recycleEmittedObjects
  const plan = s.resource();
  const maxEmitted = s.i32();
  const maxEmittedAtOnce = version >= 0x1c8 ? s.i32() : 0;
  const speedScaleStartFrame = s.f32();
  const speedScaleDeltaFrames = s.f32();
  const speedScale = readSwitchSignal(s);
  if (version < 0x2c4) lastUpdateFrame = s.f32();
  let emitScale = 1;
  let linearVel = 0;
  if (version >= 0x137) {
    if (version < 0x314) {
      worldOffset = s.vector4();
      worldRotation = s.f32();
    }
    if (version >= 0x38e) worldRotationForEditorEmitters = s.f32();
    emitScale = s.f32();
    linearVel = s.f32();
    if (version < 0x314) readThingRef(s, readers);
  }
  if (version >= 0x13f) currentEmitted = s.i32();
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
    emitFrontZ = s.f32();
    emitBackZ = s.f32();
  }
  doubled(0x226); // hideInPlayMode
  if (version >= 0x230 && version < 0x2c4) modScaleActive = s.bool();
  const behavior = version >= 0x2c4 ? s.i32() : 0;
  if (version >= 0x308) {
    if (version >= 0x38d) {
      effectCreate = s.u8();
      effectDestroy = s.u8();
    } else {
      s.i32();
      s.i32();
    }
  }
  doubled(0x32e); // ignoreParentsVelocity
  const source = version >= 0x340 ? s.reference((self) => readEmittedObjectSource(self, readers)) : undefined;
  doubled(0x361); // editorEmitter
  doubled(0x38d); // isLimboFlippedForGunEmitter
  // cwlib names it less politely; the Vita's build, `backupZOffset`.
  const backupZOffset = version >= 0x3ae ? s.f32() : undefined;
  const vita = vitaRevision(s.revision);
  if (vita >= 0xf) emitNode = s.u8();
  if (vita >= 0x2f) cleanUpOnDestroyed = s.u8();
  const useBackupZOffset = subVersion >= 0x18e ? s.bool() : undefined;
  if ((subVersion >= 0x31 && subVersion < 0x65) || subVersion >= 0x65) soundEnabled = s.bool();
  if (subVersion >= 0x41 && subVersion < 0x1a7) s.bool();
  if (subVersion > 0x64) emitByReferenceInPlayMode = s.bool();
  if (subVersion > 0x75) emitToNearestRearLayer = s.bool();
  return {
    plan, angVel, frequency, phase, lifetime, maxEmitted, maxEmittedAtOnce, emitScale, linearVel,
    parentRelativeOffset, parentRelativeRotation, worldZ, zOffset, behavior, source,
  speedScaleStartFrame, speedScaleDeltaFrames, speedScale, worldOffset, worldRotation, emitFrontZ,
  emitBackZ, effectCreate, effectDestroy,
    posVel, lastUpdateFrame, worldRotationForEditorEmitters, currentEmitted, modScaleActive,
    emitNode, cleanUpOnDestroyed, soundEnabled, emitByReferenceInPlayMode, emitToNearestRearLayer, backupZOffset, useBackupZOffset,
  };
}
