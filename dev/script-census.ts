/**
 * Every `FSHb` in an installed game's FARCs through `readScript`:
 *
 *   node dev/script-census.ts            LBP_GAME required
 *
 * Prints, per head word, how many read to their payload's last byte, the first
 * failures by path, and then whether the tables hold together -- every name
 * inside the ASCII pool, every type inside the type table, every function's
 * ranges inside the shared tables and tiling them -- and the opcodes the
 * instructions use: the numbers in steering/level-files.md, *Scripts*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readScript, type Script } from '../src/resources/script.ts';
import { FARCS, GAME, gameFileDB } from './game.ts';

const { pathOf } = await gameFileDB();

const tally = new Map<string, number>();
const bump = (key: string, by = 1): void => void tally.set(key, (tally.get(key) ?? 0) + by);
const range = new Map<string, [number, number]>();
const widen = (key: string, v: number): void => {
  const r = range.get(key) ?? [Infinity, -Infinity];
  range.set(key, [Math.min(r[0], v), Math.max(r[1], v)]);
};
const opcodes = new Map<number, number>();
const failures: string[] = [];
const seen = new Set<string>();

function measure(sc: Script): void {
  widen('functions', sc.functionDefinitions.length);
  widen('instructions', sc.bytecode.length);
  widen('ASCII strings', sc.stringA.length);
  widen('wide strings', sc.stringW.length);
  widen('depending GUIDs', sc.dependingGuids.length);
  if (sc.superClassScript) bump('with a superclass');
  if (sc.lineNos.length === 0) bump('without line numbers');
  else if (sc.lineNos.length !== sc.bytecode.length) bump('line numbers not one per instruction');
  if (sc.constantsS64.length > 0) bump('with s64 constants');
  const names = sc.stringA.length;
  const types = sc.typeReferences.length;
  const badName = (n: number): boolean => n < 0 || n >= names;
  const badType = (t: number): boolean => t < 0 || t >= types;
  for (const t of sc.typeReferences) {
    if (t.typeName === -1) bump(`unnamed type (-1), ${t.script ? 'with' : 'without'} a script`);
    else if (badName(t.typeName)) bump('type name outside the pool');
  }
  if (sc.stringA[0] !== '') bump('first ASCII string not empty');
  for (const list of [sc.fieldReferences, sc.functionReferences, sc.fieldDefinitions, sc.propertyDefinitions, sc.functionDefinitions, sc.localVariables]) {
    for (const m of list) {
      if (badName(m.name)) bump('member name outside the pool');
      if (badType(m.type)) bump('member type outside the type table');
    }
  }
  for (const a of sc.sharedArguments) if (badType(a.type)) bump('argument type outside the type table');
  for (const p of sc.propertyDefinitions) {
    for (const f of [p.getFunction, p.setFunction]) if (f < -1 || f >= sc.functionDefinitions.length) bump('property accessor outside the functions');
  }
  const tables = { arguments: sc.sharedArguments.length, bytecode: sc.bytecode.length, lineNos: sc.lineNos.length, localVariables: sc.localVariables.length } as const;
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    let end = 0;
    for (const f of sc.functionDefinitions) {
      const [b, e] = f[key];
      if (b < 0 || e < b || e > tables[key]) bump(`function ${key} outside the table`);
      if (b !== end) bump(`function ${key} not tiling the table`);
      end = e;
    }
    if (sc.functionDefinitions.length > 0 && end !== tables[key]) bump(`functions' ${key} short of the table's end`);
  }
  for (const code of sc.bytecode) {
    const op = Number(code & 0xffn);
    opcodes.set(op, (opcodes.get(op) ?? 0) + 1);
  }
  bump('instructions total', sc.bytecode.length);
}

const byRevision = new Map<string, { ok: number; failed: number }>();
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      const head = await access.read(entry.offset, 8);
      if (magicOf(head) !== 'FSHb') continue;
      seen.add(entry.sha1);
      const word = `0x${new DataView(head.buffer).getUint32(4, false).toString(16)}`;
      const row = byRevision.get(word) ?? byRevision.set(word, { ok: 0, failed: 0 }).get(word)!;
      try {
        measure(await readScript((await farc.get(entry.sha1))!, nodeInflate));
        row.ok += 1;
      } catch (error) {
        row.failed += 1;
        failures.push(`${word} ${pathOf.get(entry.sha1) ?? entry.sha1}: ${(error as Error).message}`);
      }
    }
  } finally {
    await access.close();
  }
}

const ok = [...byRevision.values()].reduce((n, r) => n + r.ok, 0);
console.log(`${ok} of ${seen.size} FSHb read, ${byRevision.size} head words`);
for (const [word, { ok: o, failed }] of [...byRevision].sort()) console.log(`  ${word}  ${o} ok${failed ? `, ${failed} FAILED` : ''}`);
for (const f of failures.slice(0, 12)) console.log(`  ✗ ${f}`);
for (const [key, [lo, hi]] of range) console.log(`${key}: ${lo} .. ${hi}`);
for (const [key, count] of [...tally].sort()) console.log(`${key}: ${count}`);
console.log(`opcodes (${opcodes.size}): ${[...opcodes].sort((a, b) => a[0] - b[0]).map(([op, n]) => `${op}:${n}`).join(' ')}`);
