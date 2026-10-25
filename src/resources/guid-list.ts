/**
 * `GUID_LIST` -- magic `GLTb`, FileDB paths `gamedata/data/*.glst`: a list of
 * GUIDs the game treats alike (`attached_shapes.glst`, plans;
 * `face_covering_costumes.glst`, head meshes). An array of `u32`.
 *
 * ❗ cwlib has the type and no class; both of the game's end on their last byte
 * with the array alone (steering/level-files.md, *Small resources*).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo } from '../io/serializer.ts';

export interface GuidList {
  readonly revision: RevisionInfo;
  readonly guids: readonly number[];
}

/** Read a `GLTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readGuidList(bytes: Uint8Array, inflate: Inflate): Promise<GuidList> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'GLTb') throw new SerializerError(`not a GUID list: "${resource.magic}"`);
  const guids = s.array((self) => self.u32());
  if (s.remaining !== 0) throw new SerializerError(`GLTb read ended ${s.remaining} bytes before the end of its payload`);
  return { revision, guids };
}
