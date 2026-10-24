/** `EMITTER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';
import { things } from './common.ts';
import { readSwitchSignal } from './switch.ts';

/** `EmittedObjectSource`: what an emitter emits. */
function readEmittedObjectSource(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  things(s, readers);
  s.resource(); // plan
  if (s.revision.subVersion > 0xcc) {
    for (let i = 0; i < 6; i += 1) s.f32();
    s.u8();
  }
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
export function readEmitter(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  /** One of the doubled booleans described above. */
  const doubled = (since: number) => {
    if ((version >= since && subVersion < 0x64) || subVersion > 0x64) s.bool();
  };

  if (version < 0x368) s.skipVector3(); // posVel
  s.f32(); // angVel
  s.i32(); // frequency
  s.i32(); // phase
  s.i32(); // lifetime
  doubled(0x2fe); // recycleEmittedObjects
  s.resource(); // plan
  s.i32(); // maxEmitted
  if (version >= 0x1c8) s.i32(); // maxEmittedAtOnce
  s.f32(); // speedScaleStartFrame
  s.f32(); // speedScaleDeltaFrames
  readSwitchSignal(s); // speedScale
  if (version < 0x2c4) s.f32(); // lastUpdateFrame
  if (version >= 0x137) {
    if (version < 0x314) {
      s.skipVector4(); // worldOffset
      s.f32(); // worldRotation
    }
    if (version >= 0x38e) s.f32(); // worldRotationForEditorEmitters
    s.f32(); // emitScale
    s.f32(); // linearVel
    if (version < 0x314) readThingRef(s, readers);
  }
  if (version >= 0x13f) s.i32(); // currentEmitted
  doubled(0x144); // emitFlip
  if (version >= 0x1ce) {
    s.skipVector4(); // parentRelativeOffset
    s.f32(); // parentRelativeRotation
    s.f32(); // worldZ
    s.f32(); // zOffset
    s.f32(); // emitFrontZ
    s.f32(); // emitBackZ
  }
  doubled(0x226); // hideInPlayMode
  if (version >= 0x230 && version < 0x2c4) s.bool(); // modScaleActive
  if (version >= 0x2c4) s.i32(); // behavior
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
  if (version >= 0x340) s.reference((self) => readEmittedObjectSource(self, readers));
  doubled(0x361); // editorEmitter
  doubled(0x38d); // isLimboFlippedForGunEmitter
  if (version >= 0x3ae) s.f32(); // the z offset cwlib names less politely
  if (subVersion >= 0x18e) s.bool();
  if ((subVersion >= 0x31 && subVersion < 0x65) || subVersion >= 0x65) s.bool(); // soundEnabled
  if (subVersion >= 0x41 && subVersion < 0x1a7) s.bool();
  if (subVersion > 0x64) s.bool(); // emitByReferenceInPlayMode
  if (subVersion > 0x75) s.bool(); // emitToNearestRearLayer
}
