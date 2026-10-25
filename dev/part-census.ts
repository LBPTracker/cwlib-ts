/**
 * Every part of every Thing in the game's levels and plans written from its
 * value, against the bytes the file holds:
 *
 *   node dev/part-census.ts [PART,PART] [limit]     LBP_GAME required, LBP_PATCH optional
 *
 * Each level and plan of the FARCs (and the 01.28 update's) goes onto a tape
 * (`editLevel`, `editPlan`); each part a Thing holds is written twice into a
 * fresh `Writer` -- once from its tape, which is the file's bytes, once by its
 * `partWriters()` writer from its value -- and the two compared. A Thing the
 * part names is written through the tape both times, so only the part's own
 * fields differ. Prints per part how many match, how many differ (with the
 * first differing offset of one), how many threw, and the parts no writer has:
 * the numbers in steering/level-files.md, *Parts written from their values*.
 */

import path from 'node:path';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import type { Segment, Tape, TapeObject } from '../src/io/tape.ts';
import { Writer } from '../src/io/writer.ts';
import type { Thing } from '../src/things/thing.ts';
import { editLevel, editPlan, type EditableThings } from '../src/things/write-level.ts';
import { partWriters, type PartWriteContext } from '../src/things/write-parts.ts';
import { PARTS } from '../src/things/thing.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { FARCS, GAME } from './game.ts';

const only = process.argv[2] && process.argv[2] !== 'all' ? new Set(process.argv[2].split(',')) : undefined;
const limit = Number(process.argv[3] ?? Infinity);
const writers = partWriters();
const NAMES = new Set(PARTS.map((p) => p.name).concat(['VITA_27', 'VITA_28']));

interface Row { same: number; differ: number; threw: number; example?: string }
const rows = new Map<string, Row>();
const row = (name: string): Row => rows.get(name) ?? rows.set(name, { same: 0, differ: 0, threw: 0 }).get(name)!;

const same = (a: Uint8Array, b: Uint8Array): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

/** Every object on a tape, each once: the Things, their parts, and whatever those name. */
function objects(tape: Tape): TapeObject[] {
  const out: TapeObject[] = [];
  const seen = new Set<TapeObject>();
  const walk = (body: readonly Segment[]): void => {
    for (const s of body) {
      if (s instanceof Uint8Array || s.kind === 'mark') continue;
      for (const o of s.kind === 'ref' ? [s.target] : s.items) {
        if (o && !seen.has(o)) {
          seen.add(o);
          out.push(o);
          walk(o.body);
        }
      }
    }
  };
  walk(tape.root);
  return out;
}

function census(file: EditableThings, where: string): void {
  const { tape, revision, compressionFlags } = file;
  const ctx: PartWriteContext = {
    thing: (w, thing: Thing | undefined) => tape.write(w, [{ kind: 'ref', target: thing && tape.objectOf(thing) }]),
  };
  for (const object of objects(tape)) {
    const thing = object.value as Thing | undefined;
    if (!thing || !(thing.parts instanceof Map)) continue;
    for (const segment of object.body) {
      if (segment instanceof Uint8Array || segment.kind !== 'ref' || !segment.label || !NAMES.has(segment.label)) continue;
      const part = segment.target;
      if (!part || (only && !only.has(segment.label))) continue;
      const r = row(segment.label);
      const write = writers.get(segment.label);
      if (!write) {
        r.threw += 0;
        continue;
      }
      const want = new Writer(revision, compressionFlags);
      tape.write(want, part.body);
      const got = new Writer(revision, compressionFlags);
      try {
        write(got, part.value as never, ctx);
      } catch (error) {
        r.threw += 1;
        r.example ??= `${where} threw ${(error as Error).message.slice(0, 80)}`;
        continue;
      }
      const a = want.done();
      const b = got.done();
      const at = same(a, b);
      if (at < 0) r.same += 1;
      else {
        r.differ += 1;
        r.example ??= `${where} rev 0x${revision.version.toString(16)}/${revision.subVersion.toString(16)} at ${at} of ${a.length} (written ${b.length})`;
      }
    }
  }
}

const archives = FARCS.map((f) => path.join(GAME, f));
if (process.env.LBP_PATCH) archives.push(path.join(process.env.LBP_PATCH, 'patch_001.farc'));
const seen = new Set<string>();
let files = 0;
outer: for (const file of archives) {
  const access = await openFileAccess(file);
  try {
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (files >= limit) break outer;
      if (seen.has(entry.sha1) || entry.size < 8) continue;
      seen.add(entry.sha1);
      const magic = magicOf(await access.read(entry.offset, 4));
      if (magic !== 'LVLb' && magic !== 'PLNb') continue;
      const bytes = (await farc.get(entry.sha1))!;
      let edited: EditableThings;
      try {
        edited = magic === 'LVLb' ? await editLevel(bytes, nodeInflate) : await editPlan(bytes, nodeInflate);
      } catch {
        continue;
      }
      files += 1;
      census(edited, `${path.basename(file)} ${entry.sha1.slice(0, 8)}`);
    }
  } finally {
    await access.close();
  }
}

console.log(`${files} files`);
const total = { same: 0, differ: 0, threw: 0 };
for (const [name, r] of [...rows].sort()) {
  const has = writers.has(name);
  total.same += r.same;
  total.differ += r.differ;
  total.threw += r.threw;
  console.log(`${name.padEnd(20)} ${has ? `${r.same} same, ${r.differ} differ, ${r.threw} threw${r.example ? `  e.g. ${r.example}` : ''}` : 'no writer'}`);
}
console.log('total', total);
