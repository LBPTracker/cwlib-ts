import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { readFileDB } from '../src/archives/filedb.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readScript, type Script } from '../src/resources/script.ts';

/**
 * The game's compiled scripts, out of its FARCs; skips without `LBP_GAME`.
 * `dev/script-census.ts` prints what they hold.
 */
const GAME = process.env.LBP_GAME ?? '';
/** Whether the installed game, when `LBP_GAME` names one, holds this file. */
const inGame = (...parts: string[]): boolean => GAME !== '' && existsSync(path.join(GAME, ...parts));
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('every FSHb the game ships reads to its last byte, and its functions tile the shared tables', async (t) => {
  if (!inGame('output', 'orbisguids.map')) return t.skip(NO_GAME);
  const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
  const pathOf = new Map([...db.values()].map((r) => [r.sha1, r.path]));
  const read = new Map<string, Script>();
  const revisions = new Set<number>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (read.has(entry.sha1) || entry.size < 8) continue;
      if (magicOf(await access.read(entry.offset, 8)) !== 'FSHb') continue;
      // readScript throws unless the walk ends on the payload's last byte.
      const sc = await readScript((await farc.get(entry.sha1))!, nodeInflate);
      read.set(entry.sha1, sc);
      revisions.add(sc.revision.subVersion * 0x10000 + sc.revision.version);
      const name = pathOf.get(entry.sha1) ?? entry.sha1;
      // Function i's bytecode starts where function i - 1's ends, and the last ends with the table.
      let end = 0;
      for (const f of sc.functionDefinitions) {
        assert.equal(f.bytecode[0], end, name);
        end = f.bytecode[1];
      }
      if (sc.functionDefinitions.length > 0) assert.equal(end, sc.bytecode.length, name);
      for (const m of [...sc.fieldDefinitions, ...sc.functionDefinitions]) assert.ok(m.name >= 0 && m.name < sc.stringA.length, name);
    }
    await access.close();
  }
  assert.equal(read.size, 534);
  assert.equal(revisions.size, 60);

  const test = [...read.values()].find((sc) => sc.stringA[1] === 'art/scripts/test.cod')!;
  assert.equal(test.className, 'Test');
  const names = test.functionDefinitions.map((f) => test.stringA[f.name]);
  assert.deepEqual(names.slice(0, 3), ['FactorialRecursive__i', 'TestFor__', 'TestLogical__']);
  assert.deepEqual(test.stringW.slice(1, 3), [' of ', ' passed\n']);
});
