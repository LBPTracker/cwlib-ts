/**
 * The installed game the censuses read, and its two indexes -- the prologue
 * eight of them used to repeat word for word.
 *
 * `LBP_GAME` is an LBP3 PS4 build, the folder holding `base_001.farc` and
 * `output/` (steering/tools.md, *Environment variables*), and a census stops
 * without it; the four FARCs are where the game's own resources are.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readFileDB, readGuidRemap, type FileDBEntry } from '../src/filedb.ts';
import { required } from './env.ts';

export const GAME = required('LBP_GAME', 'an installed LBP3 PS4 build, the folder holding base_001.farc and output/');
export const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

/** `output/orbisguids.map`: rows by GUID, and every row's path by its SHA-1. */
export async function gameFileDB(): Promise<{ db: Map<number, FileDBEntry>; pathOf: Map<string, string> }> {
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map<string, string>();
  for (const row of db.values()) pathOf.set(row.sha1, row.path);
  return { db, pathOf };
}

/**
 * `output/orbisguids.remap`, and the FileDB row for a GUID through it when the
 * GUID has none of its own -- which the game's meshes and materials need for
 * nine references in ten (steering/level-files.md, *The GUID remap*).
 */
export async function gameRemap(db: Map<number, FileDBEntry>): Promise<{
  remap: Map<number, { guid: number; path: string }>;
  rowOf: (guid: number) => FileDBEntry | undefined;
}> {
  const { remap } = readGuidRemap(await readFile(path.join(GAME, 'output', 'orbisguids.remap')));
  return { remap, rowOf: (guid) => db.get(guid) ?? db.get(remap.get(guid)?.guid ?? -1) };
}
