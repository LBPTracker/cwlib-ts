/** `POCKET_ITEM`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';

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
}

export function readPocketItem(s: Serializer): PocketItemPart {
  const { subVersion } = s.revision;
  if (subVersion < 0x15) {
    s.str();
    s.u16();
  }
  if (subVersion >= 0x15 && subVersion < 0x14d) s.u16();
  const flags = s.i16();
  if (subVersion >= 0x14 && subVersion < 0x60) s.resource(true); // plan
  if (subVersion >= 0x1e && subVersion < 0x78) s.u8();
  if (subVersion >= 0x2e && subVersion < 0x14d) s.u8();
  if (subVersion >= 0x2e && subVersion < 0x78) s.u8();
  const powerUpType = subVersion > 0x3d ? s.i8() : 0;
  const aimModifier = subVersion > 0x3f ? s.f32() : 0;
  const lifetime = subVersion > 0x55 ? s.i32() : 0;
  return { flags, powerUpType, aimModifier, lifetime };
}
