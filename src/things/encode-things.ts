/**
 * A level's or a plan's whole payload written from its values: what
 * `readLevel` and `readPlan` returned, with no tape (`write-level.ts` is the
 * other way, the bytes as read and only the edits written anew).
 *
 * Every Thing goes through `writeThing` (`thing.ts`), its header as read and
 * each part through its writer (`write-parts.ts`), and every object the stream
 * refers to -- a Thing, a part, a shared struct -- under the reference id it
 * had in its file, so a payload read and encoded again comes back byte for
 * byte. `dev/things-encode-census.ts` checks that over the game's levels and
 * plans; the numbers are in steering/level-files.md, *Levels written from
 * their values*.
 *
 * ⚠️ Only a parse read whole can be encoded whole: a level with `unreadTail`
 * stopped somewhere its values do not reach.
 */

import { SerializerError, type RevisionInfo } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';
import { writeInventoryItemDetails } from '../structs/inventory.ts';
import { LAMS_KEYS, LD_LAMS_KEYS, PLAN_DETAILS, STREAMING_PLAN, writeLevelTail, type LevelParse } from './level.ts';
import { onLeerdammer, writeNamedPart, writeThing, type Thing } from './thing.ts';
import { partWriters, type PartWriter, type PartWriteContext } from './write-parts.ts';

/** What the container says of the payload: its revision and compression flags. */
export interface EncodeHeader {
  readonly revision: RevisionInfo;
  readonly compressionFlags: number;
}

let writers: ReadonlyMap<string, PartWriter> | undefined;

/** Writes a Thing from its values, at its first mention, under its file's id. */
const context: PartWriteContext = {
  thing: (w, thing) => {
    // ❗ A part writer hands some parts' references here as well -- a contact's
    // `PShape` (`shape.ts`) -- since on a tape they are objects like a Thing.
    if (thing && !(thing.parts instanceof Map)) {
      writers ??= partWriters();
      if (writeNamedPart(w, thing, context, writers)) return;
      // ⚠️ A contact can name a shape no Thing of the stream holds -- 6 of them
      // in `4db40dd6` -- read inline in the contact (`readContactCache`). It is
      // the one object a part writer hands here that is neither, so it is
      // written as a `PShape`, under the id it had (`Writer.reference`).
      const shape = writers.get('SHAPE')!;
      w.reference(thing, (self) => shape(self, thing as never, context));
      return;
    }
    w.reference(thing, writeThingFromValues, thing?.id);
  },
};

/** One Thing's body from its values: `writeThing` with every part's writer, Things it names likewise. */
export function writeThingFromValues(w: Writer, thing: Thing): void {
  writers ??= partWriters();
  writeThing(w, thing, context, writers);
}

/** The part writers' context for a stream written wholly from values. */
export function valuesContext(): PartWriteContext {
  return context;
}

/** A level's payload: `RLevel`'s cross-play hashes, its world Thing, and the rest of `RLevel`. */
export function encodeLevel(parse: LevelParse, header: EncodeHeader): Uint8Array {
  if (!parse.world) throw new SerializerError('the parse holds no world Thing');
  if (parse.unreadTail !== undefined) throw new SerializerError(`the level did not read whole: ${parse.unreadTail}`);
  const w = new Writer(header.revision, header.compressionFlags, 0x40000);
  if (header.revision.version > 0x3e6) {
    const hashes = parse.crossPlayHashes ?? [];
    w.i32(hashes.length);
    for (const hash of hashes) w.sha1(hash);
  }
  context.thing(w, parse.world);
  writeLevelTail(w, parse.levelTail ?? {});
  return w.done();
}

/**
 * A plan's payload: `isUsedForStreaming`, the revision word, the Things in a
 * stream of their own -- its own reference ids -- and the inventory details
 * with the location and category, as LAMS keys or below `LAMS_KEYS` as tags.
 */
export function encodePlan(parse: LevelParse, header: EncodeHeader): Uint8Array {
  if (parse.unreadTail !== undefined) throw new SerializerError(`the plan did not read whole: ${parse.unreadTail}`);
  const { revision } = header;
  const w = new Writer(revision, header.compressionFlags, 0x10000);
  const streaming = parse.isUsedForStreaming ?? false;
  if (revision.subVersion >= STREAMING_PLAN) w.bool(streaming);
  w.i32(parse.planRevision ?? (((revision.subVersion << 16) | revision.version) >>> 0));
  const inner = new Writer(revision, header.compressionFlags, 0x40000);
  inner.i32(parse.things.length);
  for (const thing of parse.things) context.thing(inner, thing);
  const data = inner.done();
  w.i32(data.length);
  w.bytes(data);
  if (revision.version >= PLAN_DETAILS && !streaming) {
    const inventory = parse.inventory;
    if (!inventory) throw new SerializerError('a plan at this revision needs its inventory details');
    writeInventoryItemDetails(w, inventory.details);
    if (onLeerdammer(revision, LD_LAMS_KEYS) || revision.version >= LAMS_KEYS) {
      w.u32(inventory.location);
      w.u32(inventory.category);
    } else {
      w.str(inventory.locationTag ?? '');
      w.str(inventory.categoryTag ?? '');
    }
  }
  return w.done();
}
