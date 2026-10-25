/**
 * The game's data, opened: a GUID or a SHA-1 in, a resource's bytes out --
 * cwlib's `ResourceSystem.extract` (`singleton/ResourceSystem.java`, ennuo/toolkit
 * `fee2239`) over one install.
 *
 * A GUID is its FileDB row, straight or through the remap; a row's SHA-1 is
 * looked for in the FARCs, and failing that the row's path is read loose from
 * the install, as `extractFromDisk` does. Nothing here touches a file system:
 * the FileDB and the remap come in as bytes, each FARC as a `RandomAccess`, and
 * the loose files through `loose` -- `platform/node.ts`'s `looseFiles` reads a
 * folder; a page hands over its own.
 *
 * Where this differs from Java (lbp-modding-toolchain.md, *Where we
 * deliberately differ*): the remap is followed when the FileDB misses, which
 * `ResourceSystem.get` does not do -- steering/level-files.md, *The GUID remap*.
 */

import { openFarc, type Farc, type RandomAccess } from './farc.ts';
import { readFileDB, readGuidRemap, type FileDBEntry, type GuidRemap } from './filedb.ts';
import type { Dependency } from '../io/resource.ts';

export interface GameSource {
  /** The FileDB's bytes: `output/orbisguids.map` on an LBP3 PS4 install. */
  readonly fileDB: Uint8Array;
  /**
   * `output/orbisguids.remap`'s bytes, when the install has one. ❗ Without it
   * most of the game's materials and textures do not resolve.
   */
  readonly remap?: Uint8Array;
  readonly farcs: readonly { readonly name: string; readonly access: RandomAccess }[];
  /** A FileDB path's bytes read loose from the install, or undefined where there is no such file. */
  readonly loose?: (path: string) => Promise<Uint8Array | undefined>;
}

export interface Game {
  readonly db: ReadonlyMap<number, FileDBEntry>;
  /** Old GUID to new; empty when the install gave no remap. */
  readonly remap: ReadonlyMap<number, GuidRemap>;
  readonly farcs: readonly { readonly name: string; readonly farc: Farc }[];
  /** A GUID's FileDB row, straight or through the remap. */
  row(guid: number): FileDBEntry | undefined;
  /** A SHA-1's bytes from the first FARC that holds it. */
  bySha1(sha1: string): Promise<Uint8Array | undefined>;
  /** A dependency's bytes, from a FARC or loose; undefined when the install holds neither. */
  resolve(dependency: Dependency): Promise<Uint8Array | undefined>;
}

const NO_BYTES = '0'.repeat(40);

export async function openGame(source: GameSource): Promise<Game> {
  const db = readFileDB(source.fileDB);
  const remap = source.remap === undefined ? new Map<number, GuidRemap>() : readGuidRemap(source.remap).remap;
  // The FileDB first, the remap when it misses: no old GUID is a FileDB row.
  const row = (guid: number): FileDBEntry | undefined => {
    const direct = db.get(guid);
    if (direct !== undefined) return direct;
    const moved = remap.get(guid);
    return moved && db.get(moved.guid);
  };
  const farcs = await Promise.all(
    source.farcs.map(async ({ name, access }) => ({ name, farc: await openFarc(access) })),
  );
  // ⚠️ A SHA-1 can sit in more than one FARC; the same SHA-1 is the same bytes,
  // so the first archive that has it answers.
  const bySha1 = async (sha1: string): Promise<Uint8Array | undefined> => {
    if (sha1 === NO_BYTES) return undefined;
    for (const { farc } of farcs) {
      if (farc.entries.has(sha1)) return farc.get(sha1);
    }
    return undefined;
  };
  return {
    db,
    remap,
    farcs,
    row,
    bySha1,
    async resolve(dependency) {
      if (dependency.kind === 'sha1') return bySha1(dependency.sha1);
      const found = row(dependency.guid);
      if (found === undefined) return undefined;
      return (await bySha1(found.sha1)) ?? source.loose?.(found.path);
    },
  };
}
