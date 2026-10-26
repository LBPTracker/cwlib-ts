/**
 * An imported mesh or animation as a resource file: its payload through this
 * library's writers (`encodeMesh`, `encodeAnimation`), wrapped by
 * `writeResource` with the dependency table Java writes for it.
 *
 * ❗ **Java's table is a `HashSet<ResourceDescriptor>` iterated** -- every
 * descriptor `Serializer.resource` wrote, one per GUID or SHA-1 whatever its
 * type, hashed as the string `toString` makes of it (`g10803`, `h…`) -- so
 * the order here is that set's (`java-hash.ts`), not first mention.
 */

import { toHex } from '../io/hex.ts';
import type { ResourceRef, RevisionInfo } from '../io/serializer.ts';
import { writeResource, type Deflate, type DependencyOut } from '../io/writer.ts';
import { encodeAnimation, type Animation } from '../resources/animation.ts';
import { encodeMesh, type Mesh } from '../resources/mesh.ts';
import { JavaHashSet } from './java-hash.ts';
import { stringHash } from './mesh-builder.ts';

/** `ResourceType` values. */
export const TYPE_MESH = 2;
export const TYPE_ANIMATION = 5;
export const TYPE_GFX_MATERIAL = 7;
export const TYPE_SETTINGS_SOFT_PHYS = 14;
export const TYPE_TEXTURE_LIST = 39;

/** Java's `ResourceDescriptor.toString`. */
const descriptorString = (ref: ResourceRef): string => (ref.hash ? `h${toHex(ref.hash)}` : `g${ref.guid >>> 0}`);

/** The table Java writes for these descriptors, met in this order: one row per GUID or hash, the first type it came with. */
export function javaDependencies(refs: readonly { ref: ResourceRef | undefined; type: number }[]): DependencyOut[] {
  const set = new JavaHashSet<DependencyOut>();
  for (const { ref, type } of refs) {
    if (!ref || (ref.guid === 0 && !ref.hash)) continue;
    const key = descriptorString(ref);
    set.add(key, stringHash(key), ref.hash ? { hash: ref.hash, type } : { guid: ref.guid, type });
  }
  return set.values();
}

/** The descriptors an `RMesh` payload writes, in the order its serializer meets them. */
export function meshDescriptors(mesh: Mesh, revision: RevisionInfo): { ref: ResourceRef | undefined; type: number }[] {
  const refs: { ref: ResourceRef | undefined; type: number }[] = [];
  for (const p of mesh.primitives) {
    refs.push({ ref: p.material, type: TYPE_GFX_MATERIAL });
    if (revision.version >= 0x179) refs.push({ ref: p.textureAlternatives, type: TYPE_TEXTURE_LIST });
  }
  refs.push({ ref: mesh.tail.softPhysSettings, type: TYPE_SETTINGS_SOFT_PHYS });
  return refs;
}

export interface WriteHeader {
  readonly revision: RevisionInfo;
  /** cwlib's `CompressionFlags`: 0 none, 7 all. Java's importers' callers write 0 (`USE_NO_COMPRESSION`). */
  readonly compressionFlags: number;
}

/** An `MSHb` file: `encodeMesh`'s payload and Java's dependency table for it. */
export async function writeMeshResource(mesh: Mesh, header: WriteHeader, deflate: Deflate): Promise<Uint8Array> {
  const payload = encodeMesh(mesh, header);
  return writeResource({
    magic: 'MSHb', revision: header.revision, compressionFlags: header.compressionFlags, payload,
    dependencies: javaDependencies(meshDescriptors(mesh, header.revision)),
  }, deflate);
}

/** An `ANMb` file: `encodeAnimation`'s payload; an animation names no other resource. */
export async function writeAnimationResource(animation: Animation, header: WriteHeader, deflate: Deflate): Promise<Uint8Array> {
  const payload = encodeAnimation(animation, header);
  return writeResource({
    magic: 'ANMb', revision: header.revision, compressionFlags: header.compressionFlags, payload, dependencies: [],
  }, deflate);
}
