/**
 * `RMaterial` -- a physics material: magic `MATb`, dependency type 16, FileDB
 * paths ending `.mat` (`base_wood.mat`, `dark_matter.mat`). Not the look of a
 * surface, which is `RGfxMaterial` (`material.ts`): what a shape weighs, how it
 * slides and bounces, what it sounds like, and whether it breaks. `PShape`
 * names one on every shape.
 *
 * The walk is cwlib's `resources/RMaterial.java` (ennuo/toolkit `d6a2ef8`),
 * every field gated on the head's version alone; what the game's own files
 * prove of it is steering/level-files.md, *Physics materials*
 * (`dev/physics-material-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

/** cwlib's `CollideType`: what a Thing collides as, and what it ignores. Bit flags. */
export const COLLIDE_NONE = 0x0;
export const COLLIDE_NORMAL = 0x1;
export const COLLIDE_COLLECTABLE = 0x2;
export const COLLIDE_PLAYER = 0x4;
export const COLLIDE_MAGIC_WALL = 0x8;
export const COLLIDE_PROJECTILE = 0x10;
export const COLLIDE_TEMPORARY = 0x20;

export interface PhysicsMaterial {
  readonly revision: RevisionInfo;
  readonly traction: number;
  readonly density: number;
  readonly restitution: number;
  readonly slidingFriction: number;
  readonly rollingFriction: number;
  /** cwlib's `AudioMaterial`: which family of impact and scrape sounds. */
  readonly soundEnum: number;
  readonly grabbable: boolean;
  readonly gravityMultiplier: number;
  readonly airResistanceMultiplier: number;
  readonly limb: boolean;
  readonly shiftGrip: boolean;
  /** `COLLIDE_*` bits. */
  readonly collideType: number;
  readonly collideIgnore: number;
  readonly dissolvable: boolean;
  readonly explodable: boolean;
  readonly cuttableByExplosion: boolean;
  /** Version `0x167` on; `false` and zeros before. */
  readonly breakable: boolean;
  readonly breakMinVel: number;
  readonly breakMinForce: number;
  readonly explosionMinRadius: number;
  readonly explosionMaxRadius: number;
  readonly explosionMaxVel: number;
  /** Version `0x168` on. */
  readonly explosionMaxAngVel: number;
  readonly explosionMaxForce: number;
  /** Version `0x13c` on; `NaN` before, cwlib's default. */
  readonly maxForce: number;
  /** Version `0x244` on. */
  readonly bullet: boolean;
  /** Version `0x27b` on. */
  readonly circuitBoard: boolean;
  readonly disableCSG: boolean;
  /**
   * The bytes cwlib has no name for, below the versions that dropped them
   * (`0x13c`, `0x167`, `0x1d3`), in file order: kept so `encodePhysicsMaterial`
   * writes them back. Absent when the file has none.
   */
  readonly unnamed?: readonly Uint8Array[];
}

/**
 * Read a `MATb`. Throws on anything else, and when the walk does not end
 * exactly on the payload's last byte -- the check that the gates are right.
 */
export async function readPhysicsMaterial(bytes: Uint8Array, inflate: Inflate): Promise<PhysicsMaterial> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'MATb') throw new SerializerError(`not a physics material: "${resource.magic}"`);
  const { version } = revision;

  const unnamed: Uint8Array[] = [];
  const keep = (n: number): void => { unnamed.push(s.bytes(n)); };
  const traction = s.f32();
  const density = s.f32();
  if (version < 0x13c) keep(2); // two bytes cwlib has no name for
  const restitution = s.f32();
  const slidingFriction = s.f32();
  if (version < 0x13c) keep(4); // an f32, unnamed in cwlib
  const rollingFriction = s.f32();
  if (version < 0x13c) keep(5); // five unnamed bytes
  const soundEnum = s.i32();
  const grabbable = s.bool();
  if (version < 0x13c) keep(2);
  const gravityMultiplier = s.f32();
  const airResistanceMultiplier = s.f32();
  if (version < 0x167) keep(4); // an f32 cwlib guesses is `breakResistance`
  const limb = s.bool();
  if (version < 0x1d3) keep(1); // cwlib guesses `creativeZone`
  const shiftGrip = s.bool();
  const collideType = s.i32();
  const collideIgnore = s.i32();
  const dissolvable = s.bool();
  const explodable = s.bool();
  const cuttableByExplosion = s.bool();

  let breakable = false;
  let breakMinVel = 0;
  let breakMinForce = 0;
  let explosionMinRadius = 0;
  let explosionMaxRadius = 0;
  let explosionMaxVel = 0;
  let explosionMaxAngVel = 0;
  let explosionMaxForce = 0;
  if (version >= 0x167) {
    breakable = s.bool();
    breakMinVel = s.f32();
    breakMinForce = s.f32();
    explosionMinRadius = s.f32();
    explosionMaxRadius = s.f32();
    explosionMaxVel = s.f32();
    if (version >= 0x168) explosionMaxAngVel = s.f32();
    explosionMaxForce = s.f32();
  }
  const maxForce = version >= 0x13c ? s.f32() : NaN;
  const bullet = version >= 0x244 ? s.bool() : false;
  const circuitBoard = version >= 0x27b ? s.bool() : false;
  const disableCSG = version >= 0x27b ? s.bool() : false;

  if (s.remaining !== 0) {
    throw new SerializerError(`MATb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, traction, density, restitution, slidingFriction, rollingFriction, soundEnum, grabbable,
    gravityMultiplier, airResistanceMultiplier, limb, shiftGrip, collideType, collideIgnore, dissolvable,
    explodable, cuttableByExplosion, breakable, breakMinVel, breakMinForce, explosionMinRadius,
    explosionMaxRadius, explosionMaxVel, explosionMaxAngVel, explosionMaxForce, maxForce, bullet,
    circuitBoard, disableCSG, ...(unnamed.length > 0 ? { unnamed } : {}),
  };
}

/**
 * `readPhysicsMaterial`'s mirror: the payload, from the value. The unnamed
 * bytes of an old revision come from `unnamed`, zeros where it is absent.
 */
export function encodePhysicsMaterial(value: PhysicsMaterial, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const { version } = header.revision;
  let next = 0;
  const kept = (n: number): void => {
    const bytes = value.unnamed?.[next];
    next += 1;
    w.bytes(bytes && bytes.length === n ? bytes : new Uint8Array(n));
  };
  w.f32(value.traction);
  w.f32(value.density);
  if (version < 0x13c) kept(2);
  w.f32(value.restitution);
  w.f32(value.slidingFriction);
  if (version < 0x13c) kept(4);
  w.f32(value.rollingFriction);
  if (version < 0x13c) kept(5);
  w.i32(value.soundEnum);
  w.bool(value.grabbable);
  if (version < 0x13c) kept(2);
  w.f32(value.gravityMultiplier);
  w.f32(value.airResistanceMultiplier);
  if (version < 0x167) kept(4);
  w.bool(value.limb);
  if (version < 0x1d3) kept(1);
  w.bool(value.shiftGrip);
  w.i32(value.collideType);
  w.i32(value.collideIgnore);
  w.bool(value.dissolvable);
  w.bool(value.explodable);
  w.bool(value.cuttableByExplosion);
  if (version >= 0x167) {
    w.bool(value.breakable);
    w.f32(value.breakMinVel);
    w.f32(value.breakMinForce);
    w.f32(value.explosionMinRadius);
    w.f32(value.explosionMaxRadius);
    w.f32(value.explosionMaxVel);
    if (version >= 0x168) w.f32(value.explosionMaxAngVel);
    w.f32(value.explosionMaxForce);
  }
  if (version >= 0x13c) w.f32(value.maxForce);
  if (version >= 0x244) w.bool(value.bullet);
  if (version >= 0x27b) {
    w.bool(value.circuitBoard);
    w.bool(value.disableCSG);
  }
  return w.done();
}
