/** `COSTUME`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';
import { onLeerdammer } from '../thing.ts';

/** LEERDAMMER's own revision for the temporary pieces: cwlib's `LD_TEMP_COSTUME`. */
const LD_TEMP_COSTUME = 0xb;

/** `Primitive`: one draw call of a mesh, with the material it is drawn in. */
export interface CostumePrimitive {
  /** The `RGfxMaterial` (`GMTb`). */
  readonly material?: ResourceRef;
  /** version 0x179 on. */
  readonly textureAlternatives?: ResourceRef;
  readonly minVert: number;
  readonly maxVert: number;
  readonly firstIndex: number;
  readonly numIndices: number;
  readonly region: number;
}

/** `CostumePiece`: one wearable, its mesh and the primitives drawn of it. */
export interface CostumePiece {
  /** The `RMesh` (`MSHb`). */
  readonly mesh?: ResourceRef;
  /** cwlib's `categoriesUsed`: bits of the costume slots the piece takes. */
  readonly categoriesUsed: number;
  readonly primitives: readonly CostumePrimitive[];
  /** The piece's plan, a descriptor; version 0x19a on. */
  readonly plan?: ResourceRef;
  /** Which of the mesh's morphs each costume morph drives: an i32 each below subVersion 0x105, a byte each from it. */
  readonly morphParamRemap: readonly number[] | Uint8Array;
}

/** `PCostume`: what a creature is wearing -- its base mesh, its material, and the pieces on it. */
export interface CostumePart {
  readonly mesh?: ResourceRef;
  readonly material?: ResourceRef;
  /** version 0x19a on. */
  readonly materialPlan?: ResourceRef;
  /** The base mesh's parts the pieces hide. */
  readonly meshPartsHidden: readonly number[];
  readonly primitives: readonly CostumePrimitive[];
  /** subVersion 0xdb on; 0 before. */
  readonly creatureFilter: number;
  readonly pieces: readonly CostumePiece[];
  /** version 0x2c5 on, and LEERDAMMER from its revision 0xb: cwlib's `temporaryCostumePiece`s. */
  readonly temporaryPieces: readonly CostumePiece[];
}

function readPrimitive(s: Serializer): CostumePrimitive {
  const material = s.resource();
  // `Revisions.MESH_TEXTURE_ALTERNATIVES` is 0x179, not something in the 0x3xx
  // range -- a guess at that constant cost one debugging round.
  const textureAlternatives = s.revision.version >= 0x179 ? s.resource() : undefined;
  return {
    material, textureAlternatives,
    minVert: s.i32(), maxVert: s.i32(), firstIndex: s.i32(), numIndices: s.i32(), region: s.i32(),
  };
}

function readCostumePiece(s: Serializer): CostumePiece {
  const { version, subVersion } = s.revision;
  const mesh = s.resource();
  const categoriesUsed = s.i32();
  let morphParamRemap: number[] | Uint8Array;
  if (subVersion < 0x105) {
    const n = s.count();
    morphParamRemap = Array.from({ length: n }, () => s.i32());
  } else morphParamRemap = s.bytes(s.i32());
  const primitives = s.array(readPrimitive);
  const plan = version >= 0x19a ? s.resource(true) : undefined;
  return { mesh, categoriesUsed, primitives, plan, morphParamRemap };
}

export function readCostume(s: Serializer): CostumePart {
  const { version, subVersion } = s.revision;
  const mesh = s.resource();
  const material = s.resource();
  const materialPlan = version >= 0x19a ? s.resource(true) : undefined;
  const meshPartsHidden = s.intVector();
  const primitives = s.array(readPrimitive);
  // ⚠️ An `i32`, not a byte. It was a byte here and no compressed file could
  // tell: a varint under 128 is one byte either way. See `readFieldLayout`.
  const creatureFilter = subVersion >= 0xdb ? s.i32() : 0;
  const pieces = s.array(readCostumePiece);
  const temporaryPieces: CostumePiece[] = [];
  // ⚠️ **LBP1 has them too**, on LEERDAMMER from its revision 0xb: 96 of the
  // archive's 0x272 plans at branch revision 0x17 ended their costume one byte
  // short, the empty array's count (cwlib's `PCostume`, `LD_TEMP_COSTUME`).
  if (version >= 0x2c5 || onLeerdammer(s.revision, LD_TEMP_COSTUME)) {
    const temp = s.i32();
    for (let i = 0; i < temp; i += 1) temporaryPieces.push(readCostumePiece(s));
  }
  return {
    mesh, material, materialPlan, meshPartsHidden, primitives, creatureFilter, pieces,
    temporaryPieces,
  };
}

function writePrimitive(w: Writer, p: CostumePrimitive): void {
  w.ref(p.material);
  if (w.revision.version >= 0x179) w.ref(p.textureAlternatives);
  w.i32(p.minVert);
  w.i32(p.maxVert);
  w.i32(p.firstIndex);
  w.i32(p.numIndices);
  w.i32(p.region);
}

function writePrimitives(w: Writer, primitives: readonly CostumePrimitive[]): void {
  w.i32(primitives.length);
  for (const p of primitives) writePrimitive(w, p);
}

function writeCostumePiece(w: Writer, piece: CostumePiece): void {
  const { version, subVersion } = w.revision;
  w.ref(piece.mesh);
  w.i32(piece.categoriesUsed);
  const remap = piece.morphParamRemap;
  w.i32(remap.length);
  if (subVersion < 0x105) for (const v of remap) w.i32(v);
  else w.bytes(remap instanceof Uint8Array ? remap : Uint8Array.from(remap));
  writePrimitives(w, piece.primitives);
  if (version >= 0x19a) w.ref(piece.plan, { descriptor: true });
}

/** `readCostume`'s mirror. */
export function writeCostume(w: Writer, p: CostumePart, _ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  w.ref(p.mesh);
  w.ref(p.material);
  if (version >= 0x19a) w.ref(p.materialPlan, { descriptor: true });
  w.intVector(p.meshPartsHidden);
  writePrimitives(w, p.primitives);
  if (subVersion >= 0xdb) w.i32(p.creatureFilter);
  w.i32(p.pieces.length);
  for (const piece of p.pieces) writeCostumePiece(w, piece);
  if (version >= 0x2c5 || onLeerdammer(w.revision, LD_TEMP_COSTUME)) {
    w.i32(p.temporaryPieces.length);
    for (const piece of p.temporaryPieces) writeCostumePiece(w, piece);
  }
}
