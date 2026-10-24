/**
 * Reading a level far enough to find its music.
 *
 * ## The parse is deliberately a prefix
 *
 * A level's stream is `RLevel` → `worldThing` → that Thing's parts → `PWorld` →
 * `things`, and **everything this project needs is inside `things`**. Once that
 * array is read the walk stops: the rest of `PWorld` (rewards, lighting, trophy
 * conditions, Vita branches) and the rest of `RLevel` (player record, tutorial
 * inventory, adventure data) are hundreds of lines of serialiser that would only
 * be read to reach the end of a file nobody is going to write back yet.
 *
 * ⚠️ That is a real constraint on step 7, round-trip export: writing a level
 * back out needs all of it. Stopping early is safe **only** while the direction
 * is read-only, and `StopParse` below is where that assumption lives.
 *
 * ## What cannot be skipped
 *
 * Everything before `things`, and every Thing in it. Parts carry no length and
 * object references expand inline at their first mention, so a part with no
 * reader ends the parse — see `thing.ts`, which also records why the "eight part
 * readers" figure in steering was wrong.
 */

import { loadResource, magicOf, type Inflate } from './resource.ts';
import { Serializer, SerializerError, requireLbp3, type RevisionInfo } from './serializer.ts';
import { partReaders, type GroupPart, type InstrumentPart, type Microchip, type SequencerPart } from './parts.ts';
import { readThingRef, type PartReader, type Thing } from './thing.ts';
import { toHex } from './hex.ts';

/** Thrown once `PWorld.things` is in hand, to stop reading the rest. */
class StopParse extends Error {
  readonly things: (Thing | undefined)[];
  constructor(things: (Thing | undefined)[]) {
    super('stop');
    this.things = things;
  }
}

/**
 * A struct the corpus never actually populates.
 *
 * Reading a zero count is free; a non-zero one means this level uses something
 * the reader has not been taught, and saying so beats guessing at a layout that
 * has never been exercised.
 */
function emptyOnly(s: Serializer, what: string): void {
  const count = s.i32();
  if (count !== 0) {
    throw new SerializerError(
      `${what} has ${count} entries and no reader — it was empty everywhere in the ` +
        `corpus this was built against, so its layout has never been tested`,
    );
  }
}

/** `SlotID`: an enum32 and a u32. */
function readSlotId(s: Serializer): void {
  s.i32();
  s.u32();
}

/** `StreamingID`: a wide string and a type. */
function readStreamingId(s: Serializer): void {
  s.wstr();
  s.i32();
}

/**
 * The streaming structs below carry cwlib's subVersion gates
 * (`structs/streaming/`). ⚠️ They were written for the PS3 saves at `0x213`,
 * past every gate, and read LBP3 PS4's own `0x12c` story chunks wrong until
 * the gates were put in -- steering/level-files.md, *Streaming levels*.
 */

/** `StreamingCheckpoint`. */
function readStreamingCheckpoint(s: Serializer): void {
  const { subVersion } = s.revision;
  if (subVersion > 0x72) {
    s.i32(); // type
    s.vector3(); // position
  }
  if (subVersion > 0xdc) readStreamingId(s); // startPointName
  if (subVersion >= 0x13b) readSlotId(s); // slotID
  if (subVersion > 0x115 && subVersion <= 0x128) s.s32();
}

/** `QuestTracker`. */
function readQuestTracker(s: Serializer): void {
  const { subVersion } = s.revision;
  if (subVersion > 0xeb) {
    s.vector3(); // position
    readStreamingId(s); // questID
  }
  if (subVersion > 0xf3) readStreamingId(s); // objectiveID
  if (subVersion > 0x140) {
    s.i32(); // questKey
    s.i32(); // objectiveKey
  }
}

/** `QuestSwitch`. */
function readQuestSwitch(s: Serializer): void {
  const { subVersion } = s.revision;
  if (subVersion > 0x118) {
    readStreamingId(s); // questID
    s.i32(); // questAction
  }
  if (subVersion > 0x140) s.i32(); // questKey
  if (subVersion > 0x17a) s.i32(); // objectiveID
}

/** `CollectableData`: empty below version 0x1c2. */
function readCollectableData(s: Serializer): void {
  if (s.revision.version < 0x1c2) return;
  s.resource(true); // plan
  s.s32(); // source
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
function readChunkFile(s: Serializer): void {
  const { subVersion } = s.revision;
  let sha1 = '';
  if (subVersion > 0x130) sha1 = toHex(s.sha1()); // chunkHash
  else if (subVersion >= 0x73) {
    const ref = s.resource(true); // chunkHash, as a descriptor
    if (ref?.hash) sha1 = toHex(ref.hash);
  }
  readStreamingLists(s);
  if (subVersion >= 0xde) {
    // `userResources`: descriptors that carry their type inline.
    const resources = s.count();
    for (let i = 0; i < resources; i += 1) s.resource(true, true);
  }
  if (subVersion > 0x72) {
    const min = s.vector3();
    const max = s.vector3();
    const list = chunkFiles.get(s) ?? [];
    list.push({ sha1, min, max });
    chunkFiles.set(s, list);
  }
  if (subVersion > 0x10d) {
    s.bool(); // hasObjectSaver
    s.bool(); // deleteObjectSavers
    s.bool(); // deleteOtherThings
  }
  if (subVersion > 0x133) s.bool(); // antiStreaming
  readDependencyLists(s); // the GUIDs and hashes this chunk depends on
}

/** `LevelData`: the PS3 saves at subVersion 0x213, LBP3 PS4's own levels at 0x19f..0x1ab. */
function readLevelData(s: Serializer): void {
  readSlotId(s);
  const type = s.i32();
  // ❗ **A type-2 LevelData has no chunk list**: its type is followed straight
  // by the offset. Not in cwlib, whose reader fails on these files too; measured
  // on LBP3 PS4's own story levels, where a second LevelData of type 2 follows
  // the main one and the walk ends right only without the list
  // (steering/level-files.md, *Streaming levels*).
  if (type !== 2) s.references(readChunkFile);
  s.vector3(); // offset
  s.vector3(); // min
  s.vector3(); // max
  s.reference(readLevelData); // parent
  // ⚠️ The gate was in this comment and not in the code for a month: LBP3's own
  // story levels are subVersion 0x1ab, one below it, and every one of them
  // failed a Thing marker 100 KB later (steering/answered-questions.md).
  if (s.revision.subVersion >= 0x1ac) s.guid(); // farcGuid
}

/** `StreamingManager`: the PS3 saves at subVersion 0x213, LBP3 PS4's own levels at 0x19f..0x1ab. */
function readStreamingManager(s: Serializer): void {
  emptyOnly(s, 'StreamingManager.editingThingsList');
  const count = s.count();
  for (let i = 0; i < count; i += 1) s.reference(readLevelData);
  const { subVersion } = s.revision;
  s.i32(); // numIslands
  if (subVersion > 0x1ff) s.i32(); // numPendingIslands
  s.resource(true); // fartDesc, a descriptor
  s.vector3(); // startingPointPosition
  s.i32(); // streamingZoneShape
  s.i32(); // streamingZoneSize
  s.i32(); // numInUsePlans
  if (subVersion >= 0x1a9) s.i32(); // maintainIslandsCount
}

/** `EggLink`, inline in `PWorld`'s reward lists: a plan, a bool, and an optional painting. */
function readEggLink(s: Serializer): void {
  const { version } = s.revision;
  s.resource(); // plan
  if (version > 0x23b) s.bool(); // shareable
  if (version > 0x3e0 && s.bool()) s.resource(true); // painting, behind hasPainting
}

/** `GlobalSettings`: five factors (the Vita's `nonLinearFog` is not an LBP3 branch). */
function readGlobalSettings(s: Serializer): void {
  for (let i = 0; i < 5; i += 1) s.f32();
}

/** `MoveCursor`, in `PWorld` only below subVersion 0x118. */
function readMoveCursor(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version } = s.revision;
  if (version > 0x3c1) s.i32(); // selectionFrame
  readThingRef(s, readers); // switchThing
  readThingRef(s, readers); // selection
  s.vector4(); // localPosition
  s.f32(); // localAngle
  if (version < 0x3c2) {
    s.vector4();
    s.vector4();
  }
  s.vector4(); // moveAngle
  if (version > 0x3c1) {
    for (let i = 0; i < 4; i += 1) s.vector4(); // lastRCStart, lastRCDir, currRCStart, currRCDir
    s.f32(); // lastRoll
    s.f32(); // currRoll
  }
  s.bool(); // prevMoveGrabbing
  s.bool(); // moveGrabbing
  if (version < 0x3c2) s.vector4();
  s.f32(); // zMovePos, or the old layout's trailing float
}

/**
 * `PWorld` after `things`: cwlib's `PWorld.serialize`, with the branches LBP3's
 * range (0x3b7..0x3ff) never takes left out and the Vita's branch ignored.
 *
 * ❗ **A world Thing inside a plan has parts after its `WORLD`**, and they are
 * read right only if this is. Three of LBP3 PS4's story chunks hold an island
 * whose plan carries a world Thing (`3787a9bc` in `06_titan_2`, `e864d09e` in
 * `c07_meet_giant`, `1f4a50ed` in `c09_titan_02_outro`; version 0x3f9,
 * subVersion 0x1a9 and 0x1ab). With `readWorld` stopping at `things`, that
 * Thing's `POS` began at `maxVel` and the island failed a Thing marker 8 bytes
 * on (`e864d09e`: `WORLD` 10335..17233, the marker at 17241).
 */
function readWorldTail(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version, subVersion } = s.revision;
  const things = (): void => {
    const count = s.count();
    for (let i = 0; i < count; i += 1) readThingRef(s, readers);
  };
  s.f32(); // maxVel
  s.f32(); // maxAVel
  s.s32(); // frame
  s.s32(); // simFrame
  s.i32(); // frameLevelStarted
  s.i32(); // thingUIDCounter
  s.references((self) => {
    self.str(); // EditorSelection.name
    things(); // EditorSelection.things
  }); // selections
  readThingRef(s, readers); // backdrop
  readThingRef(s, readers); // backdropNew
  s.f32(); // backdropTimer
  s.s32(); // lbp2NightDaySwapped
  s.bool(); // isPaused
  for (let i = 0; i < 5; i += 1) s.f32(); // lighting, colour correction, fog, fog tint, darkness factors
  s.array(readEggLink); // completeRewards
  s.array(readEggLink); // collectRewards
  s.array(readEggLink); // aceRewards
  s.bool(); // areRewardsShareable
  readSlotId(s); // scoreboardLevelLinkSlot
  for (let i = 0; i < 3; i += 1) s.array(readSlotId); // complete, collect and ace unlocks: `KeyLink`s
  s.s32(); // maxNumPlayers
  things(); // dissolvingThings
  things(); // oldDissolvingThings
  s.bool(); // everSpawned
  s.s32(); // spawnFailureCount
  readGlobalSettings(s); // targetGlobalSettings
  readGlobalSettings(s); // fromGlobalSettings
  s.f32(); // globalSettingsBlendFactor
  s.bool(); // hasLevelLightingBeenSetup
  s.s32(); // globalSettingsThingUID
  // `CameraSettings`: four multipliers, and two pitch ones above subVersion 0x36.
  for (let i = 0; i < (subVersion > 0x36 ? 6 : 4); i += 1) s.f32();
  for (let i = 0; i < 9; i += 1) s.f32(); // water level, wave magnitude, gravity: each current, from, target
  s.array((self) => self.f32()); // currGlobalSettingsBlendFactors
  s.array((self) => self.i32()); // globalSettingsThingUIDs
  s.array((self) => self.i32()); // globalSettingsThingPriority
  s.f32(); // waterTint
  s.vector4(); // fromWaterTintColor
  s.f32(); // targetWaterTint
  for (let i = 0; i < 6; i += 1) s.f32(); // water murkiness and bits: each current, from, target
  s.bool(); // waterDrainSoundsEnabled
  s.bool(); // currWaterDrainSoundsEnabled
  if (subVersion >= 0xe8) {
    s.bool(); // waterCausticsEnabled
    s.bool(); // currWaterCausticsEnabled
  }
  if (subVersion >= 0xf8) for (let i = 0; i < 9; i += 1) s.s32(); // water main and hint colours: each current, from, target
  if (subVersion >= 0xf8 && subVersion < 0x189) s.bool();
  if (subVersion >= 0x182) {
    s.bool(); // backdropEnabled
    s.bool(); // currBackdropEnabled
  }
  s.f32(); // currWavePos
  s.i32(); // gameMode
  if (subVersion >= 0x218) s.i32(); // gameModeRequested
  s.s32(); // nextSackbotPlayerNumber
  // `CutsceneCameraManager`.
  s.i32(); // state
  readThingRef(s, readers); // currentCutSceneCamera
  s.s32(); // timeInCurrentCamera
  s.s32(); // endCountdown
  s.f32(); // transitionStage
  s.bool(); // currentCameraTweaking
  // `GlobalAudioSettings`.
  s.s32(); // reverb
  for (let i = 0; i < 4; i += 1) s.f32(); // music, sfx, background, dialogue volumes
  for (let i = 0; i < 6; i += 1) s.f32(); // reverb sends and low-pass filters
  if (subVersion >= 0xd8) for (let i = 0; i < 3; i += 1) s.f32(); // high-pass filters
  if (subVersion >= 0xe2) s.str(); // ambianceTrack
  s.resource(true); // backdropPlan
  s.resource(true); // backdropNewPlan
  s.bool(); // subLevel
  s.bool(); // scoreLocked
  s.s32(); // debugTimeInLevel
  s.bool(); // useEvenNewerCheckpointCode
  if (version >= 0x3bd && subVersion <= 0x117) s.array((self) => readMoveCursor(self, readers)); // moveCursors
  if (subVersion > 0x215) s.bool(); // singlePlayer
  if (version >= 0x3d0) {
    s.u8(); // minPlayers
    s.u8(); // maxPlayers
    s.bool(); // moveRecommended
  }
  if (version >= 0x3dd) s.bool(); // fixInvalidInOutMoverContacts
  if (version >= 0x3f1) s.bool(); // continueMusic
  if (subVersion >= 0x2f) {
    s.array((self) => {
      readThingRef(self, readers); // sourceMicrochip
      readThingRef(self, readers); // clonedMicrochip
    }); // broadcastMicroChipEntries
  }
  if (subVersion >= 0x5d) s.i32(); // manualJumpDown
  if (subVersion >= 0x98 && subVersion < 0xe5) things();
  if (subVersion >= 0xc3 && subVersion < 0xe5) things();
  if (subVersion >= 0x98 && subVersion < 0xe5) things();
  if (subVersion >= 0xe5) things(); // deferredDestroys
  if (subVersion >= 0xcf) for (let i = 0; i < 3; i += 1) s.f32(); // globalDofFront, globalDofBack, globalDofSackTrack
  if (subVersion >= 0xda) s.bool(); // enableSackpocket
  if (subVersion >= 0x170) s.bool(); // showQuestLog
  if (subVersion >= 0x11d) readSlotId(s); // scoreboardUnlockLevelSlot
  if (subVersion >= 0x154) s.wstr(); // progressBoardLevelLinkStartPoint
  if (subVersion >= 0x15e) s.bool(); // isLBP3World
}

/**
 * `PWorld`: its Things, and with `tail` everything after them.
 *
 * The fields before `things` are few and all gated on subVersion. Each gate below
 * reads its field or nothing; whatever older layout cwlib has behind them is
 * omitted rather than left as dead code. `readLevel`'s outermost
 * world passes `tail` false: the parse stops at its Things and reads nothing after.
 */
function readWorld(s: Serializer, readers: ReadonlyMap<string, PartReader>, tail = true): Thing[] {
  const { subVersion } = s.revision;
  if (subVersion >= 0x6d) {
    s.f32(); // backdropOffsetX
    s.f32(); // backdropOffsetY
    s.f32(); // backdropOffsetZ
  }
  if (subVersion >= 0x70) s.bool(); // backdropOffsetZAuto
  if (subVersion >= 0xe2) s.str(); // overrideBackdropAmbience
  if (subVersion >= 0x3f) s.reference(readStreamingManager);
  // Every Thing goes through `referenceInto` so that the cycles in a level --
  // a Thing's parent, a switch's target -- resolve to the real object rather
  // than the empty placeholder `reference` would register.
  const count = s.count();
  const things: (Thing | undefined)[] = [];
  for (let i = 0; i < count; i += 1) things.push(readThingRef(s, readers));
  if (tail) readWorldTail(s, readers);
  // ⚠️ **It returns; only the OUTERMOST world stops the parse.** `readLevel`
  // wraps this and throws `StopParse` the first time. A level can carry a second
  // world Thing deeper in the graph -- one turned up inside a `CREATURE` in
  // `5576f758` from the public archive, uid -1 with no parent, the same shape as
  // the level's own world -- and throwing there would have returned that inner
  // world's Things as if they were the level's.
  return things.filter((t): t is Thing => t !== undefined);
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
}

/** Inflate a resource and start a serialiser on it, with the revision checked. */
async function open(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<{ revision: RevisionInfo; flags: number; s: Serializer }> {
  const resource = await loadResource(bytes, inflate);
  // `Revision.branch` is the head word's high half, which serializer.ts spells
  // `subVersion` -- the branch proper is the separate pair on the resource.
  const revision: RevisionInfo = {
    version: resource.revision.version,
    subVersion: resource.revision.branch,
    branchId: resource.branchId,
    branchRevision: resource.branchRevision,
  };
  requireLbp3(revision);
  return {
    revision,
    flags: resource.compressionFlags,
    s: new Serializer(resource.data, revision, resource.compressionFlags),
  };
}

/** The subVersion that put `isUsedForStreaming` at the head of `RPlan`. */
const STREAMING_PLAN = 0xcc;

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
 * ...   inventoryData        head >= 0x197 and not streaming -- never read here
 * ```
 */
export async function readPlan(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: ReadonlyMap<string, PartReader>,
): Promise<LevelParse> {
  const { revision, flags, s } = await open(bytes, inflate);
  if (revision.subVersion >= STREAMING_PLAN) s.bool();
  s.i32();
  const inner = new Serializer(s.bytes(s.i32()), revision, flags);
  // A plan can hold a world Thing -- 3 islands of the game's story chunks do --
  // and its WORLD part is read like an inner world of a level: its Things are
  // the part's value, not the plan's. Installed on the map the readers close
  // over, as `readLevel` does, and only where nothing installed one already.
  const map = readers as Map<string, PartReader>;
  if (!map.has('WORLD')) map.set('WORLD', (self) => readWorld(self, map));
  const count = inner.i32();
  const things: (Thing | undefined)[] = [];
  for (let i = 0; i < count; i += 1) things.push(readThingRef(inner, readers));
  // ❗ **The array fills the blob exactly, and that is checked.** `thingData`
  // holds the Thing array and nothing else, so bytes left over mean a part
  // reader took the wrong number and the parse is wrong even though it finished.
  // Measured: 0 bytes left on all 220 corpus plans that parse at all.
  if (inner.remaining !== 0) {
    throw new SerializerError(
      `the plan's Thing array left ${inner.remaining} of ${inner.data.length} bytes ` +
        'unread — a part reader consumed the wrong number of bytes',
    );
  }
  return { revision, things };
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
function readIsland(s: Serializer, plans: Uint8Array[], bounds: IslandBounds[]): void {
  s.i32(); // timeZone
  // ⚠️ Two i32s before the bounds at subVersion 0x213 (the PS3 saves), one at
  // 0x1ab (LBP3 PS4's own story chunks, 41,741 of them): the gate lies between,
  // where no file here sits. Which of the two is the newer is not known.
  if (s.revision.subVersion > 0x1ab) s.i32(); // flags
  const min = s.vector3();
  const max = s.vector3();
  bounds.push({ min, max });
  plans.push(s.bytes(s.i32())); // planData
  readStreamingLists(s);
  readDependencyLists(s);
}

/**
 * The four lists and the dependency lists a `ChunkFile` and a
 * `StreamingIsland` share, under cwlib's `ChunkFile` gates: below `0x16a` an
 * island ends after its collectables (the `0x12c` story chunks).
 */
function readStreamingLists(s: Serializer): void {
  const { subVersion } = s.revision;
  if (subVersion > 0x72) s.array(readStreamingCheckpoint);
  if (subVersion > 0xeb) s.array(readQuestTracker);
  if (subVersion > 0x118) s.array(readQuestSwitch);
  if (subVersion > 0x11d) s.array(readCollectableData);
}

function readDependencyLists(s: Serializer): void {
  if (s.revision.subVersion <= 0x169) return;
  const guids = s.count();
  for (let i = 0; i < guids; i += 1) s.guid();
  const hashes = s.count();
  for (let i = 0; i < hashes; i += 1) s.sha1();
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
  const plans: Uint8Array[] = [];
  const bounds: IslandBounds[] = [];
  s.references((self) => readIsland(self, plans, bounds));
  if (revision.subVersion > 0x1ab) s.intVector(); // islandChunkCodeList
  if (s.remaining !== 0) {
    throw new SerializerError(
      `the chunk's island list left ${s.remaining} of ${s.data.length} bytes unread`,
    );
  }
  return { revision, plans, bounds };
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
 */
export async function readChunk(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: ReadonlyMap<string, PartReader>,
): Promise<LevelParse> {
  const { revision, plans } = await readChunkIslands(bytes, inflate);
  const things: (Thing | undefined)[] = [];
  const problems: string[] = [];
  for (let island = 0; island < plans.length; island += 1) {
    try {
      things.push(...(await readPlan(plans[island], inflate, readers)).things);
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
 */
export async function readLevel(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: ReadonlyMap<string, PartReader>,
): Promise<LevelParse> {
  const { revision, s } = await open(bytes, inflate);

  // `RLevel`: the cross-play hashes came in at 0x3e7, and the corpus straddles
  // that, so the count is only there on the later files.
  if (revision.version > 0x3e6) {
    const count = s.count();
    for (let i = 0; i < count; i += 1) s.sha1();
  }

  // ❗ **Installed on the map the part readers already captured, not on a copy.**
  // `partReaders` binds every reader as `(s) => read(s, readers)`, closing over
  // the map it built; a copy with `WORLD` added is a map nothing looks at, so a
  // world Thing anywhere below the first one threw "no reader for part WORLD".
  // That is one of the 43 archive levels, `5576f758`, and it is why this line
  // does not say `new Map(readers)`.
  let outermost = true;
  const worldReaders = readers as Map<string, PartReader>;
  worldReaders.set('WORLD', (self) => {
    if (!outermost) return readWorld(self, worldReaders);
    const things = readWorld(self, worldReaders, false);
    outermost = false;
    throw new StopParse(things);
  });

  try {
    readThingRef(s, worldReaders);
  } catch (error) {
    if (error instanceof StopParse) return { revision, things: error.things, chunks: chunkFiles.get(s) ?? [] };
    throw error;
  }
  throw new SerializerError('the world Thing carried no WORLD part');
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
      for (const child of things) {
        if (!child || child.parent !== chip.board) continue;
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
