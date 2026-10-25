/** `HUD_ELEM`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';

/** `PHudElem` -- an element of a level's HUD. cwlib's `PHudElem.java` and `HUDDecal.java`. */
/** One quad of a HUD element: a texture frame on four corners. */
export interface HudDrawable {
  readonly texture?: ResourceRef;
  readonly frameNo: number;
  readonly gpuColor: number;
  readonly corners: readonly (readonly [number, number, number, number])[];
}

/** `PHudElem`, kept: an on-screen element's placement, look and quads. */
export interface HudElemPart {
  readonly layer: number;
  readonly renderMode: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly brightness: number;
  readonly alpha: number;
  readonly color: number;
  readonly colorIndex: number;
  readonly name: string;
  readonly drawables: readonly HudDrawable[];
}

export function readHudElem(s: Serializer): HudElemPart {
  const { subVersion } = s.revision;
  let layer = 0;
  if (subVersion > 0x23) {
    layer = s.i32();
    s.i32(); // inputType
    s.i32(); // transmitMode
  }
  if (subVersion < 0x47) {
    s.i32();
    s.i32();
    s.i32();
  }
  let renderMode = 0;
  if (subVersion > 0x23) {
    renderMode = s.i32();
    s.i32(); // zTest
  }
  let [scaleX, scaleY, offsetX, offsetY] = [1, 1, 0, 0];
  if (subVersion > 0x36) {
    scaleX = s.f32();
    scaleY = s.f32();
    offsetX = s.f32();
    offsetY = s.f32();
  }
  let [brightness, alpha, color] = [1, 1, 0];
  if (subVersion > 0x23) {
    brightness = s.f32();
    alpha = s.f32();
    color = s.i32();
  }
  if (subVersion > 0x36) s.skipMatrix(); // transform
  let colorIndex = 0;
  let name = '';
  if (subVersion >= 0x24) {
    colorIndex = s.s32();
    name = s.wstr();
  }
  const drawables = subVersion > 0x23
    ? s.array((d): HudDrawable => ({
      texture: d.resource(),
      frameNo: d.i32(),
      gpuColor: d.i32(),
      corners: [d.vector4(), d.vector4(), d.vector4(), d.vector4()],
    }))
    : [];
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
  return { layer, renderMode, scaleX, scaleY, offsetX, offsetY, brightness, alpha, color, colorIndex, name, drawables };
}
