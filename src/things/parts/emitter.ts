/** `EMITTER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray, writeThingArray } from './common.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';


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
  /**
   * The doubled booleans (see `readEmitter`), under cwlib's `PEmitter` names;
   * undefined where the revision has none.
   */
  readonly recycleEmittedObjects?: boolean;
  readonly emitFlip?: boolean;
  readonly hideInPlayMode?: boolean;
  readonly ignoreParentsVelocity?: boolean;
  readonly editorEmitter?: boolean;
  readonly isLimboFlippedForGunEmitter?: boolean;
  /** Versions 0x137..0x313: cwlib's `parentThing`. */
  readonly parentThing?: Thing;
}
import { readSwitchSignal, writeSwitchSignal, type SwitchSignal } from './switch.ts';

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
  const doubled = (since: number): boolean | undefined =>
    (version >= since && subVersion < 0x64) || subVersion > 0x64 ? s.bool() : undefined;
  let parentThing: Thing | undefined;

  if (version < 0x368) posVel = s.vector3();
  const angVel = s.f32();
  const frequency = s.i32();
  const phase = s.i32();
  const lifetime = s.i32();
  const recycleEmittedObjects = doubled(0x2fe);
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
    if (version < 0x314) parentThing = readThingRef(s, readers);
  }
  if (version >= 0x13f) currentEmitted = s.i32();
  const emitFlip = doubled(0x144);
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
  const hideInPlayMode = doubled(0x226);
  if (version >= 0x230 && version < 0x2c4) modScaleActive = s.bool();
  const behavior = version >= 0x2c4 ? s.i32() : 0;
  if (version >= 0x308) {
    if (version >= 0x38d) {
      effectCreate = s.u8();
      effectDestroy = s.u8();
    } else {
      effectCreate = s.i32();
      effectDestroy = s.i32();
    }
  }
  const ignoreParentsVelocity = doubled(0x32e);
  let source: EmittedObjectSource | undefined;
  if (version >= 0x340) source = s.reference((self) => readEmittedObjectSource(self, readers));
  const editorEmitter = doubled(0x361);
  const isLimboFlippedForGunEmitter = doubled(0x38d);
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
    recycleEmittedObjects, emitFlip, hideInPlayMode, ignoreParentsVelocity, editorEmitter,
    isLimboFlippedForGunEmitter, parentThing,
  };
}

/** `readEmittedObjectSource`'s mirror. */
function writeEmittedObjectSource(w: Writer, source: EmittedObjectSource, ctx: PartWriteContext): void {
  writeThingArray(w, ctx, source.things);
  w.ref(source.plan);
  if (w.revision.subVersion <= 0xcc) return;
  for (const f of [source.f0, source.f1, source.f2, source.f3, source.f4, source.f5]) w.f32(f ?? 0);
  w.i8(source.b0 ?? 0);
}

/** `readEmitter`'s mirror; the bool cwlib writes false between subVersions 0x41 and 0x1a6 is written so. */
export function writeEmitter(w: Writer, e: EmitterPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const doubled = (since: number, value: boolean | undefined): void => {
    if ((version >= since && subVersion < 0x64) || subVersion > 0x64) w.bool(value ?? false);
  };
  if (version < 0x368) w.vector3(e.posVel ?? [0, 0, 0]);
  w.f32(e.angVel);
  w.i32(e.frequency);
  w.i32(e.phase);
  w.i32(e.lifetime);
  doubled(0x2fe, e.recycleEmittedObjects);
  w.ref(e.plan);
  w.i32(e.maxEmitted);
  if (version >= 0x1c8) w.i32(e.maxEmittedAtOnce);
  w.f32(e.speedScaleStartFrame);
  w.f32(e.speedScaleDeltaFrames);
  writeSwitchSignal(w, e.speedScale);
  if (version < 0x2c4) w.f32(e.lastUpdateFrame ?? 0);
  if (version >= 0x137) {
    if (version < 0x314) {
      w.vector4(e.worldOffset ?? [0, 0, 0, 0]);
      w.f32(e.worldRotation ?? 0);
    }
    if (version >= 0x38e) w.f32(e.worldRotationForEditorEmitters ?? 0);
    w.f32(e.emitScale);
    w.f32(e.linearVel);
    if (version < 0x314) ctx.thing(w, e.parentThing);
  }
  if (version >= 0x13f) w.i32(e.currentEmitted ?? 0);
  doubled(0x144, e.emitFlip);
  if (version >= 0x1ce) {
    w.vector4(e.parentRelativeOffset ?? [0, 0, 0, 0]);
    w.f32(e.parentRelativeRotation);
    w.f32(e.worldZ);
    w.f32(e.zOffset);
    w.f32(e.emitFrontZ ?? 0);
    w.f32(e.emitBackZ ?? 0);
  }
  doubled(0x226, e.hideInPlayMode);
  if (version >= 0x230 && version < 0x2c4) w.bool(e.modScaleActive ?? false);
  if (version >= 0x2c4) w.i32(e.behavior);
  if (version >= 0x308) {
    if (version >= 0x38d) {
      w.u8(e.effectCreate ?? 0);
      w.u8(e.effectDestroy ?? 0);
    } else {
      w.i32(e.effectCreate ?? 0);
      w.i32(e.effectDestroy ?? 0);
    }
  }
  doubled(0x32e, e.ignoreParentsVelocity);
  if (version >= 0x340) w.reference(e.source, (self, source) => writeEmittedObjectSource(self, source, ctx));
  doubled(0x361, e.editorEmitter);
  doubled(0x38d, e.isLimboFlippedForGunEmitter);
  if (version >= 0x3ae) w.f32(e.backupZOffset ?? 0);
  const vita = vitaRevision(w.revision);
  if (vita >= 0xf) w.u8(e.emitNode ?? 0);
  if (vita >= 0x2f) w.u8(e.cleanUpOnDestroyed ?? 0);
  if (subVersion >= 0x18e) w.bool(e.useBackupZOffset ?? false);
  if ((subVersion >= 0x31 && subVersion < 0x65) || subVersion >= 0x65) w.bool(e.soundEnabled ?? false);
  if (subVersion >= 0x41 && subVersion < 0x1a7) w.bool(false);
  if (subVersion > 0x64) w.bool(e.emitByReferenceInPlayMode ?? false);
  if (subVersion > 0x75) w.bool(e.emitToNearestRearLayer ?? false);
}
