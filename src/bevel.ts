/**
 * `RBevel` -- the profile a shape's edge is swept with: magic `BEVb`,
 * dependency type 24, FileDB paths `gamedata/bevels/….bev`, named by a
 * `PGeneratedMesh`.
 *
 * The field list is cwlib's `resources/RBevel.java` and `structs/bevel/
 * BevelVertex.java` (toolkit `fee22399`), which carry no revision gates; it is
 * measured on every `BEVb` in LBP3 PS4 1.28's four FARCs
 * (`dev/bevel-census.ts`) -- steering/level-files.md, *Bevels*. `readBevel`
 * throws when the walk does not end on the payload's last byte.
 */

import { openSerializer, type Inflate } from './resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo } from './serializer.ts';

/** cwlib's `BevelMappingMode`: how a bevel band's texture is laid. */
export const BEVEL_HIDDEN = 0;
export const BEVEL_DAVE = 1;
export const BEVEL_CYLINDER = 3;
export const BEVEL_PLANARXZ = 5;

/** One point of the profile. */
export interface BevelVertex {
  /** Inward, in units of the bevel's width (cwlib's reading). */
  readonly y: number;
  /** Through the shape's depth, front to back (cwlib's reading). */
  readonly z: number;
  readonly rigidity: number;
  readonly smoothWithPrevious: number;
  /** Which of the four `materials` the band from this point is drawn with. */
  readonly gmatSlot: number;
  /** `BEVEL_*`. */
  readonly mappingMode: number;
}

export interface Bevel {
  readonly revision: RevisionInfo;
  /** Four `RGfxMaterial` slots; slot 0 is usually empty, the shape's own material taking it. */
  readonly materials: (ResourceRef | undefined)[];
  readonly uvScales: number[];
  /** Degrees. */
  readonly autoSmoothCutoffAngle: number;
  readonly vertices: BevelVertex[];
  readonly includeBackface: boolean;
  readonly smoothWithFront: boolean;
  readonly relaxStrength: number;
  readonly subDivRadius: number;
  readonly fixedBevelSize: number;
  readonly spongy: boolean;
  readonly softPhysicsSettings?: ResourceRef;
  readonly textureRepeats: number;
}

const SLOTS = 4;

export async function readBevel(bytes: Uint8Array, inflate: Inflate): Promise<Bevel> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'BEVb') throw new SerializerError(`not a bevel: "${resource.magic}"`);
  const slots = (): void => {
    const count = s.i32();
    if (count !== SLOTS) throw new SerializerError(`a bevel with ${count} material slots, not ${SLOTS}`);
  };
  slots();
  const materials: (ResourceRef | undefined)[] = [];
  for (let i = 0; i < SLOTS; i += 1) materials.push(s.resource());
  slots();
  const uvScales: number[] = [];
  for (let i = 0; i < SLOTS; i += 1) uvScales.push(s.f32());
  const autoSmoothCutoffAngle = s.f32();
  const vertices = s.array((v): BevelVertex => ({
    y: v.f32(),
    z: v.f32(),
    rigidity: v.f32(),
    smoothWithPrevious: v.i8(),
    gmatSlot: v.i8(),
    mappingMode: v.u8(),
  }));
  const includeBackface = s.bool();
  const smoothWithFront = s.bool();
  const relaxStrength = s.f32();
  const subDivRadius = s.f32();
  const fixedBevelSize = s.f32();
  const spongy = s.bool();
  const softPhysicsSettings = s.resource();
  const textureRepeats = s.f32();
  if (s.remaining !== 0) {
    throw new SerializerError(`BEVb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, materials, uvScales, autoSmoothCutoffAngle, vertices, includeBackface, smoothWithFront,
    relaxStrength, subDivRadius, fixedBevelSize, spongy, softPhysicsSettings, textureRepeats,
  };
}
