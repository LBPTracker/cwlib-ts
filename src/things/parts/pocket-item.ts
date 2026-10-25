/** `POCKET_ITEM`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * `PPocketItem`: a power-up as it sits in a plan's inventory.
 *
 * Turned up only once plans were being read — two of the corpus's 224, both at
 * subVersion 0x208/0x209, where the layout is the four fields at the bottom.
 * ⚠️ **The earlier gates are cwlib's and are not exercised here**: every other
 * plan in the corpus is at subVersion 0, where a pocket item would take the
 * `str` branch instead, and none of them carries one. They are written out
 * rather than dropped because a silent misparse of the wrong branch is exactly
 * what the Thing marker cannot catch until the *next* Thing.
 */
/** `PPocketItem`, kept: a pocket item's flags, power-up and lifetime. */
export interface PocketItemPart {
  readonly flags: number;
  readonly powerUpType: number;
  readonly aimModifier: number;
  readonly lifetime: number;
  readonly plan?: ResourceRef;
  /**
   * What cwlib reads and writes as 0, naming nothing: a `u16` from subVersion
   * 0x15 below 0x14d, and a byte from 0x2e below 0x14d. The game's own pocket
   * items at subVersion 0xc8 hold other values (`dev/part-census.ts`), so both are kept.
   */
  readonly unknown15?: number;
  readonly unknown2e?: number;
}

export function readPocketItem(s: Serializer): PocketItemPart {
  const { subVersion } = s.revision;
  let plan: ResourceRef | undefined;
  let unknown15: number | undefined;
  let unknown2e: number | undefined;
  if (subVersion < 0x15) {
    s.str();
    s.u16();
  }
  if (subVersion >= 0x15 && subVersion < 0x14d) unknown15 = s.u16();
  const flags = s.i16();
  if (subVersion >= 0x14 && subVersion < 0x60) plan = s.resource(true);
  if (subVersion >= 0x1e && subVersion < 0x78) s.u8();
  if (subVersion >= 0x2e && subVersion < 0x14d) unknown2e = s.u8();
  if (subVersion >= 0x2e && subVersion < 0x78) s.u8();
  const powerUpType = subVersion > 0x3d ? s.i8() : 0;
  const aimModifier = subVersion > 0x3f ? s.f32() : 0;
  const lifetime = subVersion > 0x55 ? s.i32() : 0;
  return { flags, powerUpType, aimModifier, lifetime, plan, unknown15, unknown2e };
}

/** `readPocketItem`'s mirror; what it reads and drops is written as cwlib writes it, empty and 0. */
export function writePocketItem(w: Writer, p: PocketItemPart, _ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  if (subVersion < 0x15) {
    w.str('');
    w.u16(0);
  }
  if (subVersion >= 0x15 && subVersion < 0x14d) w.u16(p.unknown15 ?? 0);
  w.i16(p.flags);
  if (subVersion >= 0x14 && subVersion < 0x60) w.ref(p.plan, { descriptor: true });
  if (subVersion >= 0x1e && subVersion < 0x78) w.u8(0);
  if (subVersion >= 0x2e && subVersion < 0x14d) w.u8(p.unknown2e ?? 0);
  if (subVersion >= 0x2e && subVersion < 0x78) w.u8(0);
  if (subVersion > 0x3d) w.i8(p.powerUpType);
  if (subVersion > 0x3f) w.f32(p.aimModifier);
  if (subVersion > 0x55) w.i32(p.lifetime);
}
