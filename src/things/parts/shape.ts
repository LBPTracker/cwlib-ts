/** `SHAPE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { type PartReader } from '../thing.ts';

/**
 * `PShape`: a Thing's outline and what it is made of -- the polygon a level's
 * material geometry is extruded from. steering/level-files.md, *Shapes*, has
 * what of it is measured.
 */
export interface ShapePart {
  /** `x, y, z` per vertex, in the Thing's own space; z is 0 when the file stores only x and y. */
  readonly vertices: Float32Array;
  /** Whether the file stored a z per vertex. */
  readonly requiresZ: boolean;
  /** The vertex count of each closed loop, in order. */
  readonly loops: number[];
  /** The physical material (`MATb`, dependency type 16). */
  readonly material?: ResourceRef;
  readonly thickness: number;
  /** Packed ARGB, `>>> 0`; from four floats below version 0x389. */
  readonly color: number;
  readonly brightness: number;
  readonly bevelSize: number;
  /** subVersion 0x149 on; 0 before. See steering/level-files.md, *Shapes*. */
  readonly zBias: number;
  /** A byte, version 0x3c1 on; 255 before. See steering/level-files.md, *Shapes*. */
  readonly colorOpacity: number;
}

/**
 * `Polygon`: the outline a shape is cut from.
 *
 * The vertex list is two or three floats each depending on a `requiresZ` flag
 * that follows the count -- the one place in this format where an array's
 * element size is decided by a later field.
 */
function readPolygon(s: Serializer): Pick<ShapePart, 'vertices' | 'requiresZ' | 'loops'> {
  const count = s.count();
  // ❗ **`requiresZ` arrives at 0x341, and below it there is no flag byte at
  // all** -- cwlib `Polygon.serialize` takes an early return where every vertex
  // is a v3. Reading the flag anyway costs a byte and then picks the vertex
  // width from whatever that byte happened to be.
  const requiresZ = s.revision.version < 0x341 ? true : s.bool();
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    vertices[i * 3] = s.f32();
    vertices[i * 3 + 1] = s.f32();
    if (requiresZ) vertices[i * 3 + 2] = s.f32();
  }
  // ⚠️ An `intvector`, not an array: see `Serializer.intVector`.
  const loops = s.intVector();
  return { vertices, requiresZ, loops };
}

/** `ContactCache`: who this shape is touching. */
function readContactCache(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const count = s.count();
  for (let i = 0; i < count; i += 1) {
    // A `Contact` is a reference to another Thing's PShape plus a flag byte.
    s.reference((self) => readShape(self, readers));
    s.u8();
  }
  s.bool(); // contactsSorted
  if (s.revision.subVersion < 0x46) s.bool(); // cacheDirtyButRecomputed
}

/**
 * `PShape`: the physical outline, its material and every tweak on it.
 *
 * The longest of the common parts, and almost all of it fixed-width. ⚠️ Three of
 * its gates are on `version` inside the range this reader accepts, so they are
 * not constant across the corpus: `stickiness`/`grabbability`/`grabFilter` need
 * `0x3bd` and the corpus starts at `0x3b8`, the opacity pair needs `0x3c1`, and
 * `canCollect` needs `0x3e2`. A reader written against one file's revision and
 * assumed constant would desynchronise on the others.
 */
export function readShape(s: Serializer, readers: ReadonlyMap<string, PartReader>): ShapePart {
  const { version, subVersion } = s.revision;
  const polygon = readPolygon(s);
  const material = s.resource();
  if (version >= 0x15c) s.resource(); // oldMaterial
  const thickness = s.f32();
  if (version >= 0x227) s.f32(); // massDepth
  // ❗ **The colour is four floats until 0x389 and a packed ARGB after.** The
  // comment here used to say exactly that above a line that always read the
  // packed form -- 12 bytes short on every pre-0x389 Thing. cwlib `PShape`.
  let color: number;
  if (version <= 0x389) {
    const [r, g, b, a] = s.vector4().map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
    color = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  } else color = s.i32() >>> 0;
  const brightness = version >= 0x301 ? s.f32() : 1;
  const bevelSize = s.f32();
  if (version <= 0x340 || version >= 0x38e) s.skipMatrix(); // COM
  if (version <= 0x306) {
    s.u8(); // interactPlayMode
    s.u8(); // interactEditMode
  }
  if (version >= 0x303) {
    s.i32(); // behavior
    if (version < 0x38a) s.skipVector4();
    else s.i32(); // colorOff
    s.f32(); // brightnessOff
  }
  if (version <= 0x345) s.i32(); // lethalType, an enum32 here and a u16 after
  else s.u16();
  if (version < 0x2b5) {
    // The flags word does not exist yet; three bools stand in for its bits.
    s.bool(); // COLLIDABLE_GAME
    if (version >= 0x224) s.bool(); // COLLIDABLE_POPPET
    s.bool(); // COLLIDABLE_WITH_PARENT
  }
  s.i32(); // soundEnumOverride
  if (version >= 0x29d && version < 0x30c) {
    s.f32(); // restitution
    if (version < 0x2b5) s.u8();
  }
  if (version >= 0x2a3) {
    if (version <= 0x367) s.i32();
    else s.u8(); // playerNumberColor
  }
  if (version >= 0x2b5) {
    if (version <= 0x345) s.u8();
    else s.i16(); // flags
  }
  if (version >= 0x307) readContactCache(s, readers);
  if (version >= 0x3bd) {
    s.u8(); // stickiness
    s.u8(); // grabbability
    s.u8(); // grabFilter
  }
  let colorOpacity = 255;
  if (version >= 0x3c1) {
    colorOpacity = s.u8();
    s.u8(); // colorOffOpacity
  }
  if (subVersion >= 0x12c) s.u8(); // colorShininess
  if (version >= 0x3e2) s.bool(); // canCollect
  if (subVersion >= 0x42) {
    if (subVersion < 0xc6) s.u8();
    s.bool(); // ghosty
  }
  if (subVersion >= 0x186) s.bool(); // defaultClimbable
  if (subVersion >= 0x4b) s.bool(); // currentlyClimbable
  if (subVersion >= 0x63) s.bool(); // headDucking
  if (subVersion >= 0x82) s.bool(); // isLBP2Shape
  if (subVersion >= 0x8a) s.bool(); // isStatic
  if (subVersion >= 0xe6) s.bool(); // collidableSackboy
  if (subVersion >= 0x11a) {
    s.bool(); // partOfPowerUp
    s.bool(); // cameraExcluderIsSticky
  }
  if (subVersion >= 0x19a) s.bool(); // ethereal
  if (subVersion >= 0x120 && subVersion < 0x135) s.u8();
  const zBias = subVersion >= 0x149 ? s.u8() : 0;
  if (subVersion >= 0x14c) {
    s.u8(); // fireDensity
    s.u8(); // fireLifetime
  }
  return { ...polygon, material, thickness, color, brightness, bevelSize, zBias, colorOpacity };
}
