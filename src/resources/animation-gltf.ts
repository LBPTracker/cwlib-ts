/**
 * An `RAnimation` as a binary glTF 2.0 animation: cwlib's
 * `MeshExporter.GLB.FromAnimation` (ennuo/toolkit `d6a2ef8`). On its own, the
 * animation's skeleton -- a node per bone in its base pose, children under
 * their parents; on a mesh (\`meshToGlb\`'s scene), the mesh's bones found by
 * \`animHash\`. Then one animation: frame \`f\` at \`f / fps\` seconds, frame 0 the
 * base pose, each animated rotation, position and scale a channel on its bone,
 * and the morph weights a channel on each mesh node when the counts agree.
 *
 * Where this differs from Java (lbp-modding-toolchain.md, *Where we
 * deliberately differ*):
 * - **On a mesh, every channel targets the bone it names.** Java's position
 *   and scale channels set the named bone and then overwrite it with
 *   \`bone + 1\`, the node it would be without a mesh.
 * - **No skin without a mesh.** Java hangs a skin with no mesh and no inverse
 *   bind matrices on its armature node; glTF has no use for one.
 * - **Rotations are written unit length**, as glTF's samplers want; the
 *   game's are only to the 15 bits they are packed in.
 * - A bone no mesh bone shares an \`animHash\` with is left out (27 of the game's
 *   100,035 animation bones name none, steering/level-files.md *Animations*).
 */

import type { Animation } from './animation.ts';
import { ARRAY_BUFFER, GltfBuilder, type GltfOptions } from './gltf-builder.ts';
import type { Mesh } from './mesh.ts';
import { meshScene, sceneJson, type MeshScene } from './mesh-gltf.ts';

export interface AnimationGltfOptions extends GltfOptions {
  /** The mesh to animate; the animation's own skeleton when absent. */
  readonly mesh?: Mesh;
  /** The animation's name in the glTF. */
  readonly name?: string;
}

/** The animation's skeleton in its base pose: bone \`i\` is node \`i\`, under an armature. */
function skeletonScene(animation: Animation): MeshScene {
  const nodes: Record<string, unknown>[] = animation.bones.map((bone, i) => {
    const children = animation.bones.flatMap((other, j) => (other.parent === i ? [j] : []));
    return {
      name: `bone_${(bone.animHash >>> 0).toString(16).padStart(8, '0')}`,
      translation: [...animation.positions.subarray(i * 3, i * 3 + 3)],
      rotation: unit([...animation.rotations.subarray(i * 4, i * 4 + 4)]),
      scale: [...animation.scales.subarray(i * 3, i * 3 + 3)],
      ...(children.length > 0 ? { children } : {}),
    };
  });
  const roots = animation.bones.flatMap((b, i) => (b.parent < 0 ? [i] : []));
  nodes.push({ name: 'Armature', ...(roots.length > 0 ? { children: roots } : {}) });
  return { nodes, meshes: [], skins: [], roots: [nodes.length - 1], meshNodes: [] };
}

const unit = (q: number[]): number[] => {
  const length = Math.hypot(...q);
  return length > 0 ? q.map((x) => x / length) : [0, 0, 0, 1];
};

/** One component block per frame: the base value, then where \`animated\` names it, the frame's. */
function track(base: Float32Array, frames: Float32Array, per: number, count: number, animated: Uint8Array, k: number, numFrames: number): Float32Array {
  const bone = animated[k];
  const out = new Float32Array(numFrames * per);
  out.set(base.subarray(bone * per, bone * per + per), 0);
  for (let f = 1; f < numFrames; f += 1) {
    const at = (count + (f - 1) * animated.length + k) * per;
    out.set(frames.subarray(at, at + per), f * per);
  }
  return out;
}

export function animationToGlb(animation: Animation, options: AnimationGltfOptions = {}): Uint8Array {
  const g = new GltfBuilder(options);
  const { mesh } = options;
  const scene = mesh === undefined ? skeletonScene(animation) : meshScene(g, mesh);
  // An animation bone's node: its own index alone, a mesh bone's of the same animHash on a mesh.
  const nodeOf = (bone: number): number | undefined => {
    if (mesh === undefined) return bone;
    const hash = animation.bones[bone].animHash;
    const index = mesh.bones.findIndex((b) => b.animHash === hash);
    return index < 0 ? undefined : index;
  };

  const n = animation.numFrames;
  const bones = animation.bones.length;
  const time = g.floats(Float32Array.from({ length: n }, (_, f) => f / animation.fps), 'SCALAR', undefined, true);
  const samplers: Record<string, unknown>[] = [];
  const channels: Record<string, unknown>[] = [];
  const channel = (node: number, path: string, values: Float32Array, type: string): void => {
    samplers.push({ input: time, interpolation: 'LINEAR', output: g.floats(values, type, undefined) });
    channels.push({ sampler: samplers.length - 1, target: { node, path } });
  };

  animation.rotBonesAnimated.forEach((bone, k) => {
    const node = nodeOf(bone);
    if (node === undefined) return;
    const values = track(animation.rotations, animation.rotations, 4, bones, animation.rotBonesAnimated, k, n);
    for (let i = 0; i < values.length; i += 4) values.set(unit([...values.subarray(i, i + 4)]), i);
    channel(node, 'rotation', values, 'VEC4');
  });
  animation.posBonesAnimated.forEach((bone, k) => {
    const node = nodeOf(bone);
    if (node !== undefined) channel(node, 'translation', track(animation.positions, animation.positions, 3, bones, animation.posBonesAnimated, k, n), 'VEC3');
  });
  animation.scaleBonesAnimated.forEach((bone, k) => {
    const node = nodeOf(bone);
    if (node !== undefined) channel(node, 'scale', track(animation.scales, animation.scales, 3, bones, animation.scaleBonesAnimated, k, n), 'VEC3');
  });

  // The morph weights, every morph every frame, where the mesh has as many targets.
  const morphs = animation.morphCount;
  if (mesh !== undefined && morphs > 0 && mesh.morphs.length === morphs && animation.morphsAnimated.length > 0) {
    const weights = new Float32Array(n * morphs);
    for (let f = 0; f < n; f += 1) weights.set(animation.morphs.subarray(0, morphs), f * morphs);
    animation.morphsAnimated.forEach((morph, k) => {
      for (let f = 1; f < n; f += 1) weights[f * morphs + morph] = animation.morphs[morphs + (f - 1) * animation.morphsAnimated.length + k];
    });
    for (const node of scene.meshNodes) channel(node, 'weights', weights, 'SCALAR');
  }

  const animations = channels.length > 0
    ? [{ ...(options.name ? { name: options.name } : {}), channels, samplers, extras: { fps: animation.fps, loopStart: animation.loopStart } }]
    : [];
  return g.glb('cwlib-ts animationToGlb', sceneJson(scene, animations.length > 0 ? { animations } : {}));
}
