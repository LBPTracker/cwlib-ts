/**
 * The Craftworld Toolkit **`.mod`** -- a zip of resources with a FileDB to name them.
 *
 * Transcribed from cwlib's `types/mods/Mod.java` (`process` and `save`), which is
 * the format's only definition: a `.mod` is the toolkit's own container and the
 * game never sees one -- the toolkit installs its contents into a FileDB and a
 * FARC. Inside the zip:
 *
 * | entry | what |
 * |---|---|
 * | `config.json` | `ModInfo`: ID, type, title, version, author, description |
 * | `data.map` | a FileDB, read by `readFileDB` in `filedb.ts`: path, date, size, SHA-1, GUID per row |
 * | `data.farc` | a `FAR4` save archive **in the clear**, the rows' bytes by SHA-1 |
 * | `icon.png` | optional; its bytes, kept as they are |
 * | `patches.json` | optional; `ModPatch[]` by Gson, of which cwlib has one kind, `TranslationPatch` |
 *
 * ⚠️ **`data.farc` ends in the same `FAR4` magic a PS3 save does and is NOT
 * encrypted.** `backup.ts` finds a save by that magic and XXTEA-decrypts it, so
 * a mod handed to `readBackup` as a pile would fail every SHA-1. `readBackupZip`
 * asks `looksLikeMod` first.
 *
 * ⚠️ Only the zip format is read here. The legacy single-file `MODb`/`MODe`
 * that `Mod.fromLegacyMod` still opens is `readLegacyMod` in `legacy-mod.ts`,
 * ported from Java and proven on no file.
 */

import { toHex } from '../io/hex.ts';
import { lamsKeyId, type TranslationTable } from '../resources/translation.ts';
import { readFileDB, writeFileDB } from './filedb.ts';
import { readFar, writeFar } from './savearchive.ts';
import { writeZip, type ZipFile } from './zip.ts';

/** cwlib's `ModInfo`, with its defaults. */
export interface ModInfo {
  readonly ID: string;
  readonly type: string;
  readonly title: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
}

export const DEFAULT_MOD_INFO: ModInfo = {
  ID: 'sample',
  type: 'pack',
  title: 'Untitled Mod',
  version: '1.0',
  author: 'Sackthing',
  description: 'No description was provided.',
};

/**
 * cwlib's `TranslationPatch`, as Gson writes it into `patches.json`
 * (`io/gson/PatchSerializer.java`): text by tag, for the languages named.
 *
 * ⚠️ **Nothing in the toolkit applies one.** cwlib reads, keeps and writes it
 * (`Mod.java`; `fromLegacyMod` makes one of a legacy mod's LAMS rows) and no
 * class at `d6a2ef8` reads it back; `translationPatchTable` and
 * `patchTranslationTable` in `translation.ts` are how this library would.
 */
export interface TranslationPatch {
  readonly type: 'TRANSLATION';
  readonly name?: string;
  /** Language names; `fromLegacyMod` writes `*` for every language. */
  readonly languages: readonly string[];
  readonly keys: readonly { readonly tag: string; readonly string: string }[];
}

/** A patch's text by LAMS key, to hand `patchTranslationTable`. */
export function translationPatchTable(patch: TranslationPatch): TranslationTable {
  return new Map(patch.keys.map(({ tag, string }) => [lamsKeyId(tag), string]));
}

/**
 * `patches.json`: what `PatchSerializer` reads. Its `type` is matched without
 * case, and a patch of any other type is dropped, as Java's `null` is.
 */
function readPatches(bytes: Uint8Array): TranslationPatch[] {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!Array.isArray(json)) throw new Error('patches.json is not an array');
  return json.flatMap((patch: Record<string, unknown> | null) => {
    if (typeof patch?.type !== 'string' || patch.type.toLowerCase() !== 'translation') return [];
    return [{
      type: 'TRANSLATION' as const,
      ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      languages: Array.isArray(patch.languages) ? patch.languages.map(String) : [],
      keys: Array.isArray(patch.keys)
        ? patch.keys.map((k: { tag?: unknown; string?: unknown }) => ({ tag: String(k.tag ?? ''), string: String(k.string ?? '') }))
        : [],
    }];
  });
}

/** One row of `data.map` with the bytes it names. */
export interface ModEntry {
  readonly path: string;
  readonly guid: number;
  readonly bytes: Uint8Array;
}

/** `Mod()`'s database revision: an LBP3 FileDB, which is what picks the row layout. */
const MOD_DB_REVISION = 0x01480100;

/** `FileDB.MIN_SAFE_GUID`: "not used by any of the LittleBigPlanet games". */
export const MIN_SAFE_GUID = 0x00180000;

/** `Branch.MIZUKI` -- the toolkit's own branch, which `Mod()` stamps on its archive. */
const MIZUKI = { head: 0x021803f9, branchId: 0x4d5a, branchRevision: 0xc } as const;

const leaf = (files: readonly ZipFile[], name: string): ZipFile | undefined =>
  files.find((f) => f.name === name);

/** Whether an unpacked zip is a mod: it says what it is and what it holds. */
export function looksLikeMod(files: readonly ZipFile[]): boolean {
  return leaf(files, 'config.json') !== undefined && leaf(files, 'data.map') !== undefined;
}

/**
 * Read an unpacked `.mod`.
 *
 * A row's bytes come from `data.farc` by SHA-1, or failing that from a loose
 * file at the row's own path, as `Mod.process` does. A row with neither is
 * dropped: the FileDB of a mod may name things it does not carry.
 */
export async function readMod(
  files: readonly ZipFile[],
): Promise<{ config: ModInfo; entries: ModEntry[]; patches: TranslationPatch[]; icon?: Uint8Array }> {
  const configFile = leaf(files, 'config.json');
  const map = leaf(files, 'data.map');
  if (!configFile) throw new Error('mod is missing config.json');
  if (!map) throw new Error('mod has no contents: data.map is missing');
  const config: ModInfo = {
    ...DEFAULT_MOD_INFO,
    ...(JSON.parse(new TextDecoder().decode(configFile.bytes)) as Partial<ModInfo>),
  };

  const farc = leaf(files, 'data.farc');
  const bySha1 = new Map<string, Uint8Array>();
  if (farc) for (const r of await readFar(farc.bytes)) bySha1.set(r.sha1, r.bytes);

  const entries: ModEntry[] = [];
  for (const { path, guid, sha1 } of readFileDB(map.bytes).values()) {
    const bytes = bySha1.get(sha1) ?? leaf(files, path)?.bytes;
    if (bytes) entries.push({ path, guid, bytes });
  }
  const patches = leaf(files, 'patches.json');
  const icon = leaf(files, 'icon.png')?.bytes;
  return { config, entries, patches: patches ? readPatches(patches.bytes) : [], ...(icon ? { icon } : {}) };
}

/**
 * Write a `.mod`: `Mod.save`. The icon goes in as the PNG it is given --
 * Java re-encodes its `ImageIcon` -- and `patches.json` only when there are
 * patches, as `save` writes it.
 *
 * An entry with no GUID takes the next free one from `MIN_SAFE_GUID`, which is
 * `FileDB.getNextGUID`. Rows go out in ascending GUID order, as `FileDB.build`
 * sorts them. The zip is stored; Java's zip filesystem reads either.
 */
export async function writeMod(
  info: Partial<ModInfo>,
  items: readonly { path: string; bytes: Uint8Array; guid?: number }[],
  when = new Date(),
  { patches = [], icon }: { patches?: readonly TranslationPatch[]; icon?: Uint8Array } = {},
): Promise<Uint8Array> {
  const used = new Set(items.flatMap((i) => (i.guid === undefined ? [] : [i.guid])));
  if (used.size !== items.filter((i) => i.guid !== undefined).length) {
    throw new Error('two mod entries share a GUID');
  }
  let next = MIN_SAFE_GUID;
  const rows = [];
  for (const item of items) {
    let guid = item.guid;
    if (guid === undefined) {
      while (used.has(next)) next += 1;
      guid = next;
      used.add(guid);
    }
    rows.push({
      path: new TextEncoder().encode(item.path.replace(/\\/g, '/')),
      guid,
      bytes: item.bytes,
      sha1: new Uint8Array(await crypto.subtle.digest('SHA-1', item.bytes as BufferSource)),
    });
  }
  rows.sort((l, r) => l.guid - r.guid);

  const date = Math.floor(when.getTime() / 1000);
  const map = writeFileDB({
    revision: MOD_DB_REVISION,
    rows: rows.map((row) => ({
      path: new TextDecoder().decode(row.path), date, size: row.bytes.length, sha1: toHex(row.sha1), guid: row.guid,
    })),
  });

  const config = JSON.stringify({ ...DEFAULT_MOD_INFO, ...info }, null, 2);
  return writeZip([
    { name: 'config.json', bytes: new TextEncoder().encode(config) },
    ...(icon ? [{ name: 'icon.png', bytes: icon }] : []),
    ...(patches.length > 0 ? [{ name: 'patches.json', bytes: new TextEncoder().encode(JSON.stringify(patches, null, 2)) }] : []),
    { name: 'data.map', bytes: map },
    { name: 'data.farc', bytes: await writeFar(rows.map((r) => r.bytes), MIZUKI) },
  ], when);
}
