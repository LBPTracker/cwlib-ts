/** `CHECKPOINT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, vitaRevision } from '../../io/serializer.ts';
import { type PartReader, type Thing } from '../thing.ts';
import { thingArray } from './common.ts';

/** `PCheckpoint`, kept: what kind of spawn point, how many lives, and its name. */
export interface CheckpointPart {
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
  if (subVersion > 0x101) s.u8();
  else s.bool(); // activeFlags
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
  if (subVersion >= 0x88) {
    if (subVersion <= 0x12a) creatureToSpawnAs = s.resource()?.guid ?? 0;
    if (subVersion >= 0xc5) creatureToSpawnAs = s.s32();
  }
  const isStartPoint = subVersion >= 0xcb ? s.bool() : false;
  const linkVisibleOnPlanet = subVersion >= 0xd5 ? s.bool() : false;
  if (subVersion >= 0x108 && subVersion < 0x129) s.u8();
  const name = subVersion >= 0xcb ? s.wstr() : '';
  if (subVersion >= 0xe4) s.i32();
  if (subVersion >= 0xd1) s.wstr();
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
    teamFilter, persistPoint, enableAudio, continueMusic, persistLives,
  };
}
