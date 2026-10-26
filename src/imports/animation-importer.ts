/**
 * A glTF animation as an `RAnimation`: Java cwlib's
 * `io/imports/AnimationImporter.java` (ennuo/toolkit `d6a2ef8`), ported.
 *
 * What it does, as Java does: the glTF's first animation over its first skin.
 * A bone per joint -- its `animHash` the joint node's name hashed, its parent,
 * first child and next sibling from the node hierarchy -- and every channel
 * sampled at the same number of keys, which becomes the frame count. A bone's
 * base pose is its node's TRS, replaced by a channel's first key where it has
 * one; a channel whose keys move by more than 0.0001 between two frames is
 * animated, and its keys after the first are packed frame by frame after the
 * base poses. A channel that never moves is the base pose alone. The frame
 * rate is Java's default, 24; morphs, locators and the loop start are left
 * empty, as Java leaves them.
 *
 * Java refuses what it refuses here too: no animation, no channels,
 * `CUBICSPLINE`, channels of different key counts ("Optimised animations
 * aren't supported, ensure sampling is enabled and frame optimization is
 * disabled in export!").
 *
 * Where this differs from Java, on purpose:
 * - **A channel on a node that is no joint is skipped** -- a morph weight
 *   track on a mesh node, as `animationToGlb` writes one -- where Java fails
 *   unboxing a missing index; such channels do not count toward the frame
 *   count either. `skippedChannels` says how many.
 * - **A child node that is no joint is no child.** Java's hierarchy pass
 *   dereferences every child node as a joint.
 * - Keys are read as floats whatever their component type (normalized
 *   integers as glTF means them); Java reads them as floats.
 * - **This library's own conventions are read back** (both can be turned
 *   off): a `bone_` + hex joint name is its hash (`hashedBoneNames`), and
 *   `extras.fps` / `extras.loopStart` are the frame rate and loop start
 *   (`readExtras`) -- what `animationToGlb` writes.
 */

import type { RevisionInfo } from '../io/serializer.ts';
import type { AnimBone, Animation } from '../resources/animation.ts';
import { Gltf } from './gltf-read.ts';
import { animationHash } from './mesh-builder.ts';
import type { GltfSource } from './model-importer.ts';

export class AnimationImportError extends Error {}

export interface AnimationImportConfig {
  /** Which glTF animation (Java: the first). */
  readonly animation?: number;
  /** The revision the value carries. */
  readonly revision?: RevisionInfo;
  /**
   * A joint named `bone_` and eight hex digits has that hash as its
   * `animHash` (default true): it is how `animationToGlb` names a bone it
   * knows only by its hash. Java hashes the name as it stands.
   */
  readonly hashedBoneNames?: boolean;
  /**
   * The frame rate and loop start out of the animation's `extras.fps` and
   * `extras.loopStart`, as `animationToGlb` writes them (default true).
   * Java takes neither: 24 frames a second, no loop start.
   */
  readonly readExtras?: boolean;
}

export interface AnimationImport {
  readonly animation: Animation;
  /** Channels left out because their node is no joint of the skin, or their path is `weights`. */
  readonly skippedChannels: number;
}

const DEFAULT_REVISION: RevisionInfo = { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 };

/** JOML's `Vector4f.equals(v, delta)`: the same bits, or within `delta`, per component. */
const near = (a: number[], b: number[], delta: number): boolean =>
  a.every((x, i) => Object.is(x, b[i]) || Math.abs(Math.fround(x - b[i])) <= delta);

/** `AnimationImporter.getAnimation()`. */
export function importAnimation(source: GltfSource, config: AnimationImportConfig = {}): AnimationImport {
  const gltf = source instanceof Gltf ? source : Gltf.read(source);
  const animation = gltf.animations[config.animation ?? 0];
  const skin = gltf.skins[0];
  if (!skin) throw new AnimationImportError('glTF contains no skin');
  if (!animation) throw new AnimationImportError('glTF contains no animations!');

  // getAnimBones
  const joints = skin.joints;
  const nodeToIndex = new Map<number, number>();
  const bones: { animHash: number; parent: number; firstChild: number; nextSibling: number }[] = joints.map((node, i) => {
    nodeToIndex.set(node, i);
    const name = gltf.nodes[node]?.name ?? null;
    const hashed = (config.hashedBoneNames ?? true) && name !== null ? /^bone_([0-9a-f]{8})$/.exec(name) : null;
    return { animHash: hashed ? Number.parseInt(hashed[1], 16) | 0 : animationHash(name), parent: -1, firstChild: -1, nextSibling: -1 };
  });
  joints.forEach((node, i) => {
    const children = (gltf.nodes[node]?.children ?? []).filter((c) => nodeToIndex.has(c));
    if (children.length === 0) return;
    bones[i].firstChild = nodeToIndex.get(children[0])!;
    for (const child of children) bones[nodeToIndex.get(child)!].parent = i;
    for (let j = 1; j < children.length; j += 1) bones[nodeToIndex.get(children[j - 1])!].nextSibling = nodeToIndex.get(children[j])!;
  });

  const channels = animation.channels.filter((c) => c.target.node !== undefined && nodeToIndex.has(c.target.node)
    && ['translation', 'rotation', 'scale'].includes(c.target.path));
  const skippedChannels = animation.channels.length - channels.length;
  if (animation.channels.length === 0) throw new AnimationImportError('Animation contains no channels!');
  if (channels.length === 0) throw new AnimationImportError('Animation has no channel on a joint of its skin');

  let frames = 0;
  for (const channel of channels) {
    const sampler = animation.samplers[channel.sampler];
    if (sampler.interpolation === 'CUBICSPLINE') throw new AnimationImportError('Cubic spline interpolation is not supported for animations!');
    const n = gltf.accessor(sampler.output).count;
    if (frames === 0) frames = n;
    if (frames !== n) {
      throw new AnimationImportError("Optimised animations aren't supported, ensure sampling is enabled and frame optimization is disabled in export!");
    }
  }

  const count = bones.length;
  const basisRotation: number[][] = new Array(count);
  const basisTranslation: number[][] = new Array(count);
  const basisScale: number[][] = new Array(count);
  joints.forEach((node, i) => {
    const n = gltf.nodes[node];
    const t = n?.translation ?? [0, 0, 0];
    const r = n?.rotation ?? [0, 0, 0, 1];
    const s = n?.scale ?? [1, 1, 1];
    basisRotation[i] = r.map(Math.fround);
    basisTranslation[i] = [...t.map(Math.fround), 1];
    basisScale[i] = [...s.map(Math.fround), 1];
  });

  /** A channel's keys as Java's `Vector4f`s: w 1 but for a rotation. */
  const keys = (channel: (typeof channels)[number]): number[][] => {
    const values = gltf.floats(animation.samplers[channel.sampler].output);
    const rotation = channel.target.path === 'rotation';
    const per = rotation ? 4 : 3;
    return Array.from({ length: gltf.accessor(animation.samplers[channel.sampler].output).count }, (_, i) =>
      [values[i * per], values[i * per + 1], values[i * per + 2], rotation ? values[i * per + 3] : 1]);
  };

  const posAnimated: number[] = [];
  const rotAnimated: number[] = [];
  const scaleAnimated: number[] = [];
  for (const channel of channels) {
    const index = nodeToIndex.get(channel.target.node!)!;
    const data = keys(channel);
    if (data.length === 0) continue;
    let animated = false;
    for (let i = 1; i < data.length; i += 1) {
      if (!near(data[i - 1], data[i], Math.fround(0.0001))) {
        animated = true;
        break;
      }
    }
    if (channel.target.path === 'translation') {
      basisTranslation[index] = data[0];
      if (animated) posAnimated.push(index);
    } else if (channel.target.path === 'rotation') {
      basisRotation[index] = data[0];
      if (animated) rotAnimated.push(index);
    } else {
      basisScale[index] = data[0];
      if (animated) scaleAnimated.push(index);
    }
  }

  const rotations = new Float32Array((count + rotAnimated.length * (frames - 1)) * 4);
  const positions = new Float32Array((count + posAnimated.length * (frames - 1)) * 3);
  const scales = new Float32Array((count + scaleAnimated.length * (frames - 1)) * 3);
  for (let i = 0; i < count; i += 1) {
    rotations.set(basisRotation[i].slice(0, 4), i * 4);
    positions.set(basisTranslation[i].slice(0, 3), i * 3);
    scales.set(basisScale[i].slice(0, 3), i * 3);
  }
  for (const channel of channels) {
    const bone = nodeToIndex.get(channel.target.node!)!;
    const [list, packed, per] = channel.target.path === 'translation'
      ? [posAnimated, positions, 3] as const
      : channel.target.path === 'rotation' ? [rotAnimated, rotations, 4] as const : [scaleAnimated, scales, 3] as const;
    const k = list.indexOf(bone);
    if (k === -1) continue; // optimised out
    const data = keys(channel);
    for (let i = 1; i < frames; i += 1) packed.set(data[i].slice(0, per), (count + (i - 1) * list.length + k) * per);
  }

  const extra = (key: string, fallback: number): number => {
    const v = (config.readExtras ?? true) ? animation.extras?.[key] : undefined;
    return typeof v === 'number' && Number.isInteger(v) ? (v << 16) >> 16 : fallback;
  };
  const value: Animation = {
    revision: config.revision ?? DEFAULT_REVISION,
    bones: bones as AnimBone[],
    numFrames: (frames << 16) >> 16,
    fps: extra('fps', 24),
    loopStart: extra('loopStart', 0),
    morphCount: 0,
    rotBonesAnimated: Uint8Array.from(rotAnimated),
    posBonesAnimated: Uint8Array.from(posAnimated),
    scaleBonesAnimated: Uint8Array.from(scaleAnimated),
    morphsAnimated: new Uint8Array(0),
    rotations,
    positions,
    scales,
    morphs: new Float32Array(0),
    posOffset: [0, 0, 0, 1],
    posScale: [1, 1, 1, 1],
    fat: 0,
    locators: [],
  };
  return { animation: value, skippedChannels };
}
