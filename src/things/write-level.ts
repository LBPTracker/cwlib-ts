/**
 * Writing Things back: `editLevel`, `editPlan` and `editChunk` read a level, a
 * plan or a streaming chunk onto a tape (`io/tape.ts`), the edits below change
 * the tape, and `writeLevel`, `writePlan` and `writeChunk` write it out.
 *
 * ✔ **What is read and written with no edit comes back byte for byte** -- a
 * level's and a plan's payload and dependency table, and a chunk whole, over
 * the game's own (`dev/rewrite-levels.ts`, steering/level-files.md, *Writing a
 * level*). A compressed container is `writeResource`'s, its zlib streams this
 * machine's and not the game's; an uncompressed one, as every chunk and island
 * is, is the file.
 *
 * The edits are the ones a tape can make without knowing a part's layout:
 * - **remove** Things from a world or a plan, with everything parented under them;
 * - **add** Things from another level or plan of the same revision, their bodies with them;
 * - **move** a Thing, by rewriting its `PPos` world matrix;
 * - in a chunk, any of these on an island's plan (`openIsland`), and in a
 *   level, a chunk written anew in place of the one it names (`replaceChunk`).
 *
 * ⚠️ **A Thing is written wherever it is first mentioned, in the list or not.**
 * A removed Thing that another one still names -- a switch's target, a joint's
 * end -- stays in the stream at that mention, out of the list; and a Thing
 * added from elsewhere brings along every Thing its parts name. Only its
 * mentions of the other side's world Thing are turned to this one's, or to
 * nothing in a plan.
 */

import { openSerializer, readDependencies, type Inflate } from '../io/resource.ts';
import { requireLbp3, SerializerError, type RevisionInfo } from '../io/serializer.ts';
import { findSegment, Tape, type ListSegment, type MarkSegment, type TapeObject } from '../io/tape.ts';
import { dependencyKey, Writer, writeResource, type Deflate, type DependencyOut } from '../io/writer.ts';
import { fromHex, toHex } from '../io/hex.ts';
import {
  planTapes, readChunkIslandsStream, readLevelStream, readPlanStream, type IslandBounds, type LevelParse,
} from './level.ts';
import { partReaders, withBone, type PosPart } from './parts.ts';
import type { PartReader, Thing } from './thing.ts';

/** What a level, a plan and an island's plan share: a list of Things on a tape. */
export interface EditableThings {
  readonly parse: LevelParse;
  /** The tape the Things are on: a plan's `thingData`, a level's whole payload. */
  readonly tape: Tape;
  readonly revision: RevisionInfo;
  readonly compressionFlags: number;
  readonly isCompressed: boolean;
  /** The dependency table as read, and what added Things brought. */
  readonly dependencies: DependencyOut[];
  /** The list of Things: a world's, or a plan's Thing array. */
  readonly things: ListSegment;
  /** A level's world Thing; a plan has none. */
  readonly world?: TapeObject;
  /** Other files' world Things, written as this one's, or as null. */
  readonly aliases: Map<TapeObject, TapeObject | null>;
  /** Whether an edit has touched it -- what makes a chunk write an island anew. */
  edited: boolean;
}

export interface EditableLevel extends EditableThings {
  readonly world: TapeObject;
  /** A chunk's original SHA-1 → the one it has now, for those `replaceChunk` changed. */
  readonly chunkHashes: Map<string, string>;
}

export interface EditablePlan extends EditableThings {
  /** The tape of `RPlan` around the Things. */
  readonly outer: Tape;
}

export interface EditableChunk {
  readonly tape: Tape;
  readonly revision: RevisionInfo;
  readonly compressionFlags: number;
  readonly isCompressed: boolean;
  readonly dependencies: DependencyOut[];
  readonly islands: readonly Island[];
}

/** One island of a chunk: its plan's bytes as read, and the plan once opened. */
export interface Island {
  readonly bytes: Uint8Array;
  readonly bounds: IslandBounds;
  readonly mark: MarkSegment;
  plan?: EditablePlan;
}

const LEVEL = 'LVLb';
const PLAN = 'PLNb';
const CHUNK = 'CHKb';

const dependenciesOf = (bytes: Uint8Array): DependencyOut[] =>
  readDependencies(bytes).map((d): DependencyOut =>
    d.kind === 'sha1' ? { hash: fromHex(d.sha1), type: d.type } : { guid: d.guid, type: d.type });

async function open(bytes: Uint8Array, inflate: Inflate, magic: string) {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== magic) throw new SerializerError(`a ${resource.magic}, not a ${magic}`);
  requireLbp3(revision);
  const tape = new Tape(s.data);
  s.tape = tape;
  return {
    s, tape, revision, compressionFlags: resource.compressionFlags, isCompressed: resource.isCompressed,
    dependencies: dependenciesOf(bytes),
  };
}

/**
 * Read a level onto a tape. ❗ **Only a level read to its last byte can be
 * written**: a tail that does not read is bytes the tape never closed.
 */
export async function editLevel(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<EditableLevel> {
  const { s, tape, ...rest } = await open(bytes, inflate, LEVEL);
  const parse = readLevelStream(s, rest.revision, readers);
  if (parse.unreadTail !== undefined) throw new SerializerError(`the level did not read whole: ${parse.unreadTail}`);
  tape.finish(s.position);

  const root = tape.root.find((segment) => !(segment instanceof Uint8Array) && segment.kind === 'ref');
  const world = root && !(root instanceof Uint8Array) && root.kind === 'ref' ? root.target : undefined;
  const worldPart = world && findSegment(world.body, 'ref', 'WORLD')?.target;
  const things = worldPart && findSegment(worldPart.body, 'list', 'things');
  if (!world || !things) throw new SerializerError('the tape has no world Thing with a list of Things');
  return { ...rest, parse, tape, world, things, aliases: new Map(), edited: false, chunkHashes: new Map() };
}

/** Read a plan onto a tape, its `thingData` onto one of its own. Read whole, as a level must be. */
export async function editPlan(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<EditablePlan> {
  const { s, tape: outer, ...rest } = await open(bytes, inflate, PLAN);
  const parse = readPlanStream(s, rest.revision, rest.compressionFlags, readers);
  if (parse.unreadTail !== undefined) throw new SerializerError(`the plan did not read whole: ${parse.unreadTail}`);
  outer.finish(s.position);
  const tape = planTapes.get(outer);
  const things = tape && findSegment(tape.root, 'list', 'things');
  const thingData = outer.marks.find((mark) => mark.label === 'thingData');
  if (!tape || !things || !thingData) throw new SerializerError("the tape has no plan's Thing array");
  const plan: EditablePlan = { ...rest, parse, tape, outer, things, aliases: new Map(), edited: false };
  // The Things' stream is written into the blob it was read from, its length first.
  thingData.write = (w) => {
    const inner = new Writer(plan.revision, plan.compressionFlags, tape.data.length + 0x1000);
    tape.write(inner, tape.root, plan.aliases);
    const data = inner.done();
    w.i32(data.length);
    w.bytes(data);
  };
  return plan;
}

/** Read a streaming chunk onto a tape. Its islands' plans open one at a time, with `openIsland`. */
export async function editChunk(bytes: Uint8Array, inflate: Inflate): Promise<EditableChunk> {
  const { s, tape, ...rest } = await open(bytes, inflate, CHUNK);
  const { plans, bounds } = readChunkIslandsStream(s);
  tape.finish(s.position);
  const marks = tape.marks.filter((mark) => mark.label === 'planData');
  if (marks.length !== plans.length) throw new SerializerError(`${marks.length} island marks for ${plans.length} islands`);
  return { ...rest, tape, islands: plans.map((plan, i) => ({ bytes: plan, bounds: bounds[i]!, mark: marks[i]! })) };
}

/** An island's plan, opened for editing on first asking. */
export async function openIsland(
  chunk: EditableChunk,
  index: number,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<EditablePlan> {
  const island = chunk.islands[index];
  if (!island) throw new SerializerError(`no island ${index} of ${chunk.islands.length}`);
  island.plan ??= await editPlan(island.bytes, inflate, readers);
  return island.plan;
}

/** The Things in the list now, in order. */
export function worldThings(target: EditableThings): Thing[] {
  return target.things.items.flatMap((item) => (item?.value ? [item.value as Thing] : []));
}

/** Remove Things from the list, and every Thing parented under one of them. */
export function removeThings(target: EditableThings, things: Iterable<Thing>): void {
  const gone = new Set(things);
  const under = (thing: Thing | undefined): boolean => {
    for (let t = thing, depth = 0; t && depth < 0x10000; t = t.parent, depth += 1) if (gone.has(t)) return true;
    return false;
  };
  const kept = target.things.items.filter((item) => !under(item?.value as Thing | undefined));
  target.things.items.splice(0, target.things.items.length, ...kept);
  target.edited = true;
}

/**
 * Add Things of another level or plan to this one's list, after its own.
 *
 * ❗ **The two must share a revision and compression flags**: a body is bytes
 * in its file's layout, and nothing here converts one. The other side's
 * dependency table is merged into this one's, whole.
 */
export function addThings(target: EditableThings, from: EditableThings, things: Iterable<Thing>): void {
  const same = (a: RevisionInfo, b: RevisionInfo): boolean =>
    a.version === b.version && a.subVersion === b.subVersion && a.branchId === b.branchId && a.branchRevision === b.branchRevision;
  if (!same(target.revision, from.revision) || target.compressionFlags !== from.compressionFlags) {
    throw new SerializerError('Things can only be added from a file of the same revision and compression');
  }
  for (const thing of things) {
    const object = from.tape.objectOf(thing);
    if (!object) throw new SerializerError(`Thing ${thing.uid} is not on that file's tape`);
    target.things.items.push(object);
  }
  if (from !== target && from.world) target.aliases.set(from.world, target.world ?? null);
  const known = new Set(target.dependencies.map(dependencyKey));
  for (const dependency of from.dependencies) {
    const key = dependencyKey(dependency);
    if (!known.has(key)) {
      known.add(key);
      target.dependencies.push(dependency);
    }
  }
  target.edited = true;
}

/**
 * Put a Thing somewhere else: its `PPos` world matrix, column-major as
 * `readPos` returns it. The game makes the local matrix again from the
 * parent's (cwlib `PPos`, from version 0x341), so a child keeps its own.
 */
export function setWorldPosition(target: EditableThings, thing: Thing, matrix: ArrayLike<number>): void {
  const object = target.tape.objectOf(thing);
  const pos = object && findSegment(object.body, 'ref', 'POS')?.target;
  const mark = pos && findSegment(pos.body, 'mark', 'worldPosition');
  if (!mark) throw new SerializerError(`Thing ${thing.uid} has no PPos on the tape`);
  const value = Float32Array.from(matrix);
  if (value.length !== 16) throw new SerializerError(`a world matrix of ${value.length} components`);
  mark.write = (w) => w.matrix(value);
  // The bone and its animation stay with the Thing: only the matrix moved.
  const old = thing.parts.get('POS') as PosPart | undefined;
  thing.parts.set('POS', withBone(value, { thingOfWhichIAmABone: old?.thingOfWhichIAmABone, animHash: old?.animHash ?? 0, localPosition: old?.localPosition }));
  target.edited = true;
}

/**
 * Name a chunk written anew where the level named the old one: the
 * `ChunkFile.chunkHash` of every chunk entry that held it, and its row in the
 * dependency table. `sha1` is the chunk's SHA-1 as the level was read; the
 * level then names the SHA-1 of `chunk`, which is returned.
 */
export async function replaceChunk(level: EditableLevel, sha1: string, chunk: Uint8Array): Promise<string> {
  const next = toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', chunk as BufferSource)));
  const marks = level.tape.marks.filter((mark) => mark.label === 'chunkHash' && toHex(mark.bytes) === sha1);
  if (marks.length === 0) throw new SerializerError(`the level names no chunk ${sha1}`);
  const hash = fromHex(next);
  for (const mark of marks) mark.write = (w) => w.sha1(hash);
  const current = level.chunkHashes.get(sha1) ?? sha1;
  const row = level.dependencies.findIndex((d) => d.hash !== undefined && toHex(d.hash) === current);
  if (row >= 0) level.dependencies[row] = { ...level.dependencies[row]!, hash };
  level.chunkHashes.set(sha1, next);
  level.edited = true;
  return next;
}

const payloadOf = (target: { revision: RevisionInfo; compressionFlags: number }, tape: Tape, aliases?: EditableThings['aliases']): Uint8Array => {
  const w = new Writer(target.revision, target.compressionFlags, tape.data.length + 0x1000);
  tape.write(w, tape.root, aliases);
  return w.done();
};

const container = (
  magic: string,
  target: { revision: RevisionInfo; compressionFlags: number; isCompressed: boolean; dependencies: readonly DependencyOut[] },
  payload: Uint8Array,
  deflate: Deflate,
): Promise<Uint8Array> => writeResource({
  magic, revision: target.revision, compressionFlags: target.compressionFlags, payload,
  dependencies: target.dependencies, isCompressed: target.isCompressed,
}, deflate);

/** The level's payload, as `writeLevel` puts it in its container. */
export function writeLevelPayload(level: EditableLevel): Uint8Array {
  return payloadOf(level, level.tape, level.aliases);
}

/** The whole `LVLb`: the payload, in chunks when it was read so, and the dependency table. */
export function writeLevel(level: EditableLevel, deflate: Deflate): Promise<Uint8Array> {
  return container(LEVEL, level, writeLevelPayload(level), deflate);
}

/** The plan's payload, its Things written into `thingData`. */
export function writePlanPayload(plan: EditablePlan): Uint8Array {
  return payloadOf(plan, plan.outer);
}

/** The whole `PLNb`. */
export function writePlan(plan: EditablePlan, deflate: Deflate): Promise<Uint8Array> {
  return container(PLAN, plan, writePlanPayload(plan), deflate);
}

/**
 * The whole `CHKb`: every island as it was read, but those an edit touched,
 * which are written anew. ⚠️ An island's bounds and the GUID and hash lists
 * after its plan are kept as read, whatever the edit moved or brought.
 */
export async function writeChunk(chunk: EditableChunk, deflate: Deflate): Promise<Uint8Array> {
  for (const island of chunk.islands) {
    if (!island.plan?.edited) {
      island.mark.write = undefined;
      continue;
    }
    const bytes = await writePlan(island.plan, deflate);
    island.mark.write = (w) => {
      w.i32(bytes.length);
      w.bytes(bytes);
    };
  }
  return container(CHUNK, chunk, payloadOf(chunk, chunk.tape), deflate);
}
