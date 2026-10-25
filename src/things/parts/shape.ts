/** `SHAPE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef, vitaRevision } from '../../io/serializer.ts';
import { type PartReader, type Thing } from '../thing.ts';

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
  readonly interactPlayMode?: number;
  readonly interactEditMode?: number;
  readonly behavior?: number;
  readonly brightnessOff?: number;
  readonly COLLIDABLE_GAME?: boolean;
  readonly COLLIDABLE_WITH_PARENT?: boolean;
  readonly soundEnumOverride: number;
  readonly restitution?: number;
  readonly stickiness?: number;
  readonly grabbability?: number;
  readonly grabFilter?: number;
  readonly colorOffOpacity?: number;
  readonly ghosty?: boolean;
  readonly partOfPowerUp?: boolean;
  readonly cameraExcluderIsSticky?: boolean;
  readonly fireDensity?: number;
  readonly fireLifetime?: number;
  readonly oldMaterial?: ResourceRef;
  readonly massDepth?: number;
  readonly COM?: Float32Array;
  readonly COLLIDABLE_POPPET?: boolean;
  readonly touchability?: number;
  readonly colorShininess?: number;
  readonly canCollect?: boolean;
  readonly invisibleTouch?: boolean;
  readonly bouncePadBehavior?: number;
  readonly zBiasVita?: number;
  readonly touchWhenInvisible?: boolean;
  readonly defaultClimbable?: boolean;
  readonly currentlyClimbable?: boolean;
  readonly headDucking?: boolean;
  readonly isLBP2Shape?: boolean;
  readonly isStatic?: boolean;
  readonly collidableSackboy?: boolean;
  readonly ethereal?: boolean;
  /** Version 0x307 on: the shapes this one touches. */
  readonly contactCache?: ContactCache;
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
export interface ContactCache {
  /** A `Contact`: another Thing's `PShape`, by reference, and a flag byte. */
  readonly contacts: readonly { readonly shape?: ShapePart; readonly flags: number }[];
  readonly contactsSorted: boolean;
  /** Below subVersion `0x46`. */
  readonly cacheDirtyButRecomputed?: boolean;
}

function readContactCache(s: Serializer, readers: ReadonlyMap<string, PartReader>): ContactCache {
  const contacts = Array.from({ length: s.count() }, () => ({
    shape: s.reference((self) => readShape(self, readers)),
    flags: s.u8(),
  }));
  const contactsSorted = s.bool();
  const cacheDirtyButRecomputed = s.revision.subVersion < 0x46 ? s.bool() : undefined;
  return { contacts, contactsSorted, cacheDirtyButRecomputed };
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
  let oldMaterial: ResourceRef | undefined;
  let massDepth: number | undefined;
  let COM: Float32Array | undefined;
  let COLLIDABLE_POPPET: boolean | undefined;
  let touchability: number | undefined;
  let colorShininess: number | undefined;
  let canCollect: boolean | undefined;
  let invisibleTouch: boolean | undefined;
  let bouncePadBehavior: number | undefined;
  let zBiasVita: number | undefined;
  let touchWhenInvisible: boolean | undefined;
  let defaultClimbable: boolean | undefined;
  let currentlyClimbable: boolean | undefined;
  let headDucking: boolean | undefined;
  let isLBP2Shape: boolean | undefined;
  let isStatic: boolean | undefined;
  let collidableSackboy: boolean | undefined;
  let ethereal: boolean | undefined;
  let interactPlayMode: number | undefined;
  let interactEditMode: number | undefined;
  let behavior: number | undefined;
  let brightnessOff: number | undefined;
  let COLLIDABLE_GAME: boolean | undefined;
  let COLLIDABLE_WITH_PARENT: boolean | undefined;
  let restitution: number | undefined;
  let stickiness: number | undefined;
  let grabbability: number | undefined;
  let grabFilter: number | undefined;
  let colorOffOpacity: number | undefined;
  let ghosty: boolean | undefined;
  let partOfPowerUp: boolean | undefined;
  let cameraExcluderIsSticky: boolean | undefined;
  let fireDensity: number | undefined;
  let fireLifetime: number | undefined;
  const polygon = readPolygon(s);
  const material = s.resource();
  if (version >= 0x15c) oldMaterial = s.resource();
  const thickness = s.f32();
  if (version >= 0x227) massDepth = s.f32();
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
  if (version <= 0x340 || version >= 0x38e) COM = s.matrix();
  if (version <= 0x306) {
    interactPlayMode = s.u8();
    interactEditMode = s.u8();
  }
  if (version >= 0x303) {
    behavior = s.i32();
    if (version < 0x38a) s.skipVector4();
    else s.i32(); // colorOff
    brightnessOff = s.f32();
  }
  if (version <= 0x345) s.i32(); // lethalType, an enum32 here and a u16 after
  else s.u16();
  if (version < 0x2b5) {
    // The flags word does not exist yet; three bools stand in for its bits.
    COLLIDABLE_GAME = s.bool();
    if (version >= 0x224) COLLIDABLE_POPPET = s.bool();
    COLLIDABLE_WITH_PARENT = s.bool();
  }
  const soundEnumOverride = s.i32();
  if (version >= 0x29d && version < 0x30c) {
    restitution = s.f32();
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
  const contactCache = version >= 0x307 ? readContactCache(s, readers) : undefined;
  if (version >= 0x3bd) {
    stickiness = s.u8();
    grabbability = s.u8();
    grabFilter = s.u8();
  }
  let colorOpacity = 255;
  if (version >= 0x3c1) {
    colorOpacity = s.u8();
    colorOffOpacity = s.u8();
  }
  const vita = vitaRevision(s.revision);
  if (vita >= 0x5) touchability = s.u8();
  if (subVersion >= 0x12c) colorShininess = s.u8();
  if (version >= 0x3e2) canCollect = s.bool();
  if (vita >= 0x26) invisibleTouch = s.bool();
  if (vita >= 0x34) bouncePadBehavior = s.u8();
  if (vita >= 0x5f) zBiasVita = s.f32();
  if (vita >= 0x7a) touchWhenInvisible = s.bool();
  if (subVersion >= 0x42) {
    if (subVersion < 0xc6) s.u8();
    ghosty = s.bool();
  }
  if (subVersion >= 0x186) defaultClimbable = s.bool();
  if (subVersion >= 0x4b) currentlyClimbable = s.bool();
  if (subVersion >= 0x63) headDucking = s.bool();
  if (subVersion >= 0x82) isLBP2Shape = s.bool();
  if (subVersion >= 0x8a) isStatic = s.bool();
  if (subVersion >= 0xe6) collidableSackboy = s.bool();
  if (subVersion >= 0x11a) {
    partOfPowerUp = s.bool();
    cameraExcluderIsSticky = s.bool();
  }
  if (subVersion >= 0x19a) ethereal = s.bool();
  if (subVersion >= 0x120 && subVersion < 0x135) s.u8();
  const zBias = subVersion >= 0x149 ? s.u8() : 0;
  if (subVersion >= 0x14c) {
    fireDensity = s.u8();
    fireLifetime = s.u8();
  }
  return {
    ...polygon, material, thickness, color, brightness, bevelSize, zBias, colorOpacity,
    interactPlayMode, interactEditMode, behavior, brightnessOff, COLLIDABLE_GAME,
    COLLIDABLE_WITH_PARENT, soundEnumOverride, restitution, stickiness, grabbability, grabFilter,
    colorOffOpacity, ghosty, partOfPowerUp, cameraExcluderIsSticky, fireDensity, fireLifetime,
    oldMaterial, massDepth, COM, COLLIDABLE_POPPET, touchability, colorShininess, canCollect,
    invisibleTouch, bouncePadBehavior, zBiasVita, touchWhenInvisible, defaultClimbable,
    currentlyClimbable, headDucking, isLBP2Shape, isStatic, collidableSackboy, ethereal,
    contactCache,
  };
}
