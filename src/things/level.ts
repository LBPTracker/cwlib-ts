/**
 * Reading a level far enough to find its music.
 *
 * ## The parse runs to the payload's last byte, and says when it cannot
 *
 * A level's stream is `RLevel` → `worldThing` → that Thing's parts → `PWorld` →
 * `things`, and **everything this project needs is inside `things`**. Once
 * that array is read, `readLevel` goes on -- the rest of `PWorld`, the world
 * Thing's other parts, the rest of `RLevel` (player record, tutorial
 * inventory, adventure data) -- and requires the payload's last byte at the end.
 * Where that does not hold the Things are still returned, and `unreadTail`
 * says why.
 *
 * ❗ **It used to stop at `things`, and a level that "read" proved little**:
 * the array is references, so a part read too short left zero bytes that read
 * as null references and the walk went on. Twelve Vita levels "opened" under
 * part readers that were wrong (steering/level-files.md, *The Vita branch*).
 *
 * ## What cannot be skipped
 *
 * Everything before `things`, and every Thing in it. Parts carry no length and
 * object references expand inline at their first mention, so a part with no
 * reader ends the parse — see `thing.ts`, which also records why the "eight part
 * readers" figure in steering was wrong.
 */

import { magicOf, openSerializer, type Inflate } from '../io/resource.ts';
import { Serializer, SerializerError, requireLbp3, vitaRevision, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';
import { partReaders, type GroupPart, type InstrumentPart, type Microchip, type SequencerPart } from './parts.ts';
import { onLeerdammer, readThingRef, type PartReader, type Thing } from './thing.ts';
import type { PartWriteContext } from './write-parts.ts';
import { lamsKeyId } from '../resources/translation.ts';
import { Tape } from '../io/tape.ts';
import { Writer } from '../io/writer.ts';
import { toHex } from '../io/hex.ts';
import { readSlotId, writeSlotId, type SlotId } from '../structs/slot.ts';
import { readNetworkIds, writeNetworkIds } from '../structs/network.ts';
import { readInventoryItemDetails, writeInventoryItemDetails, type InventoryItemDetails } from '../structs/inventory.ts';
import { readInventoryItem, writeInventoryItem, type InventoryItem } from './parts/poppet-powerup.ts';
import { thingArray, writeThingArray } from './parts/common.ts';

/** `StreamingID`: a wide string and a type. */
export interface StreamingId {
  readonly name: string;
  readonly type: number;
}

function readStreamingId(s: Serializer): StreamingId {
  return { name: s.wstr(), type: s.i32() };
}

function writeStreamingId(w: Writer, id: StreamingId | undefined): void {
  w.wstr(id?.name ?? '');
  w.i32(id?.type ?? 0);
}

type Vector3 = readonly [number, number, number];
type Vector4 = readonly [number, number, number, number];
const ZERO3: Vector3 = [0, 0, 0];
const ZERO4: Vector4 = [0, 0, 0, 0];

function writeArray<T>(w: Writer, values: readonly T[] | undefined, write: (self: Writer, value: T) => void): void {
  w.i32(values?.length ?? 0);
  for (const value of values ?? []) write(w, value);
}

/** A count and that many Things, by reference. */
function writeThingList(w: Writer, things: readonly (Thing | undefined)[] | undefined, ctx: PartWriteContext): void {
  w.i32(things?.length ?? 0);
  for (const thing of things ?? []) ctx.thing(w, thing);
}

/**
 * The streaming structs below carry cwlib's subVersion gates
 * (`structs/streaming/`). ⚠️ They were written for the PS3 saves at `0x213`,
 * past every gate, and read LBP3 PS4's own `0x12c` story chunks wrong until
 * the gates were put in -- steering/level-files.md, *Streaming levels*.
 */

/** `StreamingCheckpoint`. */
export interface StreamingCheckpoint {
  readonly type?: number;
  readonly position?: Vector3;
  readonly startPointName?: StreamingId;
  readonly slotId?: SlotId;
  /** subVersion 0x116..0x128: an `s32` cwlib does not name. */
  readonly unknown?: number;
}

function readStreamingCheckpoint(s: Serializer): StreamingCheckpoint {
  const { subVersion } = s.revision;
  const out: { -readonly [K in keyof StreamingCheckpoint]: StreamingCheckpoint[K] } = {};
  if (subVersion > 0x72) {
    out.type = s.i32();
    out.position = s.vector3();
  }
  if (subVersion > 0xdc) out.startPointName = readStreamingId(s);
  if (subVersion >= 0x13b) out.slotId = readSlotId(s);
  if (subVersion > 0x115 && subVersion <= 0x128) out.unknown = s.s32();
  return out;
}

function writeStreamingCheckpoint(w: Writer, v: StreamingCheckpoint): void {
  const { subVersion } = w.revision;
  if (subVersion > 0x72) {
    w.i32(v.type ?? 0);
    w.vector3(v.position ?? ZERO3);
  }
  if (subVersion > 0xdc) writeStreamingId(w, v.startPointName);
  if (subVersion >= 0x13b) writeSlotId(w, v.slotId ?? { type: 0, number: 0 });
  if (subVersion > 0x115 && subVersion <= 0x128) w.s32(v.unknown ?? 0);
}

/** `QuestTracker`. */
export interface QuestTracker {
  readonly position?: Vector3;
  readonly questId?: StreamingId;
  readonly objectiveId?: StreamingId;
  readonly questKey?: number;
  readonly objectiveKey?: number;
}

function readQuestTracker(s: Serializer): QuestTracker {
  const { subVersion } = s.revision;
  const out: { -readonly [K in keyof QuestTracker]: QuestTracker[K] } = {};
  if (subVersion > 0xeb) {
    out.position = s.vector3();
    out.questId = readStreamingId(s);
  }
  if (subVersion > 0xf3) out.objectiveId = readStreamingId(s);
  if (subVersion > 0x140) {
    out.questKey = s.i32();
    out.objectiveKey = s.i32();
  }
  return out;
}

function writeQuestTracker(w: Writer, v: QuestTracker): void {
  const { subVersion } = w.revision;
  if (subVersion > 0xeb) {
    w.vector3(v.position ?? ZERO3);
    writeStreamingId(w, v.questId);
  }
  if (subVersion > 0xf3) writeStreamingId(w, v.objectiveId);
  if (subVersion > 0x140) {
    w.i32(v.questKey ?? 0);
    w.i32(v.objectiveKey ?? 0);
  }
}

/** `QuestSwitch`. */
export interface QuestSwitch {
  readonly questId?: StreamingId;
  readonly questAction?: number;
  readonly questKey?: number;
  readonly objectiveId?: number;
}

function readQuestSwitch(s: Serializer): QuestSwitch {
  const { subVersion } = s.revision;
  const out: { -readonly [K in keyof QuestSwitch]: QuestSwitch[K] } = {};
  if (subVersion > 0x118) {
    out.questId = readStreamingId(s);
    out.questAction = s.i32();
  }
  if (subVersion > 0x140) out.questKey = s.i32();
  if (subVersion > 0x17a) out.objectiveId = s.i32();
  return out;
}

function writeQuestSwitch(w: Writer, v: QuestSwitch): void {
  const { subVersion } = w.revision;
  if (subVersion > 0x118) {
    writeStreamingId(w, v.questId);
    w.i32(v.questAction ?? 0);
  }
  if (subVersion > 0x140) w.i32(v.questKey ?? 0);
  if (subVersion > 0x17a) w.i32(v.objectiveId ?? 0);
}

/** `CollectableData`: empty below version 0x1c2. */
export interface CollectableData {
  readonly plan?: ResourceRef;
  readonly source?: number;
}

function readCollectableData(s: Serializer): CollectableData {
  if (s.revision.version < 0x1c2) return {};
  return { plan: s.resource(true), source: s.s32() };
}

function writeCollectableData(w: Writer, v: CollectableData): void {
  if (w.revision.version < 0x1c2) return;
  w.ref(v.plan, { descriptor: true });
  w.s32(v.source ?? 0);
}

/** The four lists a `ChunkFile` and a `StreamingIsland` share. */
export interface StreamingLists {
  readonly checkpoints?: readonly StreamingCheckpoint[];
  readonly questTrackers?: readonly QuestTracker[];
  readonly questSwitches?: readonly QuestSwitch[];
  readonly collectables?: readonly CollectableData[];
}

/** The GUIDs and hashes a chunk depends on, from subVersion 0x16a. */
export interface DependencyLists {
  readonly guids?: readonly number[];
  readonly hashes?: readonly Uint8Array[];
}

/**
 * One `ChunkFile` of a streaming level: which chunk, and the box it fills in
 * the level's world. steering/level-files.md, *The story levels' chunks*.
 */
export interface ChunkPlacement {
  /** The `CHKb`'s SHA-1, lower-case hex. */
  readonly sha1: string;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** The chunk files each stream has read so far, collected for `readLevel` to hand out. */
const chunkFiles = new WeakMap<Serializer, ChunkPlacement[]>();

/** `ChunkFile`, every field: what `writeChunkFile` writes back. */
export interface ChunkFile extends StreamingLists, DependencyLists {
  /** From subVersion 0x131 a bare SHA-1; from 0x73 a descriptor. */
  readonly chunkHash?: Uint8Array;
  readonly chunkDescriptor?: ResourceRef;
  /** From subVersion 0xde: descriptors, each with its type inline. */
  readonly userResources?: readonly { readonly ref?: ResourceRef; readonly type: number }[];
  readonly min?: Vector3;
  readonly max?: Vector3;
  readonly hasObjectSaver?: boolean;
  readonly deleteObjectSavers?: boolean;
  readonly deleteOtherThings?: boolean;
  readonly antiStreaming?: boolean;
}

/**
 * `ChunkFile`: one streamed piece of a level, and where it sits.
 *
 * ❗ **This is the whole reason a streaming level would not open.** An LBP3
 * adventure is cut into chunks and `LevelData.chunkFileList` names them;
 * `emptyOnly` refused any non-empty list, which was right for the ten-level
 * corpus it was written against and wrong for two of the five PS3 saves.
 *
 * ⚠️ **The chunk's Things are NOT in here.** `chunkHash` is the SHA-1 of a
 * separate `RStreamingChunk` resource, so what this recovers is the level's
 * skeleton -- its bounds, checkpoints and quests -- and the Things are in the
 * file it names, which `readChunk` reads. Question 26 in
 * `steering/answered-questions.md` has how following the hash was settled.
 */
function readChunkFile(s: Serializer): ChunkFile {
  const { subVersion } = s.revision;
  const out: { -readonly [K in keyof ChunkFile]: ChunkFile[K] } = {};
  let sha1 = '';
  if (subVersion > 0x130) {
    const start = s.position;
    const hash = s.sha1();
    s.tape?.mark('chunkHash', start, s.position, { guid: 0, hash });
    sha1 = toHex(hash);
    out.chunkHash = hash.slice();
  }
  else if (subVersion >= 0x73) {
    const ref = s.resource(true); // chunkHash, as a descriptor
    if (ref?.hash) sha1 = toHex(ref.hash);
    out.chunkDescriptor = ref;
  }
  Object.assign(out, readStreamingLists(s));
  if (subVersion >= 0xde) {
    // `userResources`: descriptors that carry their type inline.
    const resources = s.count();
    const list: { ref?: ResourceRef; type: number }[] = [];
    for (let i = 0; i < resources; i += 1) {
      const ref = s.resource(true, false, false);
      list.push({ ref, type: s.i32() });
    }
    out.userResources = list;
  }
  if (subVersion > 0x72) {
    const min = s.vector3();
    const max = s.vector3();
    out.min = min;
    out.max = max;
    const placed = chunkFiles.get(s) ?? [];
    placed.push({ sha1, min, max });
    chunkFiles.set(s, placed);
  }
  if (subVersion > 0x10d) {
    out.hasObjectSaver = s.bool();
    out.deleteObjectSavers = s.bool();
    out.deleteOtherThings = s.bool();
  }
  if (subVersion > 0x133) out.antiStreaming = s.bool();
  Object.assign(out, readDependencyLists(s)); // the GUIDs and hashes this chunk depends on
  return out;
}

function writeChunkFile(w: Writer, v: ChunkFile): void {
  const { subVersion } = w.revision;
  if (subVersion > 0x130) w.sha1(v.chunkHash ?? new Uint8Array(20));
  else if (subVersion >= 0x73) w.ref(v.chunkDescriptor, { descriptor: true });
  writeStreamingLists(w, v);
  if (subVersion >= 0xde) {
    writeArray(w, v.userResources, (self, r) => {
      self.ref(r.ref, { descriptor: true, classPointer: false });
      self.i32(r.type);
    });
  }
  if (subVersion > 0x72) {
    w.vector3(v.min ?? ZERO3);
    w.vector3(v.max ?? ZERO3);
  }
  if (subVersion > 0x10d) {
    w.bool(v.hasObjectSaver ?? false);
    w.bool(v.deleteObjectSavers ?? false);
    w.bool(v.deleteOtherThings ?? false);
  }
  if (subVersion > 0x133) w.bool(v.antiStreaming ?? false);
  writeDependencyLists(w, v);
}

/** `LevelData`, every field. */
export interface LevelData {
  readonly slot: SlotId;
  readonly type: number;
  /** Absent on a type-2 LevelData, which has no list. */
  readonly chunkFiles?: readonly (ChunkFile | undefined)[];
  readonly offset: Vector3;
  readonly min: Vector3;
  readonly max: Vector3;
  readonly parent?: LevelData;
  /** subVersion 0x1ac on. */
  readonly farcGuid?: number;
}

/** `LevelData`: the PS3 saves at subVersion 0x213, LBP3 PS4's own levels at 0x19f..0x1ab. */
function readLevelData(s: Serializer): LevelData {
  const slot = readSlotId(s);
  const type = s.i32();
  // ❗ **A type-2 LevelData has no chunk list**: its type is followed straight
  // by the offset. Not in cwlib, whose reader fails on these files too; measured
  // on LBP3 PS4's own story levels, where a second LevelData of type 2 follows
  // the main one and the walk ends right only without the list
  // (steering/level-files.md, *Streaming levels*).
  const files = type !== 2 ? s.references(readChunkFile) : undefined;
  const offset = s.vector3();
  const min = s.vector3();
  const max = s.vector3();
  const parent = s.reference(readLevelData);
  // ⚠️ The gate was in this comment and not in the code for a month: LBP3's own
  // story levels are subVersion 0x1ab, one below it, and every one of them
  // failed a Thing marker 100 KB later (steering/answered-questions.md).
  const farcGuid = s.revision.subVersion >= 0x1ac ? s.guid() : undefined;
  return { slot, type, ...(files ? { chunkFiles: files } : {}), offset, min, max, parent, farcGuid };
}

function writeLevelData(w: Writer, v: LevelData): void {
  writeSlotId(w, v.slot);
  w.i32(v.type);
  if (v.type !== 2) w.references(v.chunkFiles ?? [], writeChunkFile);
  w.vector3(v.offset);
  w.vector3(v.min);
  w.vector3(v.max);
  w.reference(v.parent, writeLevelData);
  if (w.revision.subVersion >= 0x1ac) w.guid(v.farcGuid ?? 0);
}

/** `StreamingManager`, every field. */
export interface StreamingManager {
  /** The Things being edited when the level was saved: cwlib's `thingarray`. */
  readonly editingThingsList?: readonly (Thing | undefined)[];
  readonly levels: readonly (LevelData | undefined)[];
  readonly numIslands: number;
  readonly numPendingIslands?: number;
  readonly fartDesc?: ResourceRef;
  readonly startingPointPosition: Vector3;
  readonly streamingZoneShape?: number;
  readonly streamingZoneSize?: number;
  readonly numInUsePlans?: number;
  readonly maintainIslandsCount?: number;
}

/** `StreamingManager`: the PS3 saves at subVersion 0x213, LBP3 PS4's own levels at 0x19f..0x1ab. */
function readStreamingManager(s: Serializer, readers: ReadonlyMap<string, PartReader>): StreamingManager {
  // ❗ **Not always empty**: 5 of the archive's LBP3 levels at subVersions
  // 0x20c and 0x218 hold 1 to 647 Things here, which cwlib reads as a Thing
  // array. cwlib cannot open those levels for another reason.
  const editingThingsList = thingArray(s, readers);
  const count = s.count();
  const levels: (LevelData | undefined)[] = [];
  for (let i = 0; i < count; i += 1) levels.push(s.reference(readLevelData));
  const { subVersion } = s.revision;
  const numIslands = s.i32();
  const numPendingIslands = subVersion > 0x1ff ? s.i32() : undefined;
  const fartDesc = s.resource(true); // a descriptor
  const startingPointPosition = s.vector3();
  const out: { -readonly [K in keyof StreamingManager]: StreamingManager[K] } = {
    levels, numIslands, numPendingIslands, fartDesc, startingPointPosition,
    ...(editingThingsList.length > 0 ? { editingThingsList } : {}),
  };
  // ⚠️ From subVersion 0x160, as cwlib has it: below, the walk read three integers out
  // of what follows (`stitchem_manor.bin` at 0x130, `game_outro.bin` at 0x151), which
  // showed only once `readLevel` read to the end.
  if (subVersion >= 0x160) {
    out.streamingZoneShape = s.i32();
    out.streamingZoneSize = s.i32();
    out.numInUsePlans = s.i32();
    if (subVersion >= 0x1a9) out.maintainIslandsCount = s.i32();
  }
  return out;
}

function writeStreamingManager(w: Writer, v: StreamingManager, ctx: PartWriteContext): void {
  const { subVersion } = w.revision;
  writeThingArray(w, ctx, v.editingThingsList);
  w.references(v.levels, writeLevelData);
  w.i32(v.numIslands);
  if (subVersion > 0x1ff) w.i32(v.numPendingIslands ?? 0);
  w.ref(v.fartDesc, { descriptor: true });
  w.vector3(v.startingPointPosition);
  if (subVersion >= 0x160) {
    w.i32(v.streamingZoneShape ?? 0);
    w.i32(v.streamingZoneSize ?? 0);
    w.i32(v.numInUsePlans ?? 0);
    if (subVersion >= 0x1a9) w.i32(v.maintainIslandsCount ?? 0);
  }
}

/**
 * The four lists and the dependency lists a `ChunkFile` and a
 * `StreamingIsland` share, under cwlib's `ChunkFile` gates: below `0x16a` an
 * island ends after its collectables (the `0x12c` story chunks).
 */
function readStreamingLists(s: Serializer): StreamingLists {
  const { subVersion } = s.revision;
  const out: { -readonly [K in keyof StreamingLists]: StreamingLists[K] } = {};
  if (subVersion > 0x72) out.checkpoints = s.array(readStreamingCheckpoint);
  if (subVersion > 0xeb) out.questTrackers = s.array(readQuestTracker);
  if (subVersion > 0x118) out.questSwitches = s.array(readQuestSwitch);
  if (subVersion > 0x11d) out.collectables = s.array(readCollectableData);
  return out;
}

function writeStreamingLists(w: Writer, v: StreamingLists): void {
  const { subVersion } = w.revision;
  if (subVersion > 0x72) writeArray(w, v.checkpoints, writeStreamingCheckpoint);
  if (subVersion > 0xeb) writeArray(w, v.questTrackers, writeQuestTracker);
  if (subVersion > 0x118) writeArray(w, v.questSwitches, writeQuestSwitch);
  if (subVersion > 0x11d) writeArray(w, v.collectables, writeCollectableData);
}

function readDependencyLists(s: Serializer): DependencyLists {
  if (s.revision.subVersion <= 0x169) return {};
  const guidCount = s.count();
  const guids: number[] = [];
  for (let i = 0; i < guidCount; i += 1) guids.push(s.guid());
  const hashCount = s.count();
  const hashes: Uint8Array[] = [];
  for (let i = 0; i < hashCount; i += 1) hashes.push(s.sha1().slice());
  return { guids, hashes };
}

function writeDependencyLists(w: Writer, v: DependencyLists): void {
  if (w.revision.subVersion <= 0x169) return;
  writeArray(w, v.guids, (self, guid) => self.guid(guid));
  writeArray(w, v.hashes, (self, hash) => self.sha1(hash));
}

/** `EggLink`, inline in `PWorld`'s reward lists. */
export interface WorldEggLink {
  /** Below version 0x160 a `GlobalThingDescriptor`: a level's descriptor and a Thing's UID in it. */
  readonly level?: ResourceRef;
  readonly uid?: number;
  /** From version 0x160. */
  readonly plan?: ResourceRef;
  /** Versions 0x160..0x196. */
  readonly details?: InventoryItemDetails;
  /** Versions 0x208..0x229: a bool cwlib does not name. */
  readonly unknown?: boolean;
  readonly shareable?: boolean;
  /** Above version 0x3e0: whether a painting follows, and the painting -- a flag can stand before a null one. */
  readonly hasPainting?: boolean;
  readonly painting?: ResourceRef;
}

/** `EggLink`, inline in `PWorld`'s reward lists: a plan, a bool, and an optional painting. */
function readEggLink(s: Serializer): WorldEggLink {
  const { version } = s.revision;
  const out: { -readonly [K in keyof WorldEggLink]: WorldEggLink[K] } = {};
  if (version < 0x160) {
    out.level = s.resource(true, false, false); // item: a GlobalThingDescriptor's level
    out.uid = s.i32(); // and the Thing's UID in it
  } else out.plan = s.resource(false, false, false); // plan
  if (version > 0x15f && version < 0x197) out.details = readInventoryItemDetails(s);
  if (version > 0x207 && version < 0x22a) out.unknown = s.bool();
  if (version > 0x23b) out.shareable = s.bool();
  if (version > 0x3e0) {
    out.hasPainting = s.bool();
    if (out.hasPainting) out.painting = s.resource(true);
  }
  return out;
}

function writeEggLink(w: Writer, v: WorldEggLink): void {
  const { version } = w.revision;
  if (version < 0x160) {
    w.ref(v.level, { descriptor: true, classPointer: false });
    w.i32(v.uid ?? 0);
  } else w.ref(v.plan, { classPointer: false });
  if (version > 0x15f && version < 0x197) {
    if (!v.details) throw new SerializerError('an EggLink at this version needs its inventory details');
    writeInventoryItemDetails(w, v.details);
  }
  if (version > 0x207 && version < 0x22a) w.bool(v.unknown ?? false);
  if (version > 0x23b) w.bool(v.shareable ?? false);
  if (version > 0x3e0) {
    const has = v.hasPainting ?? v.painting !== undefined;
    w.bool(has);
    if (has) w.ref(v.painting, { descriptor: true });
  }
}

/** `KeyLink`: a slot, and below version 0x16f an `i32` cwlib does not name. */
export interface KeyLink {
  readonly slot: SlotId;
  readonly unknown?: number;
}

function readKeyLink(s: Serializer): KeyLink {
  const slot = readSlotId(s);
  return s.revision.version < 0x16f ? { slot, unknown: s.i32() } : { slot };
}

function writeKeyLink(w: Writer, v: KeyLink): void {
  writeSlotId(w, v.slot);
  if (w.revision.version < 0x16f) w.i32(v.unknown ?? 0);
}

/** LEERDAMMER's revisions for the water: `LD_WATER_WAVE` and `LD_WATER_BITS` in cwlib's `Revisions`. */
const LEERDAMMER = 0x4c44;
const LD_WATER_WAVE = 0x4;
const LD_WATER_BITS = 0x7;

/** `GlobalSettings`: five factors, and on the Vita from its revision 0x78 `nonLinearFog`. */
export interface GlobalSettings {
  readonly factors: readonly number[];
  readonly nonLinearFog?: boolean;
}

function readGlobalSettings(s: Serializer): GlobalSettings {
  const factors = [s.f32(), s.f32(), s.f32(), s.f32(), s.f32()];
  return vitaRevision(s.revision) >= 0x78 ? { factors, nonLinearFog: s.bool() } : { factors };
}

function writeGlobalSettings(w: Writer, v: GlobalSettings | undefined): void {
  for (let i = 0; i < 5; i += 1) w.f32(v?.factors[i] ?? 0);
  if (vitaRevision(w.revision) >= 0x78) w.bool(v?.nonLinearFog ?? false);
}

/** `MoveCursor`, every field. */
export interface MoveCursor {
  readonly selectionFrame?: number;
  readonly switchThing?: Thing;
  readonly selection?: Thing;
  readonly localPosition: Vector4;
  readonly localAngle: number;
  /** Below version 0x3c2, two vectors cwlib does not name, and one more after `moveGrabbing`. */
  readonly old?: readonly [Vector4, Vector4];
  readonly moveAngle: Vector4;
  /** Above version 0x3c1: lastRCStart, lastRCDir, currRCStart, currRCDir. */
  readonly rays?: readonly Vector4[];
  readonly lastRoll?: number;
  readonly currRoll?: number;
  readonly prevMoveGrabbing: boolean;
  readonly moveGrabbing: boolean;
  readonly oldAfter?: Vector4;
  /** `zMovePos`, or the old layout's trailing float. */
  readonly zMovePos: number;
  readonly globalCursorPlayer?: number;
  readonly cursorPlayerThing?: Thing;
  readonly globalCursorPanel?: number;
  readonly thingUnderCursor?: number;
  readonly thingUnderCursorChangedWhileDown?: boolean;
  readonly lastTouchPanel?: number;
  readonly lastTouchId?: number;
}

/** `MoveCursor`, in `PWorld` only below subVersion 0x118. */
function readMoveCursor(s: Serializer, readers: ReadonlyMap<string, PartReader>): MoveCursor {
  const { version } = s.revision;
  const selectionFrame = version > 0x3c1 ? s.i32() : undefined;
  const switchThing = readThingRef(s, readers);
  const selection = readThingRef(s, readers);
  const localPosition = s.vector4();
  const localAngle = s.f32();
  const old = version < 0x3c2 ? [s.vector4(), s.vector4()] as const : undefined;
  const moveAngle = s.vector4();
  let rays: Vector4[] | undefined;
  let lastRoll: number | undefined;
  let currRoll: number | undefined;
  if (version > 0x3c1) {
    rays = [s.vector4(), s.vector4(), s.vector4(), s.vector4()];
    lastRoll = s.f32();
    currRoll = s.f32();
  }
  const prevMoveGrabbing = s.bool();
  const moveGrabbing = s.bool();
  const oldAfter = version < 0x3c2 ? s.vector4() : undefined;
  const zMovePos = s.f32();
  const out: { -readonly [K in keyof MoveCursor]: MoveCursor[K] } = {
    selectionFrame, switchThing, selection, localPosition, localAngle, old, moveAngle, rays, lastRoll, currRoll,
    prevMoveGrabbing, moveGrabbing, oldAfter, zMovePos,
  };
  const vita = vitaRevision(s.revision);
  if (vita >= 0x1b) out.globalCursorPlayer = s.i32();
  if (vita >= 0x42) out.cursorPlayerThing = readThingRef(s, readers);
  if (vita >= 0x6d) out.globalCursorPanel = s.s32();
  if (vita >= 0x82) {
    out.thingUnderCursor = s.i32();
    out.thingUnderCursorChangedWhileDown = s.bool();
    out.lastTouchPanel = s.i32();
    out.lastTouchId = s.s32();
  }
  return out;
}

function writeMoveCursor(w: Writer, v: MoveCursor, ctx: PartWriteContext): void {
  const { version } = w.revision;
  if (version > 0x3c1) w.i32(v.selectionFrame ?? 0);
  ctx.thing(w, v.switchThing);
  ctx.thing(w, v.selection);
  w.vector4(v.localPosition);
  w.f32(v.localAngle);
  if (version < 0x3c2) {
    w.vector4(v.old?.[0] ?? ZERO4);
    w.vector4(v.old?.[1] ?? ZERO4);
  }
  w.vector4(v.moveAngle);
  if (version > 0x3c1) {
    for (let i = 0; i < 4; i += 1) w.vector4(v.rays?.[i] ?? ZERO4);
    w.f32(v.lastRoll ?? 0);
    w.f32(v.currRoll ?? 0);
  }
  w.bool(v.prevMoveGrabbing);
  w.bool(v.moveGrabbing);
  if (version < 0x3c2) w.vector4(v.oldAfter ?? ZERO4);
  w.f32(v.zMovePos);
  const vita = vitaRevision(w.revision);
  if (vita >= 0x1b) w.i32(v.globalCursorPlayer ?? 0);
  if (vita >= 0x42) ctx.thing(w, v.cursorPlayerThing);
  if (vita >= 0x6d) w.s32(v.globalCursorPanel ?? 0);
  if (vita >= 0x82) {
    w.i32(v.thingUnderCursor ?? 0);
    w.bool(v.thingUnderCursorChangedWhileDown ?? false);
    w.i32(v.lastTouchPanel ?? 0);
    w.s32(v.lastTouchId ?? 0);
  }
}

/** `EditorSelection`: a name and its Things. */
export interface EditorSelection {
  readonly name: string;
  readonly things: readonly (Thing | undefined)[];
}

/** A trophy tier of the Vita's world: its rewards and unlocks. */
export interface VitaTrophyTier {
  readonly rewards: readonly WorldEggLink[];
  readonly unlocks: readonly KeyLink[];
}

/**
 * `PWorld` after `things`, every field `readWorldTail` reads, each present
 * where its gate is open. Named as cwlib names them; the few it does not name
 * are `unknown…` after the version they sit at.
 */
export interface WorldTail {
  maxVel?: number;
  maxAVel?: number;
  frame?: number;
  simFrame?: number;
  frameLevelStarted?: number;
  thingUIDCounter?: number;
  randy?: number;
  /** Below version 0x1a4: six floats and an `i32`, and below 0x14b a list of Things. */
  old1a4?: { readonly floats: readonly number[]; readonly int: number; readonly things?: readonly (Thing | undefined)[] };
  selections?: readonly (EditorSelection | undefined)[];
  backdrop?: Thing;
  backdropNew?: Thing;
  backdropTimer?: number;
  lbp2NightDaySwapped?: number;
  isPaused?: boolean;
  lightingFactor?: number;
  colorCorrectionFactor?: number;
  fogFactor?: number;
  fogTintFactor?: number;
  darknessFactor?: number;
  nonLinearFog?: boolean;
  completeRewards?: readonly WorldEggLink[];
  collectRewards?: readonly WorldEggLink[];
  aceRewards?: readonly WorldEggLink[];
  areRewardsShareable?: boolean;
  scoreboardLevelLinkSlot?: SlotId;
  /** The complete, collect and ace unlocks. */
  unlocks?: readonly (readonly KeyLink[])[];
  vitaUnlocks?: readonly WorldEggLink[];
  vitaRewards?: readonly WorldEggLink[];
  timeRequired?: number;
  /** Gold, silver, bronze. */
  trophyTiers?: readonly VitaTrophyTier[];
  trophyConditionTypes?: readonly number[];
  trophyRequirements?: readonly { readonly score: number; readonly time: number; readonly livesLost: number }[];
  /** enableAcing, and the gold, silver and bronze trophies. */
  trophyFlags?: readonly boolean[];
  enforceMinMaxPlayers?: boolean;
  /** Versions 0x16f..0x1be: three `i32`s. */
  old16f?: readonly number[];
  spawnsPerPlayer?: number;
  deathCount?: number;
  maxNumPlayers?: number;
  dissolvingThings?: readonly (Thing | undefined)[];
  oldDissolvingThings?: readonly (Thing | undefined)[];
  isTutorialLevel?: boolean;
  everSpawned?: boolean;
  spawnFailureCount?: number;
  targetGlobalSettings?: GlobalSettings;
  fromGlobalSettings?: GlobalSettings;
  globalSettingsBlendFactor?: number;
  hasLevelLightingBeenSetup?: boolean;
  globalSettingsThingUID?: number;
  cameraSettings?: readonly number[];
  waterLevel?: number;
  fromWaterLevel?: number;
  targetWaterLevel?: number;
  /** Current, from, target. */
  waterWaveMagnitude?: readonly number[];
  gravity?: readonly number[];
  currGlobalSettingsBlendFactors?: readonly number[];
  globalSettingsThingUIDs?: readonly number[];
  globalSettingsThingPriority?: readonly number[];
  waterColor?: number;
  waterBrightness?: number;
  waterTint?: number;
  fromWaterTintColor?: Vector4;
  targetWaterTint?: number;
  waterMurkiness?: readonly number[];
  waterBits?: readonly number[];
  waterDrainSoundsEnabled?: boolean;
  currWaterDrainSoundsEnabled?: boolean;
  waterCausticsEnabled?: boolean;
  currWaterCausticsEnabled?: boolean;
  /** The water's main and hint colours, each current, from, target. */
  waterColors?: readonly number[];
  /** subVersion 0xf8..0x188: a bool cwlib does not name. */
  unknownF8?: boolean;
  backdropEnabled?: boolean;
  currBackdropEnabled?: boolean;
  currWavePos?: number;
  /** Versions 0x289..0x29b: a float and a bool. */
  old289?: { readonly float: number; readonly bool: boolean };
  gameMode?: number;
  gameModeRequested?: number;
  nextSackbotPlayerNumber?: number;
  cutscene?: {
    readonly state: number;
    readonly currentCutSceneCamera?: Thing;
    readonly timeInCurrentCamera: number;
    readonly endCountdown: number;
    readonly transitionStage: number;
    readonly old?: readonly { readonly bool: boolean; readonly a: Vector3; readonly float: number; readonly b: Vector3 }[];
    readonly currentCameraTweaking?: boolean;
  };
  audio?: {
    readonly reverb: number;
    readonly unknown347?: number;
    readonly volumes: readonly number[];
    readonly sfxReverbSend?: number;
    readonly dialogueReverbSend?: number;
    /** musicReverbSend and the three low-pass filters. */
    readonly sends347?: readonly number[];
    readonly highPass?: readonly number[];
    readonly ambianceTrack?: string;
  };
  backdropPlan?: ResourceRef;
  backdropNewPlan?: ResourceRef;
  subLevel?: boolean;
  scoreLocked?: boolean;
  debugTimeInLevel?: number;
  useEvenNewerCheckpointCode?: boolean;
  moveCursors?: readonly MoveCursor[];
  globalTouchCursor?: number;
  sharedScreenOld?: boolean;
  singlePlayer?: boolean;
  minPlayers?: number;
  maxPlayers?: number;
  moveRecommended?: boolean;
  portraitMode?: boolean;
  fixInvalidInOutMoverContacts?: boolean;
  vitaPlayerCount?: number;
  sharedScreen?: boolean;
  disableHUD?: boolean;
  disableShadows?: boolean;
  flipBackground?: boolean;
  mpSeparateScreen?: boolean;
  continueMusic?: boolean;
  broadcastMicroChipEntries?: readonly { readonly sourceMicrochip?: Thing; readonly clonedMicrochip?: Thing }[];
  manualJumpDown?: number;
  /** subVersion 0x98..0xe4 and 0xc3..0xe4: three lists of Things cwlib does not name. */
  old98a?: readonly (Thing | undefined)[];
  oldC3?: readonly (Thing | undefined)[];
  old98b?: readonly (Thing | undefined)[];
  deferredDestroys?: readonly (Thing | undefined)[];
  /** globalDofFront, globalDofBack, globalDofSackTrack. */
  globalDof?: readonly number[];
  enableSackpocket?: boolean;
  showQuestLog?: boolean;
  scoreboardUnlockLevelSlot?: SlotId;
  progressBoardLevelLinkStartPoint?: string;
  isLBP3World?: boolean;
}

const floats = (s: Serializer, n: number): number[] => Array.from({ length: n }, () => s.f32());
const writeFloats = (w: Writer, values: readonly number[] | undefined, n: number): void => {
  for (let i = 0; i < n; i += 1) w.f32(values?.[i] ?? 0);
};
const NO_SLOT: SlotId = { type: 0, number: 0 };

/**
 * `PWorld` after `things`: cwlib's `PWorld.serialize` (`d6a2ef8`) gate for gate,
 * the older revisions' too and the Vita's branch (`vitaRevision`). ❗ It used to
 * leave out every gate below LBP3, and read 38 bytes too many in an LBP2
 * tutorial at 0x39e (`tutorial_21.bin`: `WORLD` to 0xb16b where cwlib ends it at
 * 0xb145) -- steering/level-files.md, *Revisions below LBP3*.
 *
 * ❗ **A world Thing inside a plan has parts after its `WORLD`**, and they are
 * read right only if this is. Three of LBP3 PS4's story chunks hold an island
 * whose plan carries a world Thing (`3787a9bc` in `06_titan_2`, `e864d09e` in
 * `c07_meet_giant`, `1f4a50ed` in `c09_titan_02_outro`; version 0x3f9,
 * subVersion 0x1a9 and 0x1ab). With `readWorld` stopping at `things`, that
 * Thing's `POS` began at `maxVel` and the island failed a Thing marker 8 bytes
 * on (`e864d09e`: `WORLD` 10335..17233, the marker at 17241).
 */
function readWorldTail(s: Serializer, readers: ReadonlyMap<string, PartReader>): WorldTail {
  const { version, subVersion } = s.revision;
  const vita = vitaRevision(s.revision);
  const leerdammer = s.revision.branchId === LEERDAMMER;
  const t: WorldTail = {};
  const things = (): (Thing | undefined)[] => {
    const count = s.count();
    const out: (Thing | undefined)[] = [];
    for (let i = 0; i < count; i += 1) out.push(readThingRef(s, readers));
    return out;
  };
  t.maxVel = s.f32();
  t.maxAVel = s.f32();
  t.frame = s.s32();
  if (version >= 0x2e2) t.simFrame = s.s32();
  if (version >= 0x377) t.frameLevelStarted = s.i32();
  t.thingUIDCounter = s.i32();
  if (version < 0x32d) t.randy = s.i32();
  if (version < 0x1a4) {
    const f = floats(s, 6);
    const int = s.i32();
    t.old1a4 = version < 0x14b ? { floats: f, int, things: s.array((self) => readThingRef(self, readers)) } : { floats: f, int };
  }
  // cwlib skips the next four on its own toolkit branch from its scene graph on; no game file is that.
  t.selections = s.references((self): EditorSelection => ({ name: self.str(), things: things() }));
  t.backdrop = readThingRef(s, readers);
  t.backdropNew = readThingRef(s, readers);
  t.backdropTimer = s.f32();
  if (version >= 0x3a3) t.lbp2NightDaySwapped = s.s32();
  if (version >= 0x14a) t.isPaused = s.bool();
  if (version >= 0x152) {
    t.lightingFactor = s.f32();
    t.colorCorrectionFactor = s.f32();
    if (version >= 0x196) {
      t.fogFactor = s.f32();
      t.fogTintFactor = s.f32();
      t.darknessFactor = s.f32();
      if (vita >= 0x78) t.nonLinearFog = s.bool();
    }
  }
  if (version >= 0x16f) {
    t.completeRewards = s.array(readEggLink);
    t.collectRewards = s.array(readEggLink);
    t.aceRewards = s.array(readEggLink);
    if (version >= 0x208) t.areRewardsShareable = s.bool();
    if (version >= 0x35e) t.scoreboardLevelLinkSlot = readSlotId(s);
    t.unlocks = [s.array(readKeyLink), s.array(readKeyLink), s.array(readKeyLink)];
  }
  if (vita >= 0x22 && vita < 0x25) {
    t.vitaUnlocks = s.array(readEggLink);
    t.vitaRewards = s.array(readEggLink);
    t.timeRequired = s.s32();
  }
  if (vita >= 0x25) {
    const tiers: VitaTrophyTier[] = [];
    for (let i = 0; i < 3; i += 1) tiers.push({ rewards: s.array(readEggLink), unlocks: s.array(readKeyLink) });
    t.trophyTiers = tiers;
    t.trophyConditionTypes = [s.i8(), s.i8(), s.i8()];
    const requirements = [];
    for (let i = 0; i < 3; i += 1) requirements.push({ score: s.s32(), time: s.f32(), livesLost: s.s32() });
    t.trophyRequirements = requirements;
  }
  if (vita >= 0x3d) t.trophyFlags = [s.bool(), s.bool(), s.bool(), s.bool()];
  if (vita >= 0x4c) t.enforceMinMaxPlayers = s.bool();
  if (version > 0x16e && version < 0x1bf) t.old16f = [s.i32(), s.i32(), s.i32()];
  // ❗ cwlib stops here, "CGameCamera serialization unsupported", and so does this.
  if (version > 0x1a3 && version < 0x1d1) return t;
  if (version > 0x1bd && version < 0x213) t.spawnsPerPlayer = s.i32();
  if (version >= 0x1c2 && version < 0x36e) t.deathCount = s.i32();
  if (version >= 0x1c4) t.maxNumPlayers = s.s32();
  if (version >= 0x1db) {
    t.dissolvingThings = things();
    t.oldDissolvingThings = things();
  }
  if (version >= 0x1de && version < 0x345) t.isTutorialLevel = s.bool();
  if (version >= 0x22e) {
    t.everSpawned = s.bool();
    t.spawnFailureCount = s.s32();
  }
  if (version >= 0x25a) {
    t.targetGlobalSettings = readGlobalSettings(s);
    t.fromGlobalSettings = readGlobalSettings(s);
    t.globalSettingsBlendFactor = s.f32();
    t.hasLevelLightingBeenSetup = s.bool();
    t.globalSettingsThingUID = s.s32();
  }
  // `CameraSettings`: four multipliers, and two pitch ones above subVersion 0x36.
  if (version >= 0x370) t.cameraSettings = floats(s, subVersion > 0x36 ? 6 : 4);
  if (version >= 0x26f) {
    t.waterLevel = s.f32();
    if (version >= 0x278 || onLeerdammer(s.revision, LD_WATER_WAVE)) t.fromWaterLevel = s.f32();
    t.targetWaterLevel = s.f32();
  }
  if (version >= 0x270) t.waterWaveMagnitude = floats(s, 3);
  if (version >= 0x26f) {
    t.gravity = floats(s, 3);
    t.currGlobalSettingsBlendFactors = s.array((self) => self.f32());
    t.globalSettingsThingUIDs = s.array((self) => self.i32());
    if (version >= 0x270) t.globalSettingsThingPriority = s.array((self) => self.i32());
  }
  if (vita >= 0x2d) {
    t.waterColor = s.s32();
    t.waterBrightness = s.f32();
  } else if (version >= 0x289 || leerdammer) {
    t.waterTint = s.f32();
    t.fromWaterTintColor = s.vector4();
    t.targetWaterTint = s.f32();
  }
  if (version >= 0x289 || leerdammer) t.waterMurkiness = floats(s, 3);
  if (version >= 0x2b4 || onLeerdammer(s.revision, LD_WATER_BITS)) t.waterBits = floats(s, 3);
  if (version >= 0x34e) {
    t.waterDrainSoundsEnabled = s.bool();
    t.currWaterDrainSoundsEnabled = s.bool();
  }
  if (subVersion >= 0xe8) {
    t.waterCausticsEnabled = s.bool();
    t.currWaterCausticsEnabled = s.bool();
  }
  if (subVersion >= 0xf8) t.waterColors = Array.from({ length: 9 }, () => s.s32());
  if (subVersion >= 0xf8 && subVersion < 0x189) t.unknownF8 = s.bool();
  if (subVersion >= 0x182) {
    t.backdropEnabled = s.bool();
    t.currBackdropEnabled = s.bool();
  }
  if (version >= 0x29c || onLeerdammer(s.revision, LD_WATER_WAVE)) t.currWavePos = s.f32();
  if ((version > 0x288 && version < 0x29c) || (leerdammer && !onLeerdammer(s.revision, LD_WATER_WAVE))) {
    t.old289 = { float: s.f32(), bool: s.bool() };
  }
  // `CBreadLoaf`, which cwlib refuses when present.
  if (version > 0x281 && version < 0x287 && s.i32() !== 0) throw new SerializerError('PWorld carries a CBreadLoaf, which cwlib does not read either');
  if (version >= 0x2a3) t.gameMode = s.i32();
  if (subVersion >= 0x218) t.gameModeRequested = s.i32();
  if (version >= 0x2b0) t.nextSackbotPlayerNumber = s.s32();
  if (version > 0x2d3 && version < 0x2f3) throw new SerializerError(`PWorld at 0x${version.toString(16)} holds a structure cwlib does not read either`);
  if (version >= 0x2ee) {
    // `CutsceneCameraManager`.
    const state = s.i32();
    const currentCutSceneCamera = readThingRef(s, readers);
    const timeInCurrentCamera = s.s32();
    const endCountdown = s.s32();
    const transitionStage = s.f32();
    let old: { bool: boolean; a: Vector3; float: number; b: Vector3 }[] | undefined;
    if (version > 0x2ef && version < 0x36e) {
      old = [];
      for (let i = 0; i < 2; i += 1) old.push({ bool: s.bool(), a: s.vector3(), float: s.f32(), b: s.vector3() });
    }
    const currentCameraTweaking = version >= 0x3a0 ? s.bool() : undefined;
    t.cutscene = { state, currentCutSceneCamera, timeInCurrentCamera, endCountdown, transitionStage, old, currentCameraTweaking };
  }
  if (version >= 0x30c) {
    // `GlobalAudioSettings`.
    const reverb = s.s32();
    const unknown347 = version < 0x347 ? s.f32() : undefined;
    const volumes = floats(s, 4); // music, sfx, background, dialogue volumes
    let sfxReverbSend: number | undefined;
    let dialogueReverbSend: number | undefined;
    if (version >= 0x342) {
      sfxReverbSend = s.f32();
      dialogueReverbSend = s.f32();
    }
    const sends347 = version >= 0x347 ? floats(s, 4) : undefined;
    const highPass = subVersion >= 0xd8 ? floats(s, 3) : undefined;
    const ambianceTrack = subVersion >= 0xe2 ? s.str() : undefined;
    t.audio = { reverb, unknown347, volumes, sfxReverbSend, dialogueReverbSend, sends347, highPass, ambianceTrack };
  }
  if (version >= 0x321) {
    t.backdropPlan = s.resource(true);
    t.backdropNewPlan = s.resource(true);
  }
  if (version >= 0x352) t.subLevel = s.bool();
  if (version >= 0x38a) t.scoreLocked = s.bool();
  if (version >= 0x38b) t.debugTimeInLevel = s.s32();
  if (version >= 0x3ac) t.useEvenNewerCheckpointCode = s.bool();
  if (version >= 0x3bd && subVersion <= 0x117) t.moveCursors = s.array((self) => readMoveCursor(self, readers));
  if (vita >= 0x8) t.globalTouchCursor = s.i32();
  if (vita >= 0xa && vita < 0x28) t.sharedScreenOld = s.bool();
  if (subVersion > 0x215) t.singlePlayer = s.bool();
  if (version >= 0x3d0) {
    t.minPlayers = s.u8();
    t.maxPlayers = s.u8();
    t.moveRecommended = s.bool();
  }
  if (vita >= 0) {
    // The Vita's world ends here, with its own flags (cwlib returns).
    if (vita >= 0x18) t.portraitMode = s.bool();
    if (version >= 0x3dd) t.fixInvalidInOutMoverContacts = s.bool();
    if (vita >= 0x28 && vita < 0x47) t.vitaPlayerCount = s.s32(); // sharedScreen above 1
    if (vita >= 0x47) t.sharedScreen = s.bool();
    if (vita >= 0x39) t.disableHUD = s.bool();
    if (vita >= 0x52) t.disableShadows = s.bool();
    if (vita >= 0x3b) t.flipBackground = s.bool();
    if (vita >= 0x4f) t.mpSeparateScreen = s.bool();
    return t;
  }
  if (version >= 0x3dd) t.fixInvalidInOutMoverContacts = s.bool();
  if (version >= 0x3f1) t.continueMusic = s.bool();
  if (subVersion >= 0x2f) {
    t.broadcastMicroChipEntries = s.array((self) => ({
      sourceMicrochip: readThingRef(self, readers),
      clonedMicrochip: readThingRef(self, readers),
    }));
  }
  if (subVersion >= 0x5d) t.manualJumpDown = s.i32();
  if (subVersion >= 0x98 && subVersion < 0xe5) t.old98a = things();
  if (subVersion >= 0xc3 && subVersion < 0xe5) t.oldC3 = things();
  if (subVersion >= 0x98 && subVersion < 0xe5) t.old98b = things();
  if (subVersion >= 0xe5) t.deferredDestroys = things();
  if (subVersion >= 0xcf) t.globalDof = floats(s, 3);
  if (subVersion >= 0xda) t.enableSackpocket = s.bool();
  if (subVersion >= 0x170) t.showQuestLog = s.bool();
  if (subVersion >= 0x11d) t.scoreboardUnlockLevelSlot = readSlotId(s);
  if (subVersion >= 0x154) t.progressBoardLevelLinkStartPoint = s.wstr();
  if (subVersion >= 0x15e) t.isLBP3World = s.bool();
  return t;
}

/** `readWorldTail`'s mirror. */
function writeWorldTail(w: Writer, t: WorldTail, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const vita = vitaRevision(w.revision);
  const leerdammer = w.revision.branchId === LEERDAMMER;
  const things = (list: readonly (Thing | undefined)[] | undefined): void => writeThingList(w, list, ctx);
  const eggLinks = (list: readonly WorldEggLink[] | undefined): void => writeArray(w, list, writeEggLink);
  const keyLinks = (list: readonly KeyLink[] | undefined): void => writeArray(w, list, writeKeyLink);
  w.f32(t.maxVel ?? 0);
  w.f32(t.maxAVel ?? 0);
  w.s32(t.frame ?? 0);
  if (version >= 0x2e2) w.s32(t.simFrame ?? 0);
  if (version >= 0x377) w.i32(t.frameLevelStarted ?? 0);
  w.i32(t.thingUIDCounter ?? 0);
  if (version < 0x32d) w.i32(t.randy ?? 0);
  if (version < 0x1a4) {
    writeFloats(w, t.old1a4?.floats, 6);
    w.i32(t.old1a4?.int ?? 0);
    if (version < 0x14b) things(t.old1a4?.things);
  }
  w.references(t.selections ?? [], (self, selection) => {
    self.str(selection.name);
    things(selection.things);
  });
  ctx.thing(w, t.backdrop);
  ctx.thing(w, t.backdropNew);
  w.f32(t.backdropTimer ?? 0);
  if (version >= 0x3a3) w.s32(t.lbp2NightDaySwapped ?? 0);
  if (version >= 0x14a) w.bool(t.isPaused ?? false);
  if (version >= 0x152) {
    w.f32(t.lightingFactor ?? 0);
    w.f32(t.colorCorrectionFactor ?? 0);
    if (version >= 0x196) {
      w.f32(t.fogFactor ?? 0);
      w.f32(t.fogTintFactor ?? 0);
      w.f32(t.darknessFactor ?? 0);
      if (vita >= 0x78) w.bool(t.nonLinearFog ?? false);
    }
  }
  if (version >= 0x16f) {
    eggLinks(t.completeRewards);
    eggLinks(t.collectRewards);
    eggLinks(t.aceRewards);
    if (version >= 0x208) w.bool(t.areRewardsShareable ?? false);
    if (version >= 0x35e) writeSlotId(w, t.scoreboardLevelLinkSlot ?? NO_SLOT);
    for (let i = 0; i < 3; i += 1) keyLinks(t.unlocks?.[i]);
  }
  if (vita >= 0x22 && vita < 0x25) {
    eggLinks(t.vitaUnlocks);
    eggLinks(t.vitaRewards);
    w.s32(t.timeRequired ?? 0);
  }
  if (vita >= 0x25) {
    for (let i = 0; i < 3; i += 1) {
      eggLinks(t.trophyTiers?.[i]?.rewards);
      keyLinks(t.trophyTiers?.[i]?.unlocks);
    }
    for (let i = 0; i < 3; i += 1) w.i8(t.trophyConditionTypes?.[i] ?? 0);
    for (let i = 0; i < 3; i += 1) {
      const r = t.trophyRequirements?.[i];
      w.s32(r?.score ?? 0);
      w.f32(r?.time ?? 0);
      w.s32(r?.livesLost ?? 0);
    }
  }
  if (vita >= 0x3d) for (let i = 0; i < 4; i += 1) w.bool(t.trophyFlags?.[i] ?? false);
  if (vita >= 0x4c) w.bool(t.enforceMinMaxPlayers ?? false);
  if (version > 0x16e && version < 0x1bf) for (let i = 0; i < 3; i += 1) w.i32(t.old16f?.[i] ?? 0);
  if (version > 0x1a3 && version < 0x1d1) return;
  if (version > 0x1bd && version < 0x213) w.i32(t.spawnsPerPlayer ?? 0);
  if (version >= 0x1c2 && version < 0x36e) w.i32(t.deathCount ?? 0);
  if (version >= 0x1c4) w.s32(t.maxNumPlayers ?? 0);
  if (version >= 0x1db) {
    things(t.dissolvingThings);
    things(t.oldDissolvingThings);
  }
  if (version >= 0x1de && version < 0x345) w.bool(t.isTutorialLevel ?? false);
  if (version >= 0x22e) {
    w.bool(t.everSpawned ?? false);
    w.s32(t.spawnFailureCount ?? 0);
  }
  if (version >= 0x25a) {
    writeGlobalSettings(w, t.targetGlobalSettings);
    writeGlobalSettings(w, t.fromGlobalSettings);
    w.f32(t.globalSettingsBlendFactor ?? 0);
    w.bool(t.hasLevelLightingBeenSetup ?? false);
    w.s32(t.globalSettingsThingUID ?? 0);
  }
  if (version >= 0x370) writeFloats(w, t.cameraSettings, subVersion > 0x36 ? 6 : 4);
  if (version >= 0x26f) {
    w.f32(t.waterLevel ?? 0);
    if (version >= 0x278 || onLeerdammer(w.revision, LD_WATER_WAVE)) w.f32(t.fromWaterLevel ?? 0);
    w.f32(t.targetWaterLevel ?? 0);
  }
  if (version >= 0x270) writeFloats(w, t.waterWaveMagnitude, 3);
  if (version >= 0x26f) {
    writeFloats(w, t.gravity, 3);
    writeArray(w, t.currGlobalSettingsBlendFactors, (self, v) => self.f32(v));
    writeArray(w, t.globalSettingsThingUIDs, (self, v) => self.i32(v));
    if (version >= 0x270) writeArray(w, t.globalSettingsThingPriority, (self, v) => self.i32(v));
  }
  if (vita >= 0x2d) {
    w.s32(t.waterColor ?? 0);
    w.f32(t.waterBrightness ?? 0);
  } else if (version >= 0x289 || leerdammer) {
    w.f32(t.waterTint ?? 0);
    w.vector4(t.fromWaterTintColor ?? ZERO4);
    w.f32(t.targetWaterTint ?? 0);
  }
  if (version >= 0x289 || leerdammer) writeFloats(w, t.waterMurkiness, 3);
  if (version >= 0x2b4 || onLeerdammer(w.revision, LD_WATER_BITS)) writeFloats(w, t.waterBits, 3);
  if (version >= 0x34e) {
    w.bool(t.waterDrainSoundsEnabled ?? false);
    w.bool(t.currWaterDrainSoundsEnabled ?? false);
  }
  if (subVersion >= 0xe8) {
    w.bool(t.waterCausticsEnabled ?? false);
    w.bool(t.currWaterCausticsEnabled ?? false);
  }
  if (subVersion >= 0xf8) for (let i = 0; i < 9; i += 1) w.s32(t.waterColors?.[i] ?? 0);
  if (subVersion >= 0xf8 && subVersion < 0x189) w.bool(t.unknownF8 ?? false);
  if (subVersion >= 0x182) {
    w.bool(t.backdropEnabled ?? false);
    w.bool(t.currBackdropEnabled ?? false);
  }
  if (version >= 0x29c || onLeerdammer(w.revision, LD_WATER_WAVE)) w.f32(t.currWavePos ?? 0);
  if ((version > 0x288 && version < 0x29c) || (leerdammer && !onLeerdammer(w.revision, LD_WATER_WAVE))) {
    w.f32(t.old289?.float ?? 0);
    w.bool(t.old289?.bool ?? false);
  }
  if (version > 0x281 && version < 0x287) w.i32(0); // no `CBreadLoaf`
  if (version >= 0x2a3) w.i32(t.gameMode ?? 0);
  if (subVersion >= 0x218) w.i32(t.gameModeRequested ?? 0);
  if (version >= 0x2b0) w.s32(t.nextSackbotPlayerNumber ?? 0);
  if (version > 0x2d3 && version < 0x2f3) throw new SerializerError(`PWorld at 0x${version.toString(16)} holds a structure cwlib does not write either`);
  if (version >= 0x2ee) {
    const c = t.cutscene;
    w.i32(c?.state ?? 0);
    ctx.thing(w, c?.currentCutSceneCamera);
    w.s32(c?.timeInCurrentCamera ?? 0);
    w.s32(c?.endCountdown ?? 0);
    w.f32(c?.transitionStage ?? 0);
    if (version > 0x2ef && version < 0x36e) {
      for (let i = 0; i < 2; i += 1) {
        const o = c?.old?.[i];
        w.bool(o?.bool ?? false);
        w.vector3(o?.a ?? ZERO3);
        w.f32(o?.float ?? 0);
        w.vector3(o?.b ?? ZERO3);
      }
    }
    if (version >= 0x3a0) w.bool(c?.currentCameraTweaking ?? false);
  }
  if (version >= 0x30c) {
    const a = t.audio;
    w.s32(a?.reverb ?? 0);
    if (version < 0x347) w.f32(a?.unknown347 ?? 0);
    writeFloats(w, a?.volumes, 4);
    if (version >= 0x342) {
      w.f32(a?.sfxReverbSend ?? 0);
      w.f32(a?.dialogueReverbSend ?? 0);
    }
    if (version >= 0x347) writeFloats(w, a?.sends347, 4);
    if (subVersion >= 0xd8) writeFloats(w, a?.highPass, 3);
    if (subVersion >= 0xe2) w.str(a?.ambianceTrack ?? '');
  }
  if (version >= 0x321) {
    w.ref(t.backdropPlan, { descriptor: true });
    w.ref(t.backdropNewPlan, { descriptor: true });
  }
  if (version >= 0x352) w.bool(t.subLevel ?? false);
  if (version >= 0x38a) w.bool(t.scoreLocked ?? false);
  if (version >= 0x38b) w.s32(t.debugTimeInLevel ?? 0);
  if (version >= 0x3ac) w.bool(t.useEvenNewerCheckpointCode ?? false);
  if (version >= 0x3bd && subVersion <= 0x117) writeArray(w, t.moveCursors, (self, v) => writeMoveCursor(self, v, ctx));
  if (vita >= 0x8) w.i32(t.globalTouchCursor ?? 0);
  if (vita >= 0xa && vita < 0x28) w.bool(t.sharedScreenOld ?? false);
  if (subVersion > 0x215) w.bool(t.singlePlayer ?? false);
  if (version >= 0x3d0) {
    w.u8(t.minPlayers ?? 0);
    w.u8(t.maxPlayers ?? 0);
    w.bool(t.moveRecommended ?? false);
  }
  if (vita >= 0) {
    if (vita >= 0x18) w.bool(t.portraitMode ?? false);
    if (version >= 0x3dd) w.bool(t.fixInvalidInOutMoverContacts ?? false);
    if (vita >= 0x28 && vita < 0x47) w.s32(t.vitaPlayerCount ?? 0);
    if (vita >= 0x47) w.bool(t.sharedScreen ?? false);
    if (vita >= 0x39) w.bool(t.disableHUD ?? false);
    if (vita >= 0x52) w.bool(t.disableShadows ?? false);
    if (vita >= 0x3b) w.bool(t.flipBackground ?? false);
    if (vita >= 0x4f) w.bool(t.mpSeparateScreen ?? false);
    return;
  }
  if (version >= 0x3dd) w.bool(t.fixInvalidInOutMoverContacts ?? false);
  if (version >= 0x3f1) w.bool(t.continueMusic ?? false);
  if (subVersion >= 0x2f) {
    writeArray(w, t.broadcastMicroChipEntries, (self, e) => {
      ctx.thing(self, e.sourceMicrochip);
      ctx.thing(self, e.clonedMicrochip);
    });
  }
  if (subVersion >= 0x5d) w.i32(t.manualJumpDown ?? 0);
  if (subVersion >= 0x98 && subVersion < 0xe5) things(t.old98a);
  if (subVersion >= 0xc3 && subVersion < 0xe5) things(t.oldC3);
  if (subVersion >= 0x98 && subVersion < 0xe5) things(t.old98b);
  if (subVersion >= 0xe5) things(t.deferredDestroys);
  if (subVersion >= 0xcf) writeFloats(w, t.globalDof, 3);
  if (subVersion >= 0xda) w.bool(t.enableSackpocket ?? false);
  if (subVersion >= 0x170) w.bool(t.showQuestLog ?? false);
  if (subVersion >= 0x11d) writeSlotId(w, t.scoreboardUnlockLevelSlot ?? NO_SLOT);
  if (subVersion >= 0x154) w.wstr(t.progressBoardLevelLinkStartPoint ?? '');
  if (subVersion >= 0x15e) w.bool(t.isLBP3World ?? false);
}

/** `PWorld` before its Things, its Things as the list holds them, and its tail. */
export interface WorldFields {
  readonly backdropOffset?: Vector3;
  /** subVersion 0x72..0x73: three floats and two bytes cwlib does not name. */
  readonly old72?: { readonly floats: readonly number[]; readonly a: number; readonly b: number };
  readonly backdropOffsetZAuto?: boolean;
  readonly overrideBackdropAmbience?: string;
  /** Below version 0x14b. */
  readonly materials?: readonly (ResourceRef | undefined)[];
  readonly streamingManager?: StreamingManager;
  /** The list as read, null entries and all; the part's value leaves those out. */
  readonly things: readonly (Thing | undefined)[];
  tail?: WorldTail;
}

/**
 * `thing.parts.get('WORLD')`: the world's Things, as it always was, with the
 * rest of `PWorld` on it as a **non-enumerable** `world` -- the way `PosPart`
 * carries its bone -- so a writer has every field and a consumer sees the array.
 */
export type WorldPart = Thing[] & { readonly world?: WorldFields };

function withWorld(things: Thing[], world: WorldFields): WorldPart {
  return Object.defineProperty(things, 'world', { value: world, enumerable: false }) as WorldPart;
}

/**
 * `PWorld`: its Things, and with `tail` everything after them.
 *
 * The fields before `things` are few and all gated on subVersion. Each gate below
 * reads its field or nothing; whatever older layout cwlib has behind them is
 * omitted rather than left as dead code. `readLevel`'s outermost
 * world passes `tail` false and reads the tail itself, once it holds the Things.
 */
function readWorld(s: Serializer, readers: ReadonlyMap<string, PartReader>, tail = true): WorldPart {
  const { version, subVersion } = s.revision;
  const fields: { -readonly [K in keyof WorldFields]: WorldFields[K] } = { things: [] };
  if (subVersion >= 0x6d) fields.backdropOffset = s.vector3();
  if (subVersion >= 0x72 && subVersion <= 0x73) fields.old72 = { floats: floats(s, 3), a: s.u8(), b: s.u8() };
  if (subVersion >= 0x70) fields.backdropOffsetZAuto = s.bool();
  if (subVersion >= 0xe2) fields.overrideBackdropAmbience = s.str();
  if (version < 0x14b) fields.materials = s.array((self) => self.resource());
  if (subVersion >= 0x3f) fields.streamingManager = s.reference((self) => readStreamingManager(self, readers));
  // Every Thing goes through `referenceInto` so that the cycles in a level --
  // a Thing's parent, a switch's target -- resolve to the real object rather
  // than the empty placeholder `reference` would register.
  const things = s.list('things', (self) => readThingRef(self, readers));
  fields.things = things;
  if (tail) fields.tail = readWorldTail(s, readers);
  // ⚠️ **Only the OUTERMOST world's Things are the level's.** `readLevel` keeps
  // the first world's and reads the others as any part. A level can carry a second
  // world Thing deeper in the graph -- one turned up inside a `CREATURE` in
  // `5576f758` from the public archive, uid -1 with no parent, the same shape as
  // the level's own world -- and throwing there would have returned that inner
  // world's Things as if they were the level's.
  return withWorld(things.filter((t): t is Thing => t !== undefined), fields);
}

/**
 * `readWorld`'s mirror, the `WORLD` part's writer: every field `PWorld` reads,
 * from the `world` the reader put on the array. ⚠️ An array with no `world` --
 * Things gathered afresh -- writes them with every other field at its default,
 * which is no world the game made.
 */
export function writeWorld(w: Writer, value: WorldPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  const f: WorldFields = value.world ?? { things: value };
  if (subVersion >= 0x6d) w.vector3(f.backdropOffset ?? ZERO3);
  if (subVersion >= 0x72 && subVersion <= 0x73) {
    writeFloats(w, f.old72?.floats, 3);
    w.u8(f.old72?.a ?? 0);
    w.u8(f.old72?.b ?? 0);
  }
  if (subVersion >= 0x70) w.bool(f.backdropOffsetZAuto ?? false);
  if (subVersion >= 0xe2) w.str(f.overrideBackdropAmbience ?? '');
  if (version < 0x14b) writeArray(w, f.materials, (self, m) => self.ref(m));
  if (subVersion >= 0x3f) w.reference(f.streamingManager, (self, v) => writeStreamingManager(self, v, ctx));
  writeThingList(w, f.things, ctx);
  writeWorldTail(w, f.tail ?? {}, ctx);
}

export interface LevelParse {
  readonly revision: RevisionInfo;
  readonly things: (Thing | undefined)[];
  /**
   * Parts of the file that would not read, when the rest still can.
   *
   * ❗ Only a streaming chunk produces these. Its islands are **independent
   * resources** in one list, so one that will not open says nothing about its
   * neighbours -- and reporting three failures out of ninety-six beats throwing
   * ninety-three islands away, which is what a single error would do here.
   * Everything else in this file still fails whole, because everything else is
   * one stream where a bad read poisons what follows.
   */
  readonly problems?: readonly string[];
  /**
   * A streaming level's chunks and where each sits: every `ChunkFile` of its
   * `LevelData`s, in order. ❗ A chunk's Things are in its own space, from
   * (0, 0, 0); this box's `min` is where that origin is in the level.
   */
  readonly chunks?: readonly ChunkPlacement[];
  /**
   * A level or a plan: why the file after the outermost world's Things, or after
   * a plan's Thing array, did not read to the payload's last byte; absent when
   * it did. ❗ **Only a level without one is evidence that its parts were read
   * right** -- see the file's header. A plan's Thing array is checked on its own.
   */
  readonly unreadTail?: string;
  /** A plan only: what the popit shows of it, absent on a streaming island's plan. */
  readonly inventory?: PlanInventory;
  /*
   * What the payload holds besides the Things, kept so it can be written from
   * its values (`encodeLevel`, `encodePlan` in `encode-things.ts`).
   */
  /** A level: `RLevel`'s cross-play hashes, from version 0x3e7. */
  readonly crossPlayHashes?: readonly Uint8Array[];
  /** A level: its world Thing, whose `WORLD` part holds `things`. */
  readonly world?: Thing;
  /** A level read to its world's end: `RLevel` after the world Thing, as far as it read. */
  readonly levelTail?: LevelTail;
  /** A plan: `isUsedForStreaming`, from subVersion 0xcc. */
  readonly isUsedForStreaming?: boolean;
  /** A plan: the revision word `RPlan` stores, which the resource's overrules. */
  readonly planRevision?: number;
}

/** `RPlan`'s `inventoryData` and the two keys after it. */
export interface PlanInventory {
  readonly details: InventoryItemDetails;
  /** LAMS keys of the popit's location and category; below version 0x2bb made from the tags, as cwlib does. */
  readonly location: number;
  readonly category: number;
  /** Below version 0x2bb (LEERDAMMER's revision 8), the translation tags the file stores instead. */
  readonly locationTag?: string;
  readonly categoryTag?: string;
}

/** Inflate a resource and start a serialiser on it, with the revision checked. */
async function open(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<{ revision: RevisionInfo; flags: number; s: Serializer }> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  requireLbp3(revision);
  return { revision, flags: resource.compressionFlags, s };
}

/** The subVersion that put `isUsedForStreaming` at the head of `RPlan`. */
export const STREAMING_PLAN = 0xcc;

/** `Revisions.LAMS_KEYS`, and LEERDAMMER's `LD_LAMS_KEYS`: LAMS keys in place of translation tags. */
export const LAMS_KEYS = 0x2bb;
export const LD_LAMS_KEYS = 0x8;

/** `Revisions.PLAN_DETAILS`: `RPlan` carries its inventory details from this version. */
export const PLAN_DETAILS = 0x197;

/**
 * Read a **plan** (`PLNb`) and return the Things inside it.
 *
 * A plan is a saved Thing rather than a world: a costume, a vehicle, or — the
 * reason this exists — a music sequencer somebody copied into their popit and
 * backed up on its own. It is the smallest thing anyone can drop on the page,
 * one instrument rack with no level around it.
 *
 * ⚠️ **A plan's Things live in a nested stream, not in this one.** `RPlan` is
 * four fields and the third is a length-prefixed blob; the Things are inside
 * that blob, serialised with the SAME revision and compression flags but a
 * **fresh reference table** — ids inside `thingData` mean nothing outside it.
 * Reading it in place would work by accident on a plan holding one Thing and
 * desynchronise on the rest.
 *
 * The layout, from `cwlib/resources/RPlan.java`:
 *
 * ```
 * bool  isUsedForStreaming   subVersion >= 0xcc
 * i32   revision             the plan's own, ignored -- the resource's wins
 * i32   length               \  thingData: Thing[], as a reference array
 * byte  data[length]         /
 * ...   inventoryData        version >= 0x197 and not streaming
 * u32   location, category   the same, and version >= 0x2bb (LAMS keys)
 * ```
 *
 * ⚠️ **`readers` is written to**: a `WORLD` reader is installed on it, because
 * the part readers close over this very map (`partReaders`), and a copy would
 * be a map nothing looks at. Hence a `Map` and not a `ReadonlyMap`, and a fresh
 * `partReaders()` when none is given -- share one across files only knowingly.
 */
export async function readPlan(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<LevelParse> {
  const { revision, flags, s } = await open(bytes, inflate);
  return readPlanStream(s, revision, flags, readers);
}

/**
 * `readPlan` on a payload already open: what `editPlan` (`write-level.ts`)
 * calls, with a tape on the serializer. `thingData`'s own stream gets a tape
 * of its own when the outer one has one, kept in `planTapes`.
 */
export function readPlanStream(
  s: Serializer,
  revision: RevisionInfo,
  flags: number,
  readers: Map<string, PartReader> = partReaders(),
): LevelParse {
  const streaming = revision.subVersion >= STREAMING_PLAN ? s.bool() : false;
  const planRevision = s.i32();
  const inner = new Serializer(s.mark('thingData', (self) => self.bytes(self.i32())), revision, flags);
  if (s.tape) {
    inner.tape = new Tape(inner.data);
    planTapes.set(s.tape, inner.tape);
  }
  // A plan can hold a world Thing -- 3 islands of the game's story chunks do --
  // and its WORLD part is read like an inner world of a level: its Things are
  // the part's value, not the plan's. Installed on the map the readers close
  // over, as `readLevel` does, and only where nothing installed one already.
  installWorldReader(readers);
  const things = inner.list('things', (self) => readThingRef(self, readers));
  // ❗ **The array fills the blob exactly, and that is checked.** `thingData`
  // holds the Thing array and nothing else, so bytes left over mean a part
  // reader took the wrong number and the parse is wrong even though it finished.
  // Measured: 0 bytes left on all 220 corpus plans that parse at all.
  //
  // ⚠️ **Reported, not thrown**, as cwlib's `RPlan.getThings` returns its Things
  // and never looks: the four `palette_tools_*.plan` at 0x1d8 declare one Thing
  // and carry more after it, where cwlib stops at the same byte this reader does.
  let leftover: string | undefined;
  if (inner.remaining !== 0) {
    leftover = `the plan's Thing array left ${inner.remaining} of ${inner.data.length} bytes ` +
      'unread — a part reader consumed the wrong number of bytes';
  } else inner.tape?.finish(inner.position);
  // What follows the Things is read to the payload's last byte, as `readLevel`
  // reads a level's; where it does not, the Things still come back.
  let inventory: PlanInventory | undefined;
  let unreadTail: string | undefined = leftover;
  try {
    if (revision.version >= PLAN_DETAILS && !streaming) {
      const details = readInventoryItemDetails(s);
      // Below `LAMS_KEYS` these are two translation tags, `str`s, and cwlib
      // makes the keys from them: `POPIT_PAGE_COMMUNITY_OBJECTS` closes 380 of
      // the game's plans at 0x26e (`RPlan.java` at `d6a2ef8`).
      if (onLeerdammer(revision, LD_LAMS_KEYS) || revision.version >= LAMS_KEYS) {
        inventory = { details, location: s.u32(), category: s.u32() };
      } else {
        const locationTag = s.str();
        const categoryTag = s.str();
        inventory = { details, location: lamsKeyId(locationTag), category: lamsKeyId(categoryTag), locationTag, categoryTag };
      }
    }
    if (s.remaining !== 0) unreadTail ??= `${s.remaining} bytes past RPlan's last field`;
  } catch (error) {
    unreadTail ??= (error as Error).message;
  }
  return {
    revision, things, planRevision,
    ...(revision.subVersion >= STREAMING_PLAN ? { isUsedForStreaming: streaming } : {}),
    ...(inventory === undefined ? {} : { inventory }),
    ...(unreadTail === undefined ? {} : { unreadTail }),
  };
}


/** A plan's outer tape → the tape of its `thingData` stream. */
export const planTapes = new WeakMap<Tape, Tape>();

/**
 * Put a `WORLD` reader on the map the part readers close over, where none is: a
 * world Thing inside a plan or a profile reads like an inner world of a level,
 * its Things the part's value.
 */
export function installWorldReader(readers: Map<string, PartReader>): void {
  if (!readers.has('WORLD')) readers.set('WORLD', (self) => readWorld(self, readers));
}

/** A streaming island's bounds, as its chunk stores them. */
export interface IslandBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/**
 * `StreamingIsland`: one piece of a streamed level, and the plan that builds it.
 *
 * The island's Things are in `PlanData`, which is **a whole `PLNb` resource**,
 * header and all -- so it is read by `readPlan` rather than by anything here.
 */
/** The island flag that puts an unknown count before the dependency lists. */
const ISLAND_EXTRA_COUNT = 0x10000000;

function readIsland(s: Serializer, plans: Uint8Array[], bounds: IslandBounds[]): void {
  s.i32(); // timeZone
  // ⚠️ Two i32s before the bounds at subVersion 0x213 (the PS3 saves), one at
  // 0x1ab (LBP3 PS4's own story chunks, 41,741 of them) and at 0x1ae (79 of the
  // archive's chunks, which also end without the chunk-code list): the gate lies
  // above 0x1ae, where no file here sits.
  const flags = s.revision.subVersion > 0x1ae ? s.i32() : 0;
  const min = s.vector3();
  const max = s.vector3();
  bounds.push({ min, max });
  plans.push(s.mark('planData', (self) => self.bytes(self.i32())));
  readStreamingLists(s);
  // ❗ **An island whose flags carry bit 28 has one more count before its
  // dependency lists**, 0 on both seen: the archive's two 0x218 chunks with
  // islands of flags 0x10000080 and 0x10000081, beside islands of 0x80 and
  // 0x81 without it. What it counts is not known.
  if (flags & ISLAND_EXTRA_COUNT) {
    const count = s.i32();
    if (count !== 0) throw new SerializerError(`an island's count after its streaming lists is ${count}, and only 0 has been seen`);
  }
  readDependencyLists(s);
}

/**
 * A chunk's islands, each a whole `PLNb` resource, without reading any of them.
 *
 * ❗ **Separate from `readChunk` so that one island can be looked at alone.**
 * Question 36 is a three-byte over-read inside island 48 of 167 in one chunk,
 * and every probe that chases it has to reach that island's `thingData` on its
 * own; without this the first step is editing this file.
 */
export async function readChunkIslands(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<{ revision: RevisionInfo; plans: Uint8Array[]; bounds: IslandBounds[] }> {
  const { revision, s } = await open(bytes, inflate);
  return { revision, ...readChunkIslandsStream(s) };
}

/**
 * `readChunkIslands` on a payload already open: what `editChunk`
 * (`write-level.ts`) calls, with a tape on the serializer.
 */
export function readChunkIslandsStream(s: Serializer): { plans: Uint8Array[]; bounds: IslandBounds[] } {
  const { revision } = s;
  const plans: Uint8Array[] = [];
  const bounds: IslandBounds[] = [];
  s.references((self) => readIsland(self, plans, bounds));
  if (revision.subVersion > 0x1ae) s.intVector(); // islandChunkCodeList
  if (s.remaining !== 0) {
    throw new SerializerError(
      `the chunk's island list left ${s.remaining} of ${s.data.length} bytes unread`,
    );
  }
  return { plans, bounds };
}

/**
 * Read a **streaming chunk** (`CHKb`) and return the Things in its islands.
 *
 * An LBP3 adventure is not one level: `LevelData.chunkFileList` names a pile of
 * these, each holding islands, each island holding a plan. This is the last
 * step of that chain and the only one where a whole resource is nested inside
 * another.
 *
 * ⚠️ **Measured, no island in the corpus holds a music sequencer.** 2,553
 * islands over two adventures, 7,407 Things, and the sequencers in those saves
 * are all in ordinary plans beside them. This exists so that an adventure that
 * *does* put a sequencer in an island is not invisible, and because a `CHKb`
 * counted as "not a level" is a file nobody can look inside.
 *
 * ⚠️ **`readers` is written to**: a `WORLD` reader is installed on it, because
 * the part readers close over this very map (`partReaders`), and a copy would
 * be a map nothing looks at. Hence a `Map` and not a `ReadonlyMap`, and a fresh
 * `partReaders()` when none is given -- share one across files only knowingly.
 */
export async function readChunk(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<LevelParse> {
  const { revision, plans } = await readChunkIslands(bytes, inflate);
  const things: (Thing | undefined)[] = [];
  const problems: string[] = [];
  for (let island = 0; island < plans.length; island += 1) {
    try {
      // A loop, not `push(...things)`: an island's Things as arguments can run
      // past what a call may take.
      const plan = await readPlan(plans[island], inflate, readers);
      for (const thing of plan.things) things.push(thing);
      if (plan.unreadTail !== undefined) problems.push(`island ${island} of ${plans.length}: ${plan.unreadTail}`);
    } catch (error) {
      // ⚠️ **The island's own index, not the count of problems so far.** This
      // said `problems.length + 1`, so the first failure in a chunk of 167
      // islands was always "island 1" -- and chasing question 36 meant finding
      // island 48 by hand before anything else could start.
      problems.push(`island ${island} of ${plans.length}: ${
        error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { revision, things, problems };
}

/**
 * Read a level resource and return every Thing in its world.
 *
 * `readers` is the part table; a Thing carrying a part that is not in it throws
 * `UnimplementedPartError` naming that part, which is how the reader gets built
 * out — run it over the corpus, implement whatever it names, run it again.
 *
 * ⚠️ **`readers` is written to**: a `WORLD` reader is installed on it, because
 * the part readers close over this very map (`partReaders`), and a copy would
 * be a map nothing looks at. Hence a `Map` and not a `ReadonlyMap`, and a fresh
 * `partReaders()` when none is given -- share one across files only knowingly.
 */
export async function readLevel(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<LevelParse> {
  const { revision, s } = await open(bytes, inflate);
  return readLevelStream(s, revision, readers);
}

/**
 * `readLevel` on a payload already open: what `editLevel` (`write-level.ts`)
 * calls, with a tape on the serializer.
 */
export function readLevelStream(
  s: Serializer,
  revision: RevisionInfo,
  readers: Map<string, PartReader> = partReaders(),
): LevelParse {
  // `RLevel`: the cross-play hashes came in at 0x3e7, and the corpus straddles
  // that, so the count is only there on the later files.
  let crossPlayHashes: Uint8Array[] | undefined;
  if (revision.version > 0x3e6) {
    const count = s.count();
    crossPlayHashes = [];
    for (let i = 0; i < count; i += 1) crossPlayHashes.push(s.sha1().slice());
  }

  // ❗ **Installed on the map the part readers already captured, not on a copy.**
  // `partReaders` binds every reader as `(s) => read(s, readers)`, closing over
  // the map it built; a copy with `WORLD` added is a map nothing looks at, so a
  // world Thing anywhere below the first one threw "no reader for part WORLD".
  // That is one of the 43 archive levels, `5576f758`, and it is why this line
  // does not say `new Map(readers)`.
  let worldThings: WorldPart | undefined;
  readers.set('WORLD', (self) => {
    if (worldThings) return readWorld(self, readers);
    const things = readWorld(self, readers, false);
    worldThings = things;
    things.world!.tail = readWorldTail(self, readers);
    return things;
  });

  let unreadTail: string | undefined;
  let world: Thing | undefined;
  let levelTail: LevelTail | undefined;
  try {
    world = readThingRef(s, readers);
    if (!worldThings) throw new SerializerError('the world Thing carried no WORLD part');
    levelTail = readLevelTail(s);
    if (s.remaining !== 0) unreadTail = `${s.remaining} bytes past RLevel's last field`;
  } catch (error) {
    if (!worldThings) throw error;
    unreadTail = (error as Error).message;
  }
  const parse: LevelParse = {
    revision, things: worldThings, chunks: chunkFiles.get(s) ?? [],
    ...(crossPlayHashes ? { crossPlayHashes } : {}),
    ...(world ? { world } : {}),
    ...(levelTail ? { levelTail } : {}),
  };
  return unreadTail === undefined ? parse : { ...parse, unreadTail };
}

/** `AdventureItem`: an item an adventure hands out, by its id in the adventure. */
export interface AdventureItem {
  readonly puid: number;
  readonly plan?: ResourceRef;
  readonly flags: number;
  readonly iconPuid: number;
}

/**
 * `AdventureData`: what an adventure shares across its levels -- its items, its
 * quests, where each level can start. The payload of an `ADSb` and the tail of
 * an `RLevel` from subVersion 0x169 (`resources/adventure-shared-data.ts`).
 */
export interface AdventureData {
  readonly fixedId: number;
  readonly itemPuidCounter: number;
  readonly items: readonly AdventureItem[];
  /** `RQuest`s (`QSTb`), by descriptor. */
  readonly quests: readonly (ResourceRef | undefined)[];
  /** Each start point: a level's slot and the streaming ids it starts at. */
  readonly startPoints: readonly { readonly slot: SlotId; readonly ids: readonly { name: string; id: number }[] }[];
}

/** `AdventureItem`: cwlib's `structs/level/AdventureItem.java`. */
function readAdventureItem(s: Serializer): AdventureItem {
  const { subVersion } = s.revision;
  const puid = s.i32();
  const plan = s.resource(true);
  if (subVersion < 0xae) {
    s.u16();
    s.u8();
    s.f32();
    s.i32();
  }
  const flags = subVersion > 0xbe ? s.i32() : 0;
  const iconPuid = subVersion > 0xe0 ? s.i32() : 0;
  return { puid, plan, flags, iconPuid };
}

/** `AdventureData`: cwlib's `structs/level/AdventureData.java`. */
export function readAdventureData(s: Serializer): AdventureData {
  const { subVersion } = s.revision;
  const fixedId = subVersion > 0xaf ? s.i32() : 0;
  let itemPuidCounter = 0;
  let items: AdventureItem[] = [];
  if (subVersion > 0x93) {
    itemPuidCounter = s.i32();
    items = s.array(readAdventureItem);
  }
  const quests = subVersion > 0xa6 ? s.array((self) => self.resource(true)) : [];
  const startPoints = subVersion >= 0xd1
    ? s.array((self) => ({
      slot: readSlotId(self),
      ids: self.array((x) => ({ name: x.wstr(), id: x.i32() })),
    }))
    : [];
  return { fixedId, itemPuidCounter, items, quests, startPoints };
}

/**
 * `readAdventureData`'s mirror. ⚠️ Below subVersion 0xae an item carries four
 * values the reader drops; they are written 0, as cwlib writes them -- no
 * `RLevel` holds an `AdventureData` that old (it is in one from 0x169).
 */
export function writeAdventureData(w: Writer, data: AdventureData): void {
  const { subVersion } = w.revision;
  if (subVersion > 0xaf) w.i32(data.fixedId);
  if (subVersion > 0x93) {
    w.i32(data.itemPuidCounter);
    writeArray(w, data.items, (self, item) => {
      self.i32(item.puid);
      self.ref(item.plan, { descriptor: true });
      if (subVersion < 0xae) {
        self.u16(0);
        self.u8(0);
        self.f32(0);
        self.i32(0);
      }
      if (subVersion > 0xbe) self.i32(item.flags);
      if (subVersion > 0xe0) self.i32(item.iconPuid);
    });
  }
  if (subVersion > 0xa6) writeArray(w, data.quests, (self, quest) => self.ref(quest, { descriptor: true }));
  if (subVersion >= 0xd1) {
    writeArray(w, data.startPoints, (self, point) => {
      writeSlotId(self, point.slot);
      writeArray(self, point.ids, (x, id) => {
        x.wstr(id.name);
        x.i32(id.id);
      });
    });
  }
}

/** `CachedInventoryData`, one per tutorial inventory item. */
export interface CachedInventoryData {
  readonly category: number;
  readonly location: number;
  /** Above version 0x39d. */
  readonly cachedToolType?: number;
  /** U0, U1, V0, V1. */
  readonly uv?: readonly number[];
}

/** `RLevel` after its world Thing, every field `readLevelTail` reads. */
export interface LevelTail {
  /** `PlayerRecord`, above version 0x213: each player's handle. */
  readonly playerIds?: readonly string[];
  /**
   * Each `NetworkPlayerID` as stored, beside its handle in `playerIds`, where
   * any holds more than the handle -- the game's own levels do (`structs/network.ts`).
   */
  readonly playerIdBytes?: readonly (Uint8Array | undefined)[];
  readonly playerNumbers?: readonly number[];
  readonly playerRecordOffset?: number;
  readonly tutorialInventory?: readonly InventoryItem[];
  readonly tutorialInventoryData?: readonly CachedInventoryData[];
  readonly tutorialInventoryActive?: boolean;
  readonly copiedFromSomeoneElse?: boolean;
  /** The Vita's, from its revision 0x70. */
  readonly musicGuid?: number;
  readonly musicSettingsGuid?: number;
  readonly musicStemVolumes?: readonly number[];
  /** subVersion 0x35..0x90 and 0x35..0xb2: two bools cwlib does not name. */
  readonly unknown35a?: boolean;
  readonly unknown35b?: boolean;
  /** subVersion 0xf0: a buffer. */
  readonly bufferF0?: Uint8Array;
  readonly savedThroughPusher?: boolean;
  readonly dceUuid?: Uint8Array;
  /** subVersion 0x161..0x168: the adventure's shared data, by reference. */
  readonly adventureSharedData?: ResourceRef;
  /** subVersion 0x169 on. */
  readonly adventure?: AdventureData;
}

/**
 * `RLevel` after its world Thing: cwlib's `resources/RLevel.java`
 * (ennuo/toolkit `d6a2ef8`), gate for gate.
 */
function readLevelTail(s: Serializer): LevelTail {
  const { version, subVersion } = s.revision;
  const t: { -readonly [K in keyof LevelTail]: LevelTail[K] } = {};
  if (version > 0x213) {
    // `PlayerRecord`
    const ids = readNetworkIds(s, true);
    t.playerIds = ids.handles;
    if (ids.bytes) t.playerIdBytes = ids.bytes;
    t.playerNumbers = s.array((self) => self.i32());
    t.playerRecordOffset = s.i32();
  }
  if (version > 0x347) t.tutorialInventory = s.array(readInventoryItem);
  if (version > 0x35c) {
    t.tutorialInventoryData = s.array((self): CachedInventoryData => {
      const category = self.u32();
      const location = self.u32();
      if (version <= 0x39d) return { category, location };
      return { category, location, cachedToolType: self.i32(), uv: [self.u8(), self.u8(), self.u8(), self.u8()] };
    });
  }
  if (version > 0x39b) t.tutorialInventoryActive = s.bool();
  if (version > 0x3b0) t.copiedFromSomeoneElse = s.bool();
  if (vitaRevision(s.revision) >= 0x70) {
    t.musicGuid = s.guid();
    t.musicSettingsGuid = s.guid();
    t.musicStemVolumes = s.array((self) => self.f32());
  }
  if (subVersion > 0x34 && subVersion < 0x91) t.unknown35a = s.bool();
  if (subVersion > 0x34 && subVersion < 0xb3) t.unknown35b = s.bool();
  // ❗ **Three reads cwlib does not have, from the game's own loader** (`v0xc51f60` in
  // `eboot-v128.bin`, which tests the head word: steering/level-files.md, *`readLevel`
  // reads to the end*). Only the second is in a file here: the reference, null and one
  // byte in `pod2.bin` (0xe2) and `sack_town.bin` (0xc8), which ended one byte early
  // without it. What it points at -- a 0x88-byte object the loader frees at once -- is
  // not read, so a non-null one is refused, as is the struct of the first.
  if (subVersion >= 0x8e && subVersion <= 0xaf) {
    throw new SerializerError(`RLevel at subVersion 0x${subVersion.toString(16)}: a struct the game reads there is not ported`);
  }
  if (subVersion >= 0xb0 && subVersion <= 0x125 && s.i32() !== 0) {
    throw new SerializerError('RLevel with a non-null object at subVersion 0xb0..0x125: not ported');
  }
  if (subVersion === 0xf0) t.bufferF0 = s.bytes(s.count()).slice(); // a buffer, as `dceUuid` is
  if (subVersion > 0x94 && subVersion < 0x12a) t.savedThroughPusher = s.bool();
  if (subVersion >= 0xf1 && subVersion <= 0xf9) {
    throw new SerializerError(`legacy adventure data at subVersion 0x${subVersion.toString(16)}: cwlib does not read it either`);
  }
  if (subVersion >= 0xfa) t.dceUuid = s.bytes(s.count()).slice();
  if (subVersion >= 0x161 && subVersion < 0x169) t.adventureSharedData = s.resource();
  if (subVersion >= 0x169) t.adventure = s.reference(readAdventureData);
  return t;
}


/** `readLevelTail`'s mirror. */
export function writeLevelTail(w: Writer, t: LevelTail): void {
  const { version, subVersion } = w.revision;
  if (version > 0x213) {
    writeNetworkIds(w, true, t.playerIds, t.playerIdBytes);
    writeArray(w, t.playerNumbers, (self, n) => self.i32(n));
    w.i32(t.playerRecordOffset ?? 0);
  }
  if (version > 0x347) writeArray(w, t.tutorialInventory, writeInventoryItem);
  if (version > 0x35c) {
    writeArray(w, t.tutorialInventoryData, (self, d) => {
      self.u32(d.category);
      self.u32(d.location);
      if (version > 0x39d) {
        self.i32(d.cachedToolType ?? 0);
        for (let i = 0; i < 4; i += 1) self.u8(d.uv?.[i] ?? 0);
      }
    });
  }
  if (version > 0x39b) w.bool(t.tutorialInventoryActive ?? false);
  if (version > 0x3b0) w.bool(t.copiedFromSomeoneElse ?? false);
  if (vitaRevision(w.revision) >= 0x70) {
    w.guid(t.musicGuid ?? 0);
    w.guid(t.musicSettingsGuid ?? 0);
    writeArray(w, t.musicStemVolumes, (self, v) => self.f32(v));
  }
  if (subVersion > 0x34 && subVersion < 0x91) w.bool(t.unknown35a ?? false);
  if (subVersion > 0x34 && subVersion < 0xb3) w.bool(t.unknown35b ?? false);
  if (subVersion >= 0x8e && subVersion <= 0xaf) {
    throw new SerializerError(`RLevel at subVersion 0x${subVersion.toString(16)}: a struct the game reads there is not ported`);
  }
  if (subVersion >= 0xb0 && subVersion <= 0x125) w.i32(0); // the null object
  if (subVersion === 0xf0) {
    w.i32(t.bufferF0?.length ?? 0);
    if (t.bufferF0) w.bytes(t.bufferF0);
  }
  if (subVersion > 0x94 && subVersion < 0x12a) w.bool(t.savedThroughPusher ?? false);
  if (subVersion >= 0xf1 && subVersion <= 0xf9) {
    throw new SerializerError(`legacy adventure data at subVersion 0x${subVersion.toString(16)}: cwlib does not write it either`);
  }
  if (subVersion >= 0xfa) {
    w.i32(t.dceUuid?.length ?? 0);
    if (t.dceUuid) w.bytes(t.dceUuid);
  }
  if (subVersion >= 0x161 && subVersion < 0x169) w.ref(t.adventureSharedData);
  if (subVersion >= 0x169) w.reference(t.adventure, writeAdventureData);
}

/** What `readThings` found the file to be. */
export type ThingsKind = 'level' | 'plan' | 'chunk';

const KIND_BY_MAGIC: ReadonlyMap<string, ThingsKind> = new Map([['LVLb', 'level'], ['PLNb', 'plan'], ['CHKb', 'chunk']]);

/**
 * Which of the three resources that hold Things a file is, by its magic, or
 * `undefined` for anything else. `readThings` and `looksLikeLevel` both ask
 * this, so a fourth kind is added in one place.
 */
export function thingsKind(bytes: Uint8Array): ThingsKind | undefined {
  return KIND_BY_MAGIC.get(magicOf(bytes));
}

/**
 * Read the Things out of a level, a plan or a streaming chunk, told apart by
 * the resource magic -- the first four bytes, which need nothing inflated.
 *
 * ❗ **A fresh `partReaders()` per call, on purpose.** `readLevel` installs
 * `WORLD` on the very map it is given (see there), and that reader closes over
 * one parse's state; a table shared across calls would carry one level's world
 * reader into the next file.
 *
 * Any other magic throws: an `ADCb`, a texture or a mesh holds no Thing array.
 */
export async function readThings(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<LevelParse & { readonly kind: ThingsKind }> {
  const kind = thingsKind(bytes);
  if (!kind) throw new SerializerError(`not a level, plan or chunk: the magic is ${JSON.stringify(magicOf(bytes))}`);
  const read = kind === 'plan' ? readPlan : kind === 'chunk' ? readChunk : readLevel;
  return { ...(await read(bytes, inflate, partReaders())), kind };
}

/**
 * Where a Thing sits on the circuit board it is parented to.
 *
 * ## Why a frame change is needed at all
 *
 * A closed board stores each component as a `CompactComponent` with a flat
 * `x, y` in board units. An **open** board has none of that: the components are
 * real Things in the world, and all that survives is a 4x4 per Thing. The cell
 * has to come back out of those two matrices.
 *
 * It is tempting to just subtract the two translations, since a circuit board is
 * usually hanging square on the screen. **Measured, that is wrong on real
 * levels**: `dev/board-probe.ts` finds that a bare delta puts only 78.93% of the
 * corpus's 1,030 open-board placements on a cell at all. One of the seven open
 * sequencer boards is attached to something rotated, and its components come out
 * on fractional cells. Expressing the delta in the board's own frame puts
 * **100%** of them on a cell.
 *
 * ## Why there is no quaternion here
 *
 * The board's frame is its matrix's three basis columns, so "the delta in board
 * space" is three dot products — one per axis, divided by the column's own
 * squared length so a scaled board still lands on integers. That is the whole
 * transform. The Java tool this walk replaced spelled it as
 * `getNormalizedRotation().invert()` and rotated by a quaternion, which scores
 * the same 100% here for a reason worth knowing: it used the **child's**
 * rotation rather than the board's, and those agree only because a component
 * lies flat against its board. It was right by accident, and it would have
 * parted company with the engine the moment a component were turned on the
 * board. See *16. The board cell* in `steering/answered-questions.md`.
 *
 * ## What says the units and the origin are right
 *
 * Nothing needs calibrating, and the corpus says so. All 61,128 stored
 * `CompactComponent.x` on closed boards are exact multiples of 52.5 and all
 * 61,128 stored `y` are **odd** multiples of it -- steps are 52.5 apart so an
 * instrument sits on any multiple, rows are twice that and a component sits at
 * the row's centre. Run this over the open boards and 1,030 of 1,030 come out
 * with the same signature, worst fractional part 0.0004 of a cell. A wrong
 * origin or a wrong scale could not reproduce that, so the result feeds
 * `boardToGrid` exactly as a stored pair would.
 */
export function boardCell(board: Float32Array, child: Float32Array): { x: number; y: number } {
  // Column-major: 12..14 is the translation, and column `i` is 4*i..4*i+2.
  const d = [child[12] - board[12], child[13] - board[13], child[14] - board[14]];
  const axis = (i: number) => {
    const c = [board[i * 4], board[i * 4 + 1], board[i * 4 + 2]];
    const squared = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    return squared === 0 ? 0 : (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / squared;
  };
  return { x: axis(0), y: axis(1) };
}

/** One music sequencer found in a level, with its board resolved. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly instrument: InstrumentPart;
}

export interface FoundSequencer {
  /** The Thing's UID — what the golden dump calls `seqUID`. */
  readonly uid: number;
  readonly settings: SequencerPart;
  readonly name: string;
  /** One entry per instrument placed on the board, in board order. */
  readonly placements: readonly Placement[];
  /** The circuit board's height in world units — `PMicrochip.circuitBoardSizeY`. */
  readonly boardHeight: number;
  /** Who made it, as the game keeps it; '' when nobody is named. See `sequencerAuthor`. */
  readonly author: string;
}

/**
 * The PSN handle of whoever made a sequencer: the nearest creator up its
 * `groupHead` chain that is a person.
 *
 * ❗ **Measured 2026-09-14 over 210 music sequencers** (the toolkit corpus, the
 * 17 gallery plans, `fixtures/levels` and the archive sample). The sequencer
 * Thing's own `PGroup.creator` is never the author: it is `MM_Studio` on 207
 * and empty on 3 -- the gadget's marker, beside `planDescriptor` 120863. The
 * person is in the GROUP-only Things its `groupHead` chain runs through, which
 * name one on 149 of the 210; the other 61 have no chain at all, a sequencer
 * nobody ever grouped.
 *
 * ⚠️ **Nearest, not outermost.** Seven chains name more than one person, and in
 * every one of them the uids grow outwards -- `sethe99#7320 -> RyanSpiker#7322
 * -> montyferah#7395` -- so the nearest group is the oldest: whoever made the
 * thing, with the people who later pasted it into their own contraptions
 * wrapped round it. On all 15 gallery plans that name somebody, the same
 * handle's bytes also occur twice in the plan's inventory block, where
 * `InventoryItemDetails.creator` and its creation history sit -- a byte search,
 * not a parse of that block, which `readPlan` still does not read.
 */
export function sequencerAuthor(thing: Thing): string {
  const seen = new Set<Thing>();
  for (let at: Thing | undefined = thing; at && !seen.has(at); at = at.groupHead) {
    seen.add(at);
    const group = at.parts.get('GROUP') as GroupPart | undefined;
    if (group?.creator && group.creator !== 'MM_Studio') return group.creator;
  }
  return '';
}

/**
 * Every music sequencer in a parsed level.
 *
 * ⚠️ **The component list is not always where you would look for it.** While a
 * circuit board is open in the editor the game promotes its components to real
 * Things parented to the board and leaves `PMicrochip.components` empty, so
 * reading only that list finds a sequencer with no instruments at all. On one
 * corpus level that is five sequencers and 1,030 placements silently missing.
 * The fallback here is to scan the Thing list for children of the board that
 * carry an `INSTRUMENT`, and `boardCell` above recovers where each one sits.
 *
 * The rebuilt order is the Thing list's order, which is what the golden dump
 * numbers as `instIdx`; the compact list's order is its own.
 */
export function musicSequencers(things: readonly (Thing | undefined)[]): FoundSequencer[] {
  const out: FoundSequencer[] = [];
  // Each board's children in Thing-list order, built the first time an open
  // board needs them: one pass over the list, not one per open sequencer.
  let children: Map<Thing, Thing[]> | undefined;
  const childrenOf = (board: Thing): readonly Thing[] => {
    if (children === undefined) {
      children = new Map();
      for (const child of things) {
        if (!child?.parent) continue;
        const list = children.get(child.parent);
        if (list) list.push(child);
        else children.set(child.parent, [child]);
      }
    }
    return children.get(board) ?? [];
  };
  for (const thing of things) {
    if (!thing) continue;
    const settings = thing.parts.get('SEQUENCER') as SequencerPart | undefined;
    const chip = thing.parts.get('MICROCHIP') as Microchip | undefined;
    if (!settings || !chip || !settings.musicSequencer) continue;

    const placements: Placement[] = [];
    if (chip.components.length > 0) {
      for (const component of chip.components) {
        const instrument = component.thing?.parts.get('INSTRUMENT') as InstrumentPart | undefined;
        if (instrument) placements.push({ x: component.x, y: component.y, instrument });
      }
    } else if (chip.board) {
      // The board's own matrix. Without it there is no frame to measure in, so
      // the placements would have to be dropped rather than guessed at.
      const boardPos = chip.board.parts.get('POS') as Float32Array | undefined;
      for (const child of childrenOf(chip.board)) {
        const instrument = child.parts.get('INSTRUMENT') as InstrumentPart | undefined;
        if (!instrument) continue;
        const childPos = child.parts.get('POS') as Float32Array | undefined;
        const cell = boardPos && childPos ? boardCell(boardPos, childPos) : { x: NaN, y: NaN };
        placements.push({ x: cell.x, y: cell.y, instrument });
      }
    }
    out.push({
      uid: thing.uid, settings, name: chip.name, placements, boardHeight: chip.sizeY,
      author: sequencerAuthor(thing),
    });
  }
  return out;
}
