/** `MATERIAL_OVERRIDE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `RegionOverride`: one material swapped on one region of a mesh. */
function readRegionOverride(s: Serializer): void {
  s.i32(); // region
  s.resource(true); // materialPlan
  s.resource(); // material
  s.skipVector3(); // uvScale
  if (s.revision.subVersion >= 0x158) {
    s.i32(); // color
    s.i8(); // brightness
  }
}

/** `PMaterialOverride`, at version >= 0x360. */
export function readMaterialOverride(s: Serializer): void {
  const { subVersion } = s.revision;
  s.array(readRegionOverride);
  s.resource(); // mesh
  if (subVersion >= 0x15f) {
    s.i32(); // color
    if (subVersion >= 0x191) s.i8(); // brightness
  }
}
