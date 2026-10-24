/** `HUD_ELEM`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

/** `PHudElem` -- an element of a level's HUD. cwlib's `PHudElem.java` and `HUDDecal.java`. */
export function readHudElem(s: Serializer): void {
  const { subVersion } = s.revision;
  if (subVersion > 0x23) {
    s.i32(); // layer
    s.i32(); // inputType
    s.i32(); // transmitMode
  }
  if (subVersion < 0x47) {
    s.i32();
    s.i32();
    s.i32();
  }
  if (subVersion > 0x23) {
    s.i32(); // renderMode
    s.i32(); // zTest
  }
  if (subVersion > 0x36) {
    s.f32(); // scaleX
    s.f32(); // scaleY
    s.f32(); // offsetX
    s.f32(); // offsetY
  }
  if (subVersion > 0x23) {
    s.f32(); // brightness
    s.f32(); // alpha
    s.i32(); // color
  }
  if (subVersion > 0x36) s.skipMatrix(); // transform
  if (subVersion >= 0x24) {
    s.s32(); // colorIndex
    s.wstr(); // name
  }
  if (subVersion > 0x23) {
    s.array((d) => {
      d.resource(); // texture
      d.i32(); // frameNo
      d.i32(); // gpuColor
      for (let i = 0; i < 4; i += 1) d.skipVector4(); // corners
    });
  }
  if (subVersion < 0x55) {
    s.u8();
    s.u8();
    s.u8();
    s.u8();
    s.u16();
    s.f32();
    s.i32();
  }
  if (subVersion >= 0x47) {
    s.i32(); // onAnim
    s.i32(); // offAnim
    s.i32(); // highlightAnim
  }
}
