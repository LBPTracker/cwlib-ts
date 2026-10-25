/** `SHAPE`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef, vitaRevision } from '../../io/serializer.ts';
import { type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  /** The colour when off, packed ARGB as `color` is; from version 0x38a, an `i32` (cwlib `PShape.colorOff`). */
  readonly colorOff?: number;
  /** cwlib's `LethalType`, a `u16` from version 0x346. */
  readonly lethalType?: number;
  /** cwlib `PShape.playerNumberColor`, an `i8` from version 0x368. */
  readonly playerNumberColor?: number;
  /** cwlib's `ShapeFlags`, an `i16` from version 0x346. */
  readonly flags?: number;
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
  /** At and below version 0x389: `color` as the file's four floats, which the packed form rounds. */
  readonly colorVector?: readonly [number, number, number, number];
  /** Versions 0x303 to 0x389: `colorOff` as the file's four floats. */
  readonly colorOffVector?: readonly [number, number, number, number];
  /**
   * The bytes cwlib reads and writes as 0 and names nothing: subVersions 0x42
   * to 0xc5 before `ghosty`, and 0x120 to 0x134 before `zBias`. The game's own
   * files hold other values in the second (`dev/part-census.ts`), so both are kept.
   */
  readonly unknown42?: number;
  readonly unknown120?: number;
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
  const contacts = Array.from({ length: s.count() }, () => {
    const at = s.position;
    const id = s.i32();
    s.position = at;
    const read = s.reference((self) => readShape(self, readers));
    const flags = s.u8();
    // ❗ **A contact can name a shape still being read** -- its own Thing's, or
    // one whose contacts lead back here -- and `Serializer.reference` hands out
    // that shape's empty placeholder, which is never filled. The shape is looked
    // up again by its id once there is one, so a contact names the real part.
    if (!read || Object.keys(read).length > 0) return { shape: read, flags };
    let shape: ShapePart | undefined;
    let from: Serializer | undefined = s;
    return {
      get shape(): ShapePart | undefined {
        if (!from) return shape;
        const now = from.referenced.get(id) as ShapePart | undefined;
        if (now && Object.keys(now).length > 0) {
          shape = now;
          from = undefined; // the stream is let go once the shape is found
        }
        return now;
      },
      flags,
    };
  });
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
  let colorOff: number | undefined;
  let lethalType: number | undefined;
  let playerNumberColor: number | undefined;
  let flags: number | undefined;
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
  let colorVector: [number, number, number, number] | undefined;
  let colorOffVector: [number, number, number, number] | undefined;
  if (version <= 0x389) {
    colorVector = s.vector4();
    const [r, g, b, a] = colorVector.map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
    color = ((a! << 24) | (r! << 16) | (g! << 8) | b!) >>> 0;
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
    if (version < 0x38a) {
      colorOffVector = s.vector4();
      const [r, g, b, a] = colorOffVector.map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
      colorOff = ((a! << 24) | (r! << 16) | (g! << 8) | b!) >>> 0;
    } else colorOff = s.i32() >>> 0;
    brightnessOff = s.f32();
  }
  if (version <= 0x345) lethalType = s.i32(); // an enum32 here and a u16 after
  else lethalType = s.u16();
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
    if (version <= 0x367) playerNumberColor = s.i32();
    else playerNumberColor = s.i8();
  }
  if (version >= 0x2b5) {
    if (version <= 0x345) flags = s.u8();
    else flags = s.i16();
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
  let unknown42: number | undefined;
  let unknown120: number | undefined;
  if (subVersion >= 0x42) {
    if (subVersion < 0xc6) unknown42 = s.u8();
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
  if (subVersion >= 0x120 && subVersion < 0x135) unknown120 = s.u8();
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
    contactCache, colorOff, lethalType, playerNumberColor, flags, colorVector, colorOffVector,
    unknown42, unknown120,
  };
}

/** Four floats from a packed ARGB, as cwlib's `Colors.RGBA32.fromARGB` does. */
function argbVector(argb: number): [number, number, number, number] {
  return [(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff, argb >>> 24].map((x) => x / 255) as [number, number, number, number];
}

function writePolygon(w: Writer, shape: ShapePart): void {
  const count = shape.vertices.length / 3;
  w.i32(count);
  const requiresZ = w.revision.version < 0x341 ? true : shape.requiresZ;
  if (w.revision.version >= 0x341) w.bool(requiresZ);
  for (let i = 0; i < count; i += 1) {
    w.f32(shape.vertices[i * 3]!);
    w.f32(shape.vertices[i * 3 + 1]!);
    if (requiresZ) w.f32(shape.vertices[i * 3 + 2]!);
  }
  w.intVector(shape.loops);
}

/**
 * `readContactCache`'s mirror. A contact's shape is another Thing's `PShape`,
 * an object of the stream like a Thing, so it goes through `ctx.thing`, which
 * writes it as the stream does: its id, and its body at its first mention.
 */
function writeContactCache(w: Writer, cache: ContactCache, ctx: PartWriteContext): void {
  w.i32(cache.contacts.length);
  for (const contact of cache.contacts) {
    ctx.thing(w, contact.shape as unknown as Thing | undefined);
    w.u8(contact.flags);
  }
  w.bool(cache.contactsSorted);
  if (w.revision.subVersion < 0x46) w.bool(cache.cacheDirtyButRecomputed ?? false);
}

/** `readShape`'s mirror; what it reads and drops is written as cwlib writes it, 0. */
export function writeShape(w: Writer, p: ShapePart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  writePolygon(w, p);
  w.ref(p.material);
  if (version >= 0x15c) w.ref(p.oldMaterial);
  w.f32(p.thickness);
  if (version >= 0x227) w.f32(p.massDepth ?? 0);
  if (version <= 0x389) w.vector4(p.colorVector ?? argbVector(p.color));
  else w.i32(p.color | 0);
  if (version >= 0x301) w.f32(p.brightness);
  w.f32(p.bevelSize);
  if (version <= 0x340 || version >= 0x38e) w.matrix(p.COM ?? IDENTITY);
  if (version <= 0x306) {
    w.u8(p.interactPlayMode ?? 0);
    w.u8(p.interactEditMode ?? 0);
  }
  if (version >= 0x303) {
    w.i32(p.behavior ?? 0);
    if (version < 0x38a) w.vector4(p.colorOffVector ?? argbVector(p.colorOff ?? 0));
    else w.i32((p.colorOff ?? 0) | 0);
    w.f32(p.brightnessOff ?? 0);
  }
  if (version <= 0x345) w.i32(p.lethalType ?? 0);
  else w.u16(p.lethalType ?? 0);
  if (version < 0x2b5) {
    w.bool(p.COLLIDABLE_GAME ?? false);
    if (version >= 0x224) w.bool(p.COLLIDABLE_POPPET ?? false);
    w.bool(p.COLLIDABLE_WITH_PARENT ?? false);
  }
  w.i32(p.soundEnumOverride);
  if (version >= 0x29d && version < 0x30c) {
    w.f32(p.restitution ?? 0);
    if (version < 0x2b5) w.u8(0);
  }
  if (version >= 0x2a3) {
    if (version <= 0x367) w.i32(p.playerNumberColor ?? 0);
    else w.i8(p.playerNumberColor ?? 0);
  }
  if (version >= 0x2b5) {
    if (version <= 0x345) w.u8(p.flags ?? 0);
    else w.i16(p.flags ?? 0);
  }
  if (version >= 0x307) writeContactCache(w, p.contactCache ?? { contacts: [], contactsSorted: false }, ctx);
  if (version >= 0x3bd) {
    w.u8(p.stickiness ?? 0);
    w.u8(p.grabbability ?? 0);
    w.u8(p.grabFilter ?? 0);
  }
  if (version >= 0x3c1) {
    w.u8(p.colorOpacity);
    w.u8(p.colorOffOpacity ?? 0);
  }
  const vita = vitaRevision(w.revision);
  if (vita >= 0x5) w.u8(p.touchability ?? 0);
  if (subVersion >= 0x12c) w.u8(p.colorShininess ?? 0);
  if (version >= 0x3e2) w.bool(p.canCollect ?? false);
  if (vita >= 0x26) w.bool(p.invisibleTouch ?? false);
  if (vita >= 0x34) w.u8(p.bouncePadBehavior ?? 0);
  if (vita >= 0x5f) w.f32(p.zBiasVita ?? 0);
  if (vita >= 0x7a) w.bool(p.touchWhenInvisible ?? false);
  if (subVersion >= 0x42) {
    if (subVersion < 0xc6) w.u8(p.unknown42 ?? 0);
    w.bool(p.ghosty ?? false);
  }
  if (subVersion >= 0x186) w.bool(p.defaultClimbable ?? false);
  if (subVersion >= 0x4b) w.bool(p.currentlyClimbable ?? false);
  if (subVersion >= 0x63) w.bool(p.headDucking ?? false);
  if (subVersion >= 0x82) w.bool(p.isLBP2Shape ?? false);
  if (subVersion >= 0x8a) w.bool(p.isStatic ?? false);
  if (subVersion >= 0xe6) w.bool(p.collidableSackboy ?? false);
  if (subVersion >= 0x11a) {
    w.bool(p.partOfPowerUp ?? false);
    w.bool(p.cameraExcluderIsSticky ?? false);
  }
  if (subVersion >= 0x19a) w.bool(p.ethereal ?? false);
  if (subVersion >= 0x120 && subVersion < 0x135) w.u8(p.unknown120 ?? 0);
  if (subVersion >= 0x149) w.u8(p.zBias);
  if (subVersion >= 0x14c) {
    w.u8(p.fireDensity ?? 0);
    w.u8(p.fireLifetime ?? 0);
  }
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
