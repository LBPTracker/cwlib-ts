/** `JOINT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * `PJoint`: a bolt, spring, piston, string or the like between two Things.
 * steering/level-files.md, *Joints*, says what of it is measured.
 */
export interface JointPart {
  readonly a?: Thing;
  readonly b?: Thing;
  /** Where the joint holds each Thing, in that Thing's own space. */
  readonly aContact: [number, number, number];
  readonly bContact: [number, number, number];
  readonly length: number;
  readonly angle: number;
  /** cwlib's `JointType`. */
  readonly type: number;
  readonly renderScale: number;
  /** false when the revision has no field. */
  readonly hideInPlayMode: boolean;
  /** cwlib's `settings`: steering/level-files.md, *Joints*, says what it names. */
  readonly settings?: ResourceRef;
  readonly offsetTime: number;
  readonly invertAngle: boolean;
  /** cwlib's `boneIdx`, an `i32` array (its default `{ -1, -1 }`). */
  readonly boneIdx?: readonly number[];
  readonly boneLengths: readonly [number, number, number, number];
  readonly strength: number;
  readonly stiff: boolean;
  readonly slideDir: readonly [number, number, number];
  readonly animationPattern: number;
  readonly animationRange: number;
  readonly animationTime: number;
  readonly animationPhase: number;
  readonly animationSpeed: number;
  readonly animationPause: number;
  readonly aAngleOffset: number;
  readonly bAngleOffset: number;
  readonly modStartFrames: number;
  readonly modDeltaFrames: number;
  readonly modScale: number;
  readonly interactPlayMode?: number;
  readonly interactEditMode?: number;
  /** Above 0x280 a float; from 0x21d to 0x280 an `i32` (cwlib rounds a float into it). */
  readonly tweakTargetMaxLength?: number;
  readonly tweakTargetMinLength?: number;
  readonly canBeTweakedByPoppetPowerup?: boolean;
  readonly createdByPoppetPowerup?: boolean;
  readonly modDriven?: boolean;
  readonly jointSoundEnum?: number;
  readonly currentlyEditing?: boolean;
  readonly modScaleActive?: boolean;
  readonly behaviour?: number;
  readonly railInteractions?: number;
  /** subVersion 0xed on: the rail's knots. */
  readonly railKnotVector?: readonly (readonly [number, number, number])[];
  readonly oldJointOutputBehavior?: boolean;
}

/** `PJoint`: the connector between two Things. Long, and all of it fixed-width. */
export function readJoint(s: Serializer, readers: ReadonlyMap<string, PartReader>): JointPart {
  let modDriven: boolean | undefined;
  let jointSoundEnum: number | undefined;
  let currentlyEditing: boolean | undefined;
  let modScaleActive: boolean | undefined;
  let behaviour: number | undefined;
  let railInteractions: number | undefined;
  let railKnotVector: (readonly [number, number, number])[] | undefined;
  let oldJointOutputBehavior: boolean | undefined;
  let interactPlayMode: number | undefined;
  let interactEditMode: number | undefined;
  let tweakTargetMaxLength: number | undefined;
  let tweakTargetMinLength: number | undefined;
  let canBeTweakedByPoppetPowerup: boolean | undefined;
  let createdByPoppetPowerup: boolean | undefined;
  const a = readThingRef(s, readers);
  const b = readThingRef(s, readers);
  const aContact = s.vector3();
  const bContact = s.vector3();
  const length = s.f32();
  const angle = s.f32();
  const offsetTime = s.f32();
  const invertAngle = s.bool();
  const settings = s.resource();
  const boneIdx = s.array((self) => self.i32());
  const boneLengths = s.vector4();
  const type = s.i32();
  const strength = s.f32();
  const stiff = s.bool();
  const slideDir = s.vector3();
  const animationPattern = s.i32();
  const animationRange = s.f32();
  const animationTime = s.f32();
  const animationPhase = s.f32();
  const animationSpeed = s.f32();
  const animationPause = s.f32();
  const aAngleOffset = s.f32();
  const bAngleOffset = s.f32();
  const modStartFrames = s.f32();
  const modDeltaFrames = s.f32();
  const modScale = s.f32();
  const { version: jv } = s.revision;
  if (jv < 0x2c4) modDriven = s.bool();
  if (jv < 0x307) {
    interactPlayMode = s.u8();
    interactEditMode = s.u8();
  }
  const renderScale = s.f32();
  if (jv > 0x169) jointSoundEnum = s.i32();
  // ❗ A pair of floats above 0x280 and a pair of **integers** at or below it.
  // Same width on paper, different width in a compressed stream: the ints are
  // varints and the floats are four bytes each.
  if (jv > 0x280) {
    tweakTargetMaxLength = s.f32();
    tweakTargetMinLength = s.f32();
  } else if (jv > 0x21c) {
    tweakTargetMaxLength = s.i32();
    tweakTargetMinLength = s.i32();
  }
  if (jv > 0x21e) currentlyEditing = s.bool();
  if (jv > 0x22f && jv < 0x2c4) modScaleActive = s.bool();
  const hideInPlayMode = jv > 0x25c ? s.bool() : false;
  if (jv > 0x2c3) behaviour = s.i32();
  if (s.revision.subVersion >= 0xed) {
    railKnotVector = Array.from({ length: s.count() }, () => s.vector3());
  }
  if (s.revision.subVersion >= 0x197) railInteractions = s.u8();
  if (s.revision.subVersion >= 0x19f) {
    canBeTweakedByPoppetPowerup = s.bool();
    createdByPoppetPowerup = s.bool();
  }
  if (s.revision.subVersion >= 0x1a4) oldJointOutputBehavior = s.bool();
  return {
    a, b, aContact, bContact, length, angle, type, renderScale, hideInPlayMode, settings,
    offsetTime, invertAngle, boneIdx, boneLengths, strength, stiff, slideDir, animationPattern,
    animationRange, animationTime, animationPhase, animationSpeed, animationPause, aAngleOffset,
    bAngleOffset, modStartFrames, modDeltaFrames, modScale, interactPlayMode, interactEditMode,
    tweakTargetMaxLength, tweakTargetMinLength, canBeTweakedByPoppetPowerup, createdByPoppetPowerup,
    modDriven, jointSoundEnum, currentlyEditing, modScaleActive, behaviour, railInteractions, railKnotVector,
    oldJointOutputBehavior,
  };
}

/** `readJoint`'s mirror. */
export function writeJoint(w: Writer, value: JointPart, ctx: PartWriteContext): void {
  const { version: jv, subVersion } = w.revision;
  ctx.thing(w, value.a);
  ctx.thing(w, value.b);
  w.vector3(value.aContact);
  w.vector3(value.bContact);
  w.f32(value.length);
  w.f32(value.angle);
  w.f32(value.offsetTime);
  w.bool(value.invertAngle);
  w.ref(value.settings);
  const boneIdx = value.boneIdx ?? [-1, -1];
  w.i32(boneIdx.length);
  for (const bone of boneIdx) w.i32(bone);
  w.vector4(value.boneLengths);
  w.i32(value.type);
  w.f32(value.strength);
  w.bool(value.stiff);
  w.vector3(value.slideDir);
  w.i32(value.animationPattern);
  w.f32(value.animationRange);
  w.f32(value.animationTime);
  w.f32(value.animationPhase);
  w.f32(value.animationSpeed);
  w.f32(value.animationPause);
  w.f32(value.aAngleOffset);
  w.f32(value.bAngleOffset);
  w.f32(value.modStartFrames);
  w.f32(value.modDeltaFrames);
  w.f32(value.modScale);
  if (jv < 0x2c4) w.bool(value.modDriven ?? false);
  if (jv < 0x307) {
    w.u8(value.interactPlayMode ?? 0);
    w.u8(value.interactEditMode ?? 0);
  }
  w.f32(value.renderScale);
  if (jv > 0x169) w.i32(value.jointSoundEnum ?? 0);
  if (jv > 0x280) {
    w.f32(value.tweakTargetMaxLength ?? 0);
    w.f32(value.tweakTargetMinLength ?? 0);
  } else if (jv > 0x21c) {
    w.i32(Math.round(value.tweakTargetMaxLength ?? 0));
    w.i32(Math.round(value.tweakTargetMinLength ?? 0));
  }
  if (jv > 0x21e) w.bool(value.currentlyEditing ?? false);
  if (jv > 0x22f && jv < 0x2c4) w.bool(value.modScaleActive ?? false);
  if (jv > 0x25c) w.bool(value.hideInPlayMode);
  if (jv > 0x2c3) w.i32(value.behaviour ?? 0);
  if (subVersion >= 0xed) {
    const knots = value.railKnotVector ?? [];
    w.i32(knots.length);
    for (const knot of knots) w.vector3(knot);
  }
  if (subVersion >= 0x197) w.u8(value.railInteractions ?? 0);
  if (subVersion >= 0x19f) {
    w.bool(value.canBeTweakedByPoppetPowerup ?? false);
    w.bool(value.createdByPoppetPowerup ?? false);
  }
  if (subVersion >= 0x1a4) w.bool(value.oldJointOutputBehavior ?? false);
}
