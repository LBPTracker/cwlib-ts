/**
 * `RJoint` -- a joint's settings: magic `JNTb`, FileDB paths
 * `gamedata/joints/….joint` (`cog_fast.joint`). What a bolt, spring or piston
 * of that kind does -- how far it stretches and turns, how it is drawn -- where
 * `PJoint` (`things/parts/joint.ts`) is one joint placed in a level.
 *
 * The walk is cwlib's `resources/RJoint.java` and `structs/joint/FCurve.java`
 * (ennuo/toolkit `d6a2ef8`), with no revision gates; steering/level-files.md,
 * *Joint settings*, has what the game's own files prove of it
 * (`dev/resources-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

/** cwlib's `FCurve`: a curve as three 4-vectors and its type. */
export interface FCurve {
  readonly x: readonly [number, number, number, number];
  readonly y: readonly [number, number, number, number];
  readonly p: readonly [number, number, number, number];
  readonly type: number;
}

export interface JointSettings {
  readonly revision: RevisionInfo;
  readonly allowExpand: boolean;
  readonly allowContract: boolean;
  readonly contractFreely: boolean;
  readonly lengthElasticity: number;
  readonly lengthPlasticity: number;
  readonly lengthFunc: FCurve;
  readonly angleDeviation: number;
  readonly angleElasticity: number;
  readonly anglePlasticity: number;
  readonly angleVelocity: number;
  readonly angleFunc: FCurve;
  readonly normalizedForces: boolean;
  readonly dontRotateA: boolean;
  readonly dontRotateB: boolean;
  readonly breakResistance: number;
  readonly gfxMaterial?: ResourceRef;
  readonly gfxWidth: number;
  readonly eventNameAngle: string;
  readonly eventNameLength: string;
  readonly mesh?: ResourceRef;
}

function readFCurve(s: Serializer): FCurve {
  return { x: s.vector4(), y: s.vector4(), p: s.vector4(), type: s.i32() };
}

/** Read a `JNTb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readJointSettings(bytes: Uint8Array, inflate: Inflate): Promise<JointSettings> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'JNTb') throw new SerializerError(`not joint settings: "${resource.magic}"`);
  const out: JointSettings = {
    revision,
    allowExpand: s.bool(),
    allowContract: s.bool(),
    contractFreely: s.bool(),
    lengthElasticity: s.f32(),
    lengthPlasticity: s.f32(),
    lengthFunc: readFCurve(s),
    angleDeviation: s.f32(),
    angleElasticity: s.f32(),
    anglePlasticity: s.f32(),
    angleVelocity: s.f32(),
    angleFunc: readFCurve(s),
    normalizedForces: s.bool(),
    dontRotateA: s.bool(),
    dontRotateB: s.bool(),
    breakResistance: s.f32(),
    gfxMaterial: s.resource(),
    gfxWidth: s.f32(),
    eventNameAngle: s.str(),
    eventNameLength: s.str(),
    mesh: s.resource(),
  };
  if (s.remaining !== 0) {
    throw new SerializerError(`JNTb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return out;
}

function writeFCurve(w: Writer, c: FCurve): void {
  w.vector4(c.x);
  w.vector4(c.y);
  w.vector4(c.p);
  w.i32(c.type);
}

/** `readJointSettings`'s mirror: the payload, byte for byte, from the value. */
export function encodeJointSettings(value: JointSettings, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  w.bool(value.allowExpand);
  w.bool(value.allowContract);
  w.bool(value.contractFreely);
  w.f32(value.lengthElasticity);
  w.f32(value.lengthPlasticity);
  writeFCurve(w, value.lengthFunc);
  w.f32(value.angleDeviation);
  w.f32(value.angleElasticity);
  w.f32(value.anglePlasticity);
  w.f32(value.angleVelocity);
  writeFCurve(w, value.angleFunc);
  w.bool(value.normalizedForces);
  w.bool(value.dontRotateA);
  w.bool(value.dontRotateB);
  w.f32(value.breakResistance);
  w.ref(value.gfxMaterial);
  w.f32(value.gfxWidth);
  w.str(value.eventNameAngle);
  w.str(value.eventNameLength);
  w.ref(value.mesh);
  return w.done();
}
