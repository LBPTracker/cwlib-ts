/** `GAMEPLAY_DATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';

/**
 * `EggLink`: the plan a prize bubble gives.
 *
 * ⚠️ The painting at the end is behind a **bool it reads first**, not a
 * revision gate — `hasPainting` decides whether a resource follows.
 */
export interface EggLink {
  readonly plan?: ResourceRef;
  /** Version `0x23c` on. */
  readonly shareable?: boolean;
  /** Version `0x3e1` on, when its bool says so: a descriptor. */
  readonly painting?: ResourceRef;
}

function readEggLink(s: Serializer): EggLink {
  const { version } = s.revision;
  const plan = s.resource();
  const shareable = version > 0x23b ? s.bool() : undefined;
  const painting = version > 0x3e0 && s.bool() ? s.resource(true) : undefined;
  return { plan, shareable, painting };
}

/** `PGameplayData`: what a Thing is worth when collected. steering/level-files.md, *Prize bubbles*. */
export interface GameplayDataPart {
  /** cwlib's `GameplayPartType`; -1 when the revision has none. */
  readonly gameplayType: number;
  readonly fluffCost: number;
  /** The plan the Thing gives when collected: a prize bubble's prize. */
  readonly prize?: ResourceRef;
  /** The prize's link: the plan, whether it may be shared, and a painting. */
  readonly eggLink?: EggLink;
  /** The slot the Thing names: cwlib's `SlotID`. */
  readonly slot?: { readonly slotType: number; readonly slotNumber: number };
  readonly treasureType?: number;
  readonly treasureCount?: number;
}

export function readGameplayData(s: Serializer): GameplayDataPart {
  const { version, subVersion } = s.revision;
  let treasureType: number | undefined;
  let treasureCount: number | undefined;
  let gameplayType = -1;
  if (subVersion >= 0xef && version > 0x2d0) gameplayType = s.i32();
  const fluffCost = s.s32();
  // A reference: a second Thing naming the same link gets the plan read the first time.
  const eggLink = s.reference(readEggLink);
  const slot = s.reference((self) => ({ slotType: self.i32(), slotNumber: self.u32() }));
  if (version >= 0x2d1 && subVersion < 0xef) gameplayType = s.i32();
  if (subVersion >= 0xf3) {
    treasureType = s.i32();
    treasureCount = s.i16();
  }
  return { gameplayType, fluffCost, prize: eggLink?.plan, eggLink, slot, treasureType, treasureCount };
}
