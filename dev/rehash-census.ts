/**
 * Every resource of the game's FARCs that has a dependency table, through
 * `editResource` (`src/archives/hashinate.ts`):
 *
 *   node dev/rehash-census.ts [MAGIC,MAGIC]     LBP_GAME required
 *
 * Per magic: how many open on a tape, how many are refused and why, whether
 * each written back with no change is its own bytes (whole when stored, else
 * the inflated payload and the table), and whether one with its first
 * descriptor-only GUID dependency replaced by a made-up SHA-1 reads back naming the
 * new one, in its table and through its reader, and the old one nowhere -- the
 * numbers in steering/level-files.md, *Dependencies rewritten*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { editResource, replaceDependency } from '../src/archives/hashinate.ts';
import { loadResource, magicOf, readDependencies } from '../src/io/resource.ts';
import { dependencyKey } from '../src/io/writer.ts';
import { nodeDeflate, nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { FARCS, GAME } from './game.ts';

const only = process.argv[2]?.split(',');
const counts = new Map<string, number>();
const examples = new Map<string, string>();
const bump = (key: string, example?: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (example && !examples.has(key)) examples.set(key, example);
};
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const table = (b: Uint8Array): Uint8Array => b.subarray(new DataView(b.buffer, b.byteOffset).getUint32(8, false));
const BARE = new Set([10, 13, 40, 49]);

const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 0x16) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 4));
      if (magic[3] !== 'b' || (only && !only.includes(magic))) continue;
      const bytes = (await farc.get(entry.sha1))!;
      let rows;
      try {
        rows = readDependencies(bytes);
      } catch {
        bump(`${magic} with no dependency table to read`);
        continue;
      }
      if (rows.length === 0) continue;
      const edit = await editResource(bytes, nodeInflate);
      if ('refused' in edit) {
        bump(`${magic} refused: ${edit.refused.replace(/[0-9a-f]{40}|\d+/g, 'N').slice(0, 80)}`, entry.sha1);
        continue;
      }
      bump(`${magic} opened`);
      const written = await edit.write(nodeDeflate);
      // A static mesh's header is not the container `loadResource` reads: it is compared whole.
      const original = magic === 'SMHb' ? undefined : await loadResource(bytes, nodeInflate);
      const identical = original?.isCompressed
        ? same(original.data, (await loadResource(written, nodeInflate)).data) && same(table(bytes), table(written))
        : same(bytes, written);
      bump(`${magic} ${identical ? 'written back identical' : 'written back DIFFERENT'}`, entry.sha1);

      // A GUID some descriptor holds and no bare GUID does: one that can become a hash everywhere.
      const ownMarks = [edit, ...edit.parts].flatMap((e) => e.marks);
      const named = (label: string, guid: number): boolean =>
        ownMarks.some((m) => m.label === label && (m.value as { guid?: number }).guid === guid);
      const row = rows.find((r) => !BARE.has(r.type) && r.kind === 'guid' && named('resource', r.guid) && !named('guid', r.guid));
      if (!row || row.kind !== 'guid') continue;
      const hash = new Uint8Array(20).fill(0xab);
      hash[0] = row.guid & 0xff;
      replaceDependency(edit, { guid: row.guid }, { hash });
      const changed = await edit.write(nodeDeflate);
      const keys = new Set(readDependencies(changed).map((d) => (d.kind === 'guid' ? `g${d.guid}` : `h${d.sha1}`)));
      const again = await editResource(changed, nodeInflate);
      const marks = 'refused' in again ? new Set<string>()
        : new Set([again, ...again.parts].flatMap((e) => e.marks.map((m) => dependencyKey(m.value as { guid?: number; hash?: Uint8Array }))));
      const newKey = dependencyKey({ hash });
      const ok = !('refused' in again) && keys.has(newKey) && !keys.has(`g${row.guid}`) && marks.has(newKey) && !marks.has(`g${row.guid}`);
      bump(`${magic} ${ok ? 'GUID replaced, reads back' : 'GUID replacement FAILED'}`, entry.sha1);
    }
  } finally {
    await access.close();
  }
}
for (const [key, n] of [...counts].sort()) console.log(`${String(n).padStart(7)}  ${key}${examples.has(key) && /FAIL|DIFF|refused/.test(key) ? `  (e.g. ${examples.get(key)})` : ''}`);
