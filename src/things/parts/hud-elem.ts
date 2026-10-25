/** `HUD_ELEM`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  readonly inputType?: number;
  readonly transmitMode?: number;
  readonly zTest?: number;
  readonly onAnim?: number;
  readonly offAnim?: number;
  readonly highlightAnim?: number;
  readonly transform?: Float32Array;
}

export function readHudElem(s: Serializer): HudElemPart {
  const { subVersion } = s.revision;
  let transform: Float32Array | undefined;
  let inputType: number | undefined;
  let transmitMode: number | undefined;
  let zTest: number | undefined;
  let onAnim: number | undefined;
  let offAnim: number | undefined;
  let highlightAnim: number | undefined;
  let layer = 0;
  if (subVersion > 0x23) {
    layer = s.i32();
    inputType = s.i32();
    transmitMode = s.i32();
  }
  if (subVersion < 0x47) {
    s.i32();
    s.i32();
    s.i32();
  }
  let renderMode = 0;
  if (subVersion > 0x23) {
    renderMode = s.i32();
    zTest = s.i32();
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
  if (subVersion > 0x36) transform = s.matrix();
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
    onAnim = s.i32();
    offAnim = s.i32();
    highlightAnim = s.i32();
  }
  return {
    layer, renderMode, scaleX, scaleY, offsetX, offsetY, brightness, alpha, color, colorIndex, name,
    drawables, inputType, transmitMode, zTest, onAnim, offAnim, highlightAnim, transform,
  };
}

/** `readHudElem`'s mirror; what the reader discards below subVersion 0x47 and 0x55 is written as 0. */
export function writeHudElem(w: Writer, v: HudElemPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  if (subVersion > 0x23) {
    w.i32(v.layer);
    w.i32(v.inputType ?? 0);
    w.i32(v.transmitMode ?? 0);
  }
  if (subVersion < 0x47) {
    w.i32(0);
    w.i32(0);
    w.i32(0);
  }
  if (subVersion > 0x23) {
    w.i32(v.renderMode);
    w.i32(v.zTest ?? 0);
  }
  if (subVersion > 0x36) {
    w.f32(v.scaleX);
    w.f32(v.scaleY);
    w.f32(v.offsetX);
    w.f32(v.offsetY);
  }
  if (subVersion > 0x23) {
    w.f32(v.brightness);
    w.f32(v.alpha);
    w.i32(v.color);
  }
  if (subVersion > 0x36) w.matrix(v.transform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (subVersion >= 0x24) {
    w.s32(v.colorIndex);
    w.wstr(v.name);
  }
  if (subVersion > 0x23) {
    w.i32(v.drawables.length);
    for (const d of v.drawables) {
      w.ref(d.texture);
      w.i32(d.frameNo);
      w.i32(d.gpuColor);
      for (let i = 0; i < 4; i += 1) w.vector4(d.corners[i] ?? [0, 0, 0, 0]);
    }
  }
  if (subVersion < 0x55) {
    w.u8(0);
    w.u8(0);
    w.u8(0);
    w.u8(0);
    w.u16(0);
    w.f32(0);
    w.i32(0);
  }
  if (subVersion >= 0x47) {
    w.i32(v.onAnim ?? 0);
    w.i32(v.offAnim ?? 0);
    w.i32(v.highlightAnim ?? 0);
  }
}
