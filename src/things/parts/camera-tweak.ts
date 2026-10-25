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
}

export function readCameraTweak(s: Serializer): CameraTweakPart {
  const { version, subVersion } = s.revision;
  if (version < 0x37e) {
    s.skipVector3(); // pitchAngle
    s.skipVector4(); // targetBox
  }
  const triggerBox = s.vector4();
  if (subVersion >= 0x1b) {
    s.u8(); // triggerLayerOffset
    s.u8(); // triggerLayerDepth
    if (subVersion >= 0x3d) s.bool(); // isCameraZRelative
  }
  if (version < 0x37e) s.f32(); // zoomDistance
  const positionFactor = s.f32();
  if (version >= 0x1f5) s.i32(); // photoBoothTimerLength
  const cameraType = s.s32(); // a u8 below 0x1d7
  if (version > 0x196 && version < 0x2c4) s.f32(); // activationLimit
  if (version >= 0x1ff) s.bool(); // disableZoomMode
  if (version >= 0x26a) s.bool(); // requireAll
  if (version >= 0x2ba) s.bool(); // motionControllerZone
  const behavior = version >= 0x2c4 ? s.i32() : 0;
  if (version >= 0x2f8 && version < 0x37e) s.u8();
  let cutSceneHoldTime = 0;
  if (version >= 0x2eb) {
    s.u8(); // cutSceneTransitionType
    cutSceneHoldTime = s.i32();
    s.bool(); // cutSceneSkippable
  }
  if (subVersion >= 0x9f) s.bool(); // cutSceneUseHoldTime
  let cutSceneTransitionTime = 0;
  if (version > 0x2ed) {
    s.u8(); // cutSceneTimeSinceUsed
    cutSceneTransitionTime = s.i32();
    if (version < 0x35a) s.bool();
  }
  if (version > 0x359) s.i32(); // cutSceneColour
  if (version > 0x2ed) s.bool(); // cutSceneMovieMode
  if (version > 0x2f7) {
    s.f32(); // cutSceneDepthOfField
    s.f32(); // cutSceneFog
  }
  const cutSceneFOV = version > 0x2f8 ? s.f32() : 0;
  if (version > 0x315) s.f32(); // cutSceneShake
  if (version > 0x318) s.bool(); // fadeAudio
  if (version > 0x33e) s.bool(); // oldStyleCameraZone
  if (version > 0x369) s.bool(); // cutSceneTrackPlayer
  if (version > 0x395) s.bool(); // cutSceneSendsSignalOnCancelled
  if (version > 0x396) s.bool(); // cutSceneWasActiveLastFrame
  const nodes = version > 0x37d ? s.array(readCameraNode) : [];
  const frontDOF = subVersion > 0x7d ? s.f32() : 0;
  if (subVersion > 0x79) s.f32(); // sackTrackDOF
  if (subVersion > 0x7f) s.bool(); // allowSmoothZTransition
  return { triggerBox, positionFactor, cameraType, behavior, cutSceneHoldTime, cutSceneTransitionTime, cutSceneFOV, frontDOF, nodes };
}
