/**
 * `RBigProfile` -- magic `BPRb`, a save's own inventory, its creator data
 * labels, its string table and the moon's slots: cwlib's
 * `resources/RBigProfile.java` and the structs it reads (`DataLabel`,
 * `StringLookupTable`, `SortString`, `Challenge`, `Treasure`; ennuo/toolkit
 * `d6a2ef8`).
 *
 * ⚠️ **Ported from Java and proven on no file**: neither the install, its
 * update nor the saves on this machine hold one (steering/java-parity.md). No
 * revision bound is applied: a save's profile is written by the build that
 * saved it.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, vitaRevision, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readSlot, readSlotId, type Slot, type SlotId } from '../structs/slot.ts';
import { readInventoryItem, type InventoryItem } from '../things/parts/poppet-powerup.ts';
import { toHex } from '../io/hex.ts';

/** cwlib's `Revisions.DATALABELS` and `PRODUCTION_BUILD`, and the Vita's. */
const DATALABELS = 0x3ef;
const PRODUCTION_BUILD = 0x3b6;
const D1_DATALABELS = 0x2e;
const D1_NEAR_CHALLENGES = 0x57;
const D1_NEAR_TREASURES = 0x59;
const D1_DOWNLOADED_SLOTS = 0x5a;
const D1_PLANET_DECORATIONS = 0x7b;
const D1_CHALLENGE_LEVEL_TYPE = 0x5b;
const D1_CHALLENGE_SCORE = 0x68;

export interface DataLabel {
  readonly labelIndex: number;
  readonly name: string;
}

export interface SortString {
  readonly lamsKeyID: number;
  readonly string: string;
  readonly index: number;
}

export interface StringLookupTable {
  readonly unsorted: boolean;
  readonly sortEnabled: boolean;
  readonly rawIndexToSortedIndex: readonly number[];
  readonly stringList: readonly SortString[];
}

export interface Challenge {
  readonly challengeID: number;
  readonly challengeStatus: number;
  readonly levelID: number;
  readonly scoreToBeat: number;
  readonly levelType?: number;
  readonly myScore?: number;
  readonly networkOnlineID?: string;
}

export interface Treasure {
  readonly treasureID: number;
  readonly planID: number;
  readonly timestamp: number;
}

export interface BigProfile {
  readonly revision: RevisionInfo;
  readonly inventory: readonly InventoryItem[];
  /** Version above `0x3ea`: SHA-1s, lower-case hex. */
  readonly vitaCrossDependencyHashes?: readonly string[];
  readonly creatorDataLabels?: readonly DataLabel[];
  readonly stringTable: StringLookupTable;
  readonly fromProductionBuild?: boolean;
  readonly myMoonSlots: readonly { readonly id: SlotId; readonly slot: Slot }[];
  /** The Vita's. */
  readonly nearMyChallengeDataLog?: readonly Challenge[];
  readonly nearMyChallengeDataOpen?: readonly Challenge[];
  readonly nearMyTreasureLog?: readonly Treasure[];
  readonly downloadedSlots?: readonly SlotId[];
  /** An `RLevel`, a descriptor. */
  readonly planetDecorations?: ResourceRef;
}

export function readDataLabel(s: Serializer): DataLabel {
  return { labelIndex: s.i32(), name: s.wstr() };
}

export function readStringLookupTable(s: Serializer): StringLookupTable {
  return {
    unsorted: s.bool(),
    sortEnabled: s.bool(),
    rawIndexToSortedIndex: s.intVector(),
    stringList: s.array((x) => ({ lamsKeyID: x.i32(), string: x.wstr(), index: x.i32() })),
  };
}

function readChallenge(s: Serializer): Challenge {
  const vita = vitaRevision(s.revision);
  const challenge = { challengeID: s.i32(), challengeStatus: s.i32(), levelID: s.i32(), scoreToBeat: s.i32() };
  const levelType = vita >= D1_CHALLENGE_LEVEL_TYPE ? s.i32() : undefined;
  if (vita < D1_CHALLENGE_SCORE) return { ...challenge, levelType };
  return { ...challenge, levelType, myScore: s.i32(), networkOnlineID: s.str() };
}

/** Read a `BPRb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readBigProfile(bytes: Uint8Array, inflate: Inflate): Promise<BigProfile> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'BPRb') throw new SerializerError(`not a big profile: "${resource.magic}"`);
  const { version } = revision;
  const inventory = s.array(readInventoryItem);
  let vitaCrossDependencyHashes: string[] | undefined;
  if (version > 0x3ea) {
    // A plain count: cwlib reads it from the stream itself, not through its array helper.
    vitaCrossDependencyHashes = Array.from({ length: s.i32() }, () => toHex(s.sha1()));
  }
  let creatorDataLabels = version >= DATALABELS ? s.array(readDataLabel) : undefined;
  const stringTable = readStringLookupTable(s);
  const fromProductionBuild = version >= PRODUCTION_BUILD ? s.bool() : undefined;
  const moonSlots = s.i32();
  const myMoonSlots = Array.from({ length: moonSlots }, () => ({ id: readSlotId(s), slot: readSlot(s) }));
  const vita = vitaRevision(revision);
  const out: { -readonly [K in keyof BigProfile]: BigProfile[K] } = {
    revision, inventory, vitaCrossDependencyHashes, stringTable, fromProductionBuild, myMoonSlots,
  };
  if (vita >= 0) {
    if (vita >= D1_DATALABELS) creatorDataLabels = s.array(readDataLabel);
    if (vita >= D1_NEAR_CHALLENGES) {
      out.nearMyChallengeDataLog = s.array(readChallenge);
      out.nearMyChallengeDataOpen = s.array(readChallenge);
    }
    if (vita >= D1_NEAR_TREASURES) out.nearMyTreasureLog = s.array((x) => ({ treasureID: x.i32(), planID: x.i32(), timestamp: x.i32() }));
    if (vita >= D1_DOWNLOADED_SLOTS) out.downloadedSlots = s.array(readSlotId);
    if (vita >= D1_PLANET_DECORATIONS) out.planetDecorations = s.resource(true);
  }
  out.creatorDataLabels = creatorDataLabels;
  if (s.remaining !== 0) throw new SerializerError(`BPRb read ended ${s.remaining} bytes before the end of its payload`);
  return out;
}
