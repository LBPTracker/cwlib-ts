/** `AUDIO_WORLD`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PAudioWorld`: a sound object. */
export function readAudioWorld(s: Serializer): void {
  const { version, subVersion } = s.revision;
  s.str(); // soundName
  s.f32(); // initialVolume
  s.f32(); // initialPitch
  s.f32(); // initialParam1
  s.f32(); // maxFalloff
  s.f32(); // impactTolerance
  if (version < 0x2c4) {
    s.bool(); // triggerByFalloff
    s.bool(); // triggerByImpact
    s.bool(); // triggerBySwitch
    if (version >= 0x1ad) s.bool(); // triggerByDestroy
  } else s.i32(); // playMode, enum32
  s.bool(); // paramAffectVol
  s.bool(); // paramAffectPitch
  s.bool(); // paramAffectParam
  if (version >= 0x165) s.bool(); // isLocal
  if (version >= 0x198) s.bool(); // hideInPlayMode
  if (version >= 0x2c4) s.i32(); // behavior
  if (version >= 0x380) {
    s.guid(); // soundNames
    s.i32(); // meshColor
  }
  if (subVersion >= 0x178) s.i32(); // categoryGUID
  if (subVersion >= 0x191) s.bool(); // activatedLastFrame
}
