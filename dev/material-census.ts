/**
 * Every `GMTb` in an installed game's FARCs through `readMaterial`, and the
 * checks behind `materialSummary`:
 *
 *   node dev/material-census.ts            LBP_GAME, default D:/PS4Games/CUSA00063
 *
 * Prints, per revision, how many read to the payload's last byte; then:
 *
 * - the graph: box types, what feeds each output port, the swizzles;
 * - **the ports against the textures wired to them**: a texture reaching port
 *   3 (cwlib's BUMP) should be a normal map and one reaching port 0 (DIFFUSE)
 *   should not -- judged by the `GTF ` flags bit 0 and by the FileDB path;
 * - whether every texture slot resolves to a `GTF ` or `TEX `;
 * - **the UV channel against the meshes**: every mesh primitive naming the
 *   material, each sample's `params[4]` below that mesh's channel count;
 * - the summary's shapes, the UV transforms, and `alphaMode` against names.
 *
 * Nothing is written; the FARCs are read in place.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { openFarc, type Farc } from '../src/farc.ts';
import { readFileDB, readGuidRemap } from '../src/filedb.ts';
import { BOX_OUTPUT, BOX_TEXTURE_SAMPLE, materialSummary, readMaterial, type GfxMaterial } from '../src/material.ts';
import { readMesh } from '../src/mesh.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';

const GAME = process.env.LBP_GAME ?? 'D:/PS4Games/CUSA00063';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

const db = readFileDB(await readFile(path.join(GAME, 'output', 'orbisguids.map')));
const pathOf = new Map<string, string>();
for (const row of db.values()) pathOf.set(row.sha1, row.path);
const { remap } = readGuidRemap(await readFile(path.join(GAME, 'output', 'orbisguids.remap')));
/** The FileDB row for a GUID, through the remap when it has none of its own. */
const rowOf = (guid: number) => db.get(guid) ?? db.get(remap.get(guid)?.guid ?? -1);

const tally = new Map<string, number>();
const bump = (key: string, by = 1): void => void tally.set(key, (tally.get(key) ?? 0) + by);
const example = new Map<string, string>();
const note = (key: string, what: string): void => {
  bump(key);
  if (!example.has(key)) example.set(key, what);
};

const archives: { farc: Farc; close(): Promise<void> }[] = [];
for (const file of FARCS) {
  const access = await openFileAccess(path.join(GAME, file));
  archives.push({ farc: await openFarc(access), close: () => access.close() });
}
async function bytesOf(sha1: string): Promise<Uint8Array | undefined> {
  for (const { farc } of archives) {
    const bytes = await farc.get(sha1);
    if (bytes) return bytes;
  }
  return undefined;
}

/** Every texture's magic and GTF flags, by SHA-1, from its first 20 bytes. */
const textures = new Map<string, { magic: string; flags: number }>();
const materials = new Map<string, GfxMaterial>();
const byRevision = new Map<string, { ok: number; failed: number }>();
const failures: string[] = [];
const meshes: string[] = [];
for (const { farc } of archives) {
  for (const entry of farc.entries.values()) {
    if (entry.size < 20 || textures.has(entry.sha1) || materials.has(entry.sha1)) continue;
    const head = (await farc.get(entry.sha1))!;
    const magic = String.fromCharCode(...head.subarray(0, 4));
    if (magic === 'GTF ' || magic === 'TEX ') textures.set(entry.sha1, { magic, flags: magic === 'GTF ' ? head[19] : 0 });
    else if (magic === 'MSHb') meshes.push(entry.sha1);
    else if (magic === 'GMTb') {
      const revision = new DataView(head.buffer, head.byteOffset).getUint32(4, false).toString(16);
      const row = byRevision.get(revision) ?? { ok: 0, failed: 0 };
      byRevision.set(revision, row);
      try {
        materials.set(entry.sha1, await readMaterial(head, nodeInflate));
        row.ok += 1;
      } catch (error) {
        row.failed += 1;
        failures.push(`0x${revision} ${pathOf.get(entry.sha1)}: ${(error as Error).message}`);
      }
    }
  }
}

const NORMAL_NAME = /norm|bump|_nm[._]/i;
for (const [sha1, m] of materials) {
  const name = pathOf.get(sha1) ?? sha1;
  const outputs = m.boxes.filter((b) => b.type === BOX_OUTPUT).length;
  bump(`output boxes per material: ${outputs}`);
  for (const b of m.boxes) bump(`box type ${String(b.type).padStart(2)}`);
  for (const [i, ref] of m.textures.entries()) {
    if (!ref) continue;
    const row = rowOf(ref.guid);
    const t = row && textures.get(row.sha1);
    const how = db.has(ref.guid) ? 'directly' : remap.has(ref.guid) ? 'through the remap' : 'nowhere';
    note(`texture slot ${ref.hash ? 'by SHA-1' : 'by GUID'}, resolved ${how} -> ${t ? t.magic : row ? 'no bytes in the FARCs' : 'no FileDB row'}`, `${name} slot ${i} guid ${ref.guid}`);
  }
  const output = m.boxes.findIndex((b) => b.type === BOX_OUTPUT);
  for (const w of m.wires) {
    if (w.boxTo !== output) continue;
    const from = m.boxes[w.boxFrom];
    if (from?.type !== BOX_TEXTURE_SAMPLE) continue;
    const ref = m.textures[from.params[5]];
    const row = ref && rowOf(ref.guid);
    const t = row && textures.get(row.sha1);
    if (!t || t.magic !== 'GTF ') continue;
    const port = w.portTo === 0 ? 'diffuse (0)' : w.portTo === 3 ? 'bump (3)' : w.portTo === 2 ? 'specular (2)' : undefined;
    if (!port) continue;
    bump(`sample wired straight into ${port}: GTF flags bit 0 ${t.flags & 1 ? 'set' : 'clear'}`);
    bump(`sample wired straight into ${port}: path ${NORMAL_NAME.test(row.path) ? 'names' : 'does not name'} a normal/bump map`);
  }
  const summary = materialSummary(m);
  bump(`diffuse shape: ${summary.diffuse?.shape ?? 'no wire'}`);
  if (summary.alphaClip) bump(`alpha-clip port: ${summary.alphaClip.shape}, swizzle "${summary.alphaClip.swizzle}"`);
  const s = summary.diffuse?.sample;
  if (s) {
    const [a, b, c, d, e, f] = s.uvTransform;
    const identity = a === 1 && b === 0 && c === 0 && d === 0 && e === 1 && f === 0;
    note(`diffuse uv transform: ${identity ? 'identity' : b || d ? 'rotated' : 'scale/offset'}`, `${name} ${s.uvTransform.join(' ')}`);
    note(`diffuse wrap ${s.wrapS}/${s.wrapT}`, name);
  }
  if (summary.diffuse?.colour) {
    const ok = summary.diffuse.colour.every((x) => x >= 0 && x <= 1);
    note(`diffuse colour ${ok ? 'within [0, 1]' : 'OUTSIDE [0, 1]'}`, `${name} ${summary.diffuse.colour.join(' ')}`);
  }
  const words = ['alpha', 'glassy', 'refract', 'additive', 'fire', 'glow'].filter((k) => name.includes(k));
  bump(`alphaMode ${m.alphaMode} alphaLayer ${String(m.alphaLayer).padStart(3)}: name has ${words.join('+') || 'none of alpha/glassy/refract/additive/fire/glow'}`);
}

// The UV channel against every mesh that names the material.
const byGuid = new Map<number, GfxMaterial>();
for (const row of db.values()) {
  const m = materials.get(row.sha1);
  if (m) byGuid.set(row.guid, m);
}
for (const [old, { guid }] of remap) {
  const m = byGuid.get(guid);
  if (m && !byGuid.has(old)) byGuid.set(old, m);
}
for (const sha1 of meshes) {
  const mesh = await readMesh((await bytesOf(sha1))!, nodeInflate);
  for (const p of mesh.primitives) {
    if (!p.material) continue;
    const m = byGuid.get(p.material.guid);
    const how = db.has(p.material.guid) ? 'directly' : remap.has(p.material.guid) ? 'through the remap' : 'nowhere';
    if (!m) {
      note(`mesh primitive: material resolved ${how}, not among the GMTb read`, `${pathOf.get(sha1)} guid ${p.material.guid}`);
      continue;
    }
    bump(`mesh primitive: material resolved ${how} and read`);
    for (const b of m.boxes) {
      if (b.type !== BOX_TEXTURE_SAMPLE) continue;
      const ok = b.params[4] < mesh.uvs.length;
      note(`sample uv channel ${ok ? 'below' : 'AT OR PAST'} the mesh's channel count`, `${pathOf.get(sha1)} has ${mesh.uvs.length}, channel ${b.params[4]}`);
    }
  }
}
for (const a of archives) await a.close();

const total = [...byRevision.values()].reduce((sum, r) => sum + r.ok, 0);
console.log(`${materials.size + failures.length} GMTb, ${total} read to their last byte`);
for (const [revision, { ok, failed }] of [...byRevision].sort(([a], [b]) => parseInt(a, 16) - parseInt(b, 16))) {
  console.log(`  0x${revision}  ${ok} ok${failed ? `, ${failed} FAILED` : ''}`);
}
for (const failure of failures.slice(0, 20)) console.log(`  ✗ ${failure}`);
for (const [key, count] of [...tally].sort()) {
  console.log(`${key}: ${count}${example.has(key) ? `   e.g. ${example.get(key)}` : ''}`);
}
