/** `YELLOWHEAD`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { things } from './common.ts';

/** `PoppetMode`: what the popit has open, and its sub-mode. */
function readPoppetMode(s: Serializer): void {
  s.i32(); // mode
  s.i32(); // subMode
}

/** `RaycastResults`: what the popit's cursor is pointing at. */
function readRaycastResults(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  s.skipVector4(); // hitpoint
  s.skipVector4(); // normal
  s.f32(); // baryU
  s.f32(); // baryV
  s.i32(); // triIndex
  readThingRef(s, readers); // hitThing
  readThingRef(s, readers); // refThing
  s.s32(); // onCostumePiece
  s.i32(); // decorationIdx
  s.bool(); // switchConnector
}

/** `PoppetMaterialOverride`: what the popit is painting with. */
function readPoppetMaterialOverride(s: Serializer): void {
  const { version, subVersion } = s.revision;
  // The plan moved to the front at 0x2ed; both writes are here because that is
  // how cwlib has it, and only one of them can fire.
  if (version >= 0x2ed) s.resource(true); // plan
  s.resource(); // gfxMaterial
  s.resource(); // bevel
  s.resource(); // physicsMaterial
  s.i32(); // soundEnum
  s.f32(); // bevelSize
  if (version < 0x2ed) s.resource(true); // plan
  if (subVersion > 0x62) s.bool(); // headDucking
}

/** `PoppetShapeOverride`: the shape the popit is drawing. */
function readPoppetShapeOverride(s: Serializer): void {
  // ⚠️ A plain count and that many vectors, not an `array` of structs: cwlib
  // writes the length itself here rather than going through its array helper.
  const count = s.count();
  for (let i = 0; i < count; i += 1) s.skipVector3(); // polygon
  s.intVector(); // loops
  s.s32(); // back
  s.s32(); // front
  s.f32(); // scale
  s.f32(); // angle
  if (s.revision.version > 0x317) s.skipMatrix(); // worldMatrix
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
function readPoppet(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version } = s.revision;
  s.bool(); // isInUse
  s.array(readPoppetMode); // modeStack
  readRaycastResults(s, readers);
  if (version > 0x2ec) things(s, readers); // frozenList
  if (version > 0x2f1) things(s, readers); // hiddenList
  if (version >= 0x311) {
    readPoppetMaterialOverride(s);
    readPoppetShapeOverride(s);
  }
  if (version >= 0x3a0) things(s, readers); // tweakObjects
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
}

export function readYellowHead(s: Serializer, readers: ReadonlyMap<string, PartReader>): YellowHeadPart {
  const { version, subVersion } = s.revision;
  let [animSetKey, creatureToSpawnAs] = [0, 0];
  const head = readThingRef(s, readers);
  if (version > 0x1fc) readThingRef(s, readers); // legacyToolTetherJoint
  s.f32(); // legacyToolTetherWidth
  const playerNumber = s.s32();
  // The gate is `version < 0x17f || (0x184 < v < 0x192) || v > 0x1b5`, and the
  // last arm is the live one.
  s.reference((self) => readPoppet(self, readers)); // poppet
  if (version >= 0x16b) s.bool(); // requestedSuicide
  readThingRef(s, readers); // legacyJetpack
  if (version > 0x193) s.f32(); // onScreenCounter
  if (version > 0x1d0) s.i8(); // onScreenStatus
  if (version > 0x1d3) s.bool(); // editJetpack
  if (version > 0x272) {
    if (version < 0x2df) s.bool(); // recording
    readThingRef(s, readers); // recordee
  }
  if (version > 0x359) s.i32(); // lastTimeSlappedAPlayer
  if (subVersion > 0xa5) animSetKey = s.i32();
  if (subVersion > 0xd2) s.bool(); // monstrousHeadScale
  if (subVersion > 0x12a) {
    creatureToSpawnAs = s.i32();
    s.bool(); // spawnAsAlternateForm
  }
  return { head, playerNumber, animSetKey, creatureToSpawnAs };
}
