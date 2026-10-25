/** `MATERIAL_OVERRIDE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `RegionOverride`: one material swapped onto one region of a mesh. */
export interface RegionOverride {
  /** The mesh primitives' `region` it applies to. */
  readonly region: number;
  /** The plan the material came from, a descriptor. */
  readonly materialPlan?: ResourceRef;
  /** The `RGfxMaterial` (`GMTb`) drawn instead. */
  readonly material?: ResourceRef;
  readonly uvScale: readonly [number, number, number];
  /** subVersion 0x158 on; -1 and 0 before. */
  readonly color: number;
  readonly brightness: number;
}

/** `PMaterialOverride`: a Thing's mesh drawn with other materials, region by region. */
export interface MaterialOverridePart {
  readonly overrides: readonly RegionOverride[];
  /** The mesh the regions are of. */
  readonly mesh?: ResourceRef;
  /** subVersion 0x15f on, -1 before; `brightness` 0x191 on, 0 before. */
  readonly color: number;
  readonly brightness: number;
}

function readRegionOverride(s: Serializer): RegionOverride {
  const region = s.i32();
  const materialPlan = s.resource(true);
  const material = s.resource();
  const uvScale = s.vector3();
  let color = -1;
  let brightness = 0;
  if (s.revision.subVersion >= 0x158) {
    color = s.i32();
    brightness = s.i8();
  }
  return { region, materialPlan, material, uvScale, color, brightness };
}

/** `PMaterialOverride`, at version >= 0x360. */
export function readMaterialOverride(s: Serializer): MaterialOverridePart {
  const { subVersion } = s.revision;
  const overrides = s.array(readRegionOverride);
  const mesh = s.resource();
  let color = -1;
  let brightness = 0;
  if (subVersion >= 0x15f) {
    color = s.i32();
    if (subVersion >= 0x191) brightness = s.i8();
  }
  return { overrides, mesh, color, brightness };
}

function writeRegionOverride(w: Writer, r: RegionOverride): void {
  w.i32(r.region);
  w.ref(r.materialPlan, { descriptor: true });
  w.ref(r.material);
  w.vector3(r.uvScale);
  if (w.revision.subVersion >= 0x158) {
    w.i32(r.color);
    w.i8(r.brightness);
  }
}

/** `readMaterialOverride`'s mirror. */
export function writeMaterialOverride(w: Writer, p: MaterialOverridePart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.i32(p.overrides.length);
  for (const r of p.overrides) writeRegionOverride(w, r);
  w.ref(p.mesh);
  if (subVersion >= 0x15f) {
    w.i32(p.color);
    if (subVersion >= 0x191) w.i8(p.brightness);
  }
}
