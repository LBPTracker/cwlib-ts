/** `FADER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PFader`: the scenery fade an island applies when the player is behind it. */
/** `PFader`, kept: how far the Thing is faded out, and what fades it. */
export interface FaderPart {
  readonly includeRigidConnectors: boolean;
  readonly includeLights: boolean;
  readonly requirePlayerObscuration: boolean;
  /** As saved: 1 on 244 of Needlepoint Peaks' 246, 0.5 on 2; which end is opaque is not measured. */
  readonly fadeAmount: number;
  readonly faderDisabled: boolean;
  readonly fadeTimeSeconds: number;
  readonly inputBehavior: number;
}

export function readFader(s: Serializer): FaderPart {
  const { subVersion } = s.revision;
  const includeRigidConnectors = s.bool();
  const includeLights = subVersion >= 0xe0 ? s.bool() : false;
  const requirePlayerObscuration = s.bool();
  const fadeAmount = s.f32();
  const faderDisabled = subVersion >= 0x17 ? s.bool() : false;
  const fadeTimeSeconds = subVersion >= 0x39 ? s.f32() : 0;
  const inputBehavior = subVersion >= 0x3b ? s.i8() : 0;
  return {
    includeRigidConnectors, includeLights, requirePlayerObscuration, fadeAmount, faderDisabled,
    fadeTimeSeconds, inputBehavior,
  };
}

/** `readFader`'s mirror. */
export function writeFader(w: Writer, v: FaderPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.bool(v.includeRigidConnectors);
  if (subVersion >= 0xe0) w.bool(v.includeLights);
  w.bool(v.requirePlayerObscuration);
  w.f32(v.fadeAmount);
  if (subVersion >= 0x17) w.bool(v.faderDisabled);
  if (subVersion >= 0x39) w.f32(v.fadeTimeSeconds);
  if (subVersion >= 0x3b) w.i8(v.inputBehavior);
}
