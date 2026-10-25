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
import { readSlot, readSlotId, writeSlot, writeSlotId, type Slot, type SlotId } from '../structs/slot.ts';
import { Writer } from '../io/writer.ts';
import { writeAdventureData } from './adventure-shared-data.ts';
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
  /** Above subVersion 0x179: the area's sprite lights and their positions, read before `area`. */
  readonly spriteLights?: readonly (Thing | undefined)[];
  readonly spriteLightPositions?: readonly (readonly [number, number, number])[];
}

/**
 * The bytes each Thing reference here was read from, so the encoder can write
 * it back: there is no writer for a Thing from its value yet. Kept by the
 * object the Thing hangs off -- a profile's `planetWorld`, an area's `area`
 * below 0x187 and its sprite lights, positions and second `area` above 0x179.
 */
const RAW = new WeakMap<object, { planetWorld?: Uint8Array; area?: Uint8Array; tail?: Uint8Array }>();

/** Read `read`, returning the bytes it consumed too. */
function span<T>(s: Serializer, read: () => T): [T, Uint8Array] {
  const start = s.position;
  const value = read();
  return [value, s.data.slice(start, s.position)];
}

/** Write a Thing's kept bytes, or a null reference; a Thing with no bytes cannot be written. */
function writeThingBytes(w: Writer, raw: Uint8Array | undefined, thing: Thing | undefined, what: string): void {
  if (raw) w.bytes(raw);
  else if (!thing) w.i32(0);
  else throw new SerializerError(`${what}: a Thing not read from a file, and there is no Thing writer`);
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
  /** SubVersions 0x71--0x136: the planet's level, read and dropped by cwlib. Kept to be written back. */
  readonly planetLevel?: ResourceRef;
  /** Above subVersion 0x11b: the play data the adventure starts with, read and dropped by cwlib. */
  readonly startingPlayedLevelData?: readonly PlayedLevelData[];
}

function readPlanetArea(s: Serializer, readers: ReadonlyMap<string, PartReader>): PlanetArea {
  const { subVersion } = s.revision;
  let areaId = 0;
  let area: Thing | undefined;
  let mainArea: ResourceRef | undefined;
  let shadowArea: ResourceRef | undefined;
  const raw: { area?: Uint8Array; tail?: Uint8Array } = {};
  if (subVersion > 0x109) areaId = s.s32();
  if (subVersion < 0x187) {
    if (subVersion > 0x109) [area, raw.area] = span(s, () => readThingRef(s, readers));
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
  let spriteLights: (Thing | undefined)[] | undefined;
  let spriteLightPositions: [number, number, number][] | undefined;
  if (subVersion > 0x179) {
    const start = s.position;
    spriteLights = s.array((self) => readThingRef(self, readers));
    const positions = s.i32();
    spriteLightPositions = [];
    for (let i = 0; i < positions; i += 1) spriteLightPositions.push(s.vector3() as [number, number, number]);
    area = readThingRef(s, readers);
    raw.tail = s.data.slice(start, s.position);
  }
  const out: PlanetArea = {
    areaId, area, mainArea, shadowArea, ambienceTrack, ambienceVolume,
    ...(spriteLights ? { spriteLights, spriteLightPositions } : {}),
  };
  RAW.set(out, raw);
  return out;
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
  /** Versions 0x269--0x398: `discovered`, `unlocked` and `levelHasDLC`, which cwlib drops. Kept to be written back. */
  readonly discovered?: boolean;
  readonly unlocked?: boolean;
  readonly levelHasDLC?: boolean;
}

export function readPlayedLevelData(s: Serializer): PlayedLevelData {
  const { version, subVersion } = s.revision;
  const out: { -readonly [K in keyof PlayedLevelData]: PlayedLevelData[K] } = {
    slotId: readSlotId(s), playCount: 0, completionCount: 0, acedCount: 0,
  };
  if (version > 0x1fd) out.lastPlayedTimestamp = s.s64Big();
  if (version > 0x200) out.localHighScore = s.array((self) => self.i32());
  if (version > 0x268 && version < 0x399) {
    out.discovered = s.bool(); // which cwlib drops
    out.unlocked = s.bool(); // likewise
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
  if (version > 0x265 && version < 0x399) out.levelHasDLC = s.bool(); // which cwlib drops
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
  const [planetWorld, planetWorldRaw] = subVersion > 0x137 ? span(s, () => readThingRef(s, readers)) : [undefined, undefined];
  const planetLevel = subVersion >= 0x71 && subVersion < 0x137 ? s.resource(true) : undefined;
  const links = subVersion > 0xd4 ? s.array((self) => ({ from: readSlotId(self), to: readSlotId(self) })) : [];
  const areas = subVersion > 0x109 ? s.array((self) => readPlanetArea(self, readers)) : [];
  const startingPlayedLevelData = subVersion > 0x11b ? s.array(readPlayedLevelData) : undefined;
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
  const out: AdventureCreateProfile = {
    revision, slots, adventureId, planetWorld, links, areas, sharedData, inlineSharedData, photos, startLevel,
    ...(planetLevel ? { planetLevel } : {}),
    ...(startingPlayedLevelData ? { startingPlayedLevelData } : {}),
  };
  RAW.set(out, { planetWorld: planetWorldRaw });
  return out;
}

/** `readPlayedLevelData`'s mirror. */
export function writePlayedLevelData(w: Writer, d: PlayedLevelData): void {
  const { version, subVersion } = w.revision;
  writeSlotId(w, d.slotId);
  if (version > 0x1fd) w.s64Big(d.lastPlayedTimestamp ?? 0n);
  if (version > 0x200) {
    w.i32(d.localHighScore?.length ?? 0);
    for (const score of d.localHighScore ?? []) w.i32(score);
  }
  if (version > 0x268 && version < 0x399) {
    w.bool(d.discovered ?? false);
    w.bool(d.unlocked ?? false);
  }
  const count = (n: number): void => (version < 0x269 ? w.i32(n) : w.i16(n));
  count(d.playCount);
  count(d.completionCount);
  count(d.acedCount);
  if (version > 0x1c1) {
    w.i32(d.collectables?.length ?? 0);
    for (const c of d.collectables ?? []) {
      w.ref(c.plan, { descriptor: true });
      w.s32(c.source);
    }
  }
  if (version > 0x1e3 && subVersion < 0x106) {
    w.i32(d.videos?.length ?? 0);
    for (const v of d.videos ?? []) w.i32(v);
  }
  if (version > 0x363) {
    for (const list of [d.linkedLevels, d.subLevels]) {
      w.i32(list?.length ?? 0);
      for (const id of list ?? []) writeSlotId(w, id);
    }
  }
  if (version > 0x265) w.sha1(d.levelHash ?? new Uint8Array(20));
  if (version > 0x265 && version < 0x399) w.bool(d.levelHasDLC ?? false);
  if (version > 0x398) w.i16(d.flags ?? 0);
  const vita = vitaRevision(w.revision);
  if (vita >= 0x5c) {
    w.i16(d.deferredPlayCount ?? 0);
    w.i16(d.deferredPlayCountUploaded ?? 0);
    if (vita >= 0x61) {
      w.i32(d.uploadedLocalHighScore?.length ?? 0);
      for (const score of d.uploadedLocalHighScore ?? []) w.i32(score);
    }
    if (vita >= 0x72) {
      w.i16(d.goldTrophyCount ?? 0);
      w.i16(d.silverTrophyCount ?? 0);
      w.i16(d.bronzeTrophyCount ?? 0);
    }
  }
  if (subVersion >= 0x1ad) {
    w.i32(d.bestTime ?? 0);
    w.i16(d.multiplayerCompletionCount ?? 0);
  }
}

function writePlanetArea(w: Writer, a: PlanetArea): void {
  const { subVersion } = w.revision;
  const raw = RAW.get(a) ?? {};
  if (subVersion > 0x109) w.s32(a.areaId);
  if (subVersion < 0x187) {
    if (subVersion > 0x109) writeThingBytes(w, raw.area, subVersion > 0x179 ? undefined : a.area, 'a planet area');
  } else {
    w.ref(a.mainArea, { descriptor: true });
    if (subVersion > 0x18b) w.ref(a.shadowArea, { descriptor: true });
  }
  if (subVersion > 0x178) {
    w.s32(a.ambienceTrack);
    w.f32(a.ambienceVolume);
  }
  if (subVersion > 0x179) {
    if (raw.tail) w.bytes(raw.tail);
    else if (!a.area && !a.spriteLights?.length) {
      w.i32(0);
      w.i32(a.spriteLightPositions?.length ?? 0);
      for (const p of a.spriteLightPositions ?? []) w.vector3(p);
      w.i32(0);
    } else throw new SerializerError('a planet area: Things not read from a file, and there is no Thing writer');
  }
}

/**
 * `readAdventureCreateProfile`'s mirror: the payload, byte for byte, from the
 * value. ⚠️ **Its Things -- the planet's world, each area's -- are written from
 * the bytes they were read from**, as there is no writer for a Thing from its
 * value; a profile built afresh can hold none.
 */
export function encodeAdventureCreateProfile(value: AdventureCreateProfile, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const { subVersion } = header.revision;
  if (subVersion > 0x55) {
    w.i32(value.slots.length);
    for (const { id, slot } of value.slots) {
      writeSlotId(w, id);
      writeSlot(w, slot);
    }
    writeSlotId(w, value.adventureId ?? { type: 0, number: 0 });
  }
  if (subVersion > 0x137) writeThingBytes(w, RAW.get(value)?.planetWorld, value.planetWorld, 'the planet world');
  if (subVersion >= 0x71 && subVersion < 0x137) w.ref(value.planetLevel, { descriptor: true });
  if (subVersion > 0xd4) {
    w.i32(value.links.length);
    for (const link of value.links) {
      writeSlotId(w, link.from);
      writeSlotId(w, link.to);
    }
  }
  if (subVersion > 0x109) {
    w.i32(value.areas.length);
    for (const area of value.areas) writePlanetArea(w, area);
  }
  if (subVersion > 0x11b) {
    w.i32(value.startingPlayedLevelData?.length ?? 0);
    for (const d of value.startingPlayedLevelData ?? []) writePlayedLevelData(w, d);
  }
  if (subVersion >= 0xee && subVersion < 0xf1) {
    throw new SerializerError('an adventure create profile with legacy adventure data: cwlib does not read it either');
  }
  if (subVersion < 0x140) {
    writeAdventureData(w, value.inlineSharedData ?? { fixedId: 0, itemPuidCounter: 0, items: [], quests: [], startPoints: [] });
  } else w.ref(value.sharedData, { descriptor: true });
  if (subVersion > 0x174) {
    w.i32(value.photos.length);
    for (const { id, photos } of value.photos) {
      writeSlotId(w, id);
      w.i32(photos.length);
      for (const photo of photos) w.ref(photo, { descriptor: true });
    }
  }
  if (subVersion >= 0x17e) writeSlotId(w, value.startLevel ?? { type: 0, number: 0 });
  return w.done();
}
