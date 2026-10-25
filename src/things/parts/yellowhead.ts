/** `YELLOWHEAD`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray } from './common.ts';

type V3 = readonly [number, number, number];
type V4 = readonly [number, number, number, number];

/** `PoppetMode`: what the popit has open, and its sub-mode. */
export interface PoppetMode {
  readonly mode: number;
  readonly subMode: number;
}

function readPoppetMode(s: Serializer): PoppetMode {
  return { mode: s.i32(), subMode: s.i32() };
}

/** `RaycastResults`: what the popit's cursor is pointing at. */
export interface RaycastResults {
  readonly hitpoint: V4;
  readonly normal: V4;
  readonly baryU: number;
  readonly baryV: number;
  readonly triIndex: number;
  readonly hitThing?: Thing;
  readonly refThing?: Thing;
  readonly onCostumePiece: number;
  readonly decorationIdx: number;
  readonly switchConnector: boolean;
}

function readRaycastResults(s: Serializer, readers: ReadonlyMap<string, PartReader>): RaycastResults {
  return {
    hitpoint: s.vector4(),
    normal: s.vector4(),
    baryU: s.f32(),
    baryV: s.f32(),
    triIndex: s.i32(),
    hitThing: readThingRef(s, readers),
    refThing: readThingRef(s, readers),
    onCostumePiece: s.s32(),
    decorationIdx: s.i32(),
    switchConnector: s.bool(),
  };
}

/** `PoppetMaterialOverride`: what the popit is painting with. */
export interface PoppetMaterialOverride {
  /** The plan, a hashed or GUID descriptor. */
  readonly plan?: ResourceRef;
  readonly gfxMaterial?: ResourceRef;
  readonly bevel?: ResourceRef;
  readonly physicsMaterial?: ResourceRef;
  readonly soundEnum: number;
  readonly bevelSize: number;
  readonly headDucking?: boolean;
}

function readPoppetMaterialOverride(s: Serializer): PoppetMaterialOverride {
  const { version, subVersion } = s.revision;
  // The plan moved to the front at 0x2ed; both writes are here because that is
  // how cwlib has it, and only one of them can fire.
  let plan = version >= 0x2ed ? s.resource(true) : undefined;
  const gfxMaterial = s.resource();
  const bevel = s.resource();
  const physicsMaterial = s.resource();
  const soundEnum = s.i32();
  const bevelSize = s.f32();
  if (version < 0x2ed) plan = s.resource(true);
  const headDucking = subVersion > 0x62 ? s.bool() : undefined;
  return { plan, gfxMaterial, bevel, physicsMaterial, soundEnum, bevelSize, headDucking };
}

/** `PoppetShapeOverride`: the shape the popit is drawing. */
export interface PoppetShapeOverride {
  readonly polygon: readonly V3[];
  readonly loops: readonly number[];
  readonly back: number;
  readonly front: number;
  readonly scale: number;
  readonly angle: number;
  readonly worldMatrix?: Float32Array;
}

function readPoppetShapeOverride(s: Serializer): PoppetShapeOverride {
  // ⚠️ A plain count and that many vectors, not an `array` of structs: cwlib
  // writes the length itself here rather than going through its array helper.
  const polygon = Array.from({ length: s.count() }, () => s.vector3());
  return {
    polygon,
    loops: s.intVector(),
    back: s.s32(),
    front: s.s32(),
    scale: s.f32(),
    angle: s.f32(),
    worldMatrix: s.revision.version > 0x317 ? s.matrix() : undefined,
  };
}

/**
 * `Poppet`: a player's popit and what it has open.
 *
 * ⚠️ **Only the post-0x2ec layout is here.** Below that revision `Poppet` is a
 * different structure entirely -- an edit state, a marquee selection, a camera
 * zone backup -- and `requireLbp3` rules every one of those files out before
 * this can be reached. Adding them means adding that whole branch, not relaxing
 * a gate.
 */
export interface Poppet {
  readonly isInUse: boolean;
  readonly modeStack: readonly PoppetMode[];
  readonly raycast: RaycastResults;
  readonly frozenList?: readonly (Thing | undefined)[];
  readonly hiddenList?: readonly (Thing | undefined)[];
  readonly materialOverride?: PoppetMaterialOverride;
  readonly shapeOverride?: PoppetShapeOverride;
  readonly tweakObjects?: readonly (Thing | undefined)[];
}

function readPoppet(s: Serializer, readers: ReadonlyMap<string, PartReader>): Poppet {
  const { version } = s.revision;
  const isInUse = s.bool();
  const modeStack = s.array(readPoppetMode);
  const raycast = readRaycastResults(s, readers);
  const frozenList = version > 0x2ec ? thingArray(s, readers) : undefined;
  const hiddenList = version > 0x2f1 ? thingArray(s, readers) : undefined;
  const materialOverride = version >= 0x311 ? readPoppetMaterialOverride(s) : undefined;
  const shapeOverride = version >= 0x311 ? readPoppetShapeOverride(s) : undefined;
  const tweakObjects = version >= 0x3a0 ? thingArray(s, readers) : undefined;
  return {
    isInUse, modeStack, raycast, frozenList, hiddenList, materialOverride, shapeOverride,
    tweakObjects,
  };
}

/**
 * `PYellowHead`: a player, and the popit they are holding.
 *
 * ✔ **Verified on the one file that has one.** A player's popit state appears in
 * a *save*, not in a published level -- none of the 43 levels or 86 further
 * resources pulled out of the public archive carries one -- but a plan in the
 * corpus saves does, and `test/plan.test.ts` opens it. That test verifies the
 * port properly rather than by not throwing: `readPlan` requires the Thing array
 * to fill `thingData` **exactly**, so every field below has been read at the
 * right width. The corpus went from 211 plans parsing to **212**.
 *
 * ✔ **What is settled is that LBP3 is a clean path through it.** cwlib throws a
 * `SerializationException` in two subVersion ranges -- `[0xc, 0x66)` and
 * `[0x88, 0xa3)` -- and the subVersions read here are 0, `0x12c`-`0x1ab` and
 * `0x205`-`0x218` (steering/level-files.md), so neither can fire. Every version gate above 0x359 is likewise always true here;
 * they are written out anyway, because that is where the shape came from.
 */
/** `PYellowHead`, kept: a player's Sackboy -- whose, its head, and what it spawns as. */
export interface YellowHeadPart {
  readonly head?: Thing;
  readonly playerNumber: number;
  readonly animSetKey: number;
  readonly creatureToSpawnAs: number;
  readonly legacyToolTetherWidth: number;
  readonly spawnAsAlternateForm?: boolean;
  readonly requestedSuicide?: boolean;
  readonly onScreenCounter?: number;
  readonly onScreenStatus?: number;
  readonly editJetpack?: boolean;
  readonly recording?: boolean;
  readonly lastTimeSlappedAPlayer?: number;
  readonly monstrousHeadScale?: boolean;
  readonly legacyToolTetherJoint?: Thing;
  /** The popit the player holds. */
  readonly poppet?: Poppet;
  readonly legacyJetpack?: Thing;
  readonly recordee?: Thing;
}

export function readYellowHead(s: Serializer, readers: ReadonlyMap<string, PartReader>): YellowHeadPart {
  const { version, subVersion } = s.revision;
  let requestedSuicide: boolean | undefined;
  let onScreenCounter: number | undefined;
  let onScreenStatus: number | undefined;
  let editJetpack: boolean | undefined;
  let recording: boolean | undefined;
  let lastTimeSlappedAPlayer: number | undefined;
  let monstrousHeadScale: boolean | undefined;
  let spawnAsAlternateForm: boolean | undefined;
  let recordee: Thing | undefined;
  let [animSetKey, creatureToSpawnAs] = [0, 0];
  const head = readThingRef(s, readers);
  const legacyToolTetherJoint = version > 0x1fc ? readThingRef(s, readers) : undefined;
  const legacyToolTetherWidth = s.f32();
  const playerNumber = s.s32();
  // The gate is `version < 0x17f || (0x184 < v < 0x192) || v > 0x1b5`, and the
  // last arm is the live one.
  const poppet = s.reference((self) => readPoppet(self, readers));
  if (version >= 0x16b) requestedSuicide = s.bool();
  const legacyJetpack = readThingRef(s, readers);
  if (version > 0x193) onScreenCounter = s.f32();
  if (version > 0x1d0) onScreenStatus = s.i8();
  if (version > 0x1d3) editJetpack = s.bool();
  if (version > 0x272) {
    if (version < 0x2df) recording = s.bool();
    recordee = readThingRef(s, readers);
  }
  if (version > 0x359) lastTimeSlappedAPlayer = s.i32();
  if (subVersion > 0xa5) animSetKey = s.i32();
  if (subVersion > 0xd2) monstrousHeadScale = s.bool();
  if (subVersion > 0x12a) {
    creatureToSpawnAs = s.i32();
    spawnAsAlternateForm = s.bool();
  }
  return {
    head, playerNumber, animSetKey, creatureToSpawnAs, legacyToolTetherWidth, spawnAsAlternateForm,
    requestedSuicide, onScreenCounter, onScreenStatus, editJetpack, recording,
    lastTimeSlappedAPlayer, monstrousHeadScale, legacyToolTetherJoint, poppet, legacyJetpack,
    recordee,
  };
}
