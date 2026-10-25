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
import { readNetworkOnlineId, readNetworkPlayerId } from '../structs/network.ts';
import { readSlot, readSlotId, type Slot, type SlotId } from '../structs/slot.ts';
import { LD_ANY, onLeerdammer } from '../things/thing.ts';
import { readInventoryItem, type InventoryItem } from '../things/parts/poppet-powerup.ts';
import { readPlayedLevelData, type PlayedLevelData } from './adventure-create-profile.ts';
import { readStringLookupTable, type StringLookupTable } from './big-profile.ts';

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
}

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
  if (head > 0x1de && head < 0x2cb && (!onLeerdammer(r, LD_ANY) || r.branchRevision < LD_REMOVED_ENEMY_STAT)) s.i32();
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
  readonly labelIndex: number;
  readonly analogue?: readonly number[];
  readonly ternary?: Uint8Array;
}

function readDataLabelValue(s: Serializer): DataLabelValue {
  const r = s.revision;
  const creatorID = readNetworkOnlineId(s);
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
  return { creatorID, labelIndex, analogue, ternary };
}

export interface PlayerDataLabels {
  readonly values: readonly DataLabelValue[];
  readonly protectedIds?: readonly string[];
}

function readPlayerDataLabels(s: Serializer): PlayerDataLabels {
  const r = s.revision;
  const values = s.array(readDataLabelValue);
  const protectedIds = vitaRevision(r) >= D1_PROTECTED_LABELS || r.version >= DATALABELS ? s.array(readNetworkOnlineId) : undefined;
  return { values, protectedIds };
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
  readonly ownerPlayerId?: string;
  /** `OpenPSID`: two u64s. */
  readonly ownerPsid?: readonly [bigint, bigint];
  readonly ownerUserId?: number;
  readonly eulaAgreed?: Uint8Array;
  readonly acceptingPlayer?: string;
  /** An `RSyncedProfile`, a descriptor. */
  readonly syncedProfile?: ResourceRef;
  readonly voipMutedPlayers?: readonly string[];
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
      onlineId: readNetworkOnlineId(x), lastReviewCount: x.s32(), lastCommentCount: x.s32(),
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
  if (version > 0x14f) out.playerId = readNetworkPlayerId(s);
  if (version > 0x296 || ldHas(r, LD_SAVEGAME_INFO)) {
    out.ownerPlayerId = readNetworkPlayerId(s);
    out.ownerPsid = [s.u64Big(), s.u64Big()];
  }
  if (version > 0x2eb || ldHas(r, LD_OWNER_ID)) out.ownerUserId = s.i32();
  if (version > 0x175) out.eulaAgreed = s.sha1();
  if (version >= 0x3d5) out.acceptingPlayer = readNetworkPlayerId(s);
  out.syncedProfile = s.resource(true);
  if (version > 0x1a1) {
    out.voipMutedPlayers = s.array(readNetworkPlayerId);
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
  if (version > 0x255 && version < 0x351) s.i32();
  if (version > 0x32e) out.pinsAwarded = readPinsAwarded(s);
  if (version > 0x260) {
    out.userSettingPhotoBooth = s.bool();
    if (subVersion > 0x17e) out.userSettingAdvancedEditMode = s.bool();
    out.userSettingCollection = s.bool();
    if (version === 0x261) s.bool();
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
  if (vita >= 0x86) s.bool(); // hasSeenCrossCompatInfo, which cwlib drops
  if (vita >= 0x87) s.bool(); // wantsCrossCompatDownloadNotification, likewise
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
          if (vita >= D1_WAS_TRIAL) s.bool(); // wasTrial, which cwlib drops
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
  if (version > 0x3f3) out.playedLBP2 = s.bool();
  if (version > 0x3f4) {
    out.createChallengeTutorialSeen = s.bool();
    out.playChallengeTutorialSeen = s.bool();
  }
  if (version > 0x3f5 && version < 0x3f9) out.lastLegacyImportedProfileHashLBP2 = sha1List(s);
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
