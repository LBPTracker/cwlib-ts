/** `CAMERA_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `CameraNode`: one framing in a camera zone's list. */
function readCameraNode(s: Serializer): CameraNode {
  return { targetBox: s.vector4(), pitchAngle: s.vector3(), zoomDistance: s.f32(), localSpaceRoll: s.bool() };
}

/** `PCameraTweak`: a camera zone and its cut-scene settings. */
/** One shot of a camera zone: where it looks and from how far. */
export interface CameraNode {
  readonly targetBox: readonly [number, number, number, number];
  readonly pitchAngle: readonly [number, number, number];
  readonly zoomDistance: number;
  readonly localSpaceRoll: boolean;
}

/** `PCameraTweak`, kept: a camera zone, its kind and its shots. */
export interface CameraTweakPart {
  readonly triggerBox: readonly [number, number, number, number];
  readonly positionFactor: number;
  /** cwlib's `CameraType`. */
  readonly cameraType: number;
  readonly behavior: number;
  readonly cutSceneHoldTime: number;
  readonly cutSceneTransitionTime: number;
  readonly cutSceneFOV: number;
  readonly frontDOF: number;
  /** From version 0x37e; below it, the one node's fields sit in the part itself. */
  readonly nodes: readonly CameraNode[];
  readonly pitchAngle?: readonly [number, number, number];
  readonly targetBox?: readonly [number, number, number, number];
  readonly triggerLayerOffset?: number;
  readonly triggerLayerDepth?: number;
  readonly cutSceneTransitionType?: number;
  readonly cutSceneSkippable?: boolean;
  readonly cutSceneTimeSinceUsed?: number;
  readonly cutSceneDepthOfField?: number;
  readonly cutSceneFog?: number;
  readonly isCameraZRelative?: boolean;
  readonly zoomDistance?: number;
  readonly photoBoothTimerLength?: number;
  readonly activationLimit?: number;
  readonly disableZoomMode?: boolean;
  readonly requireAll?: boolean;
  readonly motionControllerZone?: boolean;
  readonly cutSceneUseHoldTime?: boolean;
  readonly cutSceneColour?: number;
  readonly cutSceneMovieMode?: boolean;
  readonly cutSceneShake?: number;
  readonly fadeAudio?: boolean;
  readonly oldStyleCameraZone?: boolean;
  readonly cutSceneTrackPlayer?: boolean;
  readonly cutSceneSendsSignalOnCancelled?: boolean;
  readonly cutSceneWasActiveLastFrame?: boolean;
  readonly sackTrackDOF?: number;
  readonly allowSmoothZTransition?: boolean;
}

export function readCameraTweak(s: Serializer): CameraTweakPart {
  const { version, subVersion } = s.revision;
  let isCameraZRelative: boolean | undefined;
  let zoomDistance: number | undefined;
  let photoBoothTimerLength: number | undefined;
  let activationLimit: number | undefined;
  let disableZoomMode: boolean | undefined;
  let requireAll: boolean | undefined;
  let motionControllerZone: boolean | undefined;
  let cutSceneUseHoldTime: boolean | undefined;
  let cutSceneColour: number | undefined;
  let cutSceneMovieMode: boolean | undefined;
  let cutSceneShake: number | undefined;
  let fadeAudio: boolean | undefined;
  let oldStyleCameraZone: boolean | undefined;
  let cutSceneTrackPlayer: boolean | undefined;
  let cutSceneSendsSignalOnCancelled: boolean | undefined;
  let cutSceneWasActiveLastFrame: boolean | undefined;
  let sackTrackDOF: number | undefined;
  let allowSmoothZTransition: boolean | undefined;
  let pitchAngle: readonly [number, number, number] | undefined;
  let targetBox: readonly [number, number, number, number] | undefined;
  let triggerLayerOffset: number | undefined;
  let triggerLayerDepth: number | undefined;
  let cutSceneTransitionType: number | undefined;
  let cutSceneSkippable: boolean | undefined;
  let cutSceneTimeSinceUsed: number | undefined;
  let cutSceneDepthOfField: number | undefined;
  let cutSceneFog: number | undefined;
  if (version < 0x37e) {
    pitchAngle = s.vector3();
    targetBox = s.vector4();
  }
  const triggerBox = s.vector4();
  if (subVersion >= 0x1b) {
    triggerLayerOffset = s.u8();
    triggerLayerDepth = s.u8();
    if (subVersion >= 0x3d) isCameraZRelative = s.bool();
  }
  if (version < 0x37e) zoomDistance = s.f32();
  const positionFactor = s.f32();
  if (version >= 0x1f5) photoBoothTimerLength = s.i32();
  const cameraType = s.s32(); // a u8 below 0x1d7
  if (version > 0x196 && version < 0x2c4) activationLimit = s.f32();
  if (version >= 0x1ff) disableZoomMode = s.bool();
  if (version >= 0x26a) requireAll = s.bool();
  if (version >= 0x2ba) motionControllerZone = s.bool();
  const behavior = version >= 0x2c4 ? s.i32() : 0;
  if (version >= 0x2f8 && version < 0x37e) s.u8();
  let cutSceneHoldTime = 0;
  if (version >= 0x2eb) {
    cutSceneTransitionType = s.u8();
    cutSceneHoldTime = s.i32();
    cutSceneSkippable = s.bool();
  }
  if (subVersion >= 0x9f) cutSceneUseHoldTime = s.bool();
  let cutSceneTransitionTime = 0;
  if (version > 0x2ed) {
    cutSceneTimeSinceUsed = s.u8();
    cutSceneTransitionTime = s.i32();
    if (version < 0x35a) s.bool();
  }
  if (version > 0x359) cutSceneColour = s.i32();
  if (version > 0x2ed) cutSceneMovieMode = s.bool();
  if (version > 0x2f7) {
    cutSceneDepthOfField = s.f32();
    cutSceneFog = s.f32();
  }
  const cutSceneFOV = version > 0x2f8 ? s.f32() : 0;
  if (version > 0x315) cutSceneShake = s.f32();
  if (version > 0x318) fadeAudio = s.bool();
  if (version > 0x33e) oldStyleCameraZone = s.bool();
  if (version > 0x369) cutSceneTrackPlayer = s.bool();
  if (version > 0x395) cutSceneSendsSignalOnCancelled = s.bool();
  if (version > 0x396) cutSceneWasActiveLastFrame = s.bool();
  const nodes = version > 0x37d ? s.array(readCameraNode) : [];
  const frontDOF = subVersion > 0x7d ? s.f32() : 0;
  if (subVersion > 0x79) sackTrackDOF = s.f32();
  if (subVersion > 0x7f) allowSmoothZTransition = s.bool();
  return {
    triggerBox, positionFactor, cameraType, behavior, cutSceneHoldTime, cutSceneTransitionTime,
    cutSceneFOV, frontDOF, nodes, pitchAngle, targetBox, triggerLayerOffset, triggerLayerDepth,
    cutSceneTransitionType, cutSceneSkippable, cutSceneTimeSinceUsed, cutSceneDepthOfField,
    cutSceneFog, isCameraZRelative, zoomDistance, photoBoothTimerLength, activationLimit,
    disableZoomMode, requireAll, motionControllerZone, cutSceneUseHoldTime, cutSceneColour,
    cutSceneMovieMode, cutSceneShake, fadeAudio, oldStyleCameraZone, cutSceneTrackPlayer,
    cutSceneSendsSignalOnCancelled, cutSceneWasActiveLastFrame, sackTrackDOF,
    allowSmoothZTransition,
  };
}

function writeCameraNode(w: Writer, node: CameraNode): void {
  w.vector4(node.targetBox);
  w.vector3(node.pitchAngle);
  w.f32(node.zoomDistance);
  w.bool(node.localSpaceRoll);
}

/** `readCameraTweak`'s mirror; the two reads it drops are written as cwlib writes them, 0 and false. */
export function writeCameraTweak(w: Writer, value: CameraTweakPart, _ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  if (version < 0x37e) {
    w.vector3(value.pitchAngle ?? [0, 0, 0]);
    w.vector4(value.targetBox ?? [0, 0, 0, 0]);
  }
  w.vector4(value.triggerBox);
  if (subVersion >= 0x1b) {
    w.u8(value.triggerLayerOffset ?? 0);
    w.u8(value.triggerLayerDepth ?? 0);
    if (subVersion >= 0x3d) w.bool(value.isCameraZRelative ?? false);
  }
  if (version < 0x37e) w.f32(value.zoomDistance ?? 0);
  w.f32(value.positionFactor);
  if (version >= 0x1f5) w.i32(value.photoBoothTimerLength ?? 0);
  w.s32(value.cameraType);
  if (version > 0x196 && version < 0x2c4) w.f32(value.activationLimit ?? 0);
  if (version >= 0x1ff) w.bool(value.disableZoomMode ?? false);
  if (version >= 0x26a) w.bool(value.requireAll ?? false);
  if (version >= 0x2ba) w.bool(value.motionControllerZone ?? false);
  if (version >= 0x2c4) w.i32(value.behavior);
  if (version >= 0x2f8 && version < 0x37e) w.u8(0);
  if (version >= 0x2eb) {
    w.u8(value.cutSceneTransitionType ?? 0);
    w.i32(value.cutSceneHoldTime);
    w.bool(value.cutSceneSkippable ?? false);
  }
  if (subVersion >= 0x9f) w.bool(value.cutSceneUseHoldTime ?? false);
  if (version > 0x2ed) {
    w.u8(value.cutSceneTimeSinceUsed ?? 0);
    w.i32(value.cutSceneTransitionTime);
    if (version < 0x35a) w.bool(false);
  }
  if (version > 0x359) w.i32(value.cutSceneColour ?? 0);
  if (version > 0x2ed) w.bool(value.cutSceneMovieMode ?? false);
  if (version > 0x2f7) {
    w.f32(value.cutSceneDepthOfField ?? 0);
    w.f32(value.cutSceneFog ?? 0);
  }
  if (version > 0x2f8) w.f32(value.cutSceneFOV);
  if (version > 0x315) w.f32(value.cutSceneShake ?? 0);
  if (version > 0x318) w.bool(value.fadeAudio ?? false);
  if (version > 0x33e) w.bool(value.oldStyleCameraZone ?? false);
  if (version > 0x369) w.bool(value.cutSceneTrackPlayer ?? false);
  if (version > 0x395) w.bool(value.cutSceneSendsSignalOnCancelled ?? false);
  if (version > 0x396) w.bool(value.cutSceneWasActiveLastFrame ?? false);
  if (version > 0x37d) {
    w.i32(value.nodes.length);
    for (const node of value.nodes) writeCameraNode(w, node);
  }
  if (subVersion > 0x7d) w.f32(value.frontDOF);
  if (subVersion > 0x79) w.f32(value.sackTrackDOF ?? 0);
  if (subVersion > 0x7f) w.bool(value.allowSmoothZTransition ?? false);
}
