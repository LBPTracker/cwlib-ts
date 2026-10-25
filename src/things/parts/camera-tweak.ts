/** `CAMERA_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

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
