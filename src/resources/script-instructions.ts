/**
 * An `RScript`'s instructions decoded: each 64-bit word of `Script.bytecode`
 * into its opcode and the fields its instruction class packs. cwlib's
 * `enums/InstructionType.java` and `structs/script/instructions/` (ennuo/toolkit
 * `d6a2ef8`); what the game's scripts prove of it is steering/level-files.md,
 * *Scripts — `RScript`*.
 *
 * The opcode is the low byte. Above it, by class: a machine type in bits 8-15,
 * a destination (or a source) in 16-31, and in 32-63 one 32-bit field or two
 * 16-bit ones -- see each variant of `Instruction`.
 */

/** cwlib's `InstructionType`, by opcode: 0x00 `NOP` to 0xca `BIT_XORs64`. */
export const INSTRUCTION_NAMES: readonly string[] = [
  'NOP', 'LCb', 'LCc', 'LCi', 'LCf', 'LCsw', 'LC_NULLsp', 'MOVb', 'LOG_NEGb', 'MOVc', 'MOVi', 'INCi', 'DECi',
  'NEGi', 'BIT_NEGi', 'LOG_NEGi', 'ABSi', 'MOVf', 'NEGf', 'ABSf', 'SQRTf', 'SINf', 'COSf', 'TANf', 'MOVv4',
  'NEGv4', 'MOVm44', 'MOVs', 'MOVrp', 'MOVcp', 'MOVsp', 'MOVo', 'EQb', 'NEb', 'RESERVED0', 'RESERVED1', 'LTc',
  'LTEc', 'GTc', 'GTEc', 'EQc', 'NEc', 'ADDi', 'SUBi', 'MULi', 'DIVi', 'MODi', 'MINi', 'MAXi', 'SLAi', 'SRAi',
  'SRLi', 'BIT_ORi', 'BIT_ANDi', 'BIT_XORi', 'LTi', 'LTEi', 'GTi', 'GTEi', 'EQi', 'NEi', 'ADDf', 'SUBf', 'MULf',
  'DIVf', 'MINf', 'MAXf', 'LTf', 'LTEf', 'GTf', 'GTEf', 'EQf', 'NEf', 'ADDv4', 'SUBv4', 'MULSv4', 'DIVSv4',
  'DOT4v4', 'DOT3v4', 'DOT2v4', 'CROSS3v4', 'MULm44', 'EQs', 'NEs', 'EQrp', 'NErp', 'EQo', 'NEo', 'EQsp', 'NEsp',
  'GET_V4_X', 'GET_V4_Y', 'GET_V4_Z', 'GET_V4_W', 'GET_V4_LEN2', 'GET_V4_LEN3', 'GET_V4_LEN4',
  'GET_M44_XX', 'GET_M44_XY', 'GET_M44_XZ', 'GET_M44_XW', 'GET_M44_YX', 'GET_M44_YY', 'GET_M44_YZ', 'GET_M44_YW',
  'GET_M44_ZX', 'GET_M44_ZY', 'GET_M44_ZZ', 'GET_M44_ZW', 'GET_M44_WX', 'GET_M44_WY', 'GET_M44_WZ', 'GET_M44_WW',
  'GET_M44_rX', 'GET_M44_rY', 'GET_M44_rZ', 'GET_M44_rW', 'GET_M44_cX', 'GET_M44_cY', 'GET_M44_cZ', 'GET_M44_cW',
  'SET_V4_X', 'SET_V4_Y', 'SET_V4_Z', 'SET_V4_W',
  'SET_M44_XX', 'SET_M44_XY', 'SET_M44_XZ', 'SET_M44_XW', 'SET_M44_YX', 'SET_M44_YY', 'SET_M44_YZ', 'SET_M44_YW',
  'SET_M44_ZX', 'SET_M44_ZY', 'SET_M44_ZZ', 'SET_M44_ZW', 'SET_M44_WX', 'SET_M44_WY', 'SET_M44_WZ', 'SET_M44_WW',
  'SET_M44_rX', 'SET_M44_rY', 'SET_M44_rZ', 'SET_M44_rW', 'SET_M44_cX', 'SET_M44_cY', 'SET_M44_cZ', 'SET_M44_cW',
  'GET_SP_MEMBER', 'GET_RP_MEMBER', 'SET_SP_MEMBER', 'SET_RP_MEMBER', 'GET_ELEMENT', 'SET_ELEMENT',
  'GET_ARRAY_LEN', 'NEW_ARRAY', 'ARRAY_INSERT', 'ARRAY_APPEND', 'ARRAY_ERASE', 'ARRAY_FIND', 'ARRAY_CLEAR',
  'WRITE', 'ARG', 'CALL', 'RETURN', 'B', 'BEZ', 'BNEZ', 'CASTsp', 'INTb', 'INTc', 'INTf', 'FLOATb', 'FLOATc',
  'FLOATi', 'BOOLc', 'BOOLi', 'BOOLf', 'GET_OBJ_MEMBER', 'SET_OBJ_MEMBER', 'NEW_OBJECT', 'ARRAY_RESIZE',
  'ARRAY_RESERVE', 'LCv4', 'LC_NULLo', 'CASTo', 'GET_SP_NATIVE_MEMBER', 'LCsa', 'BIT_ORb', 'BIT_ANDb', 'BIT_XORb',
  'CALLVo', 'CALLVsp', 'ASSERT', 'LCs64', 'MOVs64', 'ADDs64', 'EQs64', 'NEs64', 'BIT_ORs64', 'BIT_ANDs64',
  'BIT_XORs64',
];

/** cwlib's `InstructionClass`: how an instruction's fields are packed. */
export type InstructionClass =
  | 'nop' | 'loadConst' | 'unary' | 'binary' | 'getBuiltinMember' | 'setBuiltinMember' | 'getMember'
  | 'setMember' | 'getElement' | 'setElement' | 'newObject' | 'newArray' | 'write' | 'arg' | 'call'
  | 'return' | 'branch' | 'cast';

/** By opcode, built as cwlib builds its `INSTRUCTION_CLASSES`. */
const CLASSES: readonly InstructionClass[] = (() => {
  const out: InstructionClass[] = [];
  const add = (n: number, c: InstructionClass): void => {
    for (let i = 0; i < n; i += 1) out.push(c);
  };
  add(1, 'nop'); add(6, 'loadConst'); add(20, 'unary'); add(1, 'nop'); add(4, 'unary'); add(50, 'binary');
  add(2, 'nop'); add(6, 'binary'); add(31, 'getBuiltinMember'); add(28, 'setBuiltinMember'); add(2, 'getMember');
  add(2, 'setMember'); add(1, 'getElement'); add(1, 'setElement'); add(1, 'getBuiltinMember'); add(1, 'newArray');
  add(3, 'setElement'); add(1, 'getElement'); add(1, 'setElement'); add(1, 'write'); add(1, 'arg'); add(1, 'call');
  add(1, 'return'); add(3, 'branch'); add(1, 'cast'); add(9, 'unary'); add(1, 'getMember'); add(1, 'setMember');
  add(1, 'newObject'); add(2, 'setElement'); add(2, 'loadConst'); add(1, 'cast'); add(1, 'getMember');
  add(1, 'loadConst'); add(3, 'binary'); add(2, 'call'); add(1, 'write'); add(1, 'loadConst'); add(1, 'unary');
  add(6, 'binary');
  return out;
})();

/** One decoded instruction: its opcode, name and class, and the class's fields. */
export type Instruction = { readonly opcode: number; readonly name: string } & (
  | { readonly class: 'nop' }
  /**
   * `index` into a pool for `LCsw` (`stringW`), `LCsa` (`stringA`), `LCs64`
   * (`constantsS64`) and `LCv4` -- a float's index in `constantsF32`, a multiple
   * of 4 on all 1,339 of the game's; the value itself for `LCb`/`LCc`/`LCi`/`LCf`.
   */
  | { readonly class: 'loadConst'; readonly dest: number; readonly value: number | boolean; readonly index: number }
  | { readonly class: 'unary'; readonly dest: number; readonly source: number }
  | { readonly class: 'binary'; readonly dest: number; readonly a: number; readonly b: number }
  | { readonly class: 'getBuiltinMember'; readonly dest: number; readonly base: number }
  | { readonly class: 'setBuiltinMember'; readonly source: number; readonly base: number }
  /** `field` into `fieldReferences`. */
  | { readonly class: 'getMember'; readonly dest: number; readonly base: number; readonly field: number; readonly machineType: number }
  | { readonly class: 'setMember'; readonly source: number; readonly base: number; readonly field: number; readonly machineType: number }
  | { readonly class: 'getElement'; readonly dest: number; readonly base: number; readonly source: number; readonly machineType: number }
  | { readonly class: 'setElement'; readonly source: number; readonly base: number; readonly index: number; readonly machineType: number }
  /** `type` into `typeReferences`. */
  | { readonly class: 'newObject'; readonly dest: number; readonly type: number }
  | { readonly class: 'newArray'; readonly dest: number; readonly size: number; readonly type: number }
  | { readonly class: 'write'; readonly source: number; readonly machineType: number }
  | { readonly class: 'arg'; readonly source: number; readonly argument: number; readonly machineType: number }
  /** `call` into `functionReferences`. */
  | { readonly class: 'call'; readonly dest: number; readonly call: number; readonly machineType: number }
  | { readonly class: 'return'; readonly source: number; readonly machineType: number }
  /** `offset` is signed, in instructions. */
  | { readonly class: 'branch'; readonly source: number; readonly offset: number }
  | { readonly class: 'cast'; readonly dest: number; readonly source: number; readonly type: number }
);

/** Decode one instruction word. Throws on an opcode past cwlib's table. */
export function decodeInstruction(word: bigint): Instruction {
  const lo = Number(word & 0xffffffffn);
  const hi = Number(word >> 32n);
  const opcode = lo & 0xff;
  const name = INSTRUCTION_NAMES[opcode];
  const cls = CLASSES[opcode];
  if (name === undefined || cls === undefined) throw new Error(`script opcode 0x${opcode.toString(16)} is past the table`);
  const machineType = (lo >>> 8) & 0xff;
  const mid = (lo >>> 16) & 0xffff; // dest, or the source of a store
  const h0 = hi & 0xffff; // bits 32-47
  const h1 = (hi >>> 16) & 0xffff; // bits 48-63
  const s16 = (v: number): number => (v << 16) >> 16;
  const base = { opcode, name } as const;
  switch (cls) {
    case 'nop': return { ...base, class: cls };
    case 'loadConst': {
      const view = new DataView(new ArrayBuffer(4));
      view.setUint32(0, hi >>> 0);
      let value: number | boolean = hi | 0;
      if (name === 'LCb') value = hi >>> 31 !== 0;
      else if (name === 'LCc') value = h1;
      else if (name === 'LCf') value = view.getFloat32(0);
      return { ...base, class: cls, dest: s16(mid), value, index: hi | 0 };
    }
    case 'unary': return { ...base, class: cls, dest: s16(mid), source: s16(h0) };
    case 'binary': return { ...base, class: cls, dest: s16(mid), a: s16(h0), b: s16(h1) };
    case 'getBuiltinMember': return { ...base, class: cls, dest: s16(mid), base: s16(h0) };
    case 'setBuiltinMember': return { ...base, class: cls, source: s16(mid), base: s16(h0) };
    case 'getMember': return { ...base, class: cls, dest: s16(mid), base: s16(h0), field: s16(h1), machineType };
    case 'setMember': return { ...base, class: cls, source: s16(mid), base: s16(h0), field: s16(h1), machineType };
    case 'getElement': return { ...base, class: cls, dest: s16(mid), base: s16(h0), source: s16(h1), machineType };
    case 'setElement': return { ...base, class: cls, source: s16(mid), base: s16(h0), index: s16(h1), machineType };
    case 'newObject': return { ...base, class: cls, dest: s16(mid), type: s16(h1) };
    case 'newArray': return { ...base, class: cls, dest: s16(mid), size: s16(h0), type: s16(h1) };
    case 'write': return { ...base, class: cls, source: s16(h0), machineType };
    case 'arg': return { ...base, class: cls, source: s16(mid), argument: s16(h0), machineType };
    case 'call': return { ...base, class: cls, dest: s16(mid), call: s16(h0), machineType };
    case 'return': return { ...base, class: cls, source: s16(h0), machineType };
    case 'branch': return { ...base, class: cls, source: s16(mid), offset: hi | 0 };
    case 'cast': return { ...base, class: cls, dest: s16(mid), source: s16(h0), type: s16(h1) };
  }
}
