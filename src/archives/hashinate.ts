/**
 * A resource's dependencies rewritten in place, and cwlib's `Resources.hashinate`:
 * a resource and everything it needs, each GUID it names turned to the SHA-1
 * of the bytes that GUID stands for -- the form that travels without the
 * game's FileDB (ennuo/toolkit `d6a2ef8`, `util/Resources.java`).
 *
 * ❗ **Each reference is found by the resource's own reader, not by searching
 * the bytes.** cwlib's `SerializedResource.replaceDependency` replaces every
 * run of bytes that spells the old descriptor, which a float or a count can
 * spell too. Here the resource's reader runs with a tape on its serializer
 * (`readOnTape` in `io/resource.ts`), every `Serializer.resource` it reads is a
 * mark, and only marks are rewritten; a resource whose table names a
 * dependency no mark holds is refused rather than half rewritten.
 *
 * ⚠️ **A dependency of type 10, 13, 40 or 49** (`FILENAME`, `FILE_OF_BYTES`,
 * `MUSIC_SETTINGS`, `SAMPLE`) is a bare GUID in the payload, not a descriptor,
 * as cwlib has it; no hash can stand there, so those stay GUIDs, as they do in
 * Java. Scripts' dependencies (type 11) are not followed, as Java does not: a
 * script names itself.
 */

import { toHex, fromHex } from '../io/hex.ts';
import { readDependencies, readOnTape, type Dependency, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo } from '../io/serializer.ts';
import type { MarkSegment, Tape } from '../io/tape.ts';
import { dependencyKey, Writer, writeResource, type Deflate, type DependencyOut } from '../io/writer.ts';
import { readAdventureCreateProfile } from '../resources/adventure-create-profile.ts';
import { readAdventureSharedData } from '../resources/adventure-shared-data.ts';
import { readAnimatedTexture } from '../resources/animated-texture.ts';
import { readBevel } from '../resources/bevel.ts';
import { readJointSettings } from '../resources/joint-settings.ts';
import { readMaterial } from '../resources/material.ts';
import { readMesh } from '../resources/mesh.ts';
import { readOutfitList } from '../resources/outfit-list.ts';
import { readPacks } from '../resources/packs.ts';
import { readPalette } from '../resources/palette.ts';
import { readPins } from '../resources/pins.ts';
import { readQuest } from '../resources/quest.ts';
import { readScript } from '../resources/script.ts';
import { readSlotList } from '../resources/slot-list.ts';
import { readSyncedProfile } from '../resources/synced-profile.ts';
import { readTutorials } from '../resources/tutorials.ts';
import {
  editChunk, editLevel, editPlan, openIsland, writeChunk, writeLevel, writePlan, type EditablePlan,
} from '../things/write-level.ts';

/** The readers a resource is put on a tape through, by magic; levels, plans and chunks have their own. */
const READERS: Readonly<Record<string, (bytes: Uint8Array, inflate: Inflate) => Promise<unknown>>> = {
  ADCb: readAdventureCreateProfile, ADSb: readAdventureSharedData, ATXb: readAnimatedTexture, BEVb: readBevel,
  FSHb: readScript, GMTb: readMaterial, JNTb: readJointSettings, MSHb: readMesh, OUTb: readOutfitList,
  PALb: readPalette, PCKb: readPacks, PINb: readPins, PRFb: readSyncedProfile, QSTb: readQuest,
  SLTb: readSlotList, TUTb: readTutorials,
};

/** Dependency types whose payload form is a bare GUID. */
const BARE_GUIDS = new Set([10, 13, 40, 49]);
/** `ResourceType.SCRIPT`. */
const SCRIPT = 11;

/** A resource open for its dependencies to be rewritten. */
export interface EditableResource {
  readonly magic: string;
  readonly revision: RevisionInfo;
  /** The table as read, and as `replaceDependency` leaves it. */
  readonly dependencies: DependencyOut[];
  /** Every descriptor its reader read, and for a chunk its islands' too. */
  readonly marks: readonly MarkSegment[];
  readonly compressionFlags: number;
  /** A chunk's islands, rewritten with it. */
  readonly parts: readonly EditableResource[];
  /**
   * Rows of the table that nothing in the payload names, which a replacement
   * changes in the table alone -- `dependencyKey`s. Filled by `editResource`.
   */
  readonly unread: string[];
  /** Its raw runs, where a descriptor its reader did not read would lie. */
  readonly raws: readonly Uint8Array[];
  /** The resource written again. */
  write(deflate: Deflate): Promise<Uint8Array>;
  /** Called when a replacement touched it. */
  touched(): void;
}

const MAGIC_LENGTH = 4;
const magicOf = (bytes: Uint8Array): string => String.fromCharCode(...bytes.subarray(0, MAGIC_LENGTH));

const outOf = (rows: readonly Dependency[]): DependencyOut[] =>
  rows.map((d): DependencyOut => (d.kind === 'sha1' ? { hash: fromHex(d.sha1), type: d.type } : { guid: d.guid, type: d.type }));

/**
 * The marks that name a dependency: a descriptor (`resource`), a bare GUID
 * (`guid`), a chunk's bare SHA-1 in its level (`chunkHash`).
 */
const DEPENDENCY_MARKS = new Set(['resource', 'guid', 'chunkHash']);
const resourceMarks = (...tapes: Tape[]): MarkSegment[] =>
  tapes.flatMap((tape) => tape.marks.filter((mark) => DEPENDENCY_MARKS.has(mark.label)));

/** What a mark's descriptor names now: the reader's value, or the last replacement. */
const current = new WeakMap<MarkSegment, ResourceRef>();
const refOf = (mark: MarkSegment): ResourceRef => current.get(mark) ?? (mark.value as ResourceRef);
const keyOf = (ref: { guid?: number; hash?: Uint8Array }): string => dependencyKey({ guid: ref.guid || undefined, hash: ref.hash });

function plan(edit: EditablePlan, write: (deflate: Deflate) => Promise<Uint8Array>): EditableResource {
  return {
    magic: 'PLNb', revision: edit.revision, dependencies: edit.dependencies,
    marks: resourceMarks(edit.outer, edit.tape), parts: [], write, touched: () => { edit.edited = true; },
    unread: [], raws: [...edit.outer.raws, ...edit.tape.raws], compressionFlags: edit.compressionFlags,
  };
}

/**
 * Open a resource for its dependencies, or say why it cannot be: no reader
 * for its magic, a reader that did not read it on a tape, a reader that
 * failed, or a dependency its reader never read.
 */
export async function editResource(bytes: Uint8Array, inflate: Inflate): Promise<EditableResource | { readonly refused: string }> {
  const magic = magicOf(bytes);
  let edit: EditableResource;
  try {
    if (magic === 'LVLb') {
      const level = await editLevel(bytes, inflate);
      edit = {
        magic, revision: level.revision, dependencies: level.dependencies, marks: resourceMarks(level.tape),
        parts: [], write: (deflate) => writeLevel(level, deflate), touched: () => { level.edited = true; },
        unread: [], raws: level.tape.raws, compressionFlags: level.compressionFlags,
      };
    } else if (magic === 'PLNb') {
      const p = await editPlan(bytes, inflate);
      edit = plan(p, (deflate) => writePlan(p, deflate));
    } else if (magic === 'CHKb') {
      const chunk = await editChunk(bytes, inflate);
      const islands: EditableResource[] = [];
      for (let i = 0; i < chunk.islands.length; i += 1) {
        const island = await openIsland(chunk, i, inflate);
        islands.push(plan(island, (deflate) => writePlan(island, deflate)));
      }
      edit = {
        magic, revision: chunk.revision, dependencies: chunk.dependencies, marks: resourceMarks(chunk.tape),
        parts: islands, write: (deflate) => writeChunk(chunk, deflate), touched: () => {},
        unread: [], raws: chunk.tape.raws, compressionFlags: chunk.compressionFlags,
      };
    } else {
      const read = READERS[magic];
      if (!read) return { refused: `no reader for ${JSON.stringify(magic)}` };
      const opened = await readOnTape(bytes, (b) => read(b, inflate));
      if (!opened) return { refused: `the ${magic} reader opened no serializer on the file` };
      const { resource, tape } = opened;
      const dependencies = outOf(readDependencies(bytes));
      edit = {
        magic, revision: resource.revisionInfo, dependencies, marks: resourceMarks(tape), parts: [],
        touched: () => {}, unread: [], raws: tape.raws, compressionFlags: resource.compressionFlags,
        write: (deflate) => {
          const w = new Writer(resource.revisionInfo, resource.compressionFlags, tape.data.length + 0x1000);
          tape.write(w);
          return writeResource({
            magic, revision: resource.revisionInfo, compressionFlags: resource.compressionFlags,
            payload: w.done(), dependencies, isCompressed: resource.isCompressed,
          }, deflate);
        },
      };
    }
  } catch (error) {
    return { refused: (error as Error).message };
  }
  // ❗ **A row no mark holds is either unnamed or unread.** The game's tables list
  // dependencies the payload never names -- an animation of sackboy's in 40 of
  // its levels, whose GUID is nowhere in the bytes -- and those change in the
  // table alone. But a descriptor a reader stepped over would be left naming the
  // old one, so where the row's descriptor bytes lie in a run no reader cut out,
  // the resource is refused.
  const all = [edit, ...edit.parts];
  const read = new Set(all.flatMap((e) => e.marks.map((m) => keyOf(refOf(m)))));
  for (const row of edit.dependencies) {
    const key = dependencyKey(row);
    if (BARE_GUIDS.has(row.type) || read.has(key)) continue;
    const spelled = all.map((e) => spelling(row, e.revision, e.compressionFlags));
    if (all.some((e, i) => e.raws.some((raw) => contains(raw, spelled[i]!)))) {
      return { refused: `the ${magic} reader stepped over a descriptor of its dependency ${key}` };
    }
    edit.unread.push(key);
  }
  return edit;
}

/**
 * What a mark becomes when it names `ref`, or undefined where it cannot: a
 * bare GUID stays a GUID and a chunk's SHA-1 a SHA-1.
 */
function rewrite(mark: MarkSegment, ref: ResourceRef, revision: RevisionInfo): ((w: Writer) => void) | undefined {
  if (mark.label === 'resource') return descriptor(ref, revision);
  if (mark.label === 'guid') return ref.guid && !ref.hash ? (w) => w.guid(ref.guid) : undefined;
  return ref.hash && !ref.guid ? (w) => w.sha1(ref.hash!) : undefined;
}

/** A row's descriptor as a payload of this revision spells it. */
function spelling(row: DependencyOut, revision: RevisionInfo, compressionFlags: number): Uint8Array {
  const w = new Writer(revision, compressionFlags, 32);
  descriptor({ guid: row.guid ?? 0, hash: row.hash }, revision)(w);
  return w.done();
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let k = 0; k < needle.length; k += 1) if (haystack[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** A descriptor's flag, GUID and hash, as `Serializer.resource` reads them back. */
function descriptor(ref: ResourceRef, revision: RevisionInfo): (w: Writer) => void {
  const [GUID, HASH] = revision.version < 0x191 ? [1, 2] : [2, 1];
  return (w) => {
    w.u8((ref.guid ? GUID : 0) | (ref.hash ? HASH : 0));
    if (ref.guid) w.guid(ref.guid);
    if (ref.hash) w.sha1(ref.hash);
  };
}

/**
 * Make every descriptor naming `from` name `to`, and the table's row with it,
 * in the resource and its parts. Returns how many marks and rows changed.
 *
 * ⚠️ A bare GUID cannot become a hash: where one names `from` and `to` is a
 * hash, it stays, and so does the table's GUID row beside the new one.
 */
export function replaceDependency(
  edit: EditableResource,
  from: { readonly guid?: number; readonly hash?: Uint8Array },
  to: { readonly guid?: number; readonly hash?: Uint8Array },
): number {
  const old = keyOf(from);
  const next: ResourceRef = { guid: to.guid ?? 0, hash: to.hash };
  if (old === keyOf(next)) return 0;
  let changed = 0;
  for (const part of [edit, ...edit.parts]) {
    let here = 0;
    let stays = false;
    for (const mark of part.marks) {
      if (keyOf(refOf(mark)) !== old) continue;
      const write = rewrite(mark, next, part.revision);
      if (!write) {
        stays = true;
        continue;
      }
      current.set(mark, next);
      mark.write = write;
      here += 1;
    }
    const rows = part.dependencies;
    const at = rows.findIndex((row) => dependencyKey(row) === old);
    if (at >= 0 && (here > 0 || !stays)) {
      const row: DependencyOut = { ...(to.hash ? { hash: to.hash } : { guid: to.guid }), type: rows[at]!.type };
      const known = rows.some((r) => dependencyKey(r) === dependencyKey(row));
      if (stays) {
        if (!known) rows.splice(at + 1, 0, row);
      } else if (known) rows.splice(at, 1);
      else rows[at] = row;
      here += 1;
    }
    if (here > 0) part.touched();
    changed += here;
  }
  return changed;
}

/** One resource of a hashinated set. */
export interface Hashinated {
  readonly sha1: string;
  readonly bytes: Uint8Array;
  /** The GUID it was reached by, where a row named it by GUID. */
  readonly guid?: number;
  /** The type of the row that reached it; undefined for the root. */
  readonly type?: number;
  /** Why its own dependencies were left as they were, where they were. */
  readonly kept?: string;
}

export interface Hashination {
  /** Dependencies before what needs them; the root last. */
  readonly resources: readonly Hashinated[];
  /** Rows `resolve` had no bytes for, each once: these stay as they were. */
  readonly missing: readonly Dependency[];
}

const sha1Of = async (bytes: Uint8Array): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource)));
/** A binary resource's table, or none: an old head has no table, and its offset word is payload. */
function tableOf(bytes: Uint8Array): Dependency[] | undefined {
  if (bytes.length < 12 || bytes[3] !== 0x62) return undefined;
  try {
    return readDependencies(bytes);
  } catch {
    return undefined;
  }
}
const rowKey = (d: Dependency): string => (d.kind === 'guid' ? `g${d.guid}` : `h${d.sha1}`);

/**
 * `Resources.hashinate`: `root` and everything it reaches, each written with
 * its dependencies named by the SHA-1 of what they became. A resource that is
 * refused (`editResource`) is kept as it is and says why; a loop is cut where
 * it closes, the resource there keeping the reference it had.
 */
export async function hashinate(
  root: Uint8Array,
  resolve: (dependency: Dependency) => Promise<Uint8Array | undefined>,
  inflate: Inflate,
  deflate: Deflate,
): Promise<Hashination> {
  const resources: Hashinated[] = [];
  const missing = new Map<string, Dependency>();
  const done = new Map<string, string | undefined>();
  const open = new Set<string>();

  async function visit(bytes: Uint8Array, by?: Dependency): Promise<string> {
    let out = bytes;
    let kept: string | undefined;
    const table = tableOf(bytes);
    if (table) {
      const rows = table.filter((d) => d.type !== SCRIPT && !BARE_GUIDS.has(d.type));
      const edit = rows.length > 0 ? await editResource(bytes, inflate) : undefined;
      if (edit && 'refused' in edit) kept = edit.refused;
      for (const row of rows) {
        const key = rowKey(row);
        if (open.has(key)) continue;
        let sha1 = done.get(key);
        if (!done.has(key)) {
          const child = await resolve(row);
          if (!child) {
            missing.set(key, row);
            done.set(key, undefined);
            continue;
          }
          open.add(key);
          sha1 = await visit(child, row);
          open.delete(key);
          done.set(key, sha1);
        }
        if (sha1 === undefined || !edit || 'refused' in edit) continue;
        replaceDependency(edit, row.kind === 'guid' ? { guid: row.guid } : { hash: fromHex(row.sha1) }, { hash: fromHex(sha1) });
      }
      if (edit && !('refused' in edit) && rows.some((row) => {
        const sha1 = done.get(rowKey(row));
        return sha1 !== undefined && (row.kind === 'guid' || row.sha1 !== sha1);
      })) out = await edit.write(deflate);
    }
    const sha1 = await sha1Of(out);
    resources.push({
      sha1, bytes: out,
      ...(by?.kind === 'guid' ? { guid: by.guid } : {}),
      ...(by ? { type: by.type } : {}),
      ...(kept === undefined ? {} : { kept }),
    });
    return sha1;
  }

  if (!tableOf(root)) throw new SerializerError('the root is not a resource with a dependency table');
  await visit(root);
  return { resources, missing: [...missing.values()] };
}
