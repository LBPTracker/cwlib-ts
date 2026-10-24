/** `GAMEPLAY_DATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';

/**
 * `EggLink`: the plan a prize bubble gives.
 *
 * ⚠️ The painting at the end is behind a **bool it reads first**, not a
 * revision gate — `hasPainting` decides whether a resource follows.
 */
function readEggLink(s: Serializer): ResourceRef | undefined {
  const { version } = s.revision;
  const plan = s.resource(); // plan
  if (version > 0x23b) s.bool(); // shareable
  if (version > 0x3e0 && s.bool()) s.resource(true); // painting
  return plan;
}

/** `PGameplayData`: what a Thing is worth when collected. steering/level-files.md, *Prize bubbles*. */
export interface GameplayDataPart {
  /** cwlib's `GameplayPartType`; -1 when the revision has none. */
  readonly gameplayType: number;
  readonly fluffCost: number;
  /** The plan the Thing gives when collected: a prize bubble's prize. */
  readonly prize?: ResourceRef;
}

export function readGameplayData(s: Serializer): GameplayDataPart {
  const { version, subVersion } = s.revision;
  let gameplayType = -1;
  if (subVersion >= 0xef && version > 0x2d0) gameplayType = s.i32();
  const fluffCost = s.s32();
  // A reference: a second Thing naming the same link gets the plan read the first time.
  const prize = s.reference(readEggLink);
  s.reference((self) => {
    self.i32(); // SlotID.slotType
    self.u32(); // SlotID.slotNumber
  });
  if (version >= 0x2d1 && subVersion < 0xef) gameplayType = s.i32();
  if (subVersion >= 0xf3) {
    s.i32(); // treasureType
    s.i16(); // treasureCount
  }
  return { gameplayType, fluffCost, prize: prize ?? undefined };
}
