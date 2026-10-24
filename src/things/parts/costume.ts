/** `COSTUME`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `Primitive`: one draw call of a mesh. */
function readPrimitive(s: Serializer): void {
  s.resource(); // material
  // `Revisions.MESH_TEXTURE_ALTERNATIVES` is 0x179, not something in the 0x3xx
  // range -- a guess at that constant cost one debugging round.
  if (s.revision.version >= 0x179) s.resource(); // textureAlternatives
  s.i32(); // minVert
  s.i32(); // maxVert
  s.i32(); // firstIndex
  s.i32(); // numIndices
  s.i32(); // region
}

/** `CostumePiece`: one wearable. */
function readCostumePiece(s: Serializer): void {
  const { version, subVersion } = s.revision;
  s.resource(); // mesh
  s.i32(); // categoriesUsed
  if (subVersion < 0x105) {
    const n = s.count();
    for (let i = 0; i < n; i += 1) s.i32(); // morphParamRemap, an i32 each
  } else s.skip(s.i32());
  const prims = s.count();
  for (let i = 0; i < prims; i += 1) readPrimitive(s);
  if (version >= 0x19a) s.resource(true); // plan
}

/** `PCostume`: what a creature is wearing. */
export function readCostume(s: Serializer): void {
  const { version, subVersion } = s.revision;
  s.resource(); // mesh
  s.resource(); // material
  if (version >= 0x19a) s.resource(true); // materialPlan
  s.intVector(); // meshPartsHidden
  const prims = s.count();
  for (let i = 0; i < prims; i += 1) readPrimitive(s);
  // ⚠️ An `i32`, not a byte. It was a byte here and no compressed file could
  // tell: a varint under 128 is one byte either way. See `readFieldLayout`.
  if (subVersion >= 0xdb) s.i32(); // creatureFilter
  const pieces = s.count();
  for (let i = 0; i < pieces; i += 1) readCostumePiece(s);
  if (version >= 0x2c5) {
    const temp = s.i32();
    for (let i = 0; i < temp; i += 1) readCostumePiece(s);
  }
}
