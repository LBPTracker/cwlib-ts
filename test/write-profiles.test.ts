import { strict as assert } from 'node:assert';
import test from 'node:test';

import { loadResource } from '../src/io/resource.ts';
import { Serializer, type RevisionInfo } from '../src/io/serializer.ts';
import { writeResource } from '../src/io/writer.ts';
import { nodeDeflate, nodeInflate } from '../src/platform/node.ts';
import { encodeBigProfile, readBigProfile, type BigProfile } from '../src/resources/big-profile.ts';
import { encodeDlcBinary, readDlcBinary, type Dlc } from '../src/resources/dlc.ts';
import { encodeLocalProfile, readLocalProfile, type LocalProfile } from '../src/resources/local-profile.ts';
import { readSlot, type Slot } from '../src/structs/slot.ts';
import { readInventoryItem, type InventoryItem } from '../src/things/parts/poppet-powerup.ts';

/**
 * `IPRb`, `BPRb` and `DLCb` have no file in the game, so their encoders are
 * proven by a round trip: a value built here is encoded, wrapped in a
 * container, read back through the reader, and encoded again to the same bytes.
 */

type Header = { revision: RevisionInfo; compressionFlags: number };
const LBP3: Header = { revision: { version: 0x3f8, subVersion: 0x21b, branchId: 0, branchRevision: 0 }, compressionFlags: 7 };
const LBP2: Header = { revision: { version: 0x3f8, subVersion: 0, branchId: 0, branchRevision: 0 }, compressionFlags: 7 };
const LBP2_PLAIN: Header = { revision: { version: 0x3e2, subVersion: 0, branchId: 0, branchRevision: 0 }, compressionFlags: 0 };
const VITA: Header = { revision: { version: 0x3e2, subVersion: 0, branchId: 0x4431, branchRevision: 0x87 }, compressionFlags: 7 };
const HEADERS = { LBP3, LBP2, LBP2_PLAIN, VITA };

/** A value of a struct as a zeroed stream reads it, at a revision: every field there, each the default. */
function zeroed<T>(header: Header, read: (s: Serializer) => T): T {
  return read(new Serializer(new Uint8Array(4096), header.revision, header.compressionFlags));
}

async function roundTrip<T>(
  magic: string,
  value: T,
  header: Header,
  encode: (value: T, header: Header) => Uint8Array,
  read: (bytes: Uint8Array, inflate: typeof nodeInflate) => Promise<T>,
): Promise<T> {
  const payload = encode(value, header);
  const file = await writeResource({ magic, ...header, payload, dependencies: [] }, nodeDeflate);
  assert.deepEqual((await loadResource(file, nodeInflate)).data, payload);
  const back = await read(file, nodeInflate);
  assert.deepEqual(encode(back, header), payload, `${magic} encodes the same bytes from what it reads back`);
  return back;
}

const guid = (n: number) => ({ guid: n });
const hash = new Uint8Array(20).map((_, i) => i * 7 + 1);

function item(header: Header, uid: number): InventoryItem {
  return { ...zeroed(header, readInventoryItem), plan: guid(1000 + uid), uid, flags: 3 };
}

function slot(header: Header): Slot {
  return {
    ...zeroed(header, readSlot),
    id: { type: 1, number: 42 },
    root: { guid: 0, hash },
    name: 'A slot',
    description: 'Its description',
    author: 'someone',
    labels: header.revision.version >= 0x33c ? [{ key: 5, order: 1 }] : [],
  };
}

for (const [name, header] of Object.entries(HEADERS)) {
  test(`DLCb round trip, ${name}`, async () => {
    const value: Dlc = {
      guids: [{ guid: 12345, flags: 1 }, { guid: 0x80000001, flags: -1 }],
      files: [{
        directory: 'dlc/pack', file: 'pack.edat', contentId: 'EP9000-CUSA00063_00', inGameCommerceId: 'commerce',
        categoryId: 'category', flags: 2, guids: [1, 2, 300000], typeMask: header.revision.branchId === 0x4431 ? 7 : 0,
        ...(header.revision.subVersion > 0x20c ? { nonPlanGuids: [9, 8] } : {}),
      }],
    };
    const back = await roundTrip('DLCb', value, header, encodeDlcBinary, readDlcBinary);
    assert.deepEqual(back, value);
  });

  test(`BPRb round trip, ${name}`, async () => {
    const vita = header === VITA;
    const value: BigProfile = {
      revision: header.revision,
      inventory: [item(header, 1), item(header, 2)],
      vitaCrossDependencyHashes: header.revision.version > 0x3ea ? ['0102030405060708090a0b0c0d0e0f1011121314'] : undefined,
      creatorDataLabels: [{ labelIndex: 3, name: 'label' }],
      stringTable: { unsorted: true, sortEnabled: false, rawIndexToSortedIndex: [1, 0, 70000], stringList: [{ lamsKeyID: 9, string: 'nine', index: 2 }] },
      fromProductionBuild: true,
      // ⚠️ A Vita slot is refused by `readSlot`, so the Vita's profile has none.
      myMoonSlots: vita ? [] : [{ id: { type: 1, number: 42 }, slot: slot(header) }],
      ...(vita
        ? {
          nearMyChallengeDataLog: [{ challengeID: 1, challengeStatus: 2, levelID: 3, scoreToBeat: 4, levelType: 5, myScore: 6, networkOnlineID: 'x' }],
          nearMyChallengeDataOpen: [],
          nearMyTreasureLog: [{ treasureID: 1, planID: 2, timestamp: 3 }],
          downloadedSlots: [{ type: 2, number: 7 }],
          planetDecorations: guid(77),
        }
        : {}),
    };
    const back = await roundTrip('BPRb', value, header, encodeBigProfile, readBigProfile);
    assert.equal(back.inventory.length, 2);
    assert.equal(back.inventory[1]!.uid, 2);
    assert.deepEqual(back.stringTable, value.stringTable);
    assert.deepEqual(back.creatorDataLabels, header.revision.version >= 0x3ef || vita ? value.creatorDataLabels : undefined);
    if (!vita) assert.equal(back.myMoonSlots[0]!.slot.name, 'A slot');
    else assert.deepEqual(back.nearMyTreasureLog, value.nearMyTreasureLog);
  });

  test(`IPRb round trip, ${name}`, async () => {
    const vita = header === VITA;
    const view = { type: 1, subType: 2, title: 'view', heartedOnly: true, customID: 3, currentSortMode: 4, desiredSortMode: 5 };
    const value: LocalProfile = {
      revision: header.revision,
      inventory: [item(header, 1)],
      stringTable: { unsorted: false, sortEnabled: true, rawIndexToSortedIndex: [0], stringList: [] },
      fromProductionBuild: true,
      lbp1TutorialStates: [[1, 2]],
      dlcPackViewed: [-1, 5],
      playedLevelData: [{
        slotId: { type: 1, number: 9 }, lastPlayedTimestamp: -5n, localHighScore: [10, 20], playCount: 3,
        completionCount: 2, acedCount: 1, collectables: [{ plan: guid(4), source: -2 }], linkedLevels: [], subLevels: [],
        levelHash: hash, flags: 1,
      }],
      oldMyMoonSlots: vita ? [] : [{ id: { type: 1, number: 42 }, slot: slot(header) }],
      lastNewsItemTimestamp: 123456789012n,
      oldTextSearches: ['search'],
      oldDiscoveredLinks: [{ from: { type: 1, number: 2 }, to: { type: 3, number: 4 } }],
      lastPlayed: { type: 1, number: 2 },
      currentPlayerMetrics: { totalTime: 100, pointsCollected: 1.5, stats: [1n, 2n ** 40n] },
      podLevel: { guid: 0, hash },
      playerId: 'player',
      ownerPsid: [1n, 2n],
      eulaAgreed: hash,
      syncedProfile: guid(5),
      voipMutedPlayers: ['muted'],
      legacyInventoryCollections: [{ inventoryViews: [view, view, undefined], currentPageNumber: 1, collectionID: 2, actionOnItemSelect: 3 }],
      legacyInventoryViews: [view],
      inventoryCollections: [{ inventoryCollectionIndex: 1, inventoryPageInstances: [{ inventoryPageTitleKey: 7, desiredSortMode: 8 }], currentPageNumber: 0, ...(header.revision.subVersion >= 9 ? { poppetPowerupSelection: true } : {}) }],
      gamma: 0.5,
      lbp1VOPlayed: [-3, 4, 100000],
      pinsAwarded: { pinAwards: [{ pinID: 1, awardCount: 2 }], recentlyAwardedPinIDs: [5], pinsFlags: 1 },
      hiddenCategories: [1, 2],
      collectedBubbles: [{ level: guid(1), thingUID: 2, plan: guid(3) }],
      paintProperties: { triggerOverride: 1, stickerSaveSize: 2, angleOverride: true, uiHidden: false, lastAutoSave: guid(9), useDefaultBackground: true },
      playerDataLabels: { values: [{ creatorID: 'creator', labelIndex: 1, analogue: [0.25], ternary: new Uint8Array([1, 2]) }], protectedIds: ['p'] },
      twitterAccessToken: 'token',
      goPlayCache: [{ levelID: { type: 1, number: 1 }, planetID: { type: 2, number: 2 }, numBubbleCollected: 3, awardLevelComplete: 1, awardCollectAll: 0, awardAcedLevel: 1 }],
      ...(vita ? { total3GUpStream: 5, wasTrial: true, hasSeenCrossCompatInfo: true } : {}),
    };
    const back = await roundTrip('IPRb', value, header, encodeLocalProfile, readLocalProfile);
    assert.equal(back.inventory?.[0]?.uid, 1);
    assert.equal(back.playedLevelData?.[0]?.collectables?.[0]?.plan?.guid, 4);
    assert.equal(back.playedLevelData?.[0]?.collectables?.[0]?.source, -2);
    assert.equal(back.playerId, 'player');
    assert.deepEqual(back.lbp1VOPlayed, value.lbp1VOPlayed);
    // A view named twice is one object, written once and referred back to.
    const views = back.legacyInventoryCollections?.[0]?.inventoryViews;
    assert.equal(views?.[0], views?.[1]);
    assert.equal(views?.[0], back.legacyInventoryViews?.[0]);
    assert.deepEqual(back.legacyInventoryViews?.[0], view);
    if (!vita) assert.equal(back.oldMyMoonSlots?.[0]?.slot.description, 'Its description');
    if (vita) assert.equal(back.wasTrial, true);
  });
}
