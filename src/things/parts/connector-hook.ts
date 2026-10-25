/** `CONNECTOR_HOOK`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * `PConnectorHook`: a grapple point's motor settings.
 *
 * ❗ **Every field keeps cwlib's `subVersion` gate (`PConnectorHook.java`)**, as
 * `readAnimationTweak` does. `spinDamping`, `audioEnable` and `hookType` were
 * read always; measured 2026-10-22, `sack_town.bin` (subVersion 0xc8) read the
 * next Thing's UID as `hookType` and failed 8 bytes on, at 367139.
 */
/** `PConnectorHook`, kept: how a hook connects and moves. */
export interface ConnectorHookPart {
  readonly mode: number;
  readonly inputAction: number;
  readonly poweredSpeed: number;
  readonly accel: number;
  readonly decel: number;
  readonly delay: number;
  readonly reverse: boolean;
  readonly angle: number;
  readonly friction: number;
  readonly pivot?: readonly [number, number, number, number];
  readonly hookType: number;
  readonly tryLatch?: boolean;
  readonly clamped?: boolean;
  readonly collidable?: number;
  readonly spinDamping?: number;
  readonly audioEnable?: boolean;
  /**
   * subVersions 0xff..0x15c: a word cwlib writes as 0 and does not name. Kept because
   * the game's files hold other values there (one chunk at subVersion 0x144).
   */
  readonly legacyWord?: number;
}

export function readConnectorHook(s: Serializer): ConnectorHookPart {
  const { subVersion } = s.revision;
  let spinDamping: number | undefined;
  let audioEnable: boolean | undefined;
  let tryLatch: boolean | undefined;
  let clamped: boolean | undefined;
  let collidable: number | undefined;
  const mode = s.i32();
  if (subVersion <= 0xbb) s.i32();
  const inputAction = s.i32();
  if (subVersion <= 0xbd) s.skipVector3();
  const poweredSpeed = s.f32();
  const accel = s.f32();
  const decel = s.f32();
  const delay = subVersion > 0x7b ? s.f32() : 0;
  const reverse = subVersion > 0x7c ? s.bool() : false;
  let angle = 0;
  let friction = 0;
  let pivot: [number, number, number, number] | undefined;
  if (subVersion > 0xfd) {
    tryLatch = s.bool();
    clamped = s.bool();
    collidable = s.i32();
    angle = s.f32();
    friction = s.f32();
    pivot = s.vector4();
  }
  const legacyWord = subVersion >= 0xff && subVersion < 0x15d ? s.i32() : undefined;
  if (subVersion > 0x103) spinDamping = s.f32();
  if (subVersion > 0x13d) audioEnable = s.bool();
  const hookType = subVersion > 0x14e ? s.i32() : 0;
  return {
    mode, inputAction, poweredSpeed, accel, decel, delay, reverse, angle, friction, pivot, hookType,
    tryLatch, clamped, collidable, spinDamping, audioEnable, legacyWord,
  };
}

/** `readConnectorHook`'s mirror; the discarded values of old subVersions are written as 0. */
export function writeConnectorHook(w: Writer, v: ConnectorHookPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  w.i32(v.mode);
  if (subVersion <= 0xbb) w.i32(0);
  w.i32(v.inputAction);
  if (subVersion <= 0xbd) w.vector3([0, 0, 0]);
  w.f32(v.poweredSpeed);
  w.f32(v.accel);
  w.f32(v.decel);
  if (subVersion > 0x7b) w.f32(v.delay);
  if (subVersion > 0x7c) w.bool(v.reverse);
  if (subVersion > 0xfd) {
    w.bool(v.tryLatch ?? false);
    w.bool(v.clamped ?? false);
    w.i32(v.collidable ?? 0);
    w.f32(v.angle);
    w.f32(v.friction);
    w.vector4(v.pivot ?? [0, 0, 0, 0]);
  }
  if (subVersion >= 0xff && subVersion < 0x15d) w.i32(v.legacyWord ?? 0);
  if (subVersion > 0x103) w.f32(v.spinDamping ?? 0);
  if (subVersion > 0x13d) w.bool(v.audioEnable ?? false);
  if (subVersion > 0x14e) w.i32(v.hookType);
}
