/**
 * Every resource of the game's FARCs encoded from its value, against the
 * payload the file inflates to:
 *
 *   node dev/resource-census-write.ts [MAGIC,MAGIC] [limit]     LBP_GAME required, LBP_PATCH optional
 *
 * For each magic in the table, the reader's module is asked for an encoder
 * beside it -- `encodeMaterial` beside `readMaterial` -- which takes the
 * reader's value and the payload's revision and compression flags and returns
 * the payload. It is compared byte for byte with `loadResource(...).data`. A
 * magic whose module has no encoder is listed as such. The numbers are in
 * steering/level-files.md, *Resources written from their values*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { loadResource, magicOf, type Inflate } from '../src/io/resource.ts';
import type { RevisionInfo } from '../src/io/serializer.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import * as adventureCreateProfile from '../src/resources/adventure-create-profile.ts';
import * as adventureSharedData from '../src/resources/adventure-shared-data.ts';
import * as animatedTexture from '../src/resources/animated-texture.ts';
import * as animation from '../src/resources/animation.ts';
import * as bevel from '../src/resources/bevel.ts';
import * as cachedCostumeData from '../src/resources/cached-costume-data.ts';
import * as guidList from '../src/resources/guid-list.ts';
import * as jointSettings from '../src/resources/joint-settings.ts';
import * as material from '../src/resources/material.ts';
import * as mesh from '../src/resources/mesh.ts';
import * as outfitList from '../src/resources/outfit-list.ts';
import * as packs from '../src/resources/packs.ts';
import * as palette from '../src/resources/palette.ts';
import * as physicsMaterial from '../src/resources/physics-material.ts';
import * as pins from '../src/resources/pins.ts';
import * as quest from '../src/resources/quest.ts';
import * as script from '../src/resources/script.ts';
import * as slotList from '../src/resources/slot-list.ts';
import * as syncedProfile from '../src/resources/synced-profile.ts';
import * as thingRecording from '../src/resources/thing-recording.ts';
import * as tutorials from '../src/resources/tutorials.ts';
import * as voipRecording from '../src/resources/voip-recording.ts';
import { FARCS, GAME } from './game.ts';

type Module = Record<string, unknown>;
const TABLE: readonly (readonly [string, Module, string])[] = [
  ['ADCb', adventureCreateProfile, 'readAdventureCreateProfile'],
  ['ADSb', adventureSharedData, 'readAdventureSharedData'],
  ['ATXb', animatedTexture, 'readAnimatedTexture'],
  ['ANMb', animation, 'readAnimation'],
  ['BEVb', bevel, 'readBevel'],
  ['CCDb', cachedCostumeData, 'readCachedCostumeData'],
  ['GLTb', guidList, 'readGuidList'],
  ['JNTb', jointSettings, 'readJointSettings'],
  ['GMTb', material, 'readMaterial'],
  ['MSHb', mesh, 'readMesh'],
  ['OUTb', outfitList, 'readOutfitList'],
  ['PCKb', packs, 'readPacks'],
  ['PALb', palette, 'readPalette'],
  ['MATb', physicsMaterial, 'readPhysicsMaterial'],
  ['PINb', pins, 'readPins'],
  ['QSTb', quest, 'readQuest'],
  ['FSHb', script, 'readScript'],
  ['SLTb', slotList, 'readSlotList'],
  ['PRFb', syncedProfile, 'readSyncedProfile'],
  ['RECb', thingRecording, 'readThingRecording'],
  ['TUTb', tutorials, 'readTutorials'],
  ['VOPb', voipRecording, 'readVoipRecording'],
];

type Encoder = (value: unknown, header: { revision: RevisionInfo; compressionFlags: number }) => Uint8Array;
const only = process.argv[2] && process.argv[2] !== 'all' ? new Set(process.argv[2].split(',')) : undefined;
const limit = Number(process.argv[3] ?? Infinity);
const byMagic = new Map(TABLE.filter(([m]) => !only || only.has(m)).map(([magic, module, reader]) => [magic, {
  read: module[reader] as (bytes: Uint8Array, inflate: Inflate) => Promise<unknown>,
  encode: module['encode' + reader.slice(4)] as Encoder | undefined,
}]));
const rows = new Map<string, { same: number; differ: number; threw: number; unread: number; example?: string }>();

const first = (a: Uint8Array, b: Uint8Array): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

const archives = FARCS.map((f) => path.join(GAME, f));
if (process.env.LBP_PATCH) archives.push(path.join(process.env.LBP_PATCH, 'patch_001.farc'));
const seen = new Set<string>();
const counts = new Map<string, number>();
for (const file of archives) {
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 4));
      const kind = byMagic.get(magic);
      if (!kind || (counts.get(magic) ?? 0) >= limit) continue;
      counts.set(magic, (counts.get(magic) ?? 0) + 1);
      const row = rows.get(magic) ?? rows.set(magic, { same: 0, differ: 0, threw: 0, unread: 0 }).get(magic)!;
      if (!kind.encode) continue;
      const bytes = (await farc.get(entry.sha1))!;
      let value: unknown;
      let resource;
      try {
        resource = await loadResource(bytes, nodeInflate);
        value = await kind.read(bytes, nodeInflate);
      } catch {
        row.unread += 1;
        continue;
      }
      let payload: Uint8Array;
      try {
        payload = kind.encode(value, { revision: resource.revisionInfo, compressionFlags: resource.compressionFlags });
      } catch (error) {
        row.threw += 1;
        row.example ??= `${path.basename(file)} ${entry.sha1.slice(0, 8)} threw ${(error as Error).message.slice(0, 80)}`;
        continue;
      }
      const at = first(resource.data, payload);
      if (at < 0) row.same += 1;
      else {
        row.differ += 1;
        row.example ??= `${path.basename(file)} ${entry.sha1.slice(0, 8)} head 0x${resource.revision.raw.toString(16)} at ${at} of ${resource.data.length} (written ${payload.length})`;
      }
    }
  } finally {
    await access.close();
  }
}
for (const [magic, kind] of byMagic) {
  const r = rows.get(magic);
  console.log(`${magic} ${kind.encode ? `${r?.same ?? 0} same, ${r?.differ ?? 0} differ, ${r?.threw ?? 0} threw, ${r?.unread ?? 0} unread${r?.example ? `  e.g. ${r.example}` : ''}` : 'no encoder'}`);
}
