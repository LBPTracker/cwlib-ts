/** `RENDER_MESH`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

/** What `readRenderMesh` keeps: everything a renderer needs to draw the Thing. */
export interface RenderMeshPart {
  /** The `RMesh` (`MSHb`, dependency type 2): a GUID for a game mesh, a SHA-1 for a user one. */
  readonly mesh?: ResourceRef;
  /**
   * The Things that pose the mesh's bones, one per bone in the mesh's order.
   * Each one's `POS` is the bone's world matrix.
   */
  readonly boneThings: (Thing | undefined)[];
  /** An `RAnimation`, and where in it the mesh is. */
  readonly anim?: ResourceRef;
  readonly animPos: number;
  readonly animSpeed: number;
  readonly animLoop: boolean;
  readonly loopStart: number;
  readonly loopEnd: number;
  /** Packed ARGB, `>>> 0`. Below `0x31b` four RGBA floats, packed here; cwlib also forces their alpha to 0xff, this keeps it. */
  readonly editorColor: number;
  /** cwlib's `ShadowType`: 0 always, 1 never, 2 if on screen. */
  readonly castShadows: number;
  readonly rttEnable: boolean;
  /**
   * cwlib's `VisibilityFlags`: bit 0 play mode, bit 1 edit mode. A bool below
   * `0x2e3` meaning play mode only, which cwlib widens to `EDIT_MODE | bool`;
   * so is it here.
   */
  readonly visibilityFlags: number;
  readonly poppetRenderScale: number;
  readonly parentDistanceFront?: number;
  readonly parentDistanceSide?: number;
}

const channel = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));

/** `PRenderMesh`: the mesh a Thing draws, its animation and its visibility. */
export function readRenderMesh(s: Serializer, readers: ReadonlyMap<string, PartReader>): RenderMeshPart {
  const { version } = s.revision;
  let parentDistanceFront: number | undefined;
  let parentDistanceSide: number | undefined;
  const mesh = s.resource();
  const boneThings: (Thing | undefined)[] = [];
  const count = s.count();
  for (let i = 0; i < count; i += 1) boneThings.push(readThingRef(s, readers));
  const anim = s.resource();
  const animPos = s.f32();
  const animSpeed = s.f32();
  const animLoop = s.bool();
  const loopStart = s.f32();
  const loopEnd = s.f32();
  // ❗ Four floats at or below 0x31a, a packed ARGB above it. The comment said
  // so above a line that always read the packed form -- 15 bytes short on every
  // pre-0x31b Thing, which is the same mistake `PShape`'s colour made.
  let editorColor: number;
  if (version > 0x31a) editorColor = s.i32() >>> 0;
  else {
    const [r, g, b, a] = s.vector4();
    editorColor = ((channel(a) << 24) | (channel(r) << 16) | (channel(g) << 8) | channel(b)) >>> 0;
  }
  const castShadows = s.u8(); // enum8
  const rttEnable = s.bool();
  // Same width either way, so this one never desynchronised anything.
  const visibilityFlags = version > 0x2e2 ? s.u8() : 0x2 | (s.bool() ? 0x1 : 0);
  const poppetRenderScale = s.f32();
  if (version > 0x1f5 && version < 0x34d) {
    parentDistanceFront = s.f32();
    parentDistanceSide = s.f32();
  }
  return {
    mesh, boneThings, anim, animPos, animSpeed, animLoop, loopStart, loopEnd, editorColor,
    castShadows, rttEnable, visibilityFlags, poppetRenderScale,
  parentDistanceFront, parentDistanceSide,
  };
}
