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
import { installWorldReader } from '../things/level.ts';
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

/** `PlayedLevelData`: cwlib's `structs/profile/PlayedLevelData.java`, walked. */
function readPlayedLevelData(s: Serializer): void {
  const { version, subVersion } = s.revision;
  readSlotId(s);
  if (version > 0x1fd) s.s64Big(); // lastPlayedTimestamp
  if (version > 0x200) s.array((self) => self.i32()); // localHighScore
  if (version > 0x268 && version < 0x399) {
    s.bool(); // discovered
    s.bool(); // unlocked
  }
  if (version < 0x269) {
    for (let i = 0; i < 3; i += 1) s.i32(); // play, completion and aced counts
  } else {
    for (let i = 0; i < 3; i += 1) s.i16();
  }
  if (version > 0x1c1) {
    s.array((self) => {
      // CollectableData
      self.resource(true); // plan
      self.s32(); // source
    });
  }
  if (version > 0x1e3 && subVersion < 0x106) s.array((self) => self.i32()); // videos
  if (version > 0x363) {
    s.array(readSlotId); // linkedLevels
    s.array(readSlotId); // subLevels
  }
  if (version > 0x265) s.sha1(); // levelHash
  if (version > 0x265 && version < 0x399) s.bool(); // levelHasDLC
  if (version > 0x398) s.i16(); // flags
  if (vitaRevision(s.revision) >= 0) {
    throw new SerializerError('PlayedLevelData on the Vita\'s branch is not ported');
  }
  if (subVersion >= 0x1ad) {
    s.i32(); // bestTime
    s.i16(); // multiplayerCompletionCount
  }
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
  if (subVersion < 0x140) throw new SerializerError('an adventure create profile with inline AdventureData: not ported');
  const sharedData = s.resource(true);
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
  return { revision, slots, adventureId, planetWorld, links, areas, sharedData, photos, startLevel };
}
