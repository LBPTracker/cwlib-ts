/** `CHECKPOINT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision, type ResourceRef } from '../../io/serializer.ts';
import { type PartReader, type Thing } from '../thing.ts';
import { thingArray, writeThingArray } from './common.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** `PCheckpoint`, kept: what kind of spawn point, how many lives, and its name. */
export interface CheckpointPart {
  /** cwlib `PCheckpoint.activeFlags`: an `i8` above subVersion 0x101, else a bool read as 0xf or 0. */
  readonly activeFlags: number;
  /** cwlib's placeholder names: an `i32` from subVersion 0xe4 and a `wstr` from 0xd1. */
  readonly unk1?: number;
  readonly unk2?: string;
  /** -1 where the revision has none; an infinite checkpoint has `instanceInfiniteSpawns`. */
  readonly spawnsLeft: number;
  readonly maxSpawnsLeft: number;
  readonly instanceInfiniteSpawns: boolean;
  readonly spawningList: readonly (Thing | undefined)[];
  readonly spawningDelay: number;
  readonly lifeMultiplier: number;
  readonly creatureToSpawnAs: number;
  /** An adventure's start point, from subVersion 0xcb. */
  readonly isStartPoint: boolean;
  readonly linkVisibleOnPlanet: boolean;
  readonly name: string;
  /** cwlib's `CheckpointType`, from subVersion 0x101. */
  readonly checkpointType: number;
  readonly teamFlags: number;
  readonly activationFrame: number;
  readonly creatureToChangeBackTo?: number;
  readonly changeBackGate?: boolean;
  readonly teamFilter?: number;
  readonly persistPoint?: number;
  readonly enableAudio?: boolean;
  readonly continueMusic?: boolean;
  readonly persistLives?: boolean;
  /** SubVersions 0x88..0x12a: the creature to spawn as, a plan descriptor (from 0xc5 the `s32` follows it). */
  readonly creatureDescriptor?: ResourceRef;
}

/** `PCheckpoint`: a spawn point. Almost all of its later fields are subVersion-gated. */
export function readCheckpoint(s: Serializer, readers: ReadonlyMap<string, PartReader>): CheckpointPart {
  const { version, subVersion } = s.revision;
  let teamFilter: number | undefined;
  let persistPoint: number | undefined;
  let enableAudio: boolean | undefined;
  let continueMusic: boolean | undefined;
  let persistLives: boolean | undefined;
  let creatureToChangeBackTo: number | undefined;
  let changeBackGate: boolean | undefined;
  const activeFlags = subVersion > 0x101 ? s.i8() : s.bool() ? 0xf : 0;
  const activationFrame = s.i32();
  const spawnsLeft = version >= 0x1a7 ? s.s32() : -1;
  const maxSpawnsLeft = version >= 0x1c6 ? s.s32() : -1;
  const instanceInfiniteSpawns = version >= 0x1eb ? s.bool() : false;
  let spawningList: (Thing | undefined)[] = [];
  let spawningDelay = 0;
  if (version >= 0x1f3) {
    spawningList = thingArray(s, readers);
    spawningDelay = s.i32();
  }
  const lifeMultiplier = version >= 0x1fa ? s.i32() : 1;
  if (version >= 0x2ae && subVersion < 0x100) teamFilter = s.i32();
  if (subVersion >= 0x1 && subVersion < 0x127) persistPoint = s.u8();
  let creatureToSpawnAs = 0;
  let creatureDescriptor: ResourceRef | undefined;
  if (subVersion >= 0x88) {
    if (subVersion <= 0x12a) {
      creatureDescriptor = s.resource();
      creatureToSpawnAs = creatureDescriptor?.guid ?? 0;
    }
    if (subVersion >= 0xc5) creatureToSpawnAs = s.s32();
  }
  const isStartPoint = subVersion >= 0xcb ? s.bool() : false;
  const linkVisibleOnPlanet = subVersion >= 0xd5 ? s.bool() : false;
  if (subVersion >= 0x108 && subVersion < 0x129) s.u8();
  const name = subVersion >= 0xcb ? s.wstr() : '';
  const unk1 = subVersion >= 0xe4 ? s.i32() : undefined;
  const unk2 = subVersion >= 0xd1 ? s.wstr() : undefined;
  let checkpointType = 0;
  let teamFlags = 0;
  if (subVersion >= 0x101) {
    checkpointType = s.i32();
    teamFlags = s.i32();
  }
  if (vitaRevision(s.revision) >= 0x50 || subVersion >= 0x15a) enableAudio = s.bool();
  if (subVersion >= 0x191) continueMusic = s.bool();
  if (subVersion >= 0x199) {
    creatureToChangeBackTo = s.i32();
    changeBackGate = s.bool();
  }
  if (subVersion >= 0x19b) persistLives = s.bool();
  return {
    spawnsLeft, maxSpawnsLeft, instanceInfiniteSpawns, spawningList, spawningDelay, lifeMultiplier,
    creatureToSpawnAs, isStartPoint, linkVisibleOnPlanet, name, checkpointType, teamFlags,
  activationFrame, creatureToChangeBackTo, changeBackGate,
    teamFilter, persistPoint, enableAudio, continueMusic, persistLives, activeFlags, unk1, unk2,
    creatureDescriptor,
  };
}

/** `readCheckpoint`'s mirror; the byte cwlib writes 0 between subVersions 0x108 and 0x129 is written so. */
export function writeCheckpoint(w: Writer, c: CheckpointPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  if (subVersion > 0x101) w.i8(c.activeFlags);
  else w.bool((c.activeFlags & 0xf) !== 0);
  w.i32(c.activationFrame);
  if (version >= 0x1a7) w.s32(c.spawnsLeft);
  if (version >= 0x1c6) w.s32(c.maxSpawnsLeft);
  if (version >= 0x1eb) w.bool(c.instanceInfiniteSpawns);
  if (version >= 0x1f3) {
    writeThingArray(w, ctx, c.spawningList);
    w.i32(c.spawningDelay);
  }
  if (version >= 0x1fa) w.i32(c.lifeMultiplier);
  if (version >= 0x2ae && subVersion < 0x100) w.i32(c.teamFilter ?? 0);
  if (subVersion >= 0x1 && subVersion < 0x127) w.u8(c.persistPoint ?? 0);
  if (subVersion >= 0x88) {
    if (subVersion <= 0x12a) {
      w.ref(c.creatureDescriptor ?? (subVersion < 0xc5 && c.creatureToSpawnAs ? { guid: c.creatureToSpawnAs } : undefined));
    }
    if (subVersion >= 0xc5) w.s32(c.creatureToSpawnAs);
  }
  if (subVersion >= 0xcb) w.bool(c.isStartPoint);
  if (subVersion >= 0xd5) w.bool(c.linkVisibleOnPlanet);
  if (subVersion >= 0x108 && subVersion < 0x129) w.u8(0);
  if (subVersion >= 0xcb) w.wstr(c.name);
  if (subVersion >= 0xe4) w.i32(c.unk1 ?? 0);
  if (subVersion >= 0xd1) w.wstr(c.unk2 ?? '');
  if (subVersion >= 0x101) {
    w.i32(c.checkpointType);
    w.i32(c.teamFlags);
  }
  if (vitaRevision(w.revision) >= 0x50 || subVersion >= 0x15a) w.bool(c.enableAudio ?? false);
  if (subVersion >= 0x191) w.bool(c.continueMusic ?? false);
  if (subVersion >= 0x199) {
    w.i32(c.creatureToChangeBackTo ?? 0);
    w.bool(c.changeBackGate ?? false);
  }
  if (subVersion >= 0x19b) w.bool(c.persistLives ?? false);
}
