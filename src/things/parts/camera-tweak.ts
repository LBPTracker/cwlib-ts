/** `CAMERA_TWEAK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `CameraNode`: one framing in a camera zone's list. */
function readCameraNode(s: Serializer): void {
  s.skipVector4(); // targetBox
  s.skipVector3(); // pitchAngle
  s.f32(); // zoomDistance
  s.bool(); // localSpaceRoll
}

/** `PCameraTweak`: a camera zone and its cut-scene settings. */
export function readCameraTweak(s: Serializer): void {
  const { version, subVersion } = s.revision;
  if (version < 0x37e) {
    s.skipVector3(); // pitchAngle
    s.skipVector4(); // targetBox
  }
  s.skipVector4(); // triggerBox
  if (subVersion >= 0x1b) {
    s.u8(); // triggerLayerOffset
    s.u8(); // triggerLayerDepth
    if (subVersion >= 0x3d) s.bool(); // isCameraZRelative
  }
  if (version < 0x37e) s.f32(); // zoomDistance
  s.f32(); // positionFactor
  if (version >= 0x1f5) s.i32(); // photoBoothTimerLength
  s.s32(); // cameraType -- a u8 below 0x1d7
  if (version > 0x196 && version < 0x2c4) s.f32(); // activationLimit
  if (version >= 0x1ff) s.bool(); // disableZoomMode
  if (version >= 0x26a) s.bool(); // requireAll
  if (version >= 0x2ba) s.bool(); // motionControllerZone
  if (version >= 0x2c4) s.i32(); // behavior
  if (version >= 0x2f8 && version < 0x37e) s.u8();
  if (version >= 0x2eb) {
    s.u8(); // cutSceneTransitionType
    s.i32(); // cutSceneHoldTime
    s.bool(); // cutSceneSkippable
  }
  if (subVersion >= 0x9f) s.bool(); // cutSceneUseHoldTime
  if (version > 0x2ed) {
    s.u8(); // cutSceneTimeSinceUsed
    s.i32(); // cutSceneTransitionTime
    if (version < 0x35a) s.bool();
  }
  if (version > 0x359) s.i32(); // cutSceneColour
  if (version > 0x2ed) s.bool(); // cutSceneMovieMode
  if (version > 0x2f7) {
    s.f32(); // cutSceneDepthOfField
    s.f32(); // cutSceneFog
  }
  if (version > 0x2f8) s.f32(); // cutSceneFOV
  if (version > 0x315) s.f32(); // cutSceneShake
  if (version > 0x318) s.bool(); // fadeAudio
  if (version > 0x33e) s.bool(); // oldStyleCameraZone
  if (version > 0x369) s.bool(); // cutSceneTrackPlayer
  if (version > 0x395) s.bool(); // cutSceneSendsSignalOnCancelled
  if (version > 0x396) s.bool(); // cutSceneWasActiveLastFrame
  if (version > 0x37d) {
    const count = s.count();
    for (let i = 0; i < count; i += 1) readCameraNode(s);
  }
  if (subVersion > 0x7d) s.f32(); // frontDOF
  if (subVersion > 0x79) s.f32(); // sackTrackDOF
  if (subVersion > 0x7f) s.bool(); // allowSmoothZTransition
}
