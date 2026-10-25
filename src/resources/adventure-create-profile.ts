/**
 * `RAdventureCreateProfile` -- an adventure as its creator builds it: magic
 * `ADCb`, FileDB paths `….adc` (`popit_puzzle_planet.adc`). Its levels' slots,
 * the planet as a world Thing, the links between levels, the planet's areas,
 * the play data it starts with, its shared data and its photos.
 *
 * The walk is cwlib's `resources/RAdventureCreateProfile.java` and the structs
 * it names (ennuo/toolkit `d6a2ef8`); what the game's three prove of it is
 * steering/level-files.md, *Profiles*.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, requireLbp3, vitaRevision, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { readSlot, readSlotId, type Slot, type SlotId } from '../structs/slot.ts';
import { installWorldReader, readAdventureData, type AdventureData } from '../things/level.ts';
import { partReaders } from '../things/parts.ts';
import { readThingRef, type PartReader, type Thing } from '../things/thing.ts';

/** `PlanetArea`: one area of the planet. */
export interface PlanetArea {
  readonly areaId: number;
  /** The area as a Thing below subVersion 0x187, and its world beside the sprite lights above 0x179. */
  readonly area?: Thing;
  readonly mainArea?: ResourceRef;
  readonly shadowArea?: ResourceRef;
  readonly ambienceTrack: number;
  readonly ambienceVolume: number;
}

export interface AdventureCreateProfile {
  readonly revision: RevisionInfo;
  /** Each level of the adventure, by its id. */
  readonly slots: readonly { readonly id: SlotId; readonly slot: Slot }[];
  readonly adventureId?: SlotId;
  /** The planet, a world Thing; from subVersion 0x138. */
  readonly planetWorld?: Thing;
  readonly links: readonly { readonly from: SlotId; readonly to: SlotId }[];
  readonly areas: readonly PlanetArea[];
  /** The `ADSb` beside it, from subVersion 0x140. */
  readonly sharedData?: ResourceRef;
  /**
   * Below subVersion 0x140 the shared data is inline instead, cwlib's
   * `AdventureData`. ⚠️ Ported from Java, proven on no file: the game's three
   * are past it.
   */
  readonly inlineSharedData?: AdventureData;
  /** Each slot's photo plans, from subVersion 0x175. */
  readonly photos: readonly { readonly id: SlotId; readonly photos: readonly (ResourceRef | undefined)[] }[];
  readonly startLevel?: SlotId;
}

function readPlanetArea(s: Serializer, readers: ReadonlyMap<string, PartReader>): PlanetArea {
  const { subVersion } = s.revision;
  let areaId = 0;
  let area: Thing | undefined;
  let mainArea: ResourceRef | undefined;
  let shadowArea: ResourceRef | undefined;
  if (subVersion > 0x109) areaId = s.s32();
  if (subVersion < 0x187) {
    if (subVersion > 0x109) area = readThingRef(s, readers);
  } else {
    mainArea = s.resource(true);
    if (subVersion > 0x18b) shadowArea = s.resource(true);
  }
  let ambienceTrack = 0;
  let ambienceVolume = 0;
  if (subVersion > 0x178) {
    ambienceTrack = s.s32();
    ambienceVolume = s.f32();
  }
  if (subVersion > 0x179) {
    s.array((self) => readThingRef(self, readers)); // spritelights
    const positions = s.i32();
    for (let i = 0; i < positions; i += 1) s.vector3(); // spritelightPositions
    area = readThingRef(s, readers);
  }
  return { areaId, area, mainArea, shadowArea, ambienceTrack, ambienceVolume };
}

/** `PlayedLevelData`: cwlib's `structs/profile/PlayedLevelData.java`, a level's play record. */
export interface PlayedLevelData {
  readonly slotId: SlotId;
  readonly lastPlayedTimestamp?: bigint;
  readonly localHighScore?: readonly number[];
  readonly playCount: number;
  readonly completionCount: number;
  readonly acedCount: number;
  /** `CollectableData`: a plan and where it came from. */
  readonly collectables?: readonly { readonly plan?: ResourceRef; readonly source: number }[];
  readonly videos?: readonly number[];
  readonly linkedLevels?: readonly SlotId[];
  readonly subLevels?: readonly SlotId[];
  readonly levelHash?: Uint8Array;
  readonly flags?: number;
  /** The Vita's, from its revisions 0x5c, 0x61 and 0x72. ⚠️ Ported from Java, proven on no file. */
  readonly deferredPlayCount?: number;
  readonly deferredPlayCountUploaded?: number;
  readonly uploadedLocalHighScore?: readonly number[];
  readonly goldTrophyCount?: number;
  readonly silverTrophyCount?: number;
  readonly bronzeTrophyCount?: number;
  readonly bestTime?: number;
  readonly multiplayerCompletionCount?: number;
}

export function readPlayedLevelData(s: Serializer): PlayedLevelData {
  const { version, subVersion } = s.revision;
  const out: { -readonly [K in keyof PlayedLevelData]: PlayedLevelData[K] } = {
    slotId: readSlotId(s), playCount: 0, completionCount: 0, acedCount: 0,
  };
  if (version > 0x1fd) out.lastPlayedTimestamp = s.s64Big();
  if (version > 0x200) out.localHighScore = s.array((self) => self.i32());
  if (version > 0x268 && version < 0x399) {
    s.bool(); // discovered, which cwlib drops
    s.bool(); // unlocked, likewise
  }
  const count = (): number => (version < 0x269 ? s.i32() : s.i16());
  out.playCount = count();
  out.completionCount = count();
  out.acedCount = count();
  if (version > 0x1c1) out.collectables = s.array((self) => ({ plan: self.resource(true), source: self.s32() }));
  if (version > 0x1e3 && subVersion < 0x106) out.videos = s.array((self) => self.i32());
  if (version > 0x363) {
    out.linkedLevels = s.array(readSlotId);
    out.subLevels = s.array(readSlotId);
  }
  if (version > 0x265) out.levelHash = s.sha1();
  if (version > 0x265 && version < 0x399) s.bool(); // levelHasDLC, which cwlib drops
  if (version > 0x398) out.flags = s.i16();
  // The Vita's fields, cwlib's `D1_DEFERRED_PLAYS` (0x5c), `D1_UPLOADED_HIGH_SCORE`
  // (0x61) and `D1_TROPHIES` (0x72). ⚠️ Ported from Java, proven on no file.
  const vita = vitaRevision(s.revision);
  if (vita >= 0x5c) {
    out.deferredPlayCount = s.i16();
    out.deferredPlayCountUploaded = s.i16();
    if (vita >= 0x61) out.uploadedLocalHighScore = s.array((self) => self.i32());
    if (vita >= 0x72) {
      out.goldTrophyCount = s.i16();
      out.silverTrophyCount = s.i16();
      out.bronzeTrophyCount = s.i16();
    }
  }
  if (subVersion >= 0x1ad) {
    out.bestTime = s.i32();
    out.multiplayerCompletionCount = s.i16();
  }
  return out;
}

/** Read an `ADCb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readAdventureCreateProfile(bytes: Uint8Array, inflate: Inflate): Promise<AdventureCreateProfile> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'ADCb') throw new SerializerError(`not an adventure create profile: "${resource.magic}"`);
  requireLbp3(revision);
  const { subVersion } = revision;
  const readers = partReaders();
  installWorldReader(readers);

  const slots: { id: SlotId; slot: Slot }[] = [];
  let adventureId: SlotId | undefined;
  if (subVersion > 0x55) {
    const count = s.i32();
    for (let i = 0; i < count; i += 1) slots.push({ id: readSlotId(s), slot: readSlot(s) });
    adventureId = readSlotId(s);
  }
  const planetWorld = subVersion > 0x137 ? readThingRef(s, readers) : undefined;
  if (subVersion >= 0x71 && subVersion < 0x137) s.resource(true); // planetLevel
  const links = subVersion > 0xd4 ? s.array((self) => ({ from: readSlotId(self), to: readSlotId(self) })) : [];
  const areas = subVersion > 0x109 ? s.array((self) => readPlanetArea(self, readers)) : [];
  if (subVersion > 0x11b) s.array(readPlayedLevelData); // startingPlayedLevelData
  // ❗ Below subVersion 0x140 the shared data is inline; cwlib reads it there, and
  // refuses 0xee..0xf0 ("legacy adventure data not supported"), as this does.
  if (subVersion >= 0xee && subVersion < 0xf1) {
    throw new SerializerError('an adventure create profile with legacy adventure data: cwlib does not read it either');
  }
  const inlineSharedData = subVersion < 0x140 ? readAdventureData(s) : undefined;
  const sharedData = subVersion < 0x140 ? undefined : s.resource(true);
  const photos = subVersion > 0x174
    ? s.array((self) => {
      const id = readSlotId(self);
      const count = self.i32();
      const list: (ResourceRef | undefined)[] = [];
      for (let i = 0; i < count; i += 1) list.push(self.resource(true));
      return { id, photos: list };
    })
    : [];
  const startLevel = subVersion >= 0x17e ? readSlotId(s) : undefined;
  if (s.remaining !== 0) {
    throw new SerializerError(`ADCb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return { revision, slots, adventureId, planetWorld, links, areas, sharedData, inlineSharedData, photos, startLevel };
}
