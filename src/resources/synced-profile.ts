/**
 * `RSyncedProfile` -- a player's profile as the game syncs it: magic `PRFb`,
 * in a PS3 save. Time played, the Sackboy the player wears (a world Thing),
 * the creature avatars, the player's colours and PSN id.
 *
 * The walk is cwlib's `resources/RSyncedProfile.java` (ennuo/toolkit
 * `d6a2ef8`); the one profile on this machine is what proves it, to its
 * payload's last byte (steering/level-files.md, *Profiles*).
 *
 * ⚠️ **That one is on the Vita's branch** (`0x3e2`, branch revision `0x87`), and
 * it reads to its end only with one more integer after the PSN id than cwlib,
 * which has no Vita gate here. Measured on that file alone, and what the integer
 * is (5,192,869 there) is open.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, requireLbp3, vitaRevision, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readNetworkPlayerId } from '../structs/network.ts';
import { installWorldReader } from '../things/level.ts';
import { partReaders } from '../things/parts.ts';
import { readThingRef, type Thing } from '../things/thing.ts';

export interface CreatureAvatar {
  /** A creature, by the GUID of its plan. */
  readonly creature: number;
  readonly mainFormCostume?: ResourceRef;
  readonly altFormCostume?: ResourceRef;
}

export interface SyncedProfile {
  readonly revision: RevisionInfo;
  /** As cwlib reads it: written twice, and the second wins. */
  readonly timePlayed: number;
  /** The world Thing holding the player's Sackboy. */
  readonly sackboyAvatarWorld?: Thing;
  readonly creatureAvatars: readonly CreatureAvatar[];
  readonly uniqueNumber: bigint;
  /** The player's colours: primary, secondary, tertiary and, from version 0x3a7, emphasis. */
  readonly colours: readonly number[];
  readonly playerId?: string;
  /** ⚠️ The Vita's: an integer after the PSN id that cwlib does not read; meaning open. */
  readonly vitaValue?: number;
  readonly creatureToSpawnAs: number;
  readonly spawnAsAlternateForm: boolean;
  readonly creatureToPodAs: number;
  readonly podAsAlternateForm: boolean;
}

/** cwlib's `adventureCreatureReference`: a plan descriptor up to subVersion 0x12a, an `s32` from 0xc5. */
function readCreatureReference(s: Serializer): number {
  const { subVersion } = s.revision;
  let value = 0;
  if (subVersion <= 0x12a) value = s.resource()?.guid ?? 0;
  if (subVersion >= 0xc5) value = s.s32();
  return value;
}

/** Read a `PRFb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readSyncedProfile(bytes: Uint8Array, inflate: Inflate): Promise<SyncedProfile> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'PRFb') throw new SerializerError(`not a synced profile: "${resource.magic}"`);
  requireLbp3(revision);
  const { version, subVersion } = revision;
  const vita = vitaRevision(revision);
  const readers = partReaders();
  installWorldReader(readers);

  s.i32(); // timePlayed, the first time
  const sackboyAvatarWorld = readThingRef(s, readers);
  const creatureAvatars = subVersion > 0x17
    ? s.array((self): CreatureAvatar => ({
      creature: readCreatureReference(self),
      mainFormCostume: self.resource(true),
      altFormCostume: self.resource(true),
    }))
    : [];
  if (version < 0x193) s.array((self) => readThingRef(self, readers));
  if (version < 0x13e) s.resource();
  const timePlayed = s.i32();
  const uniqueNumber = s.u64Big();
  const colours: number[] = [];
  if (version > 0x163) {
    for (let i = 0; i < 3; i += 1) colours.push(s.i32());
    if (version > 0x3a6) colours.push(s.i32());
  }
  const playerId = version > 0x1a7 ? readNetworkPlayerId(s) : undefined;
  const vitaValue = vita >= 0 ? s.i32() : undefined;
  if (version > 0x1c4 && version < 0x213) s.i32();
  const creatureToSpawnAs = subVersion >= 0x9e ? readCreatureReference(s) : 0;
  const spawnAsAlternateForm = subVersion >= 0x18a ? s.bool() : false;
  let creatureToPodAs = 0;
  let podAsAlternateForm = false;
  if (subVersion >= 0x18d) {
    creatureToPodAs = readCreatureReference(s);
    podAsAlternateForm = s.bool();
  }
  if (s.remaining !== 0) {
    throw new SerializerError(`PRFb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, timePlayed, sackboyAvatarWorld, creatureAvatars, uniqueNumber, colours, playerId,
    ...(vitaValue === undefined ? {} : { vitaValue }),
    creatureToSpawnAs, spawnAsAlternateForm, creatureToPodAs, podAsAlternateForm,
  };
}
