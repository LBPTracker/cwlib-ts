/** `YELLOWHEAD`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { thingArray, writeThingArray } from './common.ts';
import { readEyetoyData, writeEyetoyData, type EyetoyData } from './stickers.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  /** From version 0x232: in the older popit as well as this one. */
  readonly raycast?: RaycastResults;
  /** Below version 0x2ed the popit is another struct: `readLegacyPoppet`. */
  readonly legacy?: LegacyPoppet;
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
  if (version < 0x2ed) return { isInUse, modeStack, ...readLegacyPoppet(s, readers) };
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
  /** Below version 0x3da: cwlib's `sensorHistory`, a `vectorarray`. */
  readonly sensorHistory?: readonly V4[];
  /** Below version 0x3da. */
  readonly newestSense?: number;
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
  let sensorHistory: V4[] | undefined;
  let newestSense: number | undefined;
  // ❗ **cwlib's gates below LBP3, gate for gate** (`PYellowHead.java`); the
  // reads it cannot name are discarded. Without them the archive's LBP1 plans
  // at 0x272 that hold a Sackboy read `sensorHistory` as the next Thing.
  const head = readThingRef(s, readers);
  let legacyToolTetherJoint: Thing | undefined;
  if (version > 0x1fc) legacyToolTetherJoint = readThingRef(s, readers);
  else s.i32();
  if (version < 0x13c) s.skipVector4();
  if (version < 0x8c) s.i32();
  if (version < 0x1d6) s.resource();
  const legacyToolTetherWidth = s.f32();
  const playerNumber = s.s32();
  if (version < 0x155) s.i32();
  if (version < 0x20c) s.bool();
  if (version < 0x161) s.bool();
  if (version === 0x170) s.bool();
  const poppet = hasPoppet(version) ? s.reference((self) => readPoppet(self, readers)) : undefined;
  if (subVersion >= 0xc && subVersion < 0x66) throw new SerializerError(`PYellowHead at subVersion 0x${subVersion.toString(16)} holds an object cwlib cannot read`);
  if (version < 0x3da) {
    const count = s.count();
    sensorHistory = [];
    for (let i = 0; i < count; i += 1) sensorHistory.push(s.vector4());
  }
  if (version < 0x203) s.f32();
  if (version < 0x3da) newestSense = s.i32();
  if (version >= 0x146 && version < 0x16b) s.i32();
  if (version >= 0x16b) requestedSuicide = s.bool();
  const legacyJetpack = readThingRef(s, readers);
  if (version > 0x134 && version < 0x164) {
    s.i32(); // primary
    s.i32(); // secondary
    s.i32(); // tertiary
  }
  if (version > 0x193) onScreenCounter = s.f32();
  if (version > 0x1ba && version < 0x1fd) s.i32();
  if (version > 0x1d0) onScreenStatus = s.i8();
  if (version > 0x1d3) editJetpack = s.bool();
  if (version > 0x272) {
    if (version < 0x2df) recording = s.bool();
    recordee = readThingRef(s, readers);
  }
  if (version > 0x359) lastTimeSlappedAPlayer = s.i32();
  if (subVersion >= 0x83 && subVersion < 0x8b) s.u8();
  if (subVersion >= 0x88 && subVersion < 0xa3) throw new SerializerError(`PYellowHead at subVersion 0x${subVersion.toString(16)} holds an object cwlib cannot read`);
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
    recordee, sensorHistory, newestSense,
  };
}

/** Whether `PYellowHead` holds its popit: cwlib's gate, whose last arm is the live one. */
function hasPoppet(version: number): boolean {
  return version < 0x17f || (version > 0x184 && version < 0x192) || version > 0x1b5;
}

function writeRaycastResults(w: Writer, r: RaycastResults, ctx: PartWriteContext): void {
  w.vector4(r.hitpoint);
  w.vector4(r.normal);
  w.f32(r.baryU);
  w.f32(r.baryV);
  w.i32(r.triIndex);
  ctx.thing(w, r.hitThing);
  ctx.thing(w, r.refThing);
  w.s32(r.onCostumePiece);
  w.i32(r.decorationIdx);
  w.bool(r.switchConnector);
}

function writePoppetMaterialOverride(w: Writer, m: PoppetMaterialOverride): void {
  const { version, subVersion } = w.revision;
  if (version >= 0x2ed) w.ref(m.plan, { descriptor: true });
  w.ref(m.gfxMaterial);
  w.ref(m.bevel);
  w.ref(m.physicsMaterial);
  w.i32(m.soundEnum);
  w.f32(m.bevelSize);
  if (version < 0x2ed) w.ref(m.plan, { descriptor: true });
  if (subVersion > 0x62) w.bool(m.headDucking ?? false);
}

function writePoppetShapeOverride(w: Writer, o: PoppetShapeOverride): void {
  w.i32(o.polygon.length);
  for (const v of o.polygon) w.vector3(v);
  w.intVector(o.loops);
  w.s32(o.back);
  w.s32(o.front);
  w.f32(o.scale);
  w.f32(o.angle);
  if (w.revision.version > 0x317) w.matrix(o.worldMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function writePoppet(w: Writer, p: Poppet, ctx: PartWriteContext): void {
  const { version } = w.revision;
  w.bool(p.isInUse);
  w.i32(p.modeStack.length);
  for (const mode of p.modeStack) {
    w.i32(mode.mode);
    w.i32(mode.subMode);
  }
  if (version < 0x2ed) {
    writeLegacyPoppet(w, p, ctx);
    return;
  }
  writeRaycastResults(w, p.raycast ?? NO_RAYCAST, ctx);
  if (version > 0x2ec) writeThingArray(w, ctx, p.frozenList);
  if (version > 0x2f1) writeThingArray(w, ctx, p.hiddenList);
  if (version >= 0x311) {
    writePoppetMaterialOverride(w, p.materialOverride ?? {
      soundEnum: 0, bevelSize: 0,
    });
    writePoppetShapeOverride(w, p.shapeOverride ?? { polygon: [], loops: [], back: 0, front: 0, scale: 0, angle: 0 });
  }
  if (version >= 0x3a0) writeThingArray(w, ctx, p.tweakObjects);
}

/** `readYellowHead`'s mirror; the popit goes in as a reference, as it is read. */
export function writeYellowHead(w: Writer, value: YellowHeadPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  ctx.thing(w, value.head);
  if (version > 0x1fc) ctx.thing(w, value.legacyToolTetherJoint);
  else w.i32(0);
  if (version < 0x13c) w.vector4(ZERO4);
  if (version < 0x8c) w.i32(0);
  if (version < 0x1d6) w.ref(undefined);
  w.f32(value.legacyToolTetherWidth);
  w.s32(value.playerNumber);
  if (version < 0x155) w.i32(0);
  if (version < 0x20c) w.bool(false);
  if (version < 0x161) w.bool(false);
  if (version === 0x170) w.bool(false);
  if (hasPoppet(version)) w.reference(value.poppet, (self, poppet) => writePoppet(self, poppet, ctx));
  if (version < 0x3da) {
    w.i32(value.sensorHistory?.length ?? 0);
    for (const sense of value.sensorHistory ?? []) w.vector4(sense);
  }
  if (version < 0x203) w.f32(0);
  if (version < 0x3da) w.i32(value.newestSense ?? 0);
  if (version >= 0x146 && version < 0x16b) w.i32(0);
  if (version >= 0x16b) w.bool(value.requestedSuicide ?? false);
  ctx.thing(w, value.legacyJetpack);
  if (version > 0x134 && version < 0x164) {
    w.i32(0);
    w.i32(0);
    w.i32(0);
  }
  if (version > 0x193) w.f32(value.onScreenCounter ?? 0);
  if (version > 0x1ba && version < 0x1fd) w.i32(0);
  if (version > 0x1d0) w.i8(value.onScreenStatus ?? 0);
  if (version > 0x1d3) w.bool(value.editJetpack ?? false);
  if (version > 0x272) {
    if (version < 0x2df) w.bool(value.recording ?? false);
    ctx.thing(w, value.recordee);
  }
  if (version > 0x359) w.i32(value.lastTimeSlappedAPlayer ?? 0);
  if (subVersion >= 0x83 && subVersion < 0x8b) w.u8(0);
  if (subVersion > 0xa5) w.i32(value.animSetKey);
  if (subVersion > 0xd2) w.bool(value.monstrousHeadScale ?? false);
  if (subVersion > 0x12a) {
    w.i32(value.creatureToSpawnAs);
    w.bool(value.spawnAsAlternateForm ?? false);
  }
}

/** A raycast that hit nothing, for a popit written with none. */
const NO_RAYCAST: RaycastResults = {
  hitpoint: [0, 0, 0, 0], normal: [0, 0, 0, 0], baryU: 0, baryV: 0, triIndex: 0,
  onCostumePiece: 0, decorationIdx: 0, switchConnector: false,
};

/** `ObjectState`: a Thing the popit is editing, with its depth. */
export interface PoppetObjectState {
  readonly thing?: Thing;
  readonly backZ: number;
  readonly frontZ: number;
  /** From version 0x2bd. */
  readonly flags?: number;
}

/** `StickerInfo`: the sticker the popit is placing. */
export interface PoppetStickerInfo {
  readonly up: V4;
  readonly across: V4;
  readonly texture?: ResourceRef;
  readonly height: number;
  readonly width: number;
  readonly angle: number;
  readonly scale: number;
  readonly reversed: boolean;
  readonly offset: V4;
  readonly stamping: boolean;
  /** From version 0x160. */
  readonly plan?: ResourceRef;
  /** From version 0x24c. */
  readonly eyetoyData?: EyetoyData;
}

/** `DecorationInfo`: the decoration the popit is placing. */
export interface PoppetDecorationInfo {
  readonly angle: number;
  readonly lastDecoration: number;
  readonly lastDecoratedThing?: Thing;
  readonly decoration?: ResourceRef;
  readonly scale: number;
  readonly reversed: boolean;
  /** From version 0x148. */
  readonly stamping?: boolean;
  /** From version 0x178. */
  readonly plan?: ResourceRef;
}

/** `PlacementBodyState`: a Thing being placed, and where it hung before. */
export interface PoppetPlacementBodyState {
  readonly thing?: Thing;
  readonly oldParent?: Thing;
  readonly frozen: number;
}

/** `PoppetEditState`, below version 0x2ed: what the popit is doing to the level. */
export interface PoppetEditState {
  readonly editObjectList: readonly PoppetObjectState[];
  readonly frozenList: readonly (Thing | undefined)[];
  /** Below version 0x2bf. */
  readonly backZ?: number;
  readonly frontZ?: number;
  readonly lerpFactor: number;
  readonly sticker: PoppetStickerInfo;
  readonly decoration: PoppetDecorationInfo;
  readonly cursorDummy?: Thing;
  readonly placementDummy?: Thing;
  readonly placementBodyState?: readonly PoppetPlacementBodyState[];
  readonly pauseList?: readonly (Thing | undefined)[];
  readonly vertexCursor?: V3;
  readonly decorativeThingAngle?: number;
  readonly switchConnectorRef?: Thing;
  readonly switchConnector?: Thing;
  /** From version 0x148 the shape's outline, from 0x1b6 the rest of it. */
  readonly overrideShape?: PoppetShapeOverride;
  readonly decorativeThingScale?: number;
  /** From version 0x1b6. */
  readonly overrideMaterial?: PoppetMaterialOverride;
  readonly lastGridMoveFrame?: number;
  readonly lastGridRotateFrame?: number;
  readonly lastGridScaleFrame?: number;
  readonly switchConnectorUID?: number;
}

/** `PoppetTweakObjectPlacement`: the Thing the popit is tweaking, and where it began. */
export interface PoppetTweakObjectPlacement {
  readonly objectList: readonly (Thing | undefined)[];
  readonly startMatrix: Float32Array;
  /** Below version 0x160, a `GlobalThingDescriptor`: a level and a UID in it. */
  readonly level?: ResourceRef;
  readonly uid?: number;
  /** From version 0x160. */
  readonly plan?: ResourceRef;
  readonly proxyObject?: Thing;
  readonly backZ: number;
  readonly thickness: number;
  readonly backToZPos: number;
  readonly rotate: number;
  readonly scale: number;
  readonly lastGridMoveFrame?: number;
  readonly lastGridRotateFrame?: number;
  readonly lastGridScaleFrame?: number;
}

/** The popit below version 0x2ed, the branch cwlib's `Poppet` reads and returns from. */
export interface LegacyPoppet {
  readonly edit: PoppetEditState;
  /** From version 0x147. */
  readonly tweakObject?: Thing;
  readonly backupCameraZoneTargetBox?: V4;
  readonly backupCameraZonePitchAngle?: V3;
  readonly backupCameraZoneZoomDistance?: number;
  readonly cameraZoneZoomSpeed?: number;
  readonly tweakObjectPlacement?: PoppetTweakObjectPlacement;
  /** From version 0x1dd. */
  readonly marqueeSelectOrigin?: V3;
  readonly marqueeSelectList?: readonly (Thing | undefined)[];
  /** From version 0x218. */
  readonly overrideMaterial?: PoppetMaterialOverride;
  /** From version 0x232. */
  readonly dangerMode?: number;
}

function readObjectState(s: Serializer, readers: ReadonlyMap<string, PartReader>): PoppetObjectState {
  const { version } = s.revision;
  const thing = readThingRef(s, readers);
  const backZ = s.s32();
  const frontZ = s.s32();
  if (version < 0x2bd) s.bool();
  if (version > 0x147 && version < 0x2be) s.bool();
  let flags: number | undefined;
  if (version > 0x2bc) flags = s.i32();
  else if (version > 0x25e) s.bool();
  return { thing, backZ, frontZ, flags };
}

function readStickerInfo(s: Serializer): PoppetStickerInfo {
  const { version } = s.revision;
  return {
    up: s.vector4(), across: s.vector4(), texture: s.resource(),
    height: s.f32(), width: s.f32(), angle: s.f32(), scale: s.f32(), reversed: s.bool(),
    offset: s.vector4(), stamping: s.bool(),
    plan: version > 0x15f ? s.resource(true) : undefined,
    eyetoyData: version > 0x24b ? readEyetoyData(s) : undefined,
  };
}

function readDecorationInfo(s: Serializer, readers: ReadonlyMap<string, PartReader>): PoppetDecorationInfo {
  const { version } = s.revision;
  return {
    angle: s.f32(), lastDecoration: s.i32(), lastDecoratedThing: readThingRef(s, readers),
    decoration: s.resource(), scale: s.f32(), reversed: s.bool(),
    stamping: version > 0x147 ? s.bool() : undefined,
    plan: version > 0x177 ? s.resource(true) : undefined,
  };
}

/** cwlib's `PoppetEditState`, gate for gate; the reads it does not name are discarded. */
function readEditState(s: Serializer, readers: ReadonlyMap<string, PartReader>): PoppetEditState {
  const { version } = s.revision;
  const editObjectList = s.array((self) => readObjectState(self, readers));
  if (version < 0x1a0) thingArray(s, readers);
  const frozenList = thingArray(s, readers);
  let backZ: number | undefined;
  let frontZ: number | undefined;
  if (version < 0x2bf) {
    backZ = s.s32();
    frontZ = s.s32();
  }
  const lerpFactor = s.f32();
  const sticker = readStickerInfo(s);
  const decoration = readDecorationInfo(s, readers);
  if (version < 0x18b) s.skipVector3();
  const cursorDummy = version > 0x1b5 ? readThingRef(s, readers) : undefined;
  const placementDummy = version > 0x147 ? readThingRef(s, readers) : undefined;
  if (version > 0x147 && version < 0x1a0) {
    thingArray(s, readers);
    thingArray(s, readers);
  }
  const placementBodyState = version > 0x19f
    ? s.array((self) => ({ thing: readThingRef(self, readers), oldParent: readThingRef(self, readers), frozen: self.i32() }))
    : undefined;
  const pauseList = version > 0x147 ? thingArray(s, readers) : undefined;
  const vertexCursor = version > 0x1dc ? s.vector3() : undefined;
  let decorativeThingAngle: number | undefined;
  let switchConnectorRef: Thing | undefined;
  let switchConnector: Thing | undefined;
  if (version > 0x147) {
    decorativeThingAngle = s.f32();
    switchConnectorRef = readThingRef(s, readers);
    switchConnector = readThingRef(s, readers);
  }
  if (version > 0x147 && version < 0x190) s.resource(); // a script
  let overrideShape: PoppetShapeOverride | undefined;
  if (version > 0x147) {
    if (version < 0x190) s.bool();
    // A plain count and that many vectors, as in `readPoppetShapeOverride`.
    const polygon = Array.from({ length: s.count() }, () => s.vector3());
    overrideShape = { polygon, loops: s.intVector(), back: 0, front: 0, scale: 0, angle: 0 };
  }
  const decorativeThingScale = version > 0x185 ? s.f32() : undefined;
  let overrideMaterial: PoppetMaterialOverride | undefined;
  if (version > 0x1b5) {
    overrideShape = { polygon: [], loops: [], ...overrideShape, back: s.s32(), front: s.s32(), scale: s.f32(), angle: s.f32() };
    overrideMaterial = readPoppetMaterialOverride(s);
  }
  let lastGridMoveFrame: number | undefined;
  let lastGridRotateFrame: number | undefined;
  let lastGridScaleFrame: number | undefined;
  if (version > 0x26b) {
    lastGridMoveFrame = s.i32();
    if (version < 0x2c2) {
      lastGridRotateFrame = s.i32();
      lastGridScaleFrame = s.i32();
    }
  }
  const switchConnectorUID = version > 0x27d ? s.i32() : undefined;
  return {
    editObjectList, frozenList, backZ, frontZ, lerpFactor, sticker, decoration, cursorDummy,
    placementDummy, placementBodyState, pauseList, vertexCursor, decorativeThingAngle,
    switchConnectorRef, switchConnector, overrideShape, decorativeThingScale, overrideMaterial,
    lastGridMoveFrame, lastGridRotateFrame, lastGridScaleFrame, switchConnectorUID,
  };
}

function readTweakObjectPlacement(s: Serializer, readers: ReadonlyMap<string, PartReader>): PoppetTweakObjectPlacement {
  const { version } = s.revision;
  const objectList = thingArray(s, readers);
  const startMatrix = s.matrix();
  let level: ResourceRef | undefined;
  let uid: number | undefined;
  let plan: ResourceRef | undefined;
  if (version < 0x160) {
    level = s.resource(true, false, false);
    uid = s.i32();
  } else plan = s.resource(true, false, false);
  const proxyObject = readThingRef(s, readers);
  const backZ = s.s32();
  const thickness = s.s32();
  const backToZPos = s.f32();
  const rotate = s.f32();
  const scale = s.f32();
  let lastGridMoveFrame: number | undefined;
  let lastGridRotateFrame: number | undefined;
  let lastGridScaleFrame: number | undefined;
  if (version > 0x26b) {
    lastGridMoveFrame = s.i32();
    lastGridRotateFrame = s.i32();
    lastGridScaleFrame = s.i32();
  }
  return {
    objectList, startMatrix, level, uid, plan, proxyObject, backZ, thickness, backToZPos, rotate,
    scale, lastGridMoveFrame, lastGridRotateFrame, lastGridScaleFrame,
  };
}

/**
 * ❗ **The popit below version 0x2ed** -- cwlib's `Poppet`, gate for gate: the
 * branch it reads and returns from. Without it every LBP1 plan holding a
 * Sackboy (42 of the archive's at 0x272) read a raycast where the edit state is.
 */
function readLegacyPoppet(
  s: Serializer,
  readers: ReadonlyMap<string, PartReader>,
): { legacy: LegacyPoppet; raycast?: RaycastResults } {
  const { version } = s.revision;
  if (version < 0x232) s.skipVector3();
  if (version < 0x135) s.i32();
  if (version >= 0x185 && version < 0x1ba) s.i32(); // a script object's UID
  const edit = readEditState(s, readers);
  if (version < 0x18f) s.array((self) => self.i32());
  if (version >= 0x148 && version < 0x185) readThingRef(s, readers);
  let tweak: Partial<LegacyPoppet> = {};
  if (version >= 0x147) {
    tweak = {
      tweakObject: readThingRef(s, readers),
      backupCameraZoneTargetBox: s.vector4(),
      backupCameraZonePitchAngle: s.vector3(),
      backupCameraZoneZoomDistance: s.f32(),
      cameraZoneZoomSpeed: s.f32(),
      tweakObjectPlacement: readTweakObjectPlacement(s, readers),
    };
    if (version < 0x211) s.bool();
  }
  if (version > 0x184 && version < 0x1dd) s.skipVector3();
  let marqueeSelectOrigin: V3 | undefined;
  let marqueeSelectList: (Thing | undefined)[] | undefined;
  if (version > 0x1dc) {
    if (version < 0x232) s.bool();
    marqueeSelectOrigin = s.vector3();
    marqueeSelectList = thingArray(s, readers);
  }
  const overrideMaterial = version >= 0x218 ? readPoppetMaterialOverride(s) : undefined;
  if (version >= 0x1b8 && version < 0x1e2) s.i32();
  if (version >= 0x1ba && version < 0x1e2) s.i32();
  const raycast = version >= 0x232 ? readRaycastResults(s, readers) : undefined;
  const dangerMode = version >= 0x232 ? s.i32() : undefined;
  if (version >= 0x236) {
    s.i32();
    s.skipVector3();
    if (version >= 0x23a) s.skipVector3();
  }
  return {
    legacy: { ...tweak, edit, marqueeSelectOrigin, marqueeSelectList, overrideMaterial, dangerMode },
    raycast,
  };
}

/** `readLegacyPoppet`'s mirror; the reads it discards are written as cwlib writes them, 0 or null. */
function writeLegacyPoppet(w: Writer, p: Poppet, ctx: PartWriteContext): void {
  const { version } = w.revision;
  const legacy = p.legacy;
  if (version < 0x232) w.vector3(ZERO3);
  if (version < 0x135) w.i32(0);
  if (version >= 0x185 && version < 0x1ba) w.i32(0);
  writeEditState(w, legacy?.edit, ctx);
  if (version < 0x18f) w.i32(0);
  if (version >= 0x148 && version < 0x185) ctx.thing(w, undefined);
  if (version >= 0x147) {
    ctx.thing(w, legacy?.tweakObject);
    w.vector4(legacy?.backupCameraZoneTargetBox ?? ZERO4);
    w.vector3(legacy?.backupCameraZonePitchAngle ?? ZERO3);
    w.f32(legacy?.backupCameraZoneZoomDistance ?? 0);
    w.f32(legacy?.cameraZoneZoomSpeed ?? 0);
    writeTweakObjectPlacement(w, legacy?.tweakObjectPlacement, ctx);
    if (version < 0x211) w.bool(false);
  }
  if (version > 0x184 && version < 0x1dd) w.vector3(ZERO3);
  if (version > 0x1dc) {
    if (version < 0x232) w.bool(false);
    w.vector3(legacy?.marqueeSelectOrigin ?? ZERO3);
    writeThingArray(w, ctx, legacy?.marqueeSelectList);
  }
  if (version >= 0x218) writePoppetMaterialOverride(w, legacy?.overrideMaterial ?? { soundEnum: 0, bevelSize: 0 });
  if (version >= 0x1b8 && version < 0x1e2) w.i32(0);
  if (version >= 0x1ba && version < 0x1e2) w.i32(0);
  if (version >= 0x232) {
    writeRaycastResults(w, p.raycast ?? NO_RAYCAST, ctx);
    w.i32(legacy?.dangerMode ?? 0);
  }
  if (version >= 0x236) {
    w.i32(0);
    w.vector3(ZERO3);
    if (version >= 0x23a) w.vector3(ZERO3);
  }
}

const ZERO3 = [0, 0, 0] as const;
const ZERO4 = [0, 0, 0, 0] as const;

function writeEditState(w: Writer, e: PoppetEditState | undefined, ctx: PartWriteContext): void {
  const { version } = w.revision;
  w.i32(e?.editObjectList.length ?? 0);
  for (const o of e?.editObjectList ?? []) {
    ctx.thing(w, o.thing);
    w.s32(o.backZ);
    w.s32(o.frontZ);
    if (version < 0x2bd) w.bool(false);
    if (version > 0x147 && version < 0x2be) w.bool(false);
    if (version > 0x2bc) w.i32(o.flags ?? 0);
    else if (version > 0x25e) w.bool(false);
  }
  if (version < 0x1a0) w.i32(0);
  writeThingArray(w, ctx, e?.frozenList);
  if (version < 0x2bf) {
    w.s32(e?.backZ ?? 0);
    w.s32(e?.frontZ ?? 0);
  }
  w.f32(e?.lerpFactor ?? 0);
  const st = e?.sticker;
  w.vector4(st?.up ?? ZERO4);
  w.vector4(st?.across ?? ZERO4);
  w.ref(st?.texture);
  w.f32(st?.height ?? 0);
  w.f32(st?.width ?? 0);
  w.f32(st?.angle ?? 0);
  w.f32(st?.scale ?? 0);
  w.bool(st?.reversed ?? false);
  w.vector4(st?.offset ?? ZERO4);
  w.bool(st?.stamping ?? false);
  if (version > 0x15f) w.ref(st?.plan, { descriptor: true });
  if (version > 0x24b) writeEyetoyData(w, st?.eyetoyData ?? {});
  const d = e?.decoration;
  w.f32(d?.angle ?? 0);
  w.i32(d?.lastDecoration ?? 0);
  ctx.thing(w, d?.lastDecoratedThing);
  w.ref(d?.decoration);
  w.f32(d?.scale ?? 0);
  w.bool(d?.reversed ?? false);
  if (version > 0x147) w.bool(d?.stamping ?? false);
  if (version > 0x177) w.ref(d?.plan, { descriptor: true });
  if (version < 0x18b) w.vector3(ZERO3);
  if (version > 0x1b5) ctx.thing(w, e?.cursorDummy);
  if (version > 0x147) ctx.thing(w, e?.placementDummy);
  if (version > 0x147 && version < 0x1a0) {
    w.i32(0);
    w.i32(0);
  }
  if (version > 0x19f) {
    w.i32(e?.placementBodyState?.length ?? 0);
    for (const b of e?.placementBodyState ?? []) {
      ctx.thing(w, b.thing);
      ctx.thing(w, b.oldParent);
      w.i32(b.frozen);
    }
  }
  if (version > 0x147) writeThingArray(w, ctx, e?.pauseList);
  if (version > 0x1dc) w.vector3(e?.vertexCursor ?? ZERO3);
  if (version > 0x147) {
    w.f32(e?.decorativeThingAngle ?? 0);
    ctx.thing(w, e?.switchConnectorRef);
    ctx.thing(w, e?.switchConnector);
  }
  if (version > 0x147 && version < 0x190) w.ref(undefined);
  const shape = e?.overrideShape;
  if (version > 0x147) {
    if (version < 0x190) w.bool(false);
    w.i32(shape?.polygon.length ?? 0);
    for (const v of shape?.polygon ?? []) w.vector3(v);
    w.intVector(shape?.loops ?? []);
  }
  if (version > 0x185) w.f32(e?.decorativeThingScale ?? 0);
  if (version > 0x1b5) {
    w.s32(shape?.back ?? 0);
    w.s32(shape?.front ?? 0);
    w.f32(shape?.scale ?? 0);
    w.f32(shape?.angle ?? 0);
    writePoppetMaterialOverride(w, e?.overrideMaterial ?? { soundEnum: 0, bevelSize: 0 });
  }
  if (version > 0x26b) {
    w.i32(e?.lastGridMoveFrame ?? 0);
    if (version < 0x2c2) {
      w.i32(e?.lastGridRotateFrame ?? 0);
      w.i32(e?.lastGridScaleFrame ?? 0);
    }
  }
  if (version > 0x27d) w.i32(e?.switchConnectorUID ?? 0);
}

function writeTweakObjectPlacement(w: Writer, t: PoppetTweakObjectPlacement | undefined, ctx: PartWriteContext): void {
  const { version } = w.revision;
  writeThingArray(w, ctx, t?.objectList);
  w.matrix(t?.startMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (version < 0x160) {
    w.ref(t?.level, { descriptor: true, classPointer: false });
    w.i32(t?.uid ?? 0);
  } else w.ref(t?.plan, { descriptor: true, classPointer: false });
  ctx.thing(w, t?.proxyObject);
  w.s32(t?.backZ ?? 0);
  w.s32(t?.thickness ?? 0);
  w.f32(t?.backToZPos ?? 0);
  w.f32(t?.rotate ?? 0);
  w.f32(t?.scale ?? 0);
  if (version > 0x26b) {
    w.i32(t?.lastGridMoveFrame ?? 0);
    w.i32(t?.lastGridRotateFrame ?? 0);
    w.i32(t?.lastGridScaleFrame ?? 0);
  }
}
