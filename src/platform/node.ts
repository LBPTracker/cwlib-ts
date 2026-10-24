/**
 * Node adapters. Nothing else in `src/` imports this -- it exists so the readers
 * can stay free of platform APIs and still be driven from `node --test` and CLI
 * tools.
 */

import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { open, readFile } from 'node:fs/promises';

import type { RandomAccess } from '../archives/farc.ts';
import type { Inflate, Resource } from '../io/resource.ts';
import { loadResource } from '../io/resource.ts';
import type { Deflate } from '../io/writer.ts';

export const nodeInflate: Inflate = (deflated) =>
  new Uint8Array(inflateSync(deflated));

/** Raw DEFLATE, which is what a ZIP entry stores -- no zlib header, no checksum. */
export const nodeInflateRaw: Inflate = (deflated) =>
  new Uint8Array(inflateRawSync(deflated));

/**
 * Deflate one resource chunk, **with the game's own window size**.
 *
 * ⚠️ `windowBits: 14` is not a tuning choice: it puts CINFO 6 in the zlib
 * header, so a chunk written here starts `0x68` exactly as the game's do, and
 * a hex dump of our output lines up with a hex dump of theirs. The default 15
 * would write `0x78` -- valid, inflatable, and visibly not what LBP writes.
 * See steering/level-files.md and the header of `src/io/writer.ts`.
 */
export const nodeDeflate: Deflate = (raw) =>
  new Uint8Array(deflateSync(raw, { windowBits: 14, level: 9 }));

export async function loadResourceFile(path: string): Promise<Resource> {
  const bytes = new Uint8Array(await readFile(path));
  return loadResource(bytes, nodeInflate);
}

/**
 * A file on disk as `RandomAccess`, for `openFarc`. The handle stays open
 * until `close` -- a FARC is read from for as long as anything resolves into it.
 */
export async function openFileAccess(path: string): Promise<RandomAccess & { close(): Promise<void> }> {
  const handle = await open(path, 'r');
  const { size } = await handle.stat();
  return {
    size,
    async read(offset, length) {
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const { bytesRead } = await handle.read(out, done, length - done, offset + done);
        if (bytesRead === 0) throw new Error(`${path} ended at ${offset + done} of ${offset + length}`);
        done += bytesRead;
      }
      return out;
    },
    close: () => handle.close(),
  };
}
