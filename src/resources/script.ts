/**
 * `RScript` -- a compiled Fish script: magic `FSHb`, FileDB paths `….ff`.
 * One class: its name and superclass, the tables of the types, fields and
 * functions it names and defines, one shared run of 64-bit instructions that
 * every function's range indexes, line numbers, locals, the string and
 * constant pools, and the GUIDs it depends on.
 *
 * The walk is cwlib's `resources/RScript.java` and `structs/script/*`
 * (ennuo/toolkit `d6a2ef8`). The instructions are kept as their 64 bits:
 * the opcode is the low byte. What the game's own files prove of it is
 * steering/level-files.md, *Scripts* (`dev/script-census.ts`).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type ResourceRef, type RevisionInfo, type Serializer } from '../io/serializer.ts';

/** A type the script names: a machine type, a Fish type, and for a class the script that defines it. */
export interface TypeReference {
  readonly machineType: number;
  readonly fishType: number;
  readonly dimensionCount: number;
  readonly arrayBaseMachineType: number;
  readonly script: ResourceRef | undefined;
  /** Into `stringA`. */
  readonly typeName: number;
}

/** A field or function of another class: indices into `typeReferences` and `stringA`. */
export interface MemberReference {
  readonly type: number;
  readonly name: number;
}

export interface FieldDefinition extends MemberReference {
  /** cwlib's `ModifierType` bits. */
  readonly modifiers: number;
}

export interface PropertyDefinition extends FieldDefinition {
  /** Into `functionDefinitions`, -1 for none. */
  readonly getFunction: number;
  readonly setFunction: number;
}

/** A function: each range is `[begin, end)` into the shared tables. */
export interface FunctionDefinition extends FieldDefinition {
  readonly arguments: readonly [number, number];
  readonly bytecode: readonly [number, number];
  readonly lineNos: readonly [number, number];
  readonly localVariables: readonly [number, number];
  readonly stackSize: number;
}

export interface TypeOffset {
  readonly type: number;
  readonly offset: number;
}

export interface LocalVariable extends FieldDefinition {
  readonly offset: number;
}

export interface Script {
  readonly revision: RevisionInfo;
  readonly className: string;
  readonly superClassScript: ResourceRef | undefined;
  readonly modifiers: number;
  readonly typeReferences: readonly TypeReference[];
  readonly fieldReferences: readonly MemberReference[];
  readonly functionReferences: readonly MemberReference[];
  readonly fieldDefinitions: readonly FieldDefinition[];
  readonly propertyDefinitions: readonly PropertyDefinition[];
  readonly functionDefinitions: readonly FunctionDefinition[];
  readonly sharedArguments: readonly TypeOffset[];
  /** One instruction per entry, as stored; the low byte is the opcode. */
  readonly bytecode: BigUint64Array;
  readonly lineNos: Int16Array;
  readonly localVariables: readonly LocalVariable[];
  /** The ASCII string pool: names, every `name` and `typeName` above indexes it. */
  readonly stringA: readonly string[];
  /** The UTF-16 string pool: the script's wide string constants. */
  readonly stringW: readonly string[];
  /** Version `0x30c` on. */
  readonly constantsS64: readonly bigint[];
  readonly constantsF32: Float32Array;
  readonly dependingGuids: readonly number[];
}

/** cwlib's modifier flags: an `i16` from `0x3d9`, an `i32` before. */
function modifiers(s: Serializer): number {
  return s.revision.version >= 0x3d9 ? s.i16() : s.i32();
}

function readTypeReference(s: Serializer): TypeReference {
  return {
    machineType: s.u8(), fishType: s.u8(), dimensionCount: s.i8(), arrayBaseMachineType: s.u8(),
    script: s.resource(), typeName: s.i32(),
  };
}

const member = (s: Serializer): MemberReference => ({ type: s.i32(), name: s.i32() });
const field = (s: Serializer): FieldDefinition => ({ modifiers: modifiers(s), type: s.i32(), name: s.i32() });

function readFunction(s: Serializer): FunctionDefinition {
  const head = field(s);
  // From 0x3d9 each range is a u16 begin and a u16 length; before, two i32 bounds.
  const wide = s.revision.version < 0x3d9;
  const range = (): [number, number] => {
    if (wide) return [s.i32(), s.i32()];
    const begin = s.u16();
    return [begin, begin + s.u16()];
  };
  return { ...head, arguments: range(), bytecode: range(), lineNos: range(), localVariables: range(), stackSize: s.i32() };
}

/**
 * A string pool: the start of each string, then the pool. Each string runs to
 * the next one's start, the last to the pool's end, and loses its NULs.
 */
function pool(starts: readonly number[], end: number, at: (i: number) => string): string[] {
  for (let i = 0; i < starts.length; i += 1) {
    const next = i + 1 < starts.length ? starts[i + 1]! : end;
    if (starts[i]! < 0 || starts[i]! > next) throw new SerializerError(`a script's string ${i} starts at ${starts[i]}, past ${next}`);
  }
  return starts.map((_, i) => at(i).replaceAll('\0', ''));
}

/** Read an `FSHb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readScript(bytes: Uint8Array, inflate: Inflate): Promise<Script> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'FSHb') throw new SerializerError(`not a script: "${resource.magic}"`);
  const { version } = revision;
  // cwlib: "Inline script format not supported!"
  if (version <= 0x1eb) throw new SerializerError(`a script at 0x${version.toString(16)}: the inline format is not read`);

  if (version <= 0x360) s.resource(); // upToDateScript
  const className = s.str();
  const superClassScript = s.resource();
  const classModifiers = modifiers(s);
  const typeReferences = s.array(readTypeReference);
  const fieldReferences = s.array(member);
  const functionReferences = s.array(member);
  const fieldDefinitions = s.array(field);
  const propertyDefinitions = s.array((x): PropertyDefinition => ({ ...field(x), getFunction: x.i32(), setFunction: x.i32() }));
  const functionDefinitions = s.array(readFunction);
  const sharedArguments = s.array((x): TypeOffset => ({ type: x.i32(), offset: x.i32() }));
  const bytecode = new BigUint64Array(s.count());
  for (let i = 0; i < bytecode.length; i += 1) bytecode[i] = s.u64Big();
  const lineNos = new Int16Array(s.count());
  for (let i = 0; i < lineNos.length; i += 1) lineNos[i] = s.i16();
  const localVariables = s.array((x): LocalVariable => ({ ...field(x), offset: x.i32() }));

  const aStarts = s.intVector();
  const aPool = s.bytes(s.count());
  const stringA = pool(aStarts, aPool.length, (i) => {
    const end = i + 1 < aStarts.length ? aStarts[i + 1]! : aPool.length;
    return String.fromCharCode(...aPool.subarray(aStarts[i], end));
  });
  const wStarts = s.intVector();
  const wPool = s.bytes(s.count() * 2);
  const wLength = wPool.length / 2;
  const stringW = pool(wStarts, wLength, (i) => {
    const end = i + 1 < wStarts.length ? wStarts[i + 1]! : wLength;
    let out = '';
    for (let c = wStarts[i]!; c < end; c += 1) out += String.fromCharCode((wPool[c * 2]! << 8) | wPool[c * 2 + 1]!);
    return out;
  });

  const constantsS64 = version >= 0x30c ? s.longVector() : [];
  const constantsF32 = new Float32Array(s.count());
  for (let i = 0; i < constantsF32.length; i += 1) constantsF32[i] = s.f32();
  const dependingGuids = version >= 0x1ec ? s.array((x) => x.guid()) : [];

  if (s.remaining !== 0) {
    throw new SerializerError(`FSHb read ended ${s.remaining} bytes before the end of its payload`);
  }
  return {
    revision, className, superClassScript, modifiers: classModifiers, typeReferences, fieldReferences,
    functionReferences, fieldDefinitions, propertyDefinitions, functionDefinitions, sharedArguments,
    bytecode, lineNos, localVariables, stringA, stringW, constantsS64, constantsF32, dependingGuids,
  };
}
