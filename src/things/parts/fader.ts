/** `FADER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PFader`: the scenery fade an island applies when the player is behind it. */
export function readFader(s: Serializer): void {
  const { subVersion } = s.revision;
  s.bool(); // includeRigidConnectors
  if (subVersion >= 0xe0) s.bool(); // includeLights
  s.bool(); // requirePlayerObscuration
  s.f32(); // fadeAmount
  if (subVersion >= 0x17) s.bool(); // faderDisabled
  if (subVersion >= 0x39) s.f32(); // fadeTimeSeconds
  if (subVersion >= 0x3b) s.i8(); // inputBehavior
}
