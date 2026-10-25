/**
 * A stream as it was read, kept so it can be written back: the **tape**.
 *
 * ❗ **Why not a writer per reader.** A reader here keeps what a consumer needs
 * and steps over the rest -- a Thing's `lookAt`, a creature's history, the
 * fields below the revision bound -- so writing a level back from the values
 * would need a second, complete serializer for some 8,000 lines of readers,
 * every field of which could disagree with its reader unseen. The tape keeps
 * the **bytes** instead, and only the one thing that cannot be kept as bytes:
 *
 * ❗ **The reference ids.** An id is handed out in first-mention order and an
 * object's body lies **inline at its first mention** (`Serializer.reference`),
 * so dropping, adding or moving one object renumbers everything after it and
 * moves bodies between places. The tape therefore cuts the stream at every
 * reference: raw byte runs between them, and a node per reference naming the
 * object, whose own body is a tape of its own. Writing walks the root through
 * a `Writer`, whose `reference` puts each body at its object's first mention
 * and keeps the object's own id where no other object has it -- the same ids,
 * in the same places, when nothing changed, which is what proves the cut.
 *
 * Three more nodes make it editable:
 * - a **list**: an array of references (a world's Things), so items can be
 *   removed and added and the count follows;
 * - a **mark**: a labelled byte run a reader names (a `PPos` world matrix), so
 *   it can be rewritten by a function;
 * - a **label** on a reference node (a Thing's parent, its parts by name).
 *
 * ⚠️ **One id space.** A script's field layouts and boxed objects are named by
 * raw ids that `Serializer.pointers` keeps apart from `referenced`; cwlib's
 * `ScriptInstance` and `ScriptObjectUID` draw them from the one
 * `nextReference` counter (ennuo/toolkit `d6a2ef8`), so the tape records them
 * in the same space, and the round trip over the game's levels is what checks
 * that (steering/level-files.md, *Writing a level*).
 */

import { SerializerError } from './serializer.ts';
import type { Writer } from './writer.ts';

/** An object the stream refers to, with its body as read. */
export interface TapeObject {
  /** The id the object had in the file it was read from. */
  readonly id: number;
  /** What the reader built of it, once it has; a Thing from the moment it is met. */
  value?: unknown;
  body: Segment[];
}

/** A reference to an object, `undefined` for a null one. */
export interface RefSegment {
  readonly kind: 'ref';
  target: TapeObject | undefined;
  readonly label?: string;
}

/** An array of references, its count written from its length. */
export interface ListSegment {
  readonly kind: 'list';
  readonly label: string;
  readonly items: (TapeObject | undefined)[];
}

/** A labelled byte run; `write`, when set, writes in its place. */
export interface MarkSegment {
  readonly kind: 'mark';
  readonly label: string;
  readonly bytes: Uint8Array;
  write?: (w: Writer) => void;
}

export type Segment = Uint8Array | RefSegment | ListSegment | MarkSegment;

interface Frame {
  readonly body: Segment[];
  list?: ListSegment;
}

/** The writer's view of objects: substitutes, by the object they stand for. */
export type Aliases = ReadonlyMap<TapeObject, TapeObject>;

export class Tape {
  readonly data: Uint8Array;
  readonly root: Segment[] = [];
  private readonly objects = new Map<number, TapeObject>();
  private readonly byValue = new Map<unknown, TapeObject>();
  private readonly stack: Frame[] = [{ body: this.root }];
  private last = 0;
  private pendingLabel: string | undefined;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  private get frame(): Frame {
    return this.stack[this.stack.length - 1]!;
  }

  /** Move the raw run up to `to` into the open body. */
  private flush(to: number): void {
    if (to < this.last) throw new SerializerError(`tape cursor went back from ${this.last} to ${to}`);
    if (to === this.last) return;
    if (this.frame.list) {
      throw new SerializerError(`${to - this.last} raw bytes between the items of list ${this.frame.list.label}`);
    }
    this.frame.body.push(this.data.subarray(this.last, to));
    this.last = to;
  }

  /** Name the next reference node. */
  label(label: string): void {
    this.pendingLabel = label;
  }

  /**
   * A reference id read between `start` and `end`. A new object's body opens
   * here and is closed by `end`; the object is returned so a reader that has
   * its value from the start (a Thing) can say so.
   */
  ref(start: number, end: number, id: number, isNew: boolean, value?: unknown): TapeObject | undefined {
    this.flush(start);
    this.last = end;
    const label = this.pendingLabel;
    this.pendingLabel = undefined;
    let target: TapeObject | undefined;
    if (id !== 0) {
      target = this.objects.get(id);
      if (isNew) {
        if (target) throw new SerializerError(`reference id ${id} has two bodies`);
        target = { id, body: [] };
        this.objects.set(id, target);
      } else if (!target) {
        throw new SerializerError(`reference id ${id} is a back-reference to nothing on the tape`);
      }
    }
    const { list } = this.frame;
    if (list) list.items.push(target);
    else this.frame.body.push(label === undefined ? { kind: 'ref', target } : { kind: 'ref', target, label });
    if (target && isNew) {
      if (value !== undefined) this.own(target, value);
      this.stack.push({ body: target.body });
    }
    return target;
  }

  /** The body of the object opened last ends at `end`; `value` is what was built of it. */
  end(end: number, target: TapeObject, value?: unknown): void {
    this.flush(end);
    const frame = this.stack.pop();
    if (frame?.body !== target.body) throw new SerializerError(`tape body of id ${target.id} closed out of order`);
    if (value !== undefined && target.value === undefined) this.own(target, value);
  }

  private own(target: TapeObject, value: unknown): void {
    target.value = value;
    if (typeof value === 'object' && value !== null) this.byValue.set(value, target);
  }

  /** The references from here until `listEnd` are one list, its count read between `start` and `end`. */
  listStart(label: string, start: number, end: number): void {
    this.flush(start);
    this.last = end;
    const list: ListSegment = { kind: 'list', label, items: [] };
    this.frame.body.push(list);
    this.frame.list = list;
  }

  listEnd(): void {
    this.frame.list = undefined;
  }

  /** The bytes between `start` and `end` are the field `label`. */
  mark(label: string, start: number, end: number): void {
    this.flush(start);
    this.frame.body.push({ kind: 'mark', label, bytes: this.data.subarray(start, end) });
    this.last = end;
  }

  /** The stream ended at `end`: what is left goes to the root. */
  finish(end: number): void {
    if (this.stack.length !== 1) throw new SerializerError(`the tape ended with ${this.stack.length - 1} bodies open`);
    this.flush(end);
  }

  /** The object a reader's value came from. */
  objectOf(value: unknown): TapeObject | undefined {
    return this.byValue.get(value);
  }

  /** Write `body` (the root by default): each object at its first mention, under its own id where it is free. */
  write(w: Writer, body: readonly Segment[] = this.root, aliases?: Aliases): void {
    writeBody(w, body, aliases);
  }
}

const writeObject = (aliases: Aliases | undefined) => (w: Writer, object: TapeObject): void =>
  writeBody(w, object.body, aliases);

function writeBody(w: Writer, body: readonly Segment[], aliases: Aliases | undefined): void {
  const write = writeObject(aliases);
  const ref = (target: TapeObject | undefined): void => {
    const object = target && (aliases?.get(target) ?? target);
    w.reference(object, write, object?.id);
  };
  for (const segment of body) {
    if (segment instanceof Uint8Array) w.bytes(segment);
    else if (segment.kind === 'ref') ref(segment.target);
    else if (segment.kind === 'list') {
      w.i32(segment.items.length);
      for (const item of segment.items) ref(item);
    } else if (segment.write) segment.write(w);
    else w.bytes(segment.bytes);
  }
}

/** The first segment of `body` of this kind and label. */
export function findSegment<K extends 'ref' | 'list' | 'mark'>(
  body: readonly Segment[],
  kind: K,
  label: string,
): Extract<Segment, { kind: K }> | undefined {
  for (const segment of body) {
    if (!(segment instanceof Uint8Array) && segment.kind === kind && 'label' in segment && segment.label === label) {
      return segment as Extract<Segment, { kind: K }>;
    }
  }
  return undefined;
}
