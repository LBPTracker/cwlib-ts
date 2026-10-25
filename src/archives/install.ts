/**
 * Resources added to an install: what cwlib's `ResourceSystem` does when it
 * saves (ennuo/toolkit `d6a2ef8`) -- `FileArchive.save` appending to a FARC,
 * `FileDB`'s rows added, patched and removed and the database built again --
 * without the GUI state around it. Nothing here touches a file: each function
 * returns the bytes to write and where, and the caller writes them.
 *
 * ❗ **A FARC is appended to, not rebuilt.** `chunk1_001.farc` is 3.3 GB, and
 * cwlib's save writes the new resources where the table was and a new table
 * after them; `appendToFarc` returns that tail and its offset. The rows go out
 * sorted by SHA-1, as the game's own tables are (`writeFarcTable`), where cwlib
 * appends them unsorted -- row 55 of *Where we deliberately differ*.
 */

import { toHex } from '../io/hex.ts';
import { writeFarcTable, type Farc, type FarcEntry } from './farc.ts';
import { writeFileDB, type FileDBEntry } from './filedb.ts';
import { MIN_SAFE_GUID } from './mod.ts';

const sha1Of = async (bytes: Uint8Array): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource)));

/** What `appendToFarc` makes: the bytes to write at `offset`, the file's end after them. */
export interface FarcAppend {
  /** Where the old table began, and the tail is written. */
  readonly offset: number;
  /** The new resources back to back, then the whole table and the footer. */
  readonly tail: Uint8Array;
  /** The rows added, in the order their bytes lie. */
  readonly added: readonly FarcEntry[];
}

/**
 * `FileArchive.save`: `resources` after the archive's last resource, then a
 * table of the old rows and the new. A resource the archive already holds, or
 * that comes twice, is added once (cwlib's `Fart.add`). The file is then its
 * first `offset` bytes and `tail`, and nothing after.
 */
export async function appendToFarc(farc: Farc, resources: readonly Uint8Array[]): Promise<FarcAppend> {
  const added: FarcEntry[] = [];
  const parts: Uint8Array[] = [];
  let offset = farc.tableOffset;
  for (const bytes of resources) {
    const sha1 = await sha1Of(bytes);
    if (farc.entries.has(sha1) || added.some((row) => row.sha1 === sha1)) continue;
    added.push({ sha1, offset, size: bytes.length });
    parts.push(bytes);
    offset += bytes.length;
  }
  const table = writeFarcTable([...farc.entries.values(), ...added]);
  const tail = new Uint8Array(offset - farc.tableOffset + table.length);
  let at = 0;
  for (const part of parts) {
    tail.set(part, at);
    at += part.length;
  }
  tail.set(table, at);
  return { offset: farc.tableOffset, tail, added };
}

/** A FileDB being edited: its rows by GUID, as `readFileDB` returns them, and its head word. */
export interface FileDBEdit {
  readonly revision: number;
  readonly rows: Map<number, FileDBEntry>;
}

/** `FileDB.getNextGUID`: the first GUID from `MIN_SAFE_GUID` that no row has. */
export function nextGuid(db: FileDBEdit): number {
  let guid = MIN_SAFE_GUID;
  while (db.rows.has(guid)) guid += 1;
  return guid;
}

/**
 * `FileDB.newFileDBRow` with the row's details set from `bytes`: a new row at
 * `path`, under `guid` or the next free one, dated `when`. A GUID already in the
 * database is refused, as cwlib refuses it.
 */
export async function addFileDBRow(
  db: FileDBEdit,
  path: string,
  bytes: Uint8Array,
  { guid = nextGuid(db), when = new Date() }: { guid?: number; when?: Date } = {},
): Promise<FileDBEntry> {
  if (db.rows.has(guid)) throw new Error(`GUID ${guid} already exists in the database`);
  const row: FileDBEntry = { path, guid, date: Math.floor(when.getTime() / 1000), size: bytes.length, sha1: await sha1Of(bytes) };
  db.rows.set(guid, row);
  return row;
}

/** `FileDB.patch`: every row of `patch` replaces the row of its GUID, or is added. */
export function patchFileDB(db: FileDBEdit, patch: Iterable<FileDBEntry>): void {
  for (const row of patch) db.rows.set(row.guid, row);
}

/** `FileDB.remove`: the row of `guid` gone. */
export function removeFileDBRow(db: FileDBEdit, guid: number): boolean {
  return db.rows.delete(guid);
}

/** `FileDB.build`: the database with its rows in ascending GUID order. */
export function buildFileDB(db: FileDBEdit): Uint8Array {
  return writeFileDB({ revision: db.revision, rows: [...db.rows.values()].sort((l, r) => (l.guid >>> 0) - (r.guid >>> 0)) });
}

/** `FileDB.toRLST`: every `.plan` path, one a line, in the rows' order. */
export function planList(db: FileDBEdit): string {
  let out = '';
  for (const row of db.rows.values()) if (row.path.endsWith('.plan')) out += `${row.path}\n`;
  return out;
}

/**
 * Resources put into an install, as cwlib's `ResourceSystem.add` does with a
 * database and a FARC selected: each item's bytes appended to `farc`, a row
 * for it in the database -- its own GUID where it brings one -- and the
 * database built again. Returns the FileDB to write whole and the FARC's tail.
 */
export async function installResources(
  db: FileDBEdit,
  farc: Farc,
  items: readonly { readonly path: string; readonly bytes: Uint8Array; readonly guid?: number }[],
  when = new Date(),
): Promise<{ fileDB: Uint8Array; farc: FarcAppend; rows: FileDBEntry[] }> {
  const rows: FileDBEntry[] = [];
  for (const item of items) {
    if (item.guid !== undefined && db.rows.has(item.guid)) {
      const sha1 = await sha1Of(item.bytes);
      const row = { ...db.rows.get(item.guid)!, path: item.path, size: item.bytes.length, sha1, date: Math.floor(when.getTime() / 1000) };
      patchFileDB(db, [row]);
      rows.push(row);
    } else rows.push(await addFileDBRow(db, item.path, item.bytes, { ...(item.guid === undefined ? {} : { guid: item.guid }), when }));
  }
  return { fileDB: buildFileDB(db), farc: await appendToFarc(farc, items.map((item) => item.bytes)), rows };
}
