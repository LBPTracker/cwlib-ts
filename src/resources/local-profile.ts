/**
 * `RLocalProfile` -- magic `IPRb`, a player's local settings and history: the
 * inventory, what they have played and viewed, their metrics, pins, tutorials
 * and options. cwlib's `resources/RLocalProfile.java` and the structs it reads
 * (ennuo/toolkit `d6a2ef8`), every gate as Java has it.
 *
 * ⚠️ **Ported from Java and proven on no file**: neither the install, its
 * update nor the saves on this machine hold one (steering/java-parity.md). No
 * revision bound is applied. Where Java drops a value (`serializer.bool(false)`
 * on reading), it is dropped here too; below version `0x187` Java reads nothing
 * at all, and so does this.
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, vitaRevision, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';
import { toHex } from '../io/hex.ts';
import { fromHex } from '../io/hex.ts';
import { Writer } from '../io/writer.ts';
import { keptField as kept, readNetworkIds, readNetworkOnlineIdKept, readNetworkPlayerIdKept, writeNetworkIds, writeNetworkOnlineId, writeNetworkPlayerId } from '../structs/network.ts';
import { readSlot, readSlotId, writeSlot, writeSlotId, type Slot, type SlotId } from '../structs/slot.ts';
import { LD_ANY, onLeerdammer } from '../things/thing.ts';
import { readInventoryItem, writeInventoryItem, type InventoryItem } from '../things/parts/poppet-powerup.ts';
import { readPlayedLevelData, writePlayedLevelData, type PlayedLevelData } from './adventure-create-profile.ts';
import { readStringLookupTable, writeStringLookupTable, type StringLookupTable } from './big-profile.ts';


// cwlib's `Revisions`, as `RLocalProfile` and its structs gate on them.
const LD_SAVEGAME_INFO = 0x3;
const LD_NEWS_TIMESTAMP = 0xd;
const LD_REMOVED_ENEMY_STAT = 0x11;
const LD_QUEUE = 0x12;
const LD_THERMOMETER = 0x14;
const LD_OWNER_ID = 0x16;
const LD_WATER_LEVELS = 0x17;
const D1_DATALABELS = 0x2e;
const D1_PROTECTED_LABELS = 0x31;
const D1_LABEL_ANALOGUE_ARRAY = 0x33;
const D1_LABEL_TERNARY = 0x3c;
const D1_3G_CONNECTIVITY = 0x58;
const D1_LEVEL_TIMES_MAP = 0x60;
const D1_MOE_PIN_PROGRESS = 0x64;
const D1_TOUCH_CREATE = 0x69;
const D1_CREATE_WARNING = 0x74;
const D1_CREATE_BETA = 0x75;
const D1_WAS_TRIAL = 0x81;
const PIN_FLAGS = 0x33b;
const WEEKDAYS_PLAYED_PIN = 0x34b;
const PROFILE_PINS = 0x385;
const PTG_USE_DEFAULT_BACKGROUND = 0x3e0;
const DATALABELS = 0x3ef;
const COLLECTION_POPPET_POWERUP = 0x9;
const SLAPPED_AS_PIN = 0x177;
const SIMON_SAYS_PIN = 0x209;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** cwlib's `intarray(…, true)`: each element an `s32`. */
const signedArray = (s: Serializer): number[] => s.array((x) => x.s32());

/** cwlib's `intvector(…, true)`: a vector whose values are zigzag-signed when packed. */
function signedVector(s: Serializer): number[] {
  if ((s.compressionFlags & 2) === 0) return signedArray(s);
  return s.intVector().map((v) => (v >>> 1) ^ -(v & 1));
}

/** A plain count and that many SHA-1s, as cwlib writes them by hand. */
const sha1List = (s: Serializer): string[] => Array.from({ length: s.i32() }, () => toHex(s.sha1()));

const ldHas = (r: RevisionInfo, since: number): boolean => onLeerdammer(r, since);

export interface ViewedLevelData {
  readonly slotId: SlotId;
  readonly lastReviewCount: number;
  readonly lastCommentCount: number;
  readonly lastPhotoCount: number;
  readonly lastAuthorPhotoCount: number;
  readonly lastStreamEventTimestamp: bigint;
  readonly lastViewedTimestamp: bigint;
}

export interface ViewedPlayerData {
  readonly onlineId: string;
  /** `onlineId`'s `NetworkOnlineID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly onlineIdBytes?: Uint8Array;
  readonly lastReviewCount: number;
  readonly lastCommentCount: number;
  readonly lastPhotosByMeCount: number;
  readonly lastPhotosWithMeCount: number;
  readonly lastFavouriteSlotsCount: number;
  readonly lastFavouriteUsersCount: number;
  readonly lastStreamEventTimestamp: bigint;
  readonly lastViewedTimestamp: bigint;
}

export interface PlayerMetrics {
  readonly totalTime?: number;
  readonly editingTime?: number;
  readonly playingTime?: number;
  readonly idlingTime?: number;
  readonly multiplayerGamesCount?: number;
  /** The Vita's: a level's time by level. */
  readonly levelTimesMap?: readonly (readonly [number, number])[];
  readonly totalLevelTime?: number;
  readonly playLadderPoints?: number;
  readonly storyLevelCompletionCount?: number;
  readonly communityLevelCompletionCount?: number;
  readonly levelCompletionCount?: number;
  readonly levelsTaggedCount?: number;
  readonly gamesWithRandomPlayersCount?: number;
  readonly pointsCollected?: number;
  readonly stats?: readonly bigint[];
  /** Versions 0x1df--0x2ca: `enemiesKilled`, which cwlib drops. Kept to be written back. */
  readonly enemiesKilled?: number;
}

const hasEnemiesKilled = (r: RevisionInfo): boolean =>
  r.version > 0x1de && r.version < 0x2cb && (!onLeerdammer(r, LD_ANY) || r.branchRevision < LD_REMOVED_ENEMY_STAT);

function readPlayerMetrics(s: Serializer): PlayerMetrics {
  const r = s.revision;
  const head = r.version;
  const out: Mutable<PlayerMetrics> = {};
  if (head > 0x16f) {
    out.totalTime = s.i32();
    out.editingTime = s.i32();
    out.playingTime = s.i32();
    out.idlingTime = s.i32();
  }
  if (head > 0x183) out.multiplayerGamesCount = s.i32();
  if (vitaRevision(r) >= D1_LEVEL_TIMES_MAP) {
    out.levelTimesMap = Array.from({ length: s.i32() }, () => [s.i32(), s.i32()] as const);
    out.totalLevelTime = s.i32();
  }
  if (head > 0x1c9) out.playLadderPoints = s.f32();
  if (head > 0x1ab) out.storyLevelCompletionCount = s.i32();
  if (head > 0x1f7) out.communityLevelCompletionCount = s.i32();
  if (head > 0x1ab) out.levelCompletionCount = s.i32();
  if (head > 0x1f7) out.levelsTaggedCount = s.i32();
  if (head > 0x1c9) out.gamesWithRandomPlayersCount = s.i32();
  // enemiesKilled, which cwlib drops; the LEERDAMMER branch removed it at its revision 0x11.
  if (hasEnemiesKilled(r)) out.enemiesKilled = s.i32();
  if (head > 0x1de) out.pointsCollected = s.f32();
  if (head >= 0x1ea) out.stats = s.array((x) => x.u64Big());
  return out;
}

export interface InventoryView {
  readonly type: number;
  readonly subType: number;
  readonly title: string;
  readonly heartedOnly: boolean;
  readonly customID: number;
  readonly currentSortMode: number;
  readonly desiredSortMode: number;
}

function readInventoryView(s: Serializer): InventoryView {
  return {
    type: s.i32(), subType: s.i32(), title: s.wstr(), heartedOnly: s.bool(),
    customID: s.i32(), currentSortMode: s.i32(), desiredSortMode: s.i32(),
  };
}

export interface LegacyInventoryCollection {
  readonly inventoryViews: readonly (InventoryView | undefined)[];
  readonly currentPageNumber: number;
  readonly collectionID: number;
  readonly actionOnItemSelect: number;
}

export interface InventoryCollection {
  readonly inventoryCollectionIndex: number;
  readonly inventoryPageInstances: readonly ({ readonly inventoryPageTitleKey: number; readonly desiredSortMode: number } | undefined)[];
  readonly currentPageNumber: number;
  readonly poppetPowerupSelection?: boolean;
}

export interface PinsAwarded {
  readonly pinAwards?: readonly { readonly pinID: number; readonly awardCount: number }[];
  readonly pinProgress?: readonly { readonly progressType: number; readonly progressCount: number }[];
  readonly recentlyAwardedPinIDs?: readonly number[];
  readonly profileDisplayPinIDs?: readonly number[];
  readonly pinsFlags?: number;
  readonly weekdaysPlayedBits?: number;
  readonly moreOfEverythingPinProgress?: number;
  readonly slappedAsBits?: number;
  readonly simonSaysProgress?: number;
}

function readPinsAwarded(s: Serializer): PinsAwarded {
  const r = s.revision;
  const out: Mutable<PinsAwarded> = {};
  if (r.version >= PROFILE_PINS) {
    out.pinAwards = s.array((x) => ({ pinID: x.i32(), awardCount: x.i32() }));
    out.pinProgress = s.array((x) => ({ progressType: x.i32(), progressCount: x.i32() }));
    out.recentlyAwardedPinIDs = s.intVector();
    out.profileDisplayPinIDs = s.intVector();
  }
  if (r.version >= PIN_FLAGS) out.pinsFlags = s.i8();
  if (r.version >= WEEKDAYS_PLAYED_PIN) out.weekdaysPlayedBits = s.i8();
  if (vitaRevision(r) >= D1_MOE_PIN_PROGRESS) out.moreOfEverythingPinProgress = s.i32();
  if (r.subVersion >= SLAPPED_AS_PIN) out.slappedAsBits = s.i8();
  if (r.subVersion >= SIMON_SAYS_PIN) out.simonSaysProgress = s.i32();
  return out;
}

export interface PaintProperties {
  readonly triggerOverride: number;
  readonly stickerSaveSize: number;
  readonly angleOverride: boolean;
  readonly uiHidden: boolean;
  /** An `RPainting`, a descriptor. */
  readonly lastAutoSave?: ResourceRef;
  readonly useDefaultBackground?: boolean;
}

export interface DataLabelValue {
  readonly creatorID: string;
  /** `creatorID`'s `NetworkOnlineID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly creatorIDBytes?: Uint8Array;
  readonly labelIndex: number;
  readonly analogue?: readonly number[];
  readonly ternary?: Uint8Array;
}

function readDataLabelValue(s: Serializer): DataLabelValue {
  const r = s.revision;
  const creator = kept('creatorID', readNetworkOnlineIdKept(s));
  const labelIndex = s.i32();
  const vita = vitaRevision(r);
  let analogue: number[] | undefined;
  let ternary: Uint8Array | undefined;
  if (vita >= 0) {
    if (vita >= D1_LABEL_ANALOGUE_ARRAY) analogue = s.array((x) => x.f32());
    else if (vita >= D1_DATALABELS) analogue = [s.f32()];
    if (vita >= D1_LABEL_TERNARY) ternary = s.bytes(s.i32());
  } else if (r.version >= DATALABELS) {
    analogue = s.array((x) => x.f32());
    ternary = s.bytes(s.i32());
  }
  return { ...creator, labelIndex, analogue, ternary };
}

export interface PlayerDataLabels {
  readonly values: readonly DataLabelValue[];
  readonly protectedIds?: readonly string[];
  /** Each of `protectedIds`' `NetworkOnlineID`s as stored, where any holds more than its handle (`structs/network.ts`). */
  readonly protectedIdsBytes?: readonly (Uint8Array | undefined)[];
}

function readPlayerDataLabels(s: Serializer): PlayerDataLabels {
  const r = s.revision;
  const values = s.array(readDataLabelValue);
  if (!(vitaRevision(r) >= D1_PROTECTED_LABELS || r.version >= DATALABELS)) return { values, protectedIds: undefined };
  const ids = readNetworkIds(s, false);
  return { values, protectedIds: ids.handles, ...(ids.bytes ? { protectedIdsBytes: ids.bytes } : {}) };
}

export interface GoPlayCache {
  readonly levelID: SlotId;
  readonly planetID: SlotId;
  readonly numBubbleCollected: number;
  readonly awardLevelComplete: number;
  readonly awardCollectAll: number;
  readonly awardAcedLevel: number;
}

/** Everything cwlib's `RLocalProfile` holds; a field gated off by the revision is absent. */
export interface LocalProfile {
  readonly revision: RevisionInfo;
  readonly inventory?: readonly InventoryItem[];
  readonly stringTable?: StringLookupTable;
  readonly fromProductionBuild?: boolean;
  /** cwlib's `TutorialLevel` to `TutorialState`, enum32 each. */
  readonly lbp1TutorialStates?: readonly (readonly [number, number])[];
  readonly dlcPackViewed?: readonly number[];
  readonly dlcPackShown?: readonly number[];
  readonly lbp1MainMenuButtonUnlocks?: number;
  readonly playedLevelData?: readonly PlayedLevelData[];
  readonly viewedLevelData?: readonly ViewedLevelData[];
  readonly viewedPlayerData?: readonly ViewedPlayerData[];
  readonly oldMyMoonSlots?: readonly { readonly id: SlotId; readonly slot: Slot }[];
  readonly copiedFromAnotherUser?: boolean;
  readonly fixedUpByDeveloper?: boolean;
  readonly showSaveGameInfo?: boolean;
  readonly totalLevelCount?: number;
  readonly lastMmPicksCount?: number;
  readonly lastNewsItemTimestamp?: bigint;
  readonly lastStreamEventTimestamp?: bigint;
  readonly lolcatFtwTimestamp?: bigint;
  readonly oldTextSearches?: readonly string[];
  readonly oldDiscoveredLinks?: readonly { readonly from: SlotId; readonly to: SlotId }[];
  readonly pendingLinks?: readonly { readonly from: SlotId; readonly to: SlotId }[];
  readonly lastPlayed?: SlotId;
  readonly lbp1VideosPlayed?: readonly number[];
  readonly lbp2VideosPlayed?: readonly number[];
  readonly currentPlayerMetrics?: PlayerMetrics;
  readonly lastPostedPlayerMetrics?: PlayerMetrics;
  readonly lbp1GameProgressionStatus?: number;
  readonly lbp1GameProgressionEventHappenedBits?: number;
  readonly lbp1GameProgressionEventsExplainedBits?: number;
  readonly demoProgressionStatus?: number;
  readonly lbp2GameProgressionFlags?: number;
  readonly pendingInventoryItems?: readonly InventoryItem[];
  /** An `RLevel`, a descriptor. */
  readonly podLevel?: ResourceRef;
  readonly playerId?: string;
  /** `playerId`'s `NetworkPlayerID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly playerIdBytes?: Uint8Array;
  readonly ownerPlayerId?: string;
  /** `ownerPlayerId`'s `NetworkPlayerID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly ownerPlayerIdBytes?: Uint8Array;
  /** `OpenPSID`: two u64s. */
  readonly ownerPsid?: readonly [bigint, bigint];
  readonly ownerUserId?: number;
  readonly eulaAgreed?: Uint8Array;
  readonly acceptingPlayer?: string;
  /** `acceptingPlayer`'s `NetworkPlayerID` as stored, where it holds more than the handle (`structs/network.ts`). */
  readonly acceptingPlayerBytes?: Uint8Array;
  /** An `RSyncedProfile`, a descriptor. */
  readonly syncedProfile?: ResourceRef;
  readonly voipMutedPlayers?: readonly string[];
  /** Each of `voipMutedPlayers`' `NetworkPlayerID`s as stored, where any holds more than its handle (`structs/network.ts`). */
  readonly voipMutedPlayersBytes?: readonly (Uint8Array | undefined)[];
  readonly voipChatPaused?: boolean;
  readonly enableMusicInPlayMode?: boolean;
  readonly enableMusicInPod?: boolean;
  readonly legacyInventoryCollections?: readonly (LegacyInventoryCollection | undefined)[];
  readonly legacyInventoryViews?: readonly (InventoryView | undefined)[];
  readonly inventoryCollections?: readonly (InventoryCollection | undefined)[];
  readonly avatarIcon?: ResourceRef;
  readonly saveIcon?: ResourceRef;
  readonly lbp1CreateModeVOProgress?: number;
  readonly gamma?: number;
  readonly screenSize?: number;
  readonly hasSeenCalibrationScreen?: boolean;
  readonly lbp1VOPlayed?: readonly number[];
  readonly lbp2VOPlayed?: readonly number[];
  readonly subtitleMode?: number;
  readonly pinsAwarded?: PinsAwarded;
  readonly userSettingPhotoBooth?: boolean;
  readonly userSettingAdvancedEditMode?: boolean;
  readonly userSettingCollection?: boolean;
  readonly showThermometer?: boolean;
  readonly saveOnlinePlaySettings?: boolean;
  readonly onlinePlayMode?: number;
  readonly friendJoinRequestMode?: number;
  readonly nonFriendJoinRequestMode?: number;
  readonly lbp2TutorialsPlayed?: readonly number[];
  readonly sectionHeadingToggled?: readonly number[];
  readonly mysteryPodEventsSeen?: readonly { readonly id: number; readonly type: number }[];
  readonly lastLegacyImportedProfileHashLBP1?: readonly string[];
  readonly lastLegacyImportedProfileHashLBP2?: readonly string[];
  readonly playedLBP1?: boolean;
  readonly playedLBP2?: boolean;
  readonly hasPerformedFirstRun?: boolean;
  readonly lbp2TutorialUnlockButtonUnleashed?: boolean;
  readonly hiddenCategories?: readonly number[];
  readonly collectedBubbles?: readonly { readonly level?: ResourceRef; readonly thingUID: number; readonly plan?: ResourceRef }[];
  readonly numWaterLevelsPlayed?: number;
  readonly autoFilterOn?: boolean;
  readonly hasUsed6Axis?: boolean;
  readonly hasUsedMove?: boolean;
  readonly paintProperties?: PaintProperties;
  readonly playerDataLabels?: PlayerDataLabels;
  readonly total3GUpStream?: number;
  readonly total3GDownStream?: number;
  readonly createRearTouchPan?: boolean;
  readonly createRearTouchPinchZoom?: boolean;
  readonly createRearTapZoom?: boolean;
  readonly createFrameRateWarningMessages?: boolean;
  readonly onlineBetaNetworkTimestamp?: bigint;
  readonly onlineBetaPlayTimeSinceOnline?: number;
  readonly onlineBetaBootsSinceOnline?: number;
  readonly distanceMovedWhilstAttracted?: number;
  readonly beakersUsedPart1?: number;
  readonly beakersUsedPart2?: number;
  readonly profileFlags?: number;
  readonly goldMedalsAwarded?: readonly number[];
  readonly goldMedalStoryArcPins?: number;
  readonly twitterEnabled?: boolean;
  readonly facebookEnabled?: boolean;
  readonly twitterAccessToken?: string;
  readonly twitterAccessTokenSecret?: string;
  readonly createChallengeTutorialSeen?: boolean;
  readonly playChallengeTutorialSeen?: boolean;
  readonly ownedLBP?: number;
  readonly dceUuidState?: number;
  readonly lastPlayedPPP?: boolean;
  readonly lastPlayedPlanet?: SlotId;
  readonly lastPlayedEarthAdv?: boolean;
  readonly hasSeenDiveInBetaMessage?: boolean;
  readonly touchCreateCursorMode?: number;
  readonly showAdvancedEditModeMessageCounter?: number;
  readonly showAdventureSaveWarning?: boolean;
  readonly totalFramesInEditMode?: number;
  readonly onlineTutorialsPlayed?: readonly string[];
  readonly popitPuzzlesCompleted?: readonly SlotId[];
  readonly timesaverNoticeViewed?: boolean;
  readonly questProgressPin?: number;
  readonly activityFilterToggled?: readonly number[];
  readonly lastLandingPageFocusItems?: number;
  readonly goPlayCache?: readonly GoPlayCache[];
  /** Versions 0x256--0x350: an integer cwlib reads and drops. Kept to be written back, as are the rest. */
  readonly dropped351?: number;
  /** Version 0x261: a bool after `userSettingCollection` cwlib drops. */
  readonly dropped261?: boolean;
  /** The Vita's from its 0x86 and 0x87: dropped by cwlib. */
  readonly hasSeenCrossCompatInfo?: boolean;
  readonly wantsCrossCompatDownloadNotification?: boolean;
  /** The Vita's from its 0x81: dropped by cwlib. */
  readonly wasTrial?: boolean;
  /** Read twice where both gates hold (subVersion above 0x37, version above 0x3f3): the first, which the second replaces. */
  readonly playedLBP2First?: boolean;
  /** Read twice where both gates hold (subVersion above 0x37, versions 0x3f6--0x3f8): the first, which the second replaces. */
  readonly lastLegacyImportedProfileHashLBP2First?: readonly string[];
}

const slotLink = (s: Serializer): { from: SlotId; to: SlotId } => ({ from: readSlotId(s), to: readSlotId(s) });

/** Read an `IPRb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readLocalProfile(bytes: Uint8Array, inflate: Inflate): Promise<LocalProfile> {
  const { resource, revision: r, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'IPRb') throw new SerializerError(`not a local profile: "${resource.magic}"`);
  const { version, subVersion } = r;
  const vita = vitaRevision(r);
  const out: Mutable<LocalProfile> = { revision: r };
  if (version < 0x187) return out;

  out.inventory = s.array(readInventoryItem);
  out.stringTable = readStringLookupTable(s);
  if (version >= 0x3b6) out.fromProductionBuild = s.bool();
  if (version > 0x1e3) out.lbp1TutorialStates = Array.from({ length: s.i32() }, () => [s.i32(), s.i32()] as const);
  if (version > 0x265) {
    out.dlcPackViewed = signedArray(s);
    out.dlcPackShown = signedArray(s);
  }
  if (version > 0x1e4) out.lbp1MainMenuButtonUnlocks = s.i32();
  if (version >= 0x16e) out.playedLevelData = s.array(readPlayedLevelData);
  if (version > 0x379) {
    out.viewedLevelData = s.array((x) => ({
      slotId: readSlotId(x), lastReviewCount: x.s32(), lastCommentCount: x.s32(), lastPhotoCount: x.s32(),
      lastAuthorPhotoCount: x.s32(), lastStreamEventTimestamp: x.s64Big(), lastViewedTimestamp: x.s64Big(),
    }));
    out.viewedPlayerData = s.array((x) => ({
      ...kept('onlineId', readNetworkOnlineIdKept(x)), lastReviewCount: x.s32(), lastCommentCount: x.s32(),
      lastPhotosByMeCount: x.s32(), lastPhotosWithMeCount: x.s32(), lastFavouriteSlotsCount: x.s32(),
      lastFavouriteUsersCount: x.s32(), lastStreamEventTimestamp: x.s64Big(), lastViewedTimestamp: x.s64Big(),
    }));
  }
  if (version > 0x16d) out.oldMyMoonSlots = Array.from({ length: s.i32() }, () => ({ id: readSlotId(s), slot: readSlot(s) }));
  if (version > 0x20d) out.copiedFromAnotherUser = s.bool();
  if (version > 0x267) out.fixedUpByDeveloper = s.bool();
  if (version > 0x296 || ldHas(r, LD_SAVEGAME_INFO)) {
    out.showSaveGameInfo = s.bool();
    out.totalLevelCount = s.i32();
  }
  if (version > 0x393) out.lastMmPicksCount = s.i32();
  if (version > 0x2cb || ldHas(r, LD_NEWS_TIMESTAMP)) out.lastNewsItemTimestamp = s.s64Big();
  if (version > 0x323) out.lastStreamEventTimestamp = s.s64Big();
  if (version > 0x2cc || ldHas(r, LD_QUEUE)) out.lolcatFtwTimestamp = s.s64Big();
  if (version >= 0x328) out.oldTextSearches = Array.from({ length: s.i32() }, () => s.wstr());
  out.oldDiscoveredLinks = s.array(slotLink);
  out.pendingLinks = s.array(slotLink);
  out.lastPlayed = readSlotId(s);
  if (version > 0x17d) out.lbp1VideosPlayed = s.array((x) => x.i32());
  if (version > 0x36b) out.lbp2VideosPlayed = s.array((x) => x.i32());
  if (version > 0x16f) out.currentPlayerMetrics = readPlayerMetrics(s);
  if (version > 0x1ab) out.lastPostedPlayerMetrics = readPlayerMetrics(s);
  if (version > 0x1b8) out.lbp1GameProgressionStatus = s.i32();
  if (version > 0x1cf) {
    out.lbp1GameProgressionEventHappenedBits = s.i32();
    out.lbp1GameProgressionEventsExplainedBits = s.i32();
  }
  if (version > 0x26c) out.demoProgressionStatus = s.i32();
  if (version > 0x36b) out.lbp2GameProgressionFlags = s.i32();
  if (version >= 0x387) out.pendingInventoryItems = s.array(readInventoryItem);
  out.podLevel = s.resource(true);
  if (version > 0x14f) Object.assign(out, kept('playerId', readNetworkPlayerIdKept(s)));
  if (version > 0x296 || ldHas(r, LD_SAVEGAME_INFO)) {
    Object.assign(out, kept('ownerPlayerId', readNetworkPlayerIdKept(s)));
    out.ownerPsid = [s.u64Big(), s.u64Big()];
  }
  if (version > 0x2eb || ldHas(r, LD_OWNER_ID)) out.ownerUserId = s.i32();
  if (version > 0x175) out.eulaAgreed = s.sha1();
  if (version >= 0x3d5) Object.assign(out, kept('acceptingPlayer', readNetworkPlayerIdKept(s)));
  out.syncedProfile = s.resource(true);
  if (version > 0x1a1) {
    const muted = readNetworkIds(s, true);
    out.voipMutedPlayers = muted.handles;
    if (muted.bytes) out.voipMutedPlayersBytes = muted.bytes;
    out.voipChatPaused = s.bool();
    out.enableMusicInPlayMode = s.bool();
  }
  if (version > 0x1b4) out.enableMusicInPod = s.bool();
  if (version > 0x1b5) {
    out.legacyInventoryCollections = s.array((x) => x.reference((y) => ({
      inventoryViews: y.array((z) => z.reference(readInventoryView)),
      currentPageNumber: y.i32(), collectionID: y.i32(), actionOnItemSelect: y.i32(),
    })));
    out.legacyInventoryViews = s.array((x) => x.reference(readInventoryView));
  }
  if (version > 0x316) {
    out.inventoryCollections = s.array((x) => x.reference((y) => ({
      inventoryCollectionIndex: y.i32(),
      inventoryPageInstances: y.array((z) => z.reference((w) => ({ inventoryPageTitleKey: w.i32(), desiredSortMode: w.i32() }))),
      currentPageNumber: y.i32(),
      ...(y.revision.subVersion >= COLLECTION_POPPET_POWERUP ? { poppetPowerupSelection: y.bool() } : {}),
    })));
  }
  if (version > 0x1e0) out.avatarIcon = s.resource(true);
  if (version > 0x23c) out.saveIcon = s.resource(true);
  if (version > 0x1e5) out.lbp1CreateModeVOProgress = s.i32();
  if (version > 0x1ff) {
    out.gamma = s.f32();
    out.screenSize = s.f32();
  }
  if (version > 0x35e) out.hasSeenCalibrationScreen = s.bool();
  if (version > 0x205) out.lbp1VOPlayed = signedVector(s);
  if (version > 0x36b) out.lbp2VOPlayed = signedVector(s);
  if (version > 0x23a) out.subtitleMode = s.s32();
  if (version > 0x255 && version < 0x351) out.dropped351 = s.i32();
  if (version > 0x32e) out.pinsAwarded = readPinsAwarded(s);
  if (version > 0x260) {
    out.userSettingPhotoBooth = s.bool();
    if (subVersion > 0x17e) out.userSettingAdvancedEditMode = s.bool();
    out.userSettingCollection = s.bool();
    if (version === 0x261) out.dropped261 = s.bool();
  }
  if (version > 0x2d2 || ldHas(r, LD_THERMOMETER)) out.showThermometer = s.bool();
  if (version > 0x383) out.saveOnlinePlaySettings = s.bool();
  if (version > 0x30d) {
    out.onlinePlayMode = s.i32();
    out.friendJoinRequestMode = s.i32();
    out.nonFriendJoinRequestMode = s.i32();
  }
  if (version > 0x352) {
    out.lbp2TutorialsPlayed = s.array((x) => x.i32());
    out.sectionHeadingToggled = s.intVector();
  }
  if (subVersion > 0x20d) out.mysteryPodEventsSeen = s.array((x) => ({ id: x.i32(), type: x.s32() }));
  if (version > 0x366) out.lastLegacyImportedProfileHashLBP1 = sha1List(s);
  if (subVersion > 0x37) out.lastLegacyImportedProfileHashLBP2 = sha1List(s);
  if (version > 0x36b) out.playedLBP1 = s.bool();
  if (subVersion > 0x37) out.playedLBP2 = s.bool();
  if (subVersion > 0x12c) out.hasPerformedFirstRun = s.bool();
  if (version > 0x3ae) out.lbp2TutorialUnlockButtonUnleashed = s.bool();
  if (version >= 0x28c) out.hiddenCategories = s.intVector();
  if (version >= 0x2d2) {
    out.collectedBubbles = s.array((x) => ({ level: x.resource(true), thingUID: x.i32(), plan: x.resource(true) }));
  }
  if (version > 0x2f5 || ldHas(r, LD_WATER_LEVELS)) out.numWaterLevelsPlayed = s.i32();
  if (version > 0x3cf) out.autoFilterOn = s.bool();
  if (version > 0x3d2) {
    out.hasUsed6Axis = s.bool();
    out.hasUsedMove = s.bool();
  }
  if (vita >= 0x86) out.hasSeenCrossCompatInfo = s.bool(); // which cwlib drops
  if (vita >= 0x87) out.wantsCrossCompatDownloadNotification = s.bool(); // likewise
  if (version > 0x3db) {
    out.paintProperties = {
      triggerOverride: s.i32(), stickerSaveSize: s.i32(), angleOverride: s.bool(), uiHidden: s.bool(),
      lastAutoSave: s.resource(true),
      ...(s.revision.version >= PTG_USE_DEFAULT_BACKGROUND ? { useDefaultBackground: s.bool() } : {}),
    };
  }
  if (vita >= D1_DATALABELS) {
    out.playerDataLabels = readPlayerDataLabels(s);
    if (vita >= D1_3G_CONNECTIVITY) {
      out.total3GUpStream = s.i32();
      out.total3GDownStream = s.i32();
      if (vita >= D1_TOUCH_CREATE) {
        out.createRearTouchPan = s.bool();
        out.createRearTouchPinchZoom = s.bool();
        out.createRearTapZoom = s.bool();
        if (vita >= D1_CREATE_WARNING) {
          out.createFrameRateWarningMessages = s.bool();
          if (vita >= D1_CREATE_BETA) {
            out.onlineBetaNetworkTimestamp = s.s64Big();
            out.onlineBetaPlayTimeSinceOnline = s.i32();
            out.onlineBetaBootsSinceOnline = s.i32();
          }
          if (vita >= D1_WAS_TRIAL) out.wasTrial = s.bool(); // which cwlib drops
        }
      }
    }
  }
  if (version > 0x3e2) out.distanceMovedWhilstAttracted = s.f32();
  if (version > 0x3e4) {
    out.beakersUsedPart1 = s.s32();
    out.beakersUsedPart2 = s.s32();
  }
  if (version > 0x3eb) out.profileFlags = s.i32();
  if (version > 0x3ee) out.playerDataLabels = readPlayerDataLabels(s);
  if (version > 0x3f1) {
    out.goldMedalsAwarded = s.intVector();
    out.goldMedalStoryArcPins = s.i8();
  }
  if (version > 0x3f2) {
    out.twitterEnabled = s.bool();
    out.facebookEnabled = s.bool();
    out.twitterAccessToken = s.str();
    out.twitterAccessTokenSecret = s.str();
  }
  if (version > 0x3f3) {
    if (out.playedLBP2 !== undefined) out.playedLBP2First = out.playedLBP2;
    out.playedLBP2 = s.bool();
  }
  if (version > 0x3f4) {
    out.createChallengeTutorialSeen = s.bool();
    out.playChallengeTutorialSeen = s.bool();
  }
  if (version > 0x3f5 && version < 0x3f9) {
    if (out.lastLegacyImportedProfileHashLBP2) out.lastLegacyImportedProfileHashLBP2First = out.lastLegacyImportedProfileHashLBP2;
    out.lastLegacyImportedProfileHashLBP2 = sha1List(s);
  }
  if (version > 0x3f7) out.ownedLBP = s.i32();
  if (subVersion > 0xef) out.dceUuidState = s.i32();
  if (subVersion > 0x15b) out.lastPlayedPPP = s.bool();
  if (subVersion > 0x20e) {
    out.lastPlayedPlanet = readSlotId(s);
    out.lastPlayedEarthAdv = s.bool();
    out.hasSeenDiveInBetaMessage = s.bool();
  }
  if (subVersion > 0x183) out.touchCreateCursorMode = s.i32();
  if (subVersion > 0x187) out.showAdvancedEditModeMessageCounter = s.i8();
  if (subVersion > 0x194) out.showAdventureSaveWarning = s.bool();
  if (subVersion > 0x19f) out.totalFramesInEditMode = s.i32();
  if (subVersion > 0x1a1) {
    out.onlineTutorialsPlayed = sha1List(s);
    out.popitPuzzlesCompleted = s.array(readSlotId);
  }
  if (subVersion > 0x1aa) out.timesaverNoticeViewed = s.bool();
  if (subVersion > 0x1ad) out.questProgressPin = s.s32();
  if (subVersion > 0x209) out.activityFilterToggled = s.intVector();
  if (subVersion > 0x212) out.lastLandingPageFocusItems = s.i32();
  if (subVersion > 0x215) {
    out.goPlayCache = s.array((x) => ({
      levelID: readSlotId(x), planetID: readSlotId(x), numBubbleCollected: x.i8(),
      awardLevelComplete: x.i8(), awardCollectAll: x.i8(), awardAcedLevel: x.i8(),
    }));
  }
  if (s.remaining !== 0) throw new SerializerError(`IPRb read ended ${s.remaining} bytes before the end of its payload`);
  return out;
}

// ---- The write side, `readLocalProfile`'s mirror. ----

const writeSigned = (w: Writer, values: readonly number[] | undefined): void => {
  w.i32(values?.length ?? 0);
  for (const v of values ?? []) w.s32(v);
};
const writeInts = (w: Writer, values: readonly number[] | undefined): void => {
  w.i32(values?.length ?? 0);
  for (const v of values ?? []) w.i32(v);
};
const writeSha1List = (w: Writer, hashes: readonly string[] | undefined): void => {
  w.i32(hashes?.length ?? 0);
  for (const h of hashes ?? []) w.sha1(fromHex(h));
};
const writeSlotLinks = (w: Writer, links: readonly { readonly from: SlotId; readonly to: SlotId }[] | undefined): void => {
  w.i32(links?.length ?? 0);
  for (const link of links ?? []) {
    writeSlotId(w, link.from);
    writeSlotId(w, link.to);
  }
};
const NO_SLOT: SlotId = { type: 0, number: 0 };

function writePlayerMetrics(w: Writer, m: PlayerMetrics | undefined): void {
  const r = w.revision;
  const head = r.version;
  const v = m ?? {};
  if (head > 0x16f) {
    w.i32(v.totalTime ?? 0);
    w.i32(v.editingTime ?? 0);
    w.i32(v.playingTime ?? 0);
    w.i32(v.idlingTime ?? 0);
  }
  if (head > 0x183) w.i32(v.multiplayerGamesCount ?? 0);
  if (vitaRevision(r) >= D1_LEVEL_TIMES_MAP) {
    w.i32(v.levelTimesMap?.length ?? 0);
    for (const [level, time] of v.levelTimesMap ?? []) {
      w.i32(level);
      w.i32(time);
    }
    w.i32(v.totalLevelTime ?? 0);
  }
  if (head > 0x1c9) w.f32(v.playLadderPoints ?? 0);
  if (head > 0x1ab) w.i32(v.storyLevelCompletionCount ?? 0);
  if (head > 0x1f7) w.i32(v.communityLevelCompletionCount ?? 0);
  if (head > 0x1ab) w.i32(v.levelCompletionCount ?? 0);
  if (head > 0x1f7) w.i32(v.levelsTaggedCount ?? 0);
  if (head > 0x1c9) w.i32(v.gamesWithRandomPlayersCount ?? 0);
  if (hasEnemiesKilled(r)) w.i32(v.enemiesKilled ?? 0);
  if (head > 0x1de) w.f32(v.pointsCollected ?? 0);
  if (head >= 0x1ea) {
    w.i32(v.stats?.length ?? 0);
    for (const stat of v.stats ?? []) w.u64Big(stat);
  }
}

function writeInventoryView(w: Writer, v: InventoryView): void {
  w.i32(v.type);
  w.i32(v.subType);
  w.wstr(v.title);
  w.bool(v.heartedOnly);
  w.i32(v.customID);
  w.i32(v.currentSortMode);
  w.i32(v.desiredSortMode);
}

function writePinsAwarded(w: Writer, p: PinsAwarded | undefined): void {
  const r = w.revision;
  const v = p ?? {};
  if (r.version >= PROFILE_PINS) {
    w.i32(v.pinAwards?.length ?? 0);
    for (const a of v.pinAwards ?? []) {
      w.i32(a.pinID);
      w.i32(a.awardCount);
    }
    w.i32(v.pinProgress?.length ?? 0);
    for (const a of v.pinProgress ?? []) {
      w.i32(a.progressType);
      w.i32(a.progressCount);
    }
    w.intVector(v.recentlyAwardedPinIDs ?? []);
    w.intVector(v.profileDisplayPinIDs ?? []);
  }
  if (r.version >= PIN_FLAGS) w.i8(v.pinsFlags ?? 0);
  if (r.version >= WEEKDAYS_PLAYED_PIN) w.i8(v.weekdaysPlayedBits ?? 0);
  if (vitaRevision(r) >= D1_MOE_PIN_PROGRESS) w.i32(v.moreOfEverythingPinProgress ?? 0);
  if (r.subVersion >= SLAPPED_AS_PIN) w.i8(v.slappedAsBits ?? 0);
  if (r.subVersion >= SIMON_SAYS_PIN) w.i32(v.simonSaysProgress ?? 0);
}

function writeDataLabelValue(w: Writer, d: DataLabelValue): void {
  const r = w.revision;
  writeNetworkOnlineId(w, d.creatorID, d.creatorIDBytes);
  w.i32(d.labelIndex);
  const vita = vitaRevision(r);
  const floats = (values: readonly number[] | undefined): void => {
    w.i32(values?.length ?? 0);
    for (const f of values ?? []) w.f32(f);
  };
  const ternary = (): void => {
    w.i32(d.ternary?.length ?? 0);
    if (d.ternary) w.bytes(d.ternary);
  };
  if (vita >= 0) {
    if (vita >= D1_LABEL_ANALOGUE_ARRAY) floats(d.analogue);
    else if (vita >= D1_DATALABELS) w.f32(d.analogue?.[0] ?? 0);
    if (vita >= D1_LABEL_TERNARY) ternary();
  } else if (r.version >= DATALABELS) {
    floats(d.analogue);
    ternary();
  }
}

function writePlayerDataLabels(w: Writer, l: PlayerDataLabels | undefined): void {
  const r = w.revision;
  w.i32(l?.values.length ?? 0);
  for (const v of l?.values ?? []) writeDataLabelValue(w, v);
  if (vitaRevision(r) >= D1_PROTECTED_LABELS || r.version >= DATALABELS) {
    writeNetworkIds(w, false, l?.protectedIds, l?.protectedIdsBytes);
  }
}

/**
 * `readLocalProfile`'s mirror: the payload, byte for byte, from the value. A
 * field the revision gates on and the value lacks is written as cwlib's
 * default, 0, false or empty. ⚠️ Proven by a round trip only: the game ships no
 * `IPRb` (`test/write-profiles.test.ts`).
 */
export function encodeLocalProfile(value: LocalProfile, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const r = header.revision;
  const { version, subVersion } = r;
  const vita = vitaRevision(r);
  const v = value;
  if (version < 0x187) return w.done();

  w.i32(v.inventory?.length ?? 0);
  for (const item of v.inventory ?? []) writeInventoryItem(w, item);
  writeStringLookupTable(w, v.stringTable ?? { unsorted: false, sortEnabled: false, rawIndexToSortedIndex: [], stringList: [] });
  if (version >= 0x3b6) w.bool(v.fromProductionBuild ?? false);
  if (version > 0x1e3) {
    w.i32(v.lbp1TutorialStates?.length ?? 0);
    for (const [level, state] of v.lbp1TutorialStates ?? []) {
      w.i32(level);
      w.i32(state);
    }
  }
  if (version > 0x265) {
    writeSigned(w, v.dlcPackViewed);
    writeSigned(w, v.dlcPackShown);
  }
  if (version > 0x1e4) w.i32(v.lbp1MainMenuButtonUnlocks ?? 0);
  if (version >= 0x16e) {
    w.i32(v.playedLevelData?.length ?? 0);
    for (const d of v.playedLevelData ?? []) writePlayedLevelData(w, d);
  }
  if (version > 0x379) {
    w.i32(v.viewedLevelData?.length ?? 0);
    for (const d of v.viewedLevelData ?? []) {
      writeSlotId(w, d.slotId);
      w.s32(d.lastReviewCount);
      w.s32(d.lastCommentCount);
      w.s32(d.lastPhotoCount);
      w.s32(d.lastAuthorPhotoCount);
      w.s64Big(d.lastStreamEventTimestamp);
      w.s64Big(d.lastViewedTimestamp);
    }
    w.i32(v.viewedPlayerData?.length ?? 0);
    for (const d of v.viewedPlayerData ?? []) {
      writeNetworkOnlineId(w, d.onlineId, d.onlineIdBytes);
      w.s32(d.lastReviewCount);
      w.s32(d.lastCommentCount);
      w.s32(d.lastPhotosByMeCount);
      w.s32(d.lastPhotosWithMeCount);
      w.s32(d.lastFavouriteSlotsCount);
      w.s32(d.lastFavouriteUsersCount);
      w.s64Big(d.lastStreamEventTimestamp);
      w.s64Big(d.lastViewedTimestamp);
    }
  }
  if (version > 0x16d) {
    w.i32(v.oldMyMoonSlots?.length ?? 0);
    for (const { id, slot } of v.oldMyMoonSlots ?? []) {
      writeSlotId(w, id);
      writeSlot(w, slot);
    }
  }
  if (version > 0x20d) w.bool(v.copiedFromAnotherUser ?? false);
  if (version > 0x267) w.bool(v.fixedUpByDeveloper ?? false);
  if (version > 0x296 || ldHas(r, LD_SAVEGAME_INFO)) {
    w.bool(v.showSaveGameInfo ?? false);
    w.i32(v.totalLevelCount ?? 0);
  }
  if (version > 0x393) w.i32(v.lastMmPicksCount ?? 0);
  if (version > 0x2cb || ldHas(r, LD_NEWS_TIMESTAMP)) w.s64Big(v.lastNewsItemTimestamp ?? 0n);
  if (version > 0x323) w.s64Big(v.lastStreamEventTimestamp ?? 0n);
  if (version > 0x2cc || ldHas(r, LD_QUEUE)) w.s64Big(v.lolcatFtwTimestamp ?? 0n);
  if (version >= 0x328) {
    w.i32(v.oldTextSearches?.length ?? 0);
    for (const text of v.oldTextSearches ?? []) w.wstr(text);
  }
  writeSlotLinks(w, v.oldDiscoveredLinks);
  writeSlotLinks(w, v.pendingLinks);
  writeSlotId(w, v.lastPlayed ?? NO_SLOT);
  if (version > 0x17d) writeInts(w, v.lbp1VideosPlayed);
  if (version > 0x36b) writeInts(w, v.lbp2VideosPlayed);
  if (version > 0x16f) writePlayerMetrics(w, v.currentPlayerMetrics);
  if (version > 0x1ab) writePlayerMetrics(w, v.lastPostedPlayerMetrics);
  if (version > 0x1b8) w.i32(v.lbp1GameProgressionStatus ?? 0);
  if (version > 0x1cf) {
    w.i32(v.lbp1GameProgressionEventHappenedBits ?? 0);
    w.i32(v.lbp1GameProgressionEventsExplainedBits ?? 0);
  }
  if (version > 0x26c) w.i32(v.demoProgressionStatus ?? 0);
  if (version > 0x36b) w.i32(v.lbp2GameProgressionFlags ?? 0);
  if (version >= 0x387) {
    w.i32(v.pendingInventoryItems?.length ?? 0);
    for (const item of v.pendingInventoryItems ?? []) writeInventoryItem(w, item);
  }
  w.ref(v.podLevel, { descriptor: true });
  if (version > 0x14f) writeNetworkPlayerId(w, v.playerId ?? '', v.playerIdBytes);
  if (version > 0x296 || ldHas(r, LD_SAVEGAME_INFO)) {
    writeNetworkPlayerId(w, v.ownerPlayerId ?? '', v.ownerPlayerIdBytes);
    w.u64Big(v.ownerPsid?.[0] ?? 0n);
    w.u64Big(v.ownerPsid?.[1] ?? 0n);
  }
  if (version > 0x2eb || ldHas(r, LD_OWNER_ID)) w.i32(v.ownerUserId ?? 0);
  if (version > 0x175) w.sha1(v.eulaAgreed ?? new Uint8Array(20));
  if (version >= 0x3d5) writeNetworkPlayerId(w, v.acceptingPlayer ?? '', v.acceptingPlayerBytes);
  w.ref(v.syncedProfile, { descriptor: true });
  if (version > 0x1a1) {
    writeNetworkIds(w, true, v.voipMutedPlayers, v.voipMutedPlayersBytes);
    w.bool(v.voipChatPaused ?? false);
    w.bool(v.enableMusicInPlayMode ?? false);
  }
  if (version > 0x1b4) w.bool(v.enableMusicInPod ?? false);
  if (version > 0x1b5) {
    w.i32(v.legacyInventoryCollections?.length ?? 0);
    for (const c of v.legacyInventoryCollections ?? []) {
      w.reference(c, (x, col) => {
        x.i32(col.inventoryViews.length);
        for (const view of col.inventoryViews) x.reference(view, writeInventoryView);
        x.i32(col.currentPageNumber);
        x.i32(col.collectionID);
        x.i32(col.actionOnItemSelect);
      });
    }
    w.i32(v.legacyInventoryViews?.length ?? 0);
    for (const view of v.legacyInventoryViews ?? []) w.reference(view, writeInventoryView);
  }
  if (version > 0x316) {
    w.i32(v.inventoryCollections?.length ?? 0);
    for (const c of v.inventoryCollections ?? []) {
      w.reference(c, (x, col) => {
        x.i32(col.inventoryCollectionIndex);
        x.i32(col.inventoryPageInstances.length);
        for (const page of col.inventoryPageInstances) {
          x.reference(page, (y, pg) => {
            y.i32(pg.inventoryPageTitleKey);
            y.i32(pg.desiredSortMode);
          });
        }
        x.i32(col.currentPageNumber);
        if (x.revision.subVersion >= COLLECTION_POPPET_POWERUP) x.bool(col.poppetPowerupSelection ?? false);
      });
    }
  }
  if (version > 0x1e0) w.ref(v.avatarIcon, { descriptor: true });
  if (version > 0x23c) w.ref(v.saveIcon, { descriptor: true });
  if (version > 0x1e5) w.i32(v.lbp1CreateModeVOProgress ?? 0);
  if (version > 0x1ff) {
    w.f32(v.gamma ?? 0);
    w.f32(v.screenSize ?? 0);
  }
  if (version > 0x35e) w.bool(v.hasSeenCalibrationScreen ?? false);
  if (version > 0x205) w.intVector(v.lbp1VOPlayed ?? [], true);
  if (version > 0x36b) w.intVector(v.lbp2VOPlayed ?? [], true);
  if (version > 0x23a) w.s32(v.subtitleMode ?? 0);
  if (version > 0x255 && version < 0x351) w.i32(v.dropped351 ?? 0);
  if (version > 0x32e) writePinsAwarded(w, v.pinsAwarded);
  if (version > 0x260) {
    w.bool(v.userSettingPhotoBooth ?? false);
    if (subVersion > 0x17e) w.bool(v.userSettingAdvancedEditMode ?? false);
    w.bool(v.userSettingCollection ?? false);
    if (version === 0x261) w.bool(v.dropped261 ?? false);
  }
  if (version > 0x2d2 || ldHas(r, LD_THERMOMETER)) w.bool(v.showThermometer ?? false);
  if (version > 0x383) w.bool(v.saveOnlinePlaySettings ?? false);
  if (version > 0x30d) {
    w.i32(v.onlinePlayMode ?? 0);
    w.i32(v.friendJoinRequestMode ?? 0);
    w.i32(v.nonFriendJoinRequestMode ?? 0);
  }
  if (version > 0x352) {
    writeInts(w, v.lbp2TutorialsPlayed);
    w.intVector(v.sectionHeadingToggled ?? []);
  }
  if (subVersion > 0x20d) {
    w.i32(v.mysteryPodEventsSeen?.length ?? 0);
    for (const e of v.mysteryPodEventsSeen ?? []) {
      w.i32(e.id);
      w.s32(e.type);
    }
  }
  const twiceLbp2Hashes = subVersion > 0x37 && version > 0x3f5 && version < 0x3f9;
  if (version > 0x366) writeSha1List(w, v.lastLegacyImportedProfileHashLBP1);
  if (subVersion > 0x37) {
    writeSha1List(w, twiceLbp2Hashes ? v.lastLegacyImportedProfileHashLBP2First ?? v.lastLegacyImportedProfileHashLBP2 : v.lastLegacyImportedProfileHashLBP2);
  }
  const twicePlayedLbp2 = subVersion > 0x37 && version > 0x3f3;
  if (version > 0x36b) w.bool(v.playedLBP1 ?? false);
  if (subVersion > 0x37) w.bool((twicePlayedLbp2 ? v.playedLBP2First ?? v.playedLBP2 : v.playedLBP2) ?? false);
  if (subVersion > 0x12c) w.bool(v.hasPerformedFirstRun ?? false);
  if (version > 0x3ae) w.bool(v.lbp2TutorialUnlockButtonUnleashed ?? false);
  if (version >= 0x28c) w.intVector(v.hiddenCategories ?? []);
  if (version >= 0x2d2) {
    w.i32(v.collectedBubbles?.length ?? 0);
    for (const b of v.collectedBubbles ?? []) {
      w.ref(b.level, { descriptor: true });
      w.i32(b.thingUID);
      w.ref(b.plan, { descriptor: true });
    }
  }
  if (version > 0x2f5 || ldHas(r, LD_WATER_LEVELS)) w.i32(v.numWaterLevelsPlayed ?? 0);
  if (version > 0x3cf) w.bool(v.autoFilterOn ?? false);
  if (version > 0x3d2) {
    w.bool(v.hasUsed6Axis ?? false);
    w.bool(v.hasUsedMove ?? false);
  }
  if (vita >= 0x86) w.bool(v.hasSeenCrossCompatInfo ?? false);
  if (vita >= 0x87) w.bool(v.wantsCrossCompatDownloadNotification ?? false);
  if (version > 0x3db) {
    const p = v.paintProperties;
    w.i32(p?.triggerOverride ?? 0);
    w.i32(p?.stickerSaveSize ?? 0);
    w.bool(p?.angleOverride ?? false);
    w.bool(p?.uiHidden ?? false);
    w.ref(p?.lastAutoSave, { descriptor: true });
    if (version >= PTG_USE_DEFAULT_BACKGROUND) w.bool(p?.useDefaultBackground ?? false);
  }
  if (vita >= D1_DATALABELS) {
    writePlayerDataLabels(w, v.playerDataLabels);
    if (vita >= D1_3G_CONNECTIVITY) {
      w.i32(v.total3GUpStream ?? 0);
      w.i32(v.total3GDownStream ?? 0);
      if (vita >= D1_TOUCH_CREATE) {
        w.bool(v.createRearTouchPan ?? false);
        w.bool(v.createRearTouchPinchZoom ?? false);
        w.bool(v.createRearTapZoom ?? false);
        if (vita >= D1_CREATE_WARNING) {
          w.bool(v.createFrameRateWarningMessages ?? false);
          if (vita >= D1_CREATE_BETA) {
            w.s64Big(v.onlineBetaNetworkTimestamp ?? 0n);
            w.i32(v.onlineBetaPlayTimeSinceOnline ?? 0);
            w.i32(v.onlineBetaBootsSinceOnline ?? 0);
          }
          if (vita >= D1_WAS_TRIAL) w.bool(v.wasTrial ?? false);
        }
      }
    }
  }
  if (version > 0x3e2) w.f32(v.distanceMovedWhilstAttracted ?? 0);
  if (version > 0x3e4) {
    w.s32(v.beakersUsedPart1 ?? 0);
    w.s32(v.beakersUsedPart2 ?? 0);
  }
  if (version > 0x3eb) w.i32(v.profileFlags ?? 0);
  if (version > 0x3ee) writePlayerDataLabels(w, v.playerDataLabels);
  if (version > 0x3f1) {
    w.intVector(v.goldMedalsAwarded ?? []);
    w.i8(v.goldMedalStoryArcPins ?? 0);
  }
  if (version > 0x3f2) {
    w.bool(v.twitterEnabled ?? false);
    w.bool(v.facebookEnabled ?? false);
    w.str(v.twitterAccessToken ?? '');
    w.str(v.twitterAccessTokenSecret ?? '');
  }
  if (version > 0x3f3) w.bool(v.playedLBP2 ?? false);
  if (version > 0x3f4) {
    w.bool(v.createChallengeTutorialSeen ?? false);
    w.bool(v.playChallengeTutorialSeen ?? false);
  }
  if (version > 0x3f5 && version < 0x3f9) writeSha1List(w, v.lastLegacyImportedProfileHashLBP2);
  if (version > 0x3f7) w.i32(v.ownedLBP ?? 0);
  if (subVersion > 0xef) w.i32(v.dceUuidState ?? 0);
  if (subVersion > 0x15b) w.bool(v.lastPlayedPPP ?? false);
  if (subVersion > 0x20e) {
    writeSlotId(w, v.lastPlayedPlanet ?? NO_SLOT);
    w.bool(v.lastPlayedEarthAdv ?? false);
    w.bool(v.hasSeenDiveInBetaMessage ?? false);
  }
  if (subVersion > 0x183) w.i32(v.touchCreateCursorMode ?? 0);
  if (subVersion > 0x187) w.i8(v.showAdvancedEditModeMessageCounter ?? 0);
  if (subVersion > 0x194) w.bool(v.showAdventureSaveWarning ?? false);
  if (subVersion > 0x19f) w.i32(v.totalFramesInEditMode ?? 0);
  if (subVersion > 0x1a1) {
    writeSha1List(w, v.onlineTutorialsPlayed);
    w.i32(v.popitPuzzlesCompleted?.length ?? 0);
    for (const id of v.popitPuzzlesCompleted ?? []) writeSlotId(w, id);
  }
  if (subVersion > 0x1aa) w.bool(v.timesaverNoticeViewed ?? false);
  if (subVersion > 0x1ad) w.s32(v.questProgressPin ?? 0);
  if (subVersion > 0x209) w.intVector(v.activityFilterToggled ?? []);
  if (subVersion > 0x212) w.i32(v.lastLandingPageFocusItems ?? 0);
  if (subVersion > 0x215) {
    w.i32(v.goPlayCache?.length ?? 0);
    for (const c of v.goPlayCache ?? []) {
      writeSlotId(w, c.levelID);
      writeSlotId(w, c.planetID);
      w.i8(c.numBubbleCollected);
      w.i8(c.awardLevelComplete);
      w.i8(c.awardCollectAll);
      w.i8(c.awardAcedLevel);
    }
  }
  return w.done();
}
