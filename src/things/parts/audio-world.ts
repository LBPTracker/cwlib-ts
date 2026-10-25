/** `AUDIO_WORLD`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PAudioWorld`: a sound object. */
/** `PAudioWorld`, kept: the sound an object plays, and how. */
export interface AudioWorldPart {
  /** An FMOD event's path: `spots/lbp2/contraptions/winding_ratchet_loop` on Needlepoint Peaks. */
  readonly soundName: string;
  readonly initialVolume: number;
  readonly initialPitch: number;
  readonly initialParam1: number;
  readonly maxFalloff: number;
  /** cwlib's `PlayMode` from version 0x2c4. */
  readonly playMode: number;
  readonly isLocal: boolean;
  readonly hideInPlayMode: boolean;
  readonly soundNames: number;
  readonly meshColor: number;
  readonly categoryGuid: number;
  readonly impactTolerance: number;
  readonly triggerByFalloff?: boolean;
  readonly triggerByImpact?: boolean;
  readonly triggerBySwitch?: boolean;
  readonly paramAffectVol: boolean;
  readonly paramAffectPitch: boolean;
  readonly paramAffectParam: boolean;
  readonly triggerByDestroy?: boolean;
  readonly behavior?: number;
  readonly activatedLastFrame?: boolean;
}

export function readAudioWorld(s: Serializer): AudioWorldPart {
  const { version, subVersion } = s.revision;
  let triggerByDestroy: boolean | undefined;
  let behavior: number | undefined;
  let activatedLastFrame: boolean | undefined;
  let triggerByFalloff: boolean | undefined;
  let triggerByImpact: boolean | undefined;
  let triggerBySwitch: boolean | undefined;
  const soundName = s.str();
  const initialVolume = s.f32();
  const initialPitch = s.f32();
  const initialParam1 = s.f32();
  const maxFalloff = s.f32();
  const impactTolerance = s.f32();
  let playMode = 0;
  if (version < 0x2c4) {
    triggerByFalloff = s.bool();
    triggerByImpact = s.bool();
    triggerBySwitch = s.bool();
    if (version >= 0x1ad) triggerByDestroy = s.bool();
  } else playMode = s.i32(); // enum32
  const paramAffectVol = s.bool();
  const paramAffectPitch = s.bool();
  const paramAffectParam = s.bool();
  const isLocal = version >= 0x165 ? s.bool() : false;
  const hideInPlayMode = version >= 0x198 ? s.bool() : false;
  if (version >= 0x2c4) behavior = s.i32();
  let soundNames = 0;
  let meshColor = 0;
  if (version >= 0x380) {
    soundNames = s.guid();
    meshColor = s.i32();
  }
  const categoryGuid = subVersion >= 0x178 ? s.i32() : 0;
  if (subVersion >= 0x191) activatedLastFrame = s.bool();
  return {
    soundName, initialVolume, initialPitch, initialParam1, maxFalloff, playMode, isLocal,
    hideInPlayMode, soundNames, meshColor, categoryGuid, impactTolerance, triggerByFalloff,
    triggerByImpact, triggerBySwitch, paramAffectVol, paramAffectPitch, paramAffectParam,
    triggerByDestroy, behavior, activatedLastFrame,
  };
}

/** `readAudioWorld`'s mirror. */
export function writeAudioWorld(w: Writer, v: AudioWorldPart, _ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  w.str(v.soundName);
  w.f32(v.initialVolume);
  w.f32(v.initialPitch);
  w.f32(v.initialParam1);
  w.f32(v.maxFalloff);
  w.f32(v.impactTolerance);
  if (version < 0x2c4) {
    w.bool(v.triggerByFalloff ?? false);
    w.bool(v.triggerByImpact ?? false);
    w.bool(v.triggerBySwitch ?? false);
    if (version >= 0x1ad) w.bool(v.triggerByDestroy ?? false);
  } else w.i32(v.playMode);
  w.bool(v.paramAffectVol);
  w.bool(v.paramAffectPitch);
  w.bool(v.paramAffectParam);
  if (version >= 0x165) w.bool(v.isLocal);
  if (version >= 0x198) w.bool(v.hideInPlayMode);
  if (version >= 0x2c4) w.i32(v.behavior ?? 0);
  if (version >= 0x380) {
    w.guid(v.soundNames);
    w.i32(v.meshColor);
  }
  if (subVersion >= 0x178) w.i32(v.categoryGuid);
  if (subVersion >= 0x191) w.bool(v.activatedLastFrame ?? false);
}
