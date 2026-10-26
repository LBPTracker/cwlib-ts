/**
 * glTF plumbing the import harnesses share (`dev/import-java.ts`,
 * `dev/import-roundtrip.ts`): neither is the importers' business, both are
 * what this library's exporters leave out for a round trip.
 */

import { ARRAY_BUFFER, GltfBuilder } from '../src/resources/gltf-builder.ts';
import { Gltf } from '../src/imports/gltf-read.ts';

/**
 * A skin over every node but the armature: `animationToGlb` writes none for an
 * animation on its own skeleton, and both importers take the joints from one;
 * jgltf wants inverse bind matrices with it, so identities are added.
 */
export function withSkin(glb: Uint8Array): Uint8Array {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
    nodes: { name?: string }[]; skins?: unknown[]; accessors?: unknown[]; bufferViews?: unknown[]; buffers?: { byteLength: number }[];
  };
  if (json.skins) return glb;
  const joints = json.nodes.flatMap((n, i) => (n.name === 'Armature' ? [] : [i]));
  const binAt = 20 + jsonLength;
  const bin = binAt + 8 <= glb.length ? glb.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true)) : new Uint8Array(0);
  const matrices = new Float32Array(joints.length * 16);
  for (let j = 0; j < joints.length; j += 1) for (const k of [0, 5, 10, 15]) matrices[j * 16 + k] = 1;
  const newBin = new Uint8Array(bin.length + matrices.byteLength);
  newBin.set(bin);
  newBin.set(new Uint8Array(matrices.buffer), bin.length);
  json.bufferViews = [...(json.bufferViews ?? []), { buffer: 0, byteOffset: bin.length, byteLength: matrices.byteLength }];
  json.accessors = [...(json.accessors ?? []), { bufferView: json.bufferViews.length - 1, componentType: 5126, count: joints.length, type: 'MAT4' }];
  json.buffers = [{ byteLength: newBin.length }];
  json.skins = [{ joints, inverseBindMatrices: json.accessors.length - 1 }];
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(20 + padded + 8 + newBin.length);
  out.set(glb.subarray(0, 12));
  const ov = new DataView(out.buffer);
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, padded, true);
  ov.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + padded);
  ov.setUint32(20 + padded, newBin.length, true);
  ov.setUint32(24 + padded, 0x004e4942, true);
  out.set(newBin, 28 + padded);
  return out;
}

/**
 * Every primitive of a glTF as a `.glb` of its own, its vertices cut to the
 * ones its indices use (in first-use order) -- how a backdrop of more than
 * 65,535 vertices, which `staticMeshToGlb` writes over one set of accessors,
 * goes through `importModel` a primitive at a time. Unskinned attributes only.
 */
export function primitivesAsGlbs(glb: Uint8Array): { glb: Uint8Array; material?: string }[] {
  const gltf = Gltf.read(glb);
  const out: { glb: Uint8Array; material?: string }[] = [];
  for (const mesh of gltf.meshes) {
    for (const p of mesh.primitives) {
      const indices = p.indices === undefined ? [] : Array.from(gltf.values(p.indices));
      const remap = new Map<number, number>();
      const order: number[] = [];
      const local = indices.map((i) => {
        let j = remap.get(i);
        if (j === undefined) {
          j = order.length;
          remap.set(i, j);
          order.push(i);
        }
        return j;
      });
      const g = new GltfBuilder();
      const attributes: Record<string, number> = {};
      for (const [name, accessor] of Object.entries(p.attributes)) {
        const per = gltf.components(accessor);
        const values = gltf.floats(accessor);
        const cut = new Float32Array(order.length * per);
        order.forEach((v, k) => cut.set(values.subarray(v * per, v * per + per), k * per));
        attributes[name] = g.floats(cut, gltf.accessor(accessor).type, ARRAY_BUFFER, name === 'POSITION');
      }
      const material = p.material === undefined ? undefined : gltf.json.materials?.[p.material]?.name;
      const json = {
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes, indices: g.indices(Uint32Array.from(local)), mode: 4, ...(material !== undefined ? { material: 0 } : {}) }] }],
        ...(material !== undefined ? { materials: [{ name: material }] } : {}),
      };
      out.push({ glb: g.glb('import-glb primitivesAsGlbs', json), material });
    }
  }
  return out;
}
