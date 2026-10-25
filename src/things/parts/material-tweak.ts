/** `MATERIAL_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

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
  readonly tweakType?: number;
  /** The Vita's, from its revision 7, with `tweakType`. */
  readonly highlight?: boolean;
  readonly includeRigidConnectors?: boolean;
  readonly droppable?: boolean;
  readonly requiresTag?: boolean;
  readonly requiresNewTouch?: boolean;
  readonly maxSpeed?: number;
  readonly colorIndex?: number;
  readonly ppGrab?: boolean;
  readonly ppTweakability?: number;
  readonly ppRigidConnection?: boolean;
  readonly activation?: number;
  readonly grabFilter?: number;
  readonly noAutoDestruct?: boolean;
  readonly disablePhysicsAudio?: boolean;
  readonly touchability?: number;
  readonly touchRotationalStrength?: number;
  readonly touchabilityInvisible?: boolean;
  readonly name?: string;
  readonly isUsableByPoppetAudio?: boolean;
  readonly ppMaterialMergeable?: boolean;
}

export function readMaterialTweak(s: Serializer, readers: ReadonlyMap<string, PartReader>): MaterialTweakPart {
  const { version, subVersion } = s.revision;
  let activation: number | undefined;
  let grabFilter: number | undefined;
  let noAutoDestruct: boolean | undefined;
  let disablePhysicsAudio: boolean | undefined;
  let touchability: number | undefined;
  let touchRotationalStrength: number | undefined;
  let touchabilityInvisible: boolean | undefined;
  let name: string | undefined;
  let isUsableByPoppetAudio: boolean | undefined;
  let ppMaterialMergeable: boolean | undefined;
  let tweakType: number | undefined;
  let [highlight, includeRigidConnectors, droppable, requiresTag, requiresNewTouch]: (boolean | undefined)[] = [];
  let maxSpeed: number | undefined;
  let colorIndex: number | undefined;
  let ppGrab: boolean | undefined;
  let ppTweakability: number | undefined;
  let ppRigidConnection: boolean | undefined;
  if (version < 0x2c4) activation = s.f32();
  const hideInPlayMode = s.bool();
  if (version < 0x2cd) s.i32(); // colorIndex
  const restitution = version > 0x2b6 ? s.f32() : 0;
  const frictionScale = version > 0x30c ? s.f32() : 1;
  if (version >= 0x2b7 && version < 0x343) {
    s.u8();
    s.u8();
  }
  const grabbability = version > 0x342 ? s.u8() : 0;
  if (version > 0x3bc) grabFilter = s.u8();
  const stickiness = version > 0x342 ? s.u8() : 0;
  if (version > 0x2b8) noAutoDestruct = s.bool();
  const isProjectile = subVersion > 0x2 ? s.bool() : false;
  if (version >= 0x2df && version < 0x327) readThingRef(s, readers);
  if (version > 0x356) disablePhysicsAudio = s.bool();
  const vita = vitaRevision(s.revision);
  if (vita >= 0x5) touchability = s.u8();
  if (vita >= 0x7) {
    tweakType = s.i32();
    [highlight, includeRigidConnectors, droppable, requiresTag, requiresNewTouch] = Array.from({ length: 5 }, () => s.bool());
    maxSpeed = s.f32();
    colorIndex = s.s32();
  }
  if (vita >= 0x49) touchRotationalStrength = s.f32();
  if (vita >= 0x6c) touchabilityInvisible = s.bool();
  if (vita >= 0x7) name = s.wstr();
  if (subVersion > 0x3) isUsableByPoppetAudio = s.bool();
  const hasShadow = version > 0x3ec || subVersion > 5 ? s.bool() : true;
  const noBevel = subVersion > 0x33 ? s.bool() : false;
  const zSlice = subVersion > 0xdb ? s.bool() : false;
  const climbability = subVersion > 0x48 ? s.bool() : false;
  if (subVersion > 0x8c) {
    ppGrab = s.bool();
    ppTweakability = s.u8();
    ppRigidConnection = s.bool();
  }
  if (subVersion >= 0x8d) {
    if (subVersion < 0x13d) s.f32();
    if (subVersion < 0x92) s.u8();
    if (subVersion >= 0x92 && subVersion < 0x13d) s.i32();
  }
  if (subVersion > 0xa7) ppMaterialMergeable = s.bool();
  return {
    hideInPlayMode, restitution, frictionScale, grabbability, stickiness, isProjectile, hasShadow,
    noBevel, zSlice, climbability, tweakType, highlight, includeRigidConnectors, droppable, requiresTag, requiresNewTouch, maxSpeed, colorIndex, ppGrab, ppTweakability,
    ppRigidConnection, activation, grabFilter, noAutoDestruct, disablePhysicsAudio, touchability,
    touchRotationalStrength, touchabilityInvisible, name, isUsableByPoppetAudio,
    ppMaterialMergeable,
  };
}
