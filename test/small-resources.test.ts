import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readAnimatedTexture } from '../src/resources/animated-texture.ts';
import { readGuidList } from '../src/resources/guid-list.ts';
import { readTexture } from '../src/resources/texture.ts';
import { readVoipRecording } from '../src/resources/voip-recording.ts';
import { readTutorials } from '../src/resources/tutorials.ts';
import { readGuidRemap } from '../src/archives/filedb.ts';

/**
 * The types cwlib names and has no class for: `ATXb`, `GLTb`, `VOPb`, `TUTb`; skips
 * without `LBP_GAME`. steering/level-files.md, *Small resources*.
 */
const GAME = process.env.LBP_GAME ?? '';
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('every ATXb, GLTb and VOPb reads to its last byte, and a flipbook fits its texture', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const byGuid = new Map([...db.values()].map((r) => [r.guid, r.sha1]));
  const accesses = await Promise.all(FARCS.map((f) => openFileAccess(path.join(GAME, f))));
  const farcs = await Promise.all(accesses.map((a) => openFarc(a)));
  const get = async (sha1: string): Promise<Uint8Array | undefined> => {
    for (const farc of farcs) if (farc.entries.has(sha1)) return farc.get(sha1);
    return undefined;
  };
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  for (let i = 0; i < farcs.length; i += 1) {
    for (const entry of farcs[i].entries.values()) {
      if (seen.has(entry.sha1)) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await accesses[i].read(entry.offset, 8));
      if (!['ATXb', 'GLTb', 'VOPb'].includes(magic)) continue;
      counts[magic] = (counts[magic] ?? 0) + 1;
      const bytes = (await get(entry.sha1))!;
      if (magic === 'GLTb') assert.ok((await readGuidList(bytes, nodeInflate)).guids.length > 0);
      if (magic === 'VOPb') assert.ok((await readVoipRecording(bytes, nodeInflate)).data.length > 0);
      if (magic === 'ATXb') {
        const flipbook = await readAnimatedTexture(bytes, nodeInflate);
        const texture = await readTexture((await get(byGuid.get(flipbook.texture!.guid)!))!, nodeInflate);
        const cells = Math.floor(texture.width / flipbook.frameWidth) * Math.floor(texture.height / flipbook.frameHeight);
        assert.ok(cells >= flipbook.frames, `${flipbook.frames} frames in ${cells} cells`);
        assert.equal(flipbook.loop, true);
      }
    }
  }
  for (const access of accesses) await access.close();
  assert.deepEqual(counts, { ATXb: 24, GLTb: 2, VOPb: 4 });
});

test('the two tutorial lists read to their last byte: nine videos, each with its thumbnail', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const { remap } = readGuidRemap(await readFile(path.join(GAME, 'output', 'orbisguids.remap')));
  const pathOf = new Map([...db.values()].map((r) => [r.guid, r.path]));
  const rows = new Map([...db.values()].filter((r) => r.path.endsWith('.tut')).map((r) => [r.path, r.sha1]));
  const read = new Map<string, Awaited<ReturnType<typeof readTutorials>>>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const [name, sha1] of rows) {
      if (!read.has(name) && farc.entries.has(sha1)) read.set(name, await readTutorials((await farc.get(sha1))!, nodeInflate));
    }
    await access.close();
  }
  assert.equal(read.get('gamedata/data/tutorials_beta.tut')!.groups.length, 0);
  const groups = read.get('gamedata_orbis/data/tutorials.tut')!.groups;
  assert.equal(groups.length, 1);
  const tutorials = groups[0]!.tutorials;
  assert.equal(tutorials.length, 9);
  for (const tutorial of tutorials) {
    const video = pathOf.get(tutorial!.videoGuid)!;
    assert.match(video, /\.bik$/);
    // The image is the PS3 GUID of the video's thumbnail, which the PS4 build remaps.
    const thumbnail = remap.get(tutorial!.image!.guid)!.path;
    assert.equal(path.posix.basename(thumbnail, '.tex'), path.posix.basename(video, '.bik'));
  }
});
