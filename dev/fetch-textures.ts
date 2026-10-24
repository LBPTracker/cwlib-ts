/**
 * The user textures a directory of levels names, out of the public archive:
 *
 *   node ../cwlib-ts/dev/fetch-textures.ts [levels-dir] [out-dir]
 *        default fixtures/archive -> fixtures/textures, run from an lbptracker checkout
 *
 * Every hashed type-1 dependency of every resource in the directory is fetched
 * under its SHA-1, skipped if already there, and checked against that SHA-1 --
 * the archive's bytes are someone else's and never committed. How the user
 * `TEX ` corpus behind steering/level-files.md, *The game's textures*, was
 * gathered; `dev/texture-census.ts` style checks on it are in
 * `test/texture.test.ts`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readDependencies } from '../src/io/resource.ts';

const DIR = process.argv[2] ?? 'fixtures/archive';
const OUT = process.argv[3] ?? 'fixtures/textures';

function url(sha1: string): string {
  const h = sha1.toLowerCase();
  return `https://archive.org/download/dry23r${h[0]}/dry${h.slice(0, 2)}.zip/${h.slice(0, 2)}%2F${h.slice(2, 4)}%2F${h}`;
}

const wanted = new Set<string>();
for (const file of readdirSync(DIR)) {
  const at = path.join(DIR, file);
  if (!statSync(at).isFile()) continue;
  try {
    for (const d of readDependencies(new Uint8Array(await readFile(at)))) {
      if (d.kind === 'sha1' && d.type === 1) wanted.add(d.sha1.toLowerCase());
    }
  } catch {
    // Not a resource with a dependency table; nothing to fetch for it.
  }
}

await mkdir(OUT, { recursive: true });
const queue = [...wanted].filter((sha1) => !existsSync(path.join(OUT, sha1)));
console.log(`${wanted.size} textures named, ${queue.length} to fetch`);
const tally = { got: 0, missing: 0, mismatch: 0 };
async function worker(): Promise<void> {
  for (let sha1 = queue.shift(); sha1; sha1 = queue.shift()) {
    const res = await fetch(url(sha1)).catch(() => undefined);
    if (!res?.ok) {
      tally.missing += 1;
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (createHash('sha1').update(bytes).digest('hex') !== sha1) {
      tally.mismatch += 1;
      continue;
    }
    await writeFile(path.join(OUT, sha1), bytes);
    tally.got += 1;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`fetched ${tally.got}, missing ${tally.missing}, not matching their SHA-1 ${tally.mismatch}`);
