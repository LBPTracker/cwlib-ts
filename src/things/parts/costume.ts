/** `COSTUME`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';

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
  /** version 0x2c5 on: cwlib's `temporaryCostumePiece`s. */
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
  if (version >= 0x2c5) {
    const temp = s.i32();
    for (let i = 0; i < temp; i += 1) temporaryPieces.push(readCostumePiece(s));
  }
  return {
    mesh, material, materialPlan, meshPartsHidden, primitives, creatureFilter, pieces,
    temporaryPieces,
  };
}
