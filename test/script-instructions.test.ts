import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { openFarc } from '../src/archives/farc.ts';
import { magicOf } from '../src/io/resource.ts';
import { nodeInflate, openFileAccess } from '../src/platform/node.ts';
import { readScript } from '../src/resources/script.ts';
import { decodeInstruction, INSTRUCTION_NAMES } from '../src/resources/script-instructions.ts';

/**
 * Every instruction of the game's scripts, decoded and checked against the
 * tables it indexes; skips without `LBP_GAME`. steering/level-files.md,
 * *Scripts — `RScript`*.
 */
const GAME = process.env.LBP_GAME ?? '';
const NO_GAME = GAME ? `no game under ${GAME}` : 'LBP_GAME is not set';
const FARCS = ['base_001.farc', 'chunk1_001.farc', 'craftworld_001.farc', 'intro_001.farc'];

test('an instruction word decodes into its class\'s fields', () => {
  assert.equal(INSTRUCTION_NAMES.length, 0xcb);
  // CALL 0x2a into dest 7: call in bits 32-47, dest in 16-31, opcode 0xa4.
  const call = decodeInstruction((0x2an << 32n) | (7n << 16n) | 0xa4n);
  assert.deepEqual(call, { opcode: 0xa4, name: 'CALL', class: 'call', dest: 7, call: 0x2a, machineType: 0 });
  // B back by three: a signed 32-bit offset in the top half.
  const branch = decodeInstruction((0xfffffffdn << 32n) | 0xa6n);
  assert.equal(branch.class === 'branch' && branch.offset, -3);
  assert.throws(() => decodeInstruction(0xcbn), /past the table/);
});

test("every instruction of the game's 534 scripts decodes, and every index it holds is in range", async (t) => {
  if (GAME === '' || !existsSync(path.join(GAME, FARCS[0]))) return t.skip(NO_GAME);
  let scripts = 0;
  let instructions = 0;
  const seen = new Set<string>();
  for (const file of FARCS) {
    const access = await openFileAccess(path.join(GAME, file));
    const farc = await openFarc(access);
    for (const entry of farc.entries.values()) {
      if (seen.has(entry.sha1) || magicOf(await access.read(entry.offset, 8)) !== 'FSHb') continue;
      seen.add(entry.sha1);
      const script = await readScript((await farc.get(entry.sha1))!, nodeInflate);
      scripts += 1;
      let covered = 0;
      for (const fn of script.functionDefinitions) {
        const [start, end] = fn.bytecode;
        covered += end - start;
        for (let i = start; i < end; i += 1) {
          const ins = decodeInstruction(script.bytecode[i]);
          instructions += 1;
          const where = `${script.className} ${i}`;
          if (ins.class === 'branch') assert.ok(i + ins.offset >= start && i + ins.offset <= end, where);
          if (ins.class === 'call') assert.ok(ins.call < script.functionReferences.length, where);
          if ((ins.class === 'getMember' || ins.class === 'setMember') && ins.name !== 'GET_SP_NATIVE_MEMBER') {
            assert.ok(ins.field < script.fieldReferences.length, where);
          }
          if (ins.class === 'newObject' || ins.class === 'cast') assert.ok(ins.type < script.typeReferences.length, where);
          if (ins.name === 'LCsw') assert.ok(ins.class === 'loadConst' && ins.index < script.stringW.length, where);
          if (ins.name === 'LCsa') assert.ok(ins.class === 'loadConst' && ins.index < script.stringA.length, where);
          if (ins.name === 'LCv4') assert.ok(ins.class === 'loadConst' && ins.index % 4 === 0 && ins.index + 4 <= script.constantsF32.length, where);
        }
      }
      assert.equal(covered, script.bytecode.length, `${script.className}: the functions tile the bytecode`);
    }
    await access.close();
  }
  assert.deepEqual([scripts, instructions], [534, 270057]);
});
