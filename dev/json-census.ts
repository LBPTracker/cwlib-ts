/**
 * Every resource of the game's FARCs that has an encoder, read, sent through
 * JSON and back, and encoded again, against the payload the file inflates to:
 *
 *   node dev/json-census.ts [MAGIC,MAGIC|all] [limit]     LBP_GAME required, LBP_PATCH optional
 *
 * value → `toJson` → `fromJson` → `encodeX` (src/io/json.ts, src/io/from-json.ts),
 * compared byte for byte with `loadResource(...).data`; the value as read is
 * encoded too, so a difference JSON made ("lost") is told from one the encoder
 * makes anyway ("encoder"). The table is `dev/resource-census-write.ts`'s, with
 * `LVLb`/`PLNb` through `encodeLevel`/`encodePlan` and the whole-file writers
 * `writeTexture` (`GTF `, `TEX `) and `writeStaticMesh` (`SMHb`), whose output
 * is compared with what they write from the value as read (their stored
 * payloads sit under Symbols JSON does not carry) and read back.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { fromJson } from '../src/io/from-json.ts';
import { toJson } from '../src/io/json.ts';
import { loadResource, magicOf, type Inflate } from '../src/io/resource.ts';
import type { RevisionInfo } from '../src/io/serializer.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
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
import { readStaticMesh, writeStaticMesh } from '../src/resources/staticmesh.ts';
import * as syncedProfile from '../src/resources/synced-profile.ts';
import { readTexture, writeTexture } from '../src/resources/texture.ts';
import * as thingRecording from '../src/resources/thing-recording.ts';
import * as tutorials from '../src/resources/tutorials.ts';
import * as voipRecording from '../src/resources/voip-recording.ts';
import { encodeLevel, encodePlan } from '../src/things/encode-things.ts';
import { readLevel, readPlan, type LevelParse } from '../src/things/level.ts';
import { FARCS, GAME } from './game.ts';

type Header = { revision: RevisionInfo; compressionFlags: number };
type Read = (bytes: Uint8Array, inflate: Inflate) => Promise<unknown>;
type Encode = (value: unknown, header: Header) => Uint8Array;
type Module = Record<string, unknown>;

/** A payload kind: read, encode to the payload. */
interface PayloadKind { kind: 'payload'; read: Read; encode: Encode }
/** A whole-file kind: read, write the file. */
interface FileKind { kind: 'file'; read: Read; write: (value: unknown) => Promise<Uint8Array> }

const fromModule = (module: Module, reader: string): PayloadKind => ({
  kind: 'payload',
  read: module[reader] as Read,
  encode: module['encode' + reader.slice(4)] as Encode,
});

const TABLE: [string, PayloadKind | FileKind][] = [
  ['ADCb', fromModule(adventureCreateProfile, 'readAdventureCreateProfile')],
  ['ADSb', fromModule(adventureSharedData, 'readAdventureSharedData')],
  ['ATXb', fromModule(animatedTexture, 'readAnimatedTexture')],
  ['ANMb', fromModule(animation, 'readAnimation')],
  ['BEVb', fromModule(bevel, 'readBevel')],
  ['CCDb', fromModule(cachedCostumeData, 'readCachedCostumeData')],
  ['GLTb', fromModule(guidList, 'readGuidList')],
  ['JNTb', fromModule(jointSettings, 'readJointSettings')],
  ['GMTb', fromModule(material, 'readMaterial')],
  ['MSHb', fromModule(mesh, 'readMesh')],
  ['OUTb', fromModule(outfitList, 'readOutfitList')],
  ['PCKb', fromModule(packs, 'readPacks')],
  ['PALb', fromModule(palette, 'readPalette')],
  ['MATb', fromModule(physicsMaterial, 'readPhysicsMaterial')],
  ['PINb', fromModule(pins, 'readPins')],
  ['QSTb', fromModule(quest, 'readQuest')],
  ['FSHb', fromModule(script, 'readScript')],
  ['SLTb', fromModule(slotList, 'readSlotList')],
  ['PRFb', fromModule(syncedProfile, 'readSyncedProfile')],
  ['RECb', fromModule(thingRecording, 'readThingRecording')],
  ['TUTb', fromModule(tutorials, 'readTutorials')],
  ['VOPb', fromModule(voipRecording, 'readVoipRecording')],
  ['LVLb', { kind: 'payload', read: (b, i) => readLevel(b, i), encode: (v, h) => encodeLevel(v as LevelParse, h) }],
  ['PLNb', { kind: 'payload', read: (b, i) => readPlan(b, i), encode: (v, h) => encodePlan(v as LevelParse, h) }],
  ['GTF ', { kind: 'file', read: readTexture, write: (v) => writeTexture(v as never, nodeDeflate) }],
  ['TEX ', { kind: 'file', read: readTexture, write: (v) => writeTexture(v as never, nodeDeflate) }],
  ['SMHb', { kind: 'file', read: readStaticMesh, write: (v) => writeStaticMesh(v as never, nodeDeflate) }],
];

interface Row {
  same: number;
  /** Differs, where the value as read encodes the same: JSON lost something. */
  lost: number;
  /** Differs, and so does the value as read: the encoder's own difference. */
  encoder: number;
  threw: number;
  /** Would not read, or read with an unread tail: not counted. */
  skipped: number;
  /** A whole-file kind's JSON output, read back to the same JSON. */
  readsBack: number;
  examples: string[];
}

const only = process.argv[2] && process.argv[2] !== 'all' ? new Set(process.argv[2].split(',')) : undefined;
const limit = Number(process.argv[3] ?? Infinity);
const kinds = new Map(TABLE.filter(([m]) => !only || only.has(m)));
const rows = new Map<string, Row>();
const rowOf = (magic: string): Row =>
  rows.get(magic) ?? rows.set(magic, { same: 0, lost: 0, encoder: 0, threw: 0, skipped: 0, readsBack: 0, examples: [] }).get(magic)!;
const example = (r: Row, text: string): void => {
  if (r.examples.length < 3) r.examples.push(text);
};

const firstDiffer = (a: Uint8Array, b: Uint8Array): number => {
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
      const kind = kinds.get(magic);
      if (!kind || (counts.get(magic) ?? 0) >= limit) continue;
      counts.set(magic, (counts.get(magic) ?? 0) + 1);
      const r = rowOf(magic);
      const where = `${path.basename(file)} ${entry.sha1.slice(0, 8)}`;
      const bytes = (await farc.get(entry.sha1))!;
      let value: unknown;
      try {
        value = await kind.read(bytes, nodeInflate);
      } catch {
        r.skipped += 1;
        continue;
      }
      if ((value as { unreadTail?: unknown }).unreadTail !== undefined) {
        r.skipped += 1;
        continue;
      }
      let again: unknown;
      let text: string;
      try {
        text = toJson(value);
        again = fromJson(text);
      } catch (error) {
        r.threw += 1;
        example(r, `${where} JSON threw ${(error as Error).message.slice(0, 100)}`);
        continue;
      }
      if (kind.kind === 'payload') {
        const resource = await loadResource(bytes, nodeInflate);
        const header = { revision: resource.revisionInfo, compressionFlags: resource.compressionFlags };
        let written: Uint8Array;
        try {
          written = kind.encode(again, header);
        } catch (error) {
          r.threw += 1;
          example(r, `${where} encode threw ${(error as Error).message.slice(0, 100)}`);
          continue;
        }
        const at = firstDiffer(resource.data, written);
        if (at < 0) {
          r.same += 1;
          continue;
        }
        let direct = -2;
        try {
          direct = firstDiffer(resource.data, kind.encode(value, header));
        } catch {
          // The value as read does not encode either: the encoder's.
        }
        if (direct === -1) {
          r.lost += 1;
          example(r, `${where} lost: at ${at} of ${resource.data.length} (written ${written.length})`);
        } else r.encoder += 1;
      } else {
        // A whole file: against what the value as read writes, then read back.
        let written: Uint8Array;
        try {
          written = await kind.write(again);
        } catch (error) {
          r.threw += 1;
          example(r, `${where} write threw ${(error as Error).message.slice(0, 100)}`);
          continue;
        }
        const direct = await kind.write(value);
        const at = firstDiffer(direct, written);
        if (at < 0) r.same += 1;
        else {
          r.lost += 1;
          example(r, `${where} lost: at ${at} of ${direct.length} (written ${written.length})`);
        }
        try {
          if (toJson(await kind.read(written, nodeInflate)) === text) r.readsBack += 1;
          else example(r, `${where} reads back to other values`);
        } catch (error) {
          example(r, `${where} does not read back: ${(error as Error).message.slice(0, 80)}`);
        }
      }
    }
  } finally {
    await access.close();
  }
}

for (const [magic, kind] of kinds) {
  const r = rows.get(magic);
  if (!r) {
    console.log(`${magic} none`);
    continue;
  }
  const back = kind.kind === 'file' ? `, ${r.readsBack} read back to the same JSON` : '';
  console.log(`${magic} ${r.same} same, ${r.lost} lost to JSON, ${r.encoder} differ as read too, ${r.threw} threw, ${r.skipped} skipped${back}`);
  for (const e of r.examples) console.log(`  e.g. ${e}`);
}
