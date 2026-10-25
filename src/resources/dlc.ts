/**
 * `RDLC` as the game ships it: magic `DLCt`, text, FileDB paths
 * `gamedata/data/*.dlc` -- which GUIDs belong to which downloadable pack, and
 * the `.edat` each pack comes in. Read by `TextResource`; the fields are
 * cwlib's `RDLC`, `DLCGUID` and `DLCFile` (ennuo/toolkit `d6a2ef8`), whose
 * binary reading this is not. What the files prove is steering/level-files.md,
 * *Text resources*.
 *
 * ```
 * DLCt
 * GUIDS	<count>
 * 	[i]
 * 		GUID.guid	<guid>
 * 		Flags	<int>
 * Files	<count>
 * 	[i]
 * 		Directory	"<dir>"         File	"<name>.edat"
 * 		ContentID	"<id>"          InGameCommerceID	"<id>"
 * 		CategoryID	"<id>"          Flags	<int>
 * 		GUIDs	<count>, then each [j]	<guid>
 * 		NonPlanGuids	<count>, then each [j]	<guid>     the 01.28 update's files only
 * 		TypeMask	<int>
 * ```
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, vitaRevision, type RevisionInfo } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';
import { TextResource } from '../io/text-resource.ts';

export interface DlcGuid {
  readonly guid: number;
  readonly flags: number;
}

export interface DlcFile {
  readonly directory: string;
  readonly file: string;
  readonly contentId: string;
  readonly inGameCommerceId: string;
  readonly categoryId: string;
  readonly flags: number;
  /** The GUIDs the pack unlocks. */
  readonly guids: readonly number[];
  /**
   * cwlib's `nonPlanGuids`, which its binary reading gates on a revision: the
   * text form has none, so the line is read where it is. ✔ All 6 of the 01.28
   * update's `DLCt`s have it, none of the 01.00 install's (2026-10-25).
   */
  readonly nonPlanGuids?: readonly number[];
  readonly typeMask: number;
}

export interface Dlc {
  readonly guids: readonly DlcGuid[];
  readonly files: readonly DlcFile[];
}

/** Read a `DLCt`. Throws on anything else, and unless every line is read. */
export function readDlc(bytes: Uint8Array): Dlc {
  const t = new TextResource(bytes);
  if (t.magic !== 'DLCt') throw new SerializerError(`not a text DLC list: "${t.magic}"`);
  const guids = t.array(0, 'GUIDS', () => ({ guid: t.int(2, 'GUID.guid'), flags: t.int(2, 'Flags') }));
  const files = t.array(0, 'Files', () => ({
    directory: t.string(2, 'Directory'),
    file: t.string(2, 'File'),
    contentId: t.string(2, 'ContentID'),
    inGameCommerceId: t.string(2, 'InGameCommerceID'),
    categoryId: t.string(2, 'CategoryID'),
    flags: t.int(2, 'Flags'),
    guids: t.intArray(2, 'GUIDs'),
    ...(t.has(2, 'NonPlanGuids') ? { nonPlanGuids: t.intArray(2, 'NonPlanGuids') } : {}),
    typeMask: t.int(2, 'TypeMask'),
  }));
  t.end();
  return { guids, files };
}

/**
 * Read an `RDLC` in its binary form (`DLCb`, a resource container): cwlib's
 * `RDLC.serialize`, `DLCGUID` and `DLCFile` (ennuo/toolkit `d6a2ef8`) -- the
 * GUIDs with their flags, then the files: directory, file, content ID, commerce
 * ID, category ID (version `0x264` on), flags, `nonPlanGuids` (subVersion above
 * `0x20c`; before the GUIDs here, after them in the text form), the GUIDs, and
 * `typeMask` on the Vita's branch from its revision `0x85`. ⚠️ **Ported from Java
 * and proven on no file**: the game ships only the text form
 * (steering/java-parity.md).
 */
export async function readDlcBinary(bytes: Uint8Array, inflate: Inflate): Promise<Dlc> {
  const { revision, s } = await openSerializer(bytes, inflate);
  const guids = s.array((x) => ({ guid: x.guid(), flags: x.i32() }));
  const files = s.array((x): DlcFile => {
    const directory = x.str();
    const file = x.str();
    const contentId = x.str();
    const inGameCommerceId = x.str();
    const categoryId = revision.version >= 0x264 ? x.str() : '';
    const flags = x.i32();
    const nonPlanGuids = revision.subVersion > 0x20c ? x.intVector() : undefined;
    const fileGuids = x.intVector();
    const typeMask = vitaRevision(revision) >= 0x85 ? x.i32() : 0;
    return {
      directory, file, contentId, inGameCommerceId, categoryId, flags, guids: fileGuids, typeMask,
      ...(nonPlanGuids ? { nonPlanGuids } : {}),
    };
  });
  if (s.remaining !== 0) throw new SerializerError(`DLCb read ended ${s.remaining} bytes before the end of its payload`);
  return { guids, files };
}

/**
 * `readDlcBinary`'s mirror: a `DLCb` payload, byte for byte, from the value.
 * ⚠️ Proven by a round trip only: the game ships no `DLCb`.
 */
export function encodeDlcBinary(value: Dlc, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  const { revision } = header;
  w.i32(value.guids.length);
  for (const g of value.guids) {
    w.guid(g.guid);
    w.i32(g.flags);
  }
  w.i32(value.files.length);
  for (const f of value.files) {
    w.str(f.directory);
    w.str(f.file);
    w.str(f.contentId);
    w.str(f.inGameCommerceId);
    if (revision.version >= 0x264) w.str(f.categoryId);
    w.i32(f.flags);
    if (revision.subVersion > 0x20c) w.intVector(f.nonPlanGuids ?? []);
    w.intVector(f.guids);
    if (vitaRevision(revision) >= 0x85) w.i32(f.typeMask);
  }
  return w.done();
}
