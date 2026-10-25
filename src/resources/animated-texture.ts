/**
 * `ANIMATED_TEXTURE` -- a flipbook: magic `ATXb`, FileDB paths
 * `texture_library/ui/animated/…/*.atx`, the UI's animated icons. A texture
 * and how to cut it into frames.
 *
 * ❗ cwlib has the type and no class: this is a reading of our own, proven on
 * the game's 24 (steering/level-files.md, *Small resources*):
 *
 * ```
 * descriptor texture     the atlas, a GUID in every one
 * s32 frames, frameWidth, frameHeight
 * bool loop              true in all 24
 * ```
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';

export interface AnimatedTexture {
  readonly revision: RevisionInfo;
  /**
   * ✔ A grid of `frameWidth` x `frameHeight` cells, as many or more than
   * `frames` and a power of two in each axis: in all 24 the frames fit the
   * texture this names (32 frames of 64x64 in a 512x256).
   */
  readonly texture?: ResourceRef;
  readonly frames: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly loop: boolean;
}

/** Read an `ATXb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readAnimatedTexture(bytes: Uint8Array, inflate: Inflate): Promise<AnimatedTexture> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'ATXb') throw new SerializerError(`not an animated texture: "${resource.magic}"`);
  const texture = s.resource();
  const frames = s.s32();
  const frameWidth = s.s32();
  const frameHeight = s.s32();
  const loop = s.bool();
  if (s.remaining !== 0) throw new SerializerError(`ATXb read ended ${s.remaining} bytes before the end of its payload`);
  return { revision, texture, frames, frameWidth, frameHeight, loop };
}
