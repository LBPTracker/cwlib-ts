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
import { readNetworkPlayerIdKept, writeNetworkPlayerId } from '../structs/network.ts';
import { Writer } from '../io/writer.ts';
import { valuesContext } from '../things/encode-things.ts';
import { installWorldReader } from '../things/level.ts';
import { partReaders } from '../things/parts.ts';
import { readThingRef, type Thing } from '../things/thing.ts';

export interface CreatureAvatar {
  /** A creature, by the GUID of its plan. */
  readonly creature: number;
  readonly mainFormCostume?: ResourceRef;
  readonly altFormCostume?: ResourceRef;
  /** Up to subVersion 0x12a: the creature's plan descriptor, which `creature` replaces from 0xc5. Kept to be written back. */
  readonly creaturePlan?: ResourceRef;
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
  /** `playerId`'s `NetworkPlayerID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly playerIdBytes?: Uint8Array;
  /** ⚠️ The Vita's: an integer after the PSN id that cwlib does not read; meaning open. */
  readonly vitaValue?: number;
  readonly creatureToSpawnAs: number;
  readonly spawnAsAlternateForm: boolean;
  readonly creatureToPodAs: number;
  readonly podAsAlternateForm: boolean;
  /** The first `timePlayed`, which cwlib reads and overwrites. Kept to be written back. */
  readonly firstTimePlayed?: number;
  /** Below version 0x193: a Thing array cwlib reads and drops. */
  readonly droppedThings?: readonly (Thing | undefined)[];
  /** Below version 0x13e: a resource cwlib reads and drops. */
  readonly droppedResource?: ResourceRef;
  /** Versions 0x1c5--0x212: an integer cwlib reads and drops. */
  readonly droppedValue?: number;
  /** Up to subVersion 0x12a: the plan descriptors `creatureToSpawnAs` and `creatureToPodAs` replace from 0xc5. */
  readonly creatureToSpawnAsPlan?: ResourceRef;
  readonly creatureToPodAsPlan?: ResourceRef;
}


/** cwlib's `adventureCreatureReference`: a plan descriptor up to subVersion 0x12a, an `s32` from 0xc5. */
function readCreatureReference(s: Serializer): [number, ResourceRef | undefined] {
  const { subVersion } = s.revision;
  let value = 0;
  let plan: ResourceRef | undefined;
  if (subVersion <= 0x12a) {
    plan = s.resource();
    value = plan?.guid ?? 0;
  }
  if (subVersion >= 0xc5) value = s.s32();
  return [value, plan];
}

function writeCreatureReference(w: Writer, value: number, plan: ResourceRef | undefined): void {
  const { subVersion } = w.revision;
  if (subVersion <= 0x12a) w.ref(plan ?? (subVersion >= 0xc5 || value === 0 ? undefined : { guid: value }));
  if (subVersion >= 0xc5) w.s32(value);
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

  const firstTimePlayed = s.i32(); // timePlayed, the first time
  const sackboyAvatarWorld = readThingRef(s, readers);
  const creatureAvatars = subVersion > 0x17
    ? s.array((self): CreatureAvatar => {
      const [creature, creaturePlan] = readCreatureReference(self);
      return {
        creature,
        mainFormCostume: self.resource(true),
        altFormCostume: self.resource(true),
        ...(creaturePlan ? { creaturePlan } : {}),
      };
    })
    : [];
  const droppedThings = version < 0x193 ? s.array((self) => readThingRef(self, readers)) : undefined;
  const droppedResource = version < 0x13e ? s.resource() : undefined;
  const timePlayed = s.i32();
  const uniqueNumber = s.u64Big();
  const colours: number[] = [];
  if (version > 0x163) {
    for (let i = 0; i < 3; i += 1) colours.push(s.i32());
    if (version > 0x3a6) colours.push(s.i32());
  }
  const { handle: playerId, bytes: playerIdBytes } = version > 0x1a7 ? readNetworkPlayerIdKept(s) : { handle: undefined, bytes: undefined };
  const vitaValue = vita >= 0 ? s.i32() : undefined;
  const droppedValue = version > 0x1c4 && version < 0x213 ? s.i32() : undefined;
  const [creatureToSpawnAs, creatureToSpawnAsPlan] = subVersion >= 0x9e ? readCreatureReference(s) : [0, undefined];
  const spawnAsAlternateForm = subVersion >= 0x18a ? s.bool() : false;
  let creatureToPodAs = 0;
  let creatureToPodAsPlan: ResourceRef | undefined;
  let podAsAlternateForm = false;
  if (subVersion >= 0x18d) {
    [creatureToPodAs, creatureToPodAsPlan] = readCreatureReference(s);
    podAsAlternateForm = s.bool();
  }
  if (s.remaining !== 0) {
    throw new SerializerError(`PRFb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, timePlayed, sackboyAvatarWorld, creatureAvatars, uniqueNumber, colours, playerId,
    ...(playerIdBytes ? { playerIdBytes } : {}),
    ...(vitaValue === undefined ? {} : { vitaValue }),
    creatureToSpawnAs, spawnAsAlternateForm, creatureToPodAs, podAsAlternateForm,
    firstTimePlayed,
    ...(droppedThings ? { droppedThings } : {}),
    ...(droppedResource ? { droppedResource } : {}),
    ...(droppedValue === undefined ? {} : { droppedValue }),
    ...(creatureToSpawnAsPlan ? { creatureToSpawnAsPlan } : {}),
    ...(creatureToPodAsPlan ? { creatureToPodAsPlan } : {}),
  };
}

/**
 * `readSyncedProfile`'s mirror: the payload, byte for byte, from the value, its
 * Things by the Thing writer (`encode-things.ts`), each under the id it was read with.
 */
export function encodeSyncedProfile(value: SyncedProfile, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const { version, subVersion } = header.revision;
  const vita = vitaRevision(header.revision);
  const things = valuesContext();
  w.i32(value.firstTimePlayed ?? value.timePlayed);
  things.thing(w, value.sackboyAvatarWorld);
  if (subVersion > 0x17) {
    w.i32(value.creatureAvatars.length);
    for (const a of value.creatureAvatars) {
      writeCreatureReference(w, a.creature, a.creaturePlan);
      w.ref(a.mainFormCostume, { descriptor: true });
      w.ref(a.altFormCostume, { descriptor: true });
    }
  }
  if (version < 0x193) {
    w.i32(value.droppedThings?.length ?? 0);
    for (const thing of value.droppedThings ?? []) things.thing(w, thing);
  }
  if (version < 0x13e) w.ref(value.droppedResource);
  w.i32(value.timePlayed);
  w.u64Big(value.uniqueNumber);
  if (version > 0x163) {
    for (let i = 0; i < 3; i += 1) w.i32(value.colours[i] ?? 0);
    if (version > 0x3a6) w.i32(value.colours[3] ?? 0);
  }
  if (version > 0x1a7) writeNetworkPlayerId(w, value.playerId ?? '', value.playerIdBytes);
  if (vita >= 0) w.i32(value.vitaValue ?? 0);
  if (version > 0x1c4 && version < 0x213) w.i32(value.droppedValue ?? 0);
  if (subVersion >= 0x9e) writeCreatureReference(w, value.creatureToSpawnAs, value.creatureToSpawnAsPlan);
  if (subVersion >= 0x18a) w.bool(value.spawnAsAlternateForm);
  if (subVersion >= 0x18d) {
    writeCreatureReference(w, value.creatureToPodAs, value.creatureToPodAsPlan);
    w.bool(value.podAsAlternateForm);
  }
  return w.done();
}
