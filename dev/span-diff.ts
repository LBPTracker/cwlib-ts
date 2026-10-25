/**
 * cwlib's part spans against ours, file by file, grouped by where they first part:
 *
 *   node dev/span-diff.ts <dir>        LBP_JAVA, LBP_CWLIB_CP required
 *
 * Every `LVLb`/`PLNb` in `dir` goes through lbptracker's `CwlibTrace spans` (a
 * level) or `PlanTrace` (a plan, whose spans are in its `thingData`) and through
 * `readThings` with `setTrace` on; the first boundary where the two disagree,
 * and the part open on our side there, group the files -- "LVLb 0x22a in BODY:
 * END BODY@35 vs END BODY@39" names the reader, the revision and the four bytes.
 * How the older revisions were brought to cwlib's reading (steering/level-files.md,
 * *Revisions below LBP3*). `LBP_JAVA` is a JDK's `java` (25, not the 1.8 on
 * PATH); `LBP_CWLIB_CP` the classpath holding the toolkit's jar and the two
 * classes (steering/tools.md).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readThings } from '../src/things/level.ts';
import { setTrace } from '../src/things/thing.ts';
import { nodeInflate } from '../src/platform/node.ts';
import { required } from './env.ts';
const DIR = process.argv[2];
const JDK = required('LBP_JAVA', 'a JDK 25 java executable');
const CP = required('LBP_CWLIB_CP', 'the classpath of the toolkit jar and CwlibTrace and PlanTrace');
const groups = new Map<string, string[]>();
for (const name of readdirSync(DIR)) {
  const file = path.join(DIR, name);
  const bytes = new Uint8Array(readFileSync(file));
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const head = new DataView(bytes.buffer).getUint32(4, false).toString(16);
  let out = '';
  { const r = spawnSync(JDK, ['-cp', CP, ...(magic === 'PLNb' ? ['PlanTrace', file] : ['CwlibTrace', 'spans', file])], { encoding: 'utf8', maxBuffer: 1 << 28 }); out = (r.stdout ?? '') + (r.stderr ?? ''); }
  const java = [...out.matchAll(/@ 0x([0-9A-F]+) -> (.*) \[(START|END)\]/g)].map((m) => [m[3], m[2], parseInt(m[1], 16)] as const).filter((x) => !/^THING/.test(x[1]));
  const javaFail = /Exception|# /.test(out.split('\n').slice(-3).join(' '));
  const ours: (readonly [string, string, number])[] = [];
  setTrace((e, s, end) => { if (!e.startsWith('THING')) ours.push(end < 0 ? ['START', e, s] : ['END', e, end]); });
  let ourError = '';
  try { const r = await readThings(bytes, nodeInflate); ourError = r.unreadTail ?? ''; } catch (e) { ourError = (e as Error).message; }
  setTrace(undefined);
  let i = 0;
  for (; i < Math.min(java.length, ours.length); i++) { const a = java[i]!, b = ours[i]!; if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) break; }
  const at = java[i] && ours[i] ? `${java[i]![0]} ${java[i]![1]}@${java[i]![2].toString(16)} vs ${ours[i]![0]} ${ours[i]![1]}@${ours[i]![2].toString(16)}` : `java ${java.length} ours ${ours.length}`;
  // The part that was open when they parted: the last START before i on our side.
  let open = '';
  for (let k = i - 1, depth = 0; k >= 0; k--) { const x = ours[k]!; if (x[0] === 'END') depth++; else if (depth === 0) { open = x[1]; break; } else depth--; }
  const key = `${magic} 0x${head.slice(-3)} in ${open || '-'}${javaFail ? ' (java fails too)' : ''}`;
  const list = groups.get(key) ?? groups.set(key, []).get(key)!;
  list.push(`${name.slice(0, 8)} ${at} | ${ourError.slice(0, 70)}`);
}
for (const [k, v] of [...groups].sort((a, b) => b[1].length - a[1].length)) { console.log(`${v.length} ${k}`); for (const x of v.slice(0, 2)) console.log(`    ${x}`); }
