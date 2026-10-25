/**
 * Everything a resource needs, gathered: cwlib's `Resources.collect`
 * (`util/Resources.java`, ennuo/toolkit `d6a2ef8`), which a mod is built from.
 *
 * Each resource with a binary header carries a dependency table
 * (`readDependencies`); each row is fetched through `resolve` -- injected, as
 * the FARCs and the FileDB are the caller's (`openGame`'s `resolve` in
 * `game.ts` joins them) -- and walked in turn, dependencies before what needs them, the root last.
 *
 * Where this differs from Java (lbp-modding-toolchain.md, *Where we
 * deliberately differ*):
 * - **A resource is gathered once.** Java walks every table afresh and adds a
 *   texture once per material that names it; here a row already seen, by GUID
 *   or by SHA-1, is not fetched again, and the same bytes are not added twice.
 * - **Scripts are walked too.** Java skips every `SCRIPT` row because a script
 *   may name itself and loop; the walk here cannot loop, so nothing is skipped.
 */

import { toHex } from '../io/hex.ts';
import { readDependencies, type Dependency } from '../io/resource.ts';

/** One resource the walk reached. */
export interface Gathered {
  /** Lower-case hex of `bytes`. */
  readonly sha1: string;
  /** The GUID it was reached by, when a row named it by GUID. */
  readonly guid?: number;
  /** The dependency type of the row that reached it; undefined for the root. */
  readonly type?: number;
  readonly bytes: Uint8Array;
}

export interface Gathering {
  /** Dependencies before what needs them; the root last. */
  readonly gathered: readonly Gathered[];
  /** Rows `resolve` had no bytes for, each once. */
  readonly missing: readonly Dependency[];
}

/** Whether a resource opens with a binary header, and so carries a dependency table. */
function hasDependencyTable(bytes: Uint8Array): boolean {
  // `b` binary, `e` encrypted binary: the two `getDependencyTable` reads.
  return bytes.length >= 12 && (bytes[3] === 0x62 || bytes[3] === 0x65);
}

const rowKey = (d: Dependency): string => (d.kind === 'guid' ? `g${d.guid}` : `h${d.sha1}`);

/** Gather `root` and everything it needs, transitively. */
export async function gatherDependencies(
  root: Uint8Array,
  resolve: (dependency: Dependency) => Promise<Uint8Array | undefined>,
): Promise<Gathering> {
  const gathered: Gathered[] = [];
  const missing: Dependency[] = [];
  const seenRows = new Set<string>();
  const seenBytes = new Set<string>();

  const walk = async (bytes: Uint8Array, via?: Dependency): Promise<void> => {
    const sha1 = toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource)));
    if (seenBytes.has(sha1)) return;
    seenBytes.add(sha1);
    if (hasDependencyTable(bytes)) {
      for (const dependency of readDependencies(bytes)) {
        const key = rowKey(dependency);
        if (seenRows.has(key)) continue;
        seenRows.add(key);
        const found = await resolve(dependency);
        if (found === undefined) missing.push(dependency);
        else await walk(found, dependency);
      }
    }
    gathered.push({
      sha1,
      ...(via?.kind === 'guid' ? { guid: via.guid } : {}),
      ...(via ? { type: via.type } : {}),
      bytes,
    });
  };

  await walk(root);
  return { gathered, missing };
}
