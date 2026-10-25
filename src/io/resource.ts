/**
 * The LBP serialised-resource container (`LVLb`, `PLNb`, ...).
 *
 * Port of tools/lbpres.py, which is the reference implementation. Layout and
 * how it was verified are in steering/sequencer-data-model.md; the short
 * version is that on 18 real levels every chunk inflates to its declared size
 * and the end of chunk data lands exactly on the dependency-table offset.
 *
 * Inflation is injected rather than imported so this file stays free of Node
 * built-ins: the browser passes a DecompressionStream wrapper, Node passes
 * zlib.inflateSync. See src/platform/.
 */

import { ByteReader, Revision } from './stream.ts';
import { toHex } from './hex.ts';
import { Serializer, latin1, type RevisionInfo } from './serializer.ts';
import { Tape } from './tape.ts';

/** Inflate one zlib stream. May be sync or async; `rawSize` is the expected output length. */
export type Inflate = (
  deflated: Uint8Array,
  rawSize: number,
) => Uint8Array | Promise<Uint8Array>;

export interface ResourceChunk {
  readonly compressedSize: number;
  readonly rawSize: number;
}

export interface Resource {
  /** Four-character magic, e.g. "LVLb". */
  readonly magic: string;
  readonly revision: Revision;
  /** Branch id and revision, a separate pair from the head word's subVersion. */
  readonly branchId: number;
  readonly branchRevision: number;
  /**
   * The revision as every reader gates on it: `version` and `subVersion` from
   * the head word, the branch pair beside them.
   */
  readonly revisionInfo: RevisionInfo;
  /** See `COMPRESSED_INTEGERS` in serializer.ts -- this changes how to read everything. */
  readonly compressionFlags: number;
  readonly isCompressed: boolean;
  /** Offset of the dependency table, which is also the end of the chunk data. */
  readonly dependencyTableOffset: number;
  readonly chunks: readonly ResourceChunk[];
  /** All chunks inflated and concatenated. */
  readonly data: Uint8Array;
}

/** The shortest a resource's header can be; anything shorter is not a resource. */
export const HEADER_MIN = 0x16;

export class ResourceFormatError extends Error {}

/**
 * A file's first four bytes as text: `LVLb`, `GTF `, `DDS `. Shorter when the
 * file is; every reader here tells its formats apart by this, before inflating
 * anything.
 */
export function magicOf(bytes: Uint8Array): string {
  return latin1(bytes.subarray(0, 4));
}

/**
 * Parse a serialised resource and inflate its payload.
 *
 * Throws ResourceFormatError when the container does not hold together --
 * never returns a half-decoded result, because a silently truncated buffer is
 * the worst possible input to a deserialiser.
 */
export async function loadResource(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<Resource> {
  if (bytes.length < HEADER_MIN) {
    throw new ResourceFormatError(
      `too short to be a resource: ${bytes.length} bytes`,
    );
  }

  const reader = new ByteReader(bytes);
  const magic = magicOf(bytes);
  reader.position = 4;
  const revision = new Revision(reader.u32());
  // ❗ Below head 0x109 there is no dependency table, and so no offset to it:
  // the chunks run to the end of the file (cwlib's `SerializedResource`).
  const oldest = revision.raw < 0x109;
  const dependencyTableOffset = oldest ? bytes.length : reader.u32();

  // ⚠️ These three sit between the dependency-table offset and the chunk table,
  // and the reader used to jump straight past them. `compressionFlags` is not
  // optional detail: with its COMPRESSED_INTEGERS bit set, every 32- and 64-bit
  // integer in the payload is a LEB128 varint instead of four bytes, so a
  // deserialiser that does not know it reads the whole stream wrong.
  //
  // ❗ **Both are younger than the container.** The branch pair arrived at head
  // `0x271` and the flags at `0x297` (LEERDAMMER `0x272` has them from its own
  // revision 2): before that the compressed bool follows the dependency offset
  // directly. The game's own LBP1-era meshes are `0x239`, and a reader that
  // always read the pair took the chunk table from five bytes too far on, which
  // "fails to inflate". cwlib's `SerializedResource`, measured on the meshes in
  // LBP3 PS4's FARCs -- steering/level-files.md.
  const head = revision.raw;
  // ❗ **Below 0x189 there is no compressed flag either: the payload is always
  // compressed**, and the chunk table follows the dependency offset (or the
  // head, below 0x109). cwlib's `SerializedResource`; measured on the game's
  // 44 bevels at 0x132--0x188, which then end on their dependency table and
  // walk to their last byte (steering/level-files.md, *Bevels*).
  const modern = head >= 0x189;
  const branchId = modern && head >= 0x271 ? reader.u16() : 0;
  const branchRevision = modern && head >= 0x271 ? reader.u16() : 0;
  const hasFlags = modern && (head >= 0x297 || (head === 0x272 && branchId === 0x4c44 && branchRevision >= 2));
  const compressionFlags = hasFlags ? reader.u8() : 0;
  const isCompressed = modern ? reader.u8() !== 0 : true;
  const tableAt = reader.position;
  const revisionInfo: RevisionInfo = {
    version: revision.version, subVersion: revision.subVersion, branchId, branchRevision,
  };

  // ⚠️ **`isCompressed` is a real branch and was ignored here for months.** An
  // uncompressed resource has no chunk table at all: the payload starts right
  // after this byte and runs to the dependency table. Every level and plan in
  // the corpus is compressed, so reading the table unconditionally worked until
  // the first `CHKb` streaming chunk arrived -- and then it read a chunk count
  // out of the payload's first bytes ("96 chunks") and failed to inflate the
  // level geometry it found behind it.
  if (!isCompressed) {
    return {
      magic, revision, branchId, branchRevision, revisionInfo, compressionFlags, isCompressed,
      dependencyTableOffset, chunks: [],
      data: bytes.subarray(tableAt, dependencyTableOffset),
    };
  }

  // ❗ **Name the revision.** A chunk that will not inflate is almost never a
  // broken file: it is a header this reader laid out wrongly, and the usual
  // reason is a revision older than the range it implements. Four LBP1 levels
  // out of the public archive (0x23d, 0x26e) said only "chunk 0/26 failed to
  // inflate", which sends you looking at zlib.
  const { chunks, data, end } = await inflateChunkTable(bytes, tableAt, inflate, {
    storedEnd: dependencyTableOffset,
    inflateHint: `revision 0x${revision.version.toString(16)} sub 0x${revision.subVersion.toString(16)}` +
      ', whose header layout may not be the one this reader implements',
  });

  // The header never tells the parser where chunk data ends -- it works that
  // out by summing the table. Landing exactly on the dependency table is
  // therefore an independent check that the whole header was read correctly.
  if (end !== dependencyTableOffset) {
    throw new ResourceFormatError(
      `chunk data ends at 0x${end.toString(16)} but the dependency ` +
        `table is at 0x${dependencyTableOffset.toString(16)}`,
    );
  }

  return {
    magic, revision, branchId, branchRevision, revisionInfo, compressionFlags, isCompressed,
    dependencyTableOffset, chunks, data,
  };
}

/**
 * A chunk table at `at` and the chunks behind it, inflated into one buffer.
 *
 * The table is a `u16` that is always `0x0001`, a `u16` count, then a
 * `(u16 compressed, u16 raw)` pair per chunk; the chunks follow it, each a
 * zlib stream. A resource's payload is one, and so are a static mesh's after
 * its `StaticMeshInfo` and a texture's after its `GTF `/`TEX ` header -- which
 * is why this is the one reader of it. Where the chunks have to end is the
 * caller's check: `end` is the byte after the last one.
 *
 * ❗ **A table of zero chunks means the payload is stored as it is**, from the
 * table's end to `storedEnd` -- the dependency table in a resource, the file's
 * end in a texture (cwlib's `Compressor.decompressData`). 71 of the game's
 * 178 `PALb` palettes and 51 of its 59 `OUTb` outfit lists are written so, a
 * few dozen bytes each that would not shrink (steering/level-files.md, *The
 * container*). The payload is then a copy, so it is never a view of `bytes`.
 *
 * `error` makes the exception, so each format throws its own class.
 */
export async function inflateChunkTable(
  bytes: Uint8Array,
  at: number,
  inflate: Inflate,
  options: {
    readonly error?: new (message: string, options?: ErrorOptions) => Error;
    /** Appended to "failed to inflate", for the caller to say what it suspects. */
    readonly inflateHint?: string;
    /** Where a payload stored with no chunks ends; the file's end when not given. */
    readonly storedEnd?: number;
  } = {},
): Promise<{ chunks: ResourceChunk[]; data: Uint8Array; end: number }> {
  const Fail = options.error ?? ResourceFormatError;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (at + 4 > bytes.length) throw new Fail('no chunk table: the file ends first');
  const count = view.getUint16(at + 2, false);
  if (count === 0) {
    const end = options.storedEnd ?? bytes.length;
    if (end < at + 4 || end > bytes.length) throw new Fail(`a stored payload from ${at + 4} to ${end} is outside the file`);
    return { chunks: [], data: bytes.slice(at + 4, end), end };
  }
  if (at + 4 + count * 4 > bytes.length) throw new Fail(`a table of ${count} chunks runs past the end of the file`);

  const chunks: ResourceChunk[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const compressedSize = view.getUint16(at + 4 + i * 4, false);
    const rawSize = view.getUint16(at + 6 + i * 4, false);
    chunks.push({ compressedSize, rawSize });
    total += rawSize;
  }

  const data = new Uint8Array(total);
  let written = 0;
  let p = at + 4 + count * 4;
  for (let i = 0; i < count; i += 1) {
    const { compressedSize, rawSize } = chunks[i];
    if (p + compressedSize > bytes.length) throw new Fail(`chunk ${i}/${count} runs past the end of the file`);
    const deflated = bytes.subarray(p, p + compressedSize);
    p += compressedSize;
    // ⚠️ **A chunk that would not shrink is stored as it is**, both sizes
    // equal and no zlib header. cwlib's `Compressor.decompressData`; 8 chunks
    // of the game's meshes are stored so, one of them the fourth of
    // `spawn_point_start_chrome.mol`, which otherwise "fails to inflate".
    if (compressedSize === rawSize) {
      data.set(deflated, written);
      written += rawSize;
      continue;
    }
    let inflated: Uint8Array;
    try {
      inflated = await inflate(deflated, rawSize);
    } catch (cause) {
      const hint = options.inflateHint ? ` — ${options.inflateHint}` : '';
      throw new Fail(`chunk ${i}/${count} failed to inflate${hint}`, { cause });
    }
    if (inflated.length !== rawSize) {
      throw new Fail(`chunk ${i}/${count} inflated to ${inflated.length}, header says ${rawSize}`);
    }
    data.set(inflated, written);
    written += rawSize;
  }
  return { chunks, data, end: p };
}

/**
 * Inflate a resource and start a `Serializer` on its payload, with the
 * revision and compression flags the payload is read under. What every
 * resource reader here begins with; each checks its own magic and range.
 */
export async function openSerializer(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<{ resource: Resource; revision: RevisionInfo; s: Serializer }> {
  const resource = await loadResource(bytes, inflate);
  const revision = resource.revisionInfo;
  const s = new Serializer(resource.data, revision, resource.compressionFlags);
  if (tapeRequests.has(bytes)) {
    tapeRequests.delete(bytes);
    s.tape = new Tape(resource.data);
    openedOnTape.set(bytes, { resource, s });
  }
  return { resource, revision, s };
}

/**
 * Files whose next `openSerializer` puts its serializer on a tape, by the
 * very array: what lets any reader run on a tape with no parameter of its own
 * (`readOnTape`). Keyed by object, so two reads at once do not meet.
 */
const tapeRequests = new WeakSet<Uint8Array>();
const openedOnTape = new WeakMap<Uint8Array, { resource: Resource; s: Serializer }>();

/**
 * Run `read` with the serializer it opens on `bytes` put on a tape. The
 * result names the tape and the container, or is undefined when the reader
 * opened no serializer on these bytes (one that slices them, or reads its own
 * header). The tape is finished at the payload's end: what the reader did not
 * read is one raw run.
 */
export async function readOnTape(
  bytes: Uint8Array,
  read: (bytes: Uint8Array) => Promise<unknown>,
): Promise<{ resource: Resource; tape: Tape; position: number } | undefined> {
  tapeRequests.add(bytes);
  try {
    await read(bytes);
  } finally {
    tapeRequests.delete(bytes);
  }
  const opened = openedOnTape.get(bytes);
  openedOnTape.delete(bytes);
  if (!opened?.s.tape) return undefined;
  const { resource, s } = opened;
  const position = s.position;
  s.tape!.finish(s.data.length);
  return { resource, tape: s.tape!, position };
}

/**
 * One entry of a resource's dependency table.
 *
 * ❗ **A SHA-1 dependency is a USER resource and a GUID one is a GAME asset.**
 * That distinction is the whole usefulness of this table to us: the hashed ones
 * are in the public archive under the same URL as the level itself, and the
 * GUIDs are in the game's own FileDB and are not in the archive at all. Measured
 * on "Music Gallery #3": 160 dependencies, **20 hashed and 140 GUIDs**.
 */
export type Dependency =
  | { readonly kind: 'sha1'; readonly sha1: string; readonly type: number }
  | { readonly kind: 'guid'; readonly guid: number; readonly type: number };

/**
 * Dependency types, as far as they have been **measured** rather than read off
 * somebody's enum: every one was checked against the magic of the resource
 * actually downloaded for it, over levels from both PS3 and PS4.
 *
 * | type | magic | what it is | checked |
 * |---|---|---|---|
 * | 1 | `TEX ` | a texture | 3 |
 * | 9 | `LVLb` | a level **inside an adventure** | 10 |
 * | 38 | `PLNb` | a plan: a Thing saved in the popit | 17 |
 * | 61 | `CHKb` | a **streaming chunk** | 22 |
 * | 62 | `ADSb` | an adventure's shared data, 35-270 bytes | 2 |
 *
 * ❗ **Type 9 is why an adventure opens at all.** An `ADCb` has no world of its
 * own: `readBackup` cannot open one, and its levels are hashed dependencies of
 * this type. Following them turns "nothing happened" into the adventure.
 */
export const DEPENDENCY_TEXTURE = 1;
export const DEPENDENCY_LEVEL = 9;
export const DEPENDENCY_PLAN = 38;
export const DEPENDENCY_CHUNK = 61;
export const DEPENDENCY_ADVENTURE_SHARED = 62;

/**
 * The dependency types worth fetching: exactly what `readBackup` can open.
 *
 * ⚠️ **Anything else is somebody else's bandwidth for no song.** A level's table
 * names its textures, meshes and materials too, and `looksLikeLevel` throws all
 * of them away on the first four bytes.
 */
export const OPENABLE_DEPENDENCIES: readonly number[] = [
  DEPENDENCY_LEVEL, DEPENDENCY_PLAN, DEPENDENCY_CHUNK,
];

/**
 * The table at the end of a resource, which `loadResource` only points at.
 *
 * The layout is `u32 count` and then, per entry, `u8 kind` -- 1 for a 20-byte
 * SHA-1, 2 for a `u32` GUID -- followed by a `u32` resource type. It is **not**
 * inside the compressed payload: it sits after it, in the file, which is why
 * this takes the raw bytes rather than a `Resource`.
 *
 * ✔ The reading is self-checking: on a real level the table ended at exactly the
 * last byte of the file (0x52d02 of 0x52d02), which nothing but a correct walk
 * of 160 variable-length entries can do.
 */
export function readDependencies(bytes: Uint8Array): Dependency[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = view.getUint32(8);
  if (at < HEADER_MIN || at + 4 > bytes.length) {
    throw new ResourceFormatError(`dependency table offset 0x${at.toString(16)} is outside the file`);
  }
  const count = view.getUint32(at);
  at += 4;
  const out: Dependency[] = [];
  for (let i = 0; i < count; i += 1) {
    // ⚠️ **The length check has to know the kind**, because the two entries are
    // 25 and 9 bytes. Checking a fixed nine and then reading twenty was the
    // first attempt: `subarray` shortens silently at the end of a buffer, so a
    // truncated table produced a HASH THAT WAS SHORT rather than an error --
    // and a short hash is a URL that 404s for a reason nobody could see. The
    // test truncates a real table by eight bytes to keep this honest.
    if (at + 1 > bytes.length) {
      throw new ResourceFormatError(`dependency ${i} of ${count} runs past the end of the file`);
    }
    const kind = view.getUint8(at);
    at += 1;
    const needs = kind === 1 ? 24 : kind === 2 ? 8 : 0;
    if (needs === 0) {
      throw new ResourceFormatError(`dependency ${i} has kind ${kind}, which is neither hash nor GUID`);
    }
    if (at + needs > bytes.length) {
      throw new ResourceFormatError(`dependency ${i} of ${count} runs past the end of the file`);
    }
    if (kind === 1) {
      const sha1 = toHex(bytes.subarray(at, at + 20));
      at += 20;
      out.push({ kind: 'sha1', sha1, type: view.getUint32(at) });
    } else {
      const guid = view.getUint32(at);
      at += 4;
      out.push({ kind: 'guid', guid, type: view.getUint32(at) });
    }
    at += 4;
  }
  return out;
}
