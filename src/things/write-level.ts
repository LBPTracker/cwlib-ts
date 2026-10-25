/**
 * Writing a level back: `editLevel` reads one onto a tape (`io/tape.ts`), the
 * edits below change the tape, and `writeLevel` writes it out.
 *
 * ✔ **A level read and written with no edit comes back byte for byte** -- the
 * payload and the dependency table, over the game's levels (`dev/rewrite-levels.ts`,
 * steering/level-files.md, *Writing a level*). The container around them is
 * `writeResource`'s, and its zlib streams are this machine's, not the game's.
 *
 * The edits are the ones a tape can make without knowing a part's layout:
 * - **remove** Things from the world, with everything parented under them;
 * - **add** Things from another level of the same revision, their bodies with them;
 * - **move** a Thing, by rewriting its `PPos` world matrix.
 *
 * ⚠️ **A Thing is written wherever it is first mentioned, in the world's list
 * or not.** A removed Thing that another one still names -- a switch's target,
 * a joint's end -- stays in the stream at that mention, out of the world; and a
 * Thing added from another level brings along every Thing its parts name. Only
 * its mentions of the other level's world Thing are turned to this one's.
 */

import { openSerializer, readDependencies, type Inflate } from '../io/resource.ts';
import { requireLbp3, SerializerError, type RevisionInfo } from '../io/serializer.ts';
import { findSegment, Tape, type ListSegment, type TapeObject } from '../io/tape.ts';
import { dependencyKey, Writer, writeResource, type Deflate, type DependencyOut } from '../io/writer.ts';
import { fromHex } from '../io/hex.ts';
import { readLevelStream, type LevelParse } from './level.ts';
import { partReaders } from './parts.ts';
import type { PartReader, Thing } from './thing.ts';

/** A level read onto a tape, to be edited and written. */
export interface EditableLevel {
  readonly parse: LevelParse;
  readonly tape: Tape;
  readonly revision: RevisionInfo;
  readonly compressionFlags: number;
  /** The dependency table as read, and what added Things brought. */
  readonly dependencies: DependencyOut[];
  /** The world Thing's object on the tape. */
  readonly world: TapeObject;
  /** The world's list of Things. */
  readonly things: ListSegment;
  /** Other levels' world Things, written as this one's. */
  readonly aliases: Map<TapeObject, TapeObject>;
}

const LEVEL_MAGIC = 'LVLb';

/**
 * Read a level onto a tape. ❗ **Only a level read to its last byte can be
 * written**: a tail that does not read is bytes the tape never closed.
 */
export async function editLevel(
  bytes: Uint8Array,
  inflate: Inflate,
  readers: Map<string, PartReader> = partReaders(),
): Promise<EditableLevel> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== LEVEL_MAGIC) throw new SerializerError(`a ${resource.magic}, not a level`);
  requireLbp3(revision);
  const tape = new Tape(s.data);
  s.tape = tape;
  const parse = readLevelStream(s, revision, readers);
  if (parse.unreadTail !== undefined) throw new SerializerError(`the level did not read whole: ${parse.unreadTail}`);
  tape.finish(s.position);

  const root = tape.root.find((segment) => !(segment instanceof Uint8Array) && segment.kind === 'ref');
  const world = root && !(root instanceof Uint8Array) && root.kind === 'ref' ? root.target : undefined;
  const worldPart = world && findSegment(world.body, 'ref', 'WORLD')?.target;
  const things = worldPart && findSegment(worldPart.body, 'list', 'things');
  if (!world || !things) throw new SerializerError("the tape has no world Thing with a list of Things");

  const dependencies = readDependencies(bytes).map((d): DependencyOut =>
    d.kind === 'sha1' ? { hash: fromHex(d.sha1), type: d.type } : { guid: d.guid, type: d.type });
  return {
    parse, tape, revision, compressionFlags: resource.compressionFlags, dependencies, world, things,
    aliases: new Map(),
  };
}

/** The Things in the world's list now, in order. */
export function worldThings(level: EditableLevel): Thing[] {
  return level.things.items.flatMap((item) => (item?.value ? [item.value as Thing] : []));
}

/** Remove Things from the world's list, and every Thing parented under one of them. */
export function removeThings(level: EditableLevel, things: Iterable<Thing>): void {
  const gone = new Set(things);
  const under = (thing: Thing | undefined): boolean => {
    for (let t = thing, depth = 0; t && depth < 0x10000; t = t.parent, depth += 1) if (gone.has(t)) return true;
    return false;
  };
  const kept = level.things.items.filter((item) => !under(item?.value as Thing | undefined));
  level.things.items.splice(0, level.things.items.length, ...kept);
}

/**
 * Add Things of another level to this one's world, after its own.
 *
 * ❗ **The two must share a revision and compression flags**: a body is bytes
 * in its file's layout, and nothing here converts one. The other level's
 * dependency table is merged into this one's, whole.
 */
export function addThings(level: EditableLevel, from: EditableLevel, things: Iterable<Thing>): void {
  const same = (a: RevisionInfo, b: RevisionInfo): boolean =>
    a.version === b.version && a.subVersion === b.subVersion && a.branchId === b.branchId && a.branchRevision === b.branchRevision;
  if (!same(level.revision, from.revision) || level.compressionFlags !== from.compressionFlags) {
    throw new SerializerError('Things can only be added from a level of the same revision and compression');
  }
  for (const thing of things) {
    const object = from.tape.objectOf(thing);
    if (!object) throw new SerializerError(`Thing ${thing.uid} is not on that level's tape`);
    level.things.items.push(object);
  }
  if (from !== level) level.aliases.set(from.world, level.world);
  const known = new Set(level.dependencies.map(dependencyKey));
  for (const dependency of from.dependencies) {
    const key = dependencyKey(dependency);
    if (!known.has(key)) {
      known.add(key);
      level.dependencies.push(dependency);
    }
  }
}

/**
 * Put a Thing somewhere else: its `PPos` world matrix, column-major as
 * `readPos` returns it. The game makes the local matrix again from the
 * parent's (cwlib `PPos`, from version 0x341), so a child keeps its own.
 */
export function setWorldPosition(level: EditableLevel, thing: Thing, matrix: ArrayLike<number>): void {
  const pos = level.tape.objectOf(thing) && findSegment(level.tape.objectOf(thing)!.body, 'ref', 'POS')?.target;
  const mark = pos && findSegment(pos.body, 'mark', 'worldPosition');
  if (!mark) throw new SerializerError(`Thing ${thing.uid} has no PPos on the tape`);
  const value = Float32Array.from(matrix);
  if (value.length !== 16) throw new SerializerError(`a world matrix of ${value.length} components`);
  mark.write = (w) => w.matrix(value);
  thing.parts.set('POS', value);
}

/** The level's payload, as `writeLevel` deflates it. */
export function writeLevelPayload(level: EditableLevel): Uint8Array {
  const w = new Writer(level.revision, level.compressionFlags, level.tape.data.length + 0x1000);
  level.tape.write(w, level.tape.root, level.aliases);
  return w.done();
}

/** The whole `LVLb`: the payload in chunks, and the dependency table. */
export async function writeLevel(level: EditableLevel, deflate: Deflate): Promise<Uint8Array> {
  return writeResource({
    magic: LEVEL_MAGIC,
    revision: level.revision,
    compressionFlags: level.compressionFlags,
    payload: writeLevelPayload(level),
    dependencies: level.dependencies,
  }, deflate);
}
