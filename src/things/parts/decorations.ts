/** `DECORATIONS`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { type PartReader } from '../thing.ts';
import { readRenderMesh, type RenderMeshPart } from './render-mesh.ts';

/**
 * One decoration: a mesh stuck onto a Thing. cwlib's `Decoration.java`;
 * steering/level-files.md, *Decorations*, says what of it is measured.
 */
export interface Decoration {
  readonly renderMesh?: RenderMeshPart;
  /** 4x4, column-major like `PPos`. */
  readonly offset: Float32Array;
  readonly parentBone: number;
  readonly parentTriVert: number;
  readonly baryU: number;
  readonly baryV: number;
  readonly decorationAngle: number;
  readonly decorationScale: number;
  readonly reversed: boolean;
  /** -1 when the revision has none. */
  readonly playModeFrame: number;
  readonly planGUID: number;
  readonly onCostumePiece: number;
  readonly earthDecoration: number;
  /** Version `0x214` on. */
  readonly placedBy?: number;
  /** subVersion `0xc4` on. */
  readonly hasShadow?: boolean;
  /** subVersion `0x16c` on. */
  readonly isQuest?: boolean;
  /** The Vita's, from its revision `0x7c`. */
  readonly zBias?: number;
}

function readDecoration(s: Serializer, readers: ReadonlyMap<string, PartReader>): Decoration {
  const { version, subVersion } = s.revision;
  const renderMesh = s.reference((self) => readRenderMesh(self, readers));
  const offset = s.matrix();
  const parentBone = s.i32();
  const parentTriVert = s.i32();
  const baryU = s.f32();
  const baryV = s.f32();
  const decorationAngle = s.f32();
  const onCostumePiece = s.s32();
  const earthDecoration = s.s32();
  const decorationScale = s.f32();
  const placedBy = version >= 0x214 ? s.i16() : undefined;
  const reversed = s.bool();
  const hasShadow = subVersion >= 0xc4 ? s.bool() : undefined;
  const isQuest = subVersion >= 0x16c ? s.bool() : undefined;
  const playModeFrame = version >= 0x215 ? s.i32() : -1;
  const planGUID = version >= 0x25b ? s.guid() : 0;
  const zBias = vitaRevision(s.revision) >= 0x7c ? s.f32() : undefined;
  return {
    renderMesh, offset, parentBone, parentTriVert, baryU, baryV, decorationAngle, decorationScale,
    reversed, playModeFrame, planGUID, onCostumePiece, earthDecoration, placedBy, hasShadow, isQuest, zBias,
  };
}

/** `PDecorations`: every decoration on a Thing. */
export function readDecorations(s: Serializer, readers: ReadonlyMap<string, PartReader>): Decoration[] {
  const count = s.count();
  const out: Decoration[] = [];
  for (let i = 0; i < count; i += 1) out.push(readDecoration(s, readers));
  return out;
}
