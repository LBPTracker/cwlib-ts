/**
 * `RBoneSet` -- **the toolkit's own resource, not the game's**: magic `BSTb`,
 * written on the toolkit's `MIZUKI` branch (`0x4d5a`). The only one is the
 * toolkit's `lib/cwlib/src/main/resources/binary/characters.boneset`, which
 * its `ModelImporter` loads to know the characters' skeletons; the game's
 * four FARCs hold none.
 *
 * Each skeleton is a mesh's bones and the tail that follows them in an
 * `RMesh` -- the mirror bones and their flip types, the cull bones -- so the
 * walk is cwlib's `resources/custom/RBoneSet.java` and
 * `structs/custom/Skeleton.java` (ennuo/toolkit `d6a2ef8`) over `readBone`.
 * What the one file proves is steering/level-files.md, *Bone sets*.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readBone, type MeshBone } from './mesh.ts';

/** `Branch.MIZUKI`: the head and branch id the toolkit stamps on what it writes. */
const MIZUKI_HEAD = 0x021803f9;
const MIZUKI = 0x4d5a;
/** `Revisions.MZ_BST_REMOVE_SK`: "Remove skeleton type from RBoneSet". */
const MZ_BST_REMOVE_SK = 0x1;

/** `CullBone`: a box in a bone's space and the matrix into it. */
export interface CullBone {
  readonly invSkinPose: Float32Array;
  readonly boundBoxMin: readonly [number, number, number, number];
  readonly boundBoxMax: readonly [number, number, number, number];
}

export interface Skeleton {
  readonly bones: readonly MeshBone[];
  /** Per bone, the index of its mirror image. */
  readonly mirror: Int16Array;
  /** Per bone, cwlib's `FlipType` (0 `MAX` … 6 `COPY`). */
  readonly mirrorType: Uint8Array;
  readonly cullBones: readonly CullBone[];
  /** cwlib's `SkeletonType`, stored only on the branch's revisions before `0x1`. */
  readonly type: number | undefined;
}

export interface BoneSet {
  readonly revision: RevisionInfo;
  readonly skeletons: readonly Skeleton[];
}

function readSkeleton(s: Serializer): Skeleton {
  const { version, subVersion, branchId, branchRevision } = s.revision;
  const bones = s.array(readBone);
  const mirror = Int16Array.from(s.array((x) => x.i16()));
  const mirrorType = Uint8Array.from(s.array((x) => x.u8()));
  const cullBones = s.array((x): CullBone => ({ invSkinPose: x.matrix(), boundBoxMin: x.vector4(), boundBoxMax: x.vector4() }));
  const old = ((subVersion << 16) | version) === MIZUKI_HEAD && branchId === MIZUKI && branchRevision < MZ_BST_REMOVE_SK;
  return { bones, mirror, mirrorType, cullBones, type: old ? s.u8() : undefined };
}

/** Read a `BSTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readBoneSet(bytes: Uint8Array, inflate: Inflate): Promise<BoneSet> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'BSTb') throw new SerializerError(`not a bone set: "${resource.magic}"`);
  const skeletons = s.array(readSkeleton);
  if (s.remaining !== 0) {
    throw new SerializerError(`BSTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, skeletons };
}
