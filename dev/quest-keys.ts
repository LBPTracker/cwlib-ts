/**
 * What a level's `PQuest` names, against the game's `RQuest`s:
 *
 *   node dev/quest-keys.ts            LBP_GAME required
 *
 * Reads every `QSTb` in the four FARCs, then every `QUEST` part in their
 * levels and plans and in the story's streaming chunks (`gamedata/…/*.farc`,
 * as `story-census.ts` finds them), and prints how many parts' `questKey` is
 * some quest's `key`, how many `objectiveKey`s are an objective's of that same
 * quest, and how the parts' `questId` and `objectiveId` strings compare with
 * the quests' own -- steering/level-files.md, *Quests*. Slow: every story
 * chunk is parsed.
 */

import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { openFarc } from '../src/archives/farc.ts';
import { readFar } from '../src/archives/savearchive.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readQuest, type Quest } from '../src/resources/quest.ts';
import { readThings } from '../src/things/level.ts';
import type { QuestPart } from '../src/things/parts/quest.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const { pathOf } = await gameFileDB();
const quests: { path: string; quest: Quest }[] = [];
const parts: { part: QuestPart; where: string }[] = [];
let unread = 0;

async function collect(bytes: Uint8Array, where: string): Promise<void> {
  try {
    const parse = await readThings(bytes, nodeInflate);
    for (const thing of parse.things) {
      const part = thing?.parts.get('QUEST') as QuestPart | undefined;
      if (part) parts.push({ part, where });
    }
  } catch {
    unread += 1; // things-census.ts and story-census.ts say why
  }
}

const seen = new Set<string>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 8));
      const where = pathOf.get(entry.sha1) ?? entry.sha1;
      if (magic === 'QSTb') quests.push({ path: where, quest: await readQuest((await farc.get(entry.sha1))!, nodeInflate) });
      else if (magic === 'LVLb' || magic === 'PLNb') await collect((await farc.get(entry.sha1))!, where);
    }
  } finally {
    await access.close();
  }
}
const archives: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) walk(at);
    else if (name.endsWith('.farc')) archives.push(at);
  }
};
walk(path.join(GAME, 'gamedata'));
for (const file of archives) {
  for (const { bytes } of await readFar(new Uint8Array(await readFile(file)))) {
    if (magicOf(bytes) === 'CHKb') await collect(bytes, path.relative(GAME, file));
  }
}

const byKey = new Map(quests.map((q) => [q.quest.key, q]));
const tally = new Map<string, number>();
const bump = (key: string): void => void tally.set(key, (tally.get(key) ?? 0) + 1);
const unmatched: string[] = [];
for (const { part, where } of parts) {
  bump(`parts of type ${part.type}`);
  if (part.questKey === 0) {
    bump('questKey 0');
    continue;
  }
  const q = byKey.get(part.questKey);
  if (!q) {
    bump('questKey not a QSTb key');
    unmatched.push(`${part.questId || '(no questId)'} ${part.questKey} in ${where}`);
    continue;
  }
  bump('questKey a QSTb key');
  bump(`  questId ${part.questId === '' ? 'empty' : part.questId === q.quest.name ? "the QSTb's name" : 'another string'}`);
  if (part.objectiveKey === 0) continue;
  const objective = q.quest.objectives.find((o) => o.key === part.objectiveKey);
  bump(`  objectiveKey ${objective ? "one of that quest's objectives" : "none of that quest's objectives"}`);
  if (objective) bump(`    objectiveId ${part.objectiveId === '' ? 'empty' : part.objectiveId === objective.id ? "the objective's id" : 'another string'}`);
}
const named = new Set(parts.map((p) => p.part.questKey));
const namedObjectives = new Set(parts.map((p) => p.part.objectiveKey));
const objectives = quests.flatMap((q) => q.quest.objectives);
console.log(`${quests.length} QSTb, ${parts.length} QUEST parts (${unread} levels, plans or chunks did not parse)`);
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}`);
console.log(`QSTb some part names: ${quests.filter((q) => named.has(q.quest.key)).length} of ${quests.length}`);
console.log(`objectives some part names: ${objectives.filter((o) => namedObjectives.has(o.key)).length} of ${objectives.length}`);
for (const u of [...new Set(unmatched)]) console.log(`  ✗ ${u}`);
