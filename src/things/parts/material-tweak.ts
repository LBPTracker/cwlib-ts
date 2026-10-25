/** `MATERIAL_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';

/** `PMaterialTweak`: the per-Thing material overrides. */
/** `PMaterialTweak`, kept: how a material tweaker changes a shape's physics and its look. */
export interface MaterialTweakPart {
  readonly hideInPlayMode: boolean;
  readonly restitution: number;
  readonly frictionScale: number;
  readonly grabbability: number;
  readonly stickiness: number;
  readonly isProjectile: boolean;
  /** Whether the tweaked shape casts a shadow, from version 0x3ed or subVersion 6. */
  readonly hasShadow: boolean;
  /** Whether it is drawn without its bevel, from subVersion 0x34. */
  readonly noBevel: boolean;
  readonly zSlice: boolean;
  readonly climbability: boolean;
}

export function readMaterialTweak(s: Serializer, readers: ReadonlyMap<string, PartReader>): MaterialTweakPart {
  const { version, subVersion } = s.revision;
  if (version < 0x2c4) s.f32(); // activation
  const hideInPlayMode = s.bool();
  if (version < 0x2cd) s.i32(); // colorIndex
  const restitution = version > 0x2b6 ? s.f32() : 0;
  const frictionScale = version > 0x30c ? s.f32() : 1;
  if (version >= 0x2b7 && version < 0x343) {
    s.u8();
    s.u8();
  }
  const grabbability = version > 0x342 ? s.u8() : 0;
  if (version > 0x3bc) s.u8(); // grabFilter
  const stickiness = version > 0x342 ? s.u8() : 0;
  if (version > 0x2b8) s.bool(); // noAutoDestruct
  const isProjectile = subVersion > 0x2 ? s.bool() : false;
  if (version >= 0x2df && version < 0x327) readThingRef(s, readers);
  if (version > 0x356) s.bool(); // disablePhysicsAudio
  const vita = vitaRevision(s.revision);
  if (vita >= 0x5) s.u8(); // touchability
  if (vita >= 0x7) {
    s.i32(); // tweakType
    for (let i = 0; i < 5; i += 1) s.bool(); // highlight, includeRigidConnectors, droppable, requiresTag, requiresNewTouch
    s.f32(); // maxSpeed
    s.s32(); // colorIndex
  }
  if (vita >= 0x49) s.f32(); // touchRotationalStrength
  if (vita >= 0x6c) s.bool(); // touchabilityInvisible
  if (vita >= 0x7) s.wstr(); // name
  if (subVersion > 0x3) s.bool(); // isUsableByPoppetAudio
  const hasShadow = version > 0x3ec || subVersion > 5 ? s.bool() : true;
  const noBevel = subVersion > 0x33 ? s.bool() : false;
  const zSlice = subVersion > 0xdb ? s.bool() : false;
  const climbability = subVersion > 0x48 ? s.bool() : false;
  if (subVersion > 0x8c) {
    s.bool(); // ppGrab
    s.u8(); // ppTweakability
    s.bool(); // ppRigidConnection
  }
  if (subVersion >= 0x8d) {
    if (subVersion < 0x13d) s.f32();
    if (subVersion < 0x92) s.u8();
    if (subVersion >= 0x92 && subVersion < 0x13d) s.i32();
  }
  if (subVersion > 0xa7) s.bool(); // ppMaterialMergeable
  return { hideInPlayMode, restitution, frictionScale, grabbability, stickiness, isProjectile, hasShadow, noBevel, zSlice, climbability };
}
