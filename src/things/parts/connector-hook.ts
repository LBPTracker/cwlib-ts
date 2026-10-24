/** `CONNECTOR_HOOK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/**
 * `PConnectorHook`: a grapple point's motor settings.
 *
 * ❗ **Every field keeps cwlib's `subVersion` gate (`PConnectorHook.java`)**, as
 * `readAnimationTweak` does. `spinDamping`, `audioEnable` and `hookType` were
 * read always; measured 2026-10-22, `sack_town.bin` (subVersion 0xc8) read the
 * next Thing's UID as `hookType` and failed 8 bytes on, at 367139.
 */
export function readConnectorHook(s: Serializer): void {
  const { subVersion } = s.revision;
  s.i32(); // mode
  if (subVersion <= 0xbb) s.i32();
  s.i32(); // inputAction
  if (subVersion <= 0xbd) s.skipVector3();
  s.f32(); // poweredSpeed
  s.f32(); // accel
  s.f32(); // decel
  if (subVersion > 0x7b) s.f32(); // delay
  if (subVersion > 0x7c) s.bool(); // reverse
  if (subVersion > 0xfd) {
    s.bool(); // tryLatch
    s.bool(); // clamped
    s.i32(); // collidable
    s.f32(); // angle
    s.f32(); // friction
    s.skipVector4(); // pivot
  }
  if (subVersion >= 0xff && subVersion < 0x15d) s.i32();
  if (subVersion > 0x103) s.f32(); // spinDamping
  if (subVersion > 0x13d) s.bool(); // audioEnable
  if (subVersion > 0x14e) s.i32(); // hookType
}
