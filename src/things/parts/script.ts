/** `SCRIPT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/**
 * The id each shared object -- a layout, a boxed object, an instance behind a
 * reference -- had in the file it was read from, so a writer names it the same.
 * A `WeakMap` rather than a field: the values stay what they were, and an object
 * made here has none and is numbered afresh.
 */
const IDS = new WeakMap<object, number>();

/**
 * The tape object each shared object was read as, where the stream was read
 * onto a tape (`io/tape.ts`).
 *
 * ❗ **A writer has to name a shared object by the same key the tape does.** A
 * Thing a script field points at is written through the tape (`ctx.thing`), and
 * its own scripts' layouts and boxed objects go with it as tape objects; the
 * same layout written here from its value is a second JavaScript object under
 * the same id, so the `Writer` took the id as taken and renumbered whichever
 * came second -- 13,007 of the game's 73,267 `PScript`s, until both sides
 * used the tape object as the key. An instance behind a reference is mapped by
 * the tape itself (`objectOf`); a layout or boxed object, behind a pointer, has
 * no value on the tape, so it is looked up by its id.
 */
const TAPED = new WeakMap<object, object>();

/** The tape object read for reference id `id`. ⚠️ `Tape.objects` is private: the tape has no public lookup by id. */
function tapeObjectAt(s: Serializer, id: number): object | undefined {
  return s.tape?.objectAt(id);
}

/** A shared object by reference: under its tape object's key where it has one, its file's id, its body from its value. */
function writeShared<T extends object>(w: Writer, value: T | undefined, body: (self: Writer, value: T) => void): void {
  if (!value) {
    w.reference(undefined, () => {});
    return;
  }
  w.reference<object>(TAPED.get(value) ?? value, (self) => body(self, value), IDS.get(value));
}

/** The id the next `i32` holds, without consuming it: what `s.reference` is about to read. */
function peekId(s: Serializer): number {
  const at = s.position;
  const id = s.i32();
  s.position = at;
  return id;
}

/** `MachineType`: how a script field's value is stored. */
const MACHINE_BOOL = 0x1;

const MACHINE_CHAR = 0x2;

const MACHINE_S32 = 0x3;

const MACHINE_F32 = 0x4;

const MACHINE_V4 = 0x5;

const MACHINE_M44 = 0x6;

const MACHINE_OBJECT_REF = 0xb;

const MACHINE_SAFE_PTR = 0xa;

/** `ModifierType.DIVERGENT` is bit 0xc of the modifier flags. */
const MODIFIER_DIVERGENT = 1 << 0xc;

/** One field of a script instance's layout, as the stream describes it. */
export interface ScriptFieldLayout {
  readonly name: string;
  /** cwlib's `ModifierType` flags, as stored (an `i16` from 0x3d9, an `i32` below). */
  readonly modifiers: number;
  /** cwlib's `MachineType`: 1 bool, 2 char, 3 s32, 4 f32, 5 v4, 6 m44, 10 a Thing, 11 a boxed object. */
  readonly machineType: number;
  /** cwlib's `BuiltinType`, the type the script declares; 0 below version 0x145. */
  readonly fishType: number;
  readonly divergent: boolean;
  readonly dimensionCount: number;
  readonly arrayBaseMachineType: number;
  readonly instanceOffset: number;
}

/**
 * A boxed value in a script field: `ScriptObjectType` and what it holds. The
 * same object, met twice through its pointer, is the same JavaScript value.
 */
export type ScriptObject =
  | { readonly type: 'bools'; readonly values: readonly boolean[] }
  | { readonly type: 's32s'; readonly values: readonly number[] }
  | { readonly type: 'f32s'; readonly values: readonly number[] }
  | { readonly type: 'vector4s'; readonly values: readonly (readonly [number, number, number, number])[] }
  | { readonly type: 'things'; readonly values: readonly (Thing | undefined)[] }
  | { readonly type: 'objects'; readonly values: readonly (ScriptObject | undefined)[] }
  /** `resourceType` is cwlib's `ResourceType`; 0 is none, and no descriptor follows. */
  | { readonly type: 'resource'; readonly resourceType: number; readonly resource?: ResourceRef }
  | { readonly type: 'instance'; readonly instance?: ScriptInstance }
  | { readonly type: 'stringW'; readonly value: string }
  | { readonly type: 'stringA'; readonly value: string }
  /** An audio handle has no bytes: nothing survives the save. */
  | { readonly type: 'audioHandle' };

/** What one field holds, by its machine type: a `Float32Array` for a matrix, column-major like `PPos`. */
export type ScriptValue =
  | boolean
  | number
  | readonly [number, number, number, number]
  | Float32Array
  | Thing
  | ScriptObject
  | undefined;

export interface ScriptField extends ScriptFieldLayout {
  /**
   * The field's value. ⚠️ A `DIVERGENT` field is in the layout and **not in the
   * stream** unless the instance reflects divergent fields: then `stored` is
   * false and `value` undefined.
   */
  readonly stored: boolean;
  readonly value: ScriptValue;
}

/** `ScriptInstance`: a script and the values of its reflected fields. */
export interface ScriptInstance {
  /** The `RScript` (`FSHb`) -- `readScript` in `resources/script.ts` reads it. */
  readonly script?: ResourceRef;
  /** Empty when the instance is not serialised or has no layout. */
  readonly fields: readonly ScriptField[];
  /** The layout's instance size, where the instance has a layout. */
  readonly instanceSize?: number;
  /** From version 0x1a1, whether the instance is stored at all (cwlib's `serialize`). */
  readonly serialize?: boolean;
  /**
   * cwlib's `InstanceLayout`, the one object every instance of a script shares
   * by pointer: kept by identity, so a writer names it once and points after.
   */
  readonly layout?: ScriptLayout;
  /** From version 0x19d, whether `DIVERGENT` fields are in the value stream. */
  readonly reflectDivergent?: boolean;
  /** On a `PScript` between versions 0x17a and 0x1a0: the bool cwlib calls "unknown", kept where true. */
  readonly unknown?: boolean;
}

/** cwlib's `InstanceLayout`: the field table, shared by pointer. */
export interface ScriptLayout {
  readonly fields: readonly ScriptFieldLayout[];
  readonly instanceSize: number;
  /** Below version 0x1ec, the reflection table: a field's name and its index. */
  readonly reflection?: readonly { readonly name: string; readonly index: number }[];
}

/**
 * `FieldLayoutDetails`: the name, type and modifiers of one script field.
 *
 * ⚠️ **At 0x3d9 the record stops being enums and becomes bytes**, and reading
 * the new one with the old code is invisible on a compressed stream: an `enum32`
 * is a varint there, and a machine type below 128 takes exactly the one byte a
 * `u8` would. The first UNCOMPRESSED resource -- a streaming island's plan --
 * read nine bytes too many per field and landed in the middle of the next
 * field's name, which is how "read of 1634429294 bytes" (`aimn`, out of a
 * script's own text) turned out to mean this. 101 of the corpus's 2,553 islands.
 */
function readFieldLayout(s: Serializer): ScriptFieldLayout {
  const { version } = s.revision;
  const name = s.str();
  if (version >= 0x3d9) {
    const flags = s.i16();
    const machineType = s.u8();
    const fishType = s.u8();
    const dimensionCount = s.i8();
    const arrayBaseMachineType = s.u8();
    const instanceOffset = s.i32();
    const divergent = (flags & MODIFIER_DIVERGENT) !== 0;
    return { name, modifiers: flags, machineType, fishType, divergent, dimensionCount, arrayBaseMachineType, instanceOffset };
  }
  const flags = s.i32();
  const machineType = s.i32();
  const fishType = version >= 0x145 ? s.i32() : 0;
  const dimensionCount = s.i8();
  const arrayBaseMachineType = s.i32();
  const instanceOffset = s.i32();
  const divergent = (flags & MODIFIER_DIVERGENT) !== 0;
  return { name, modifiers: flags, machineType, fishType, divergent, dimensionCount, arrayBaseMachineType, instanceOffset };
}

/** `readFieldLayout`'s mirror. */
function writeFieldLayout(w: Writer, field: ScriptFieldLayout): void {
  w.str(field.name);
  if (w.revision.version >= 0x3d9) {
    w.i16(field.modifiers);
    w.u8(field.machineType);
    w.u8(field.fishType);
    w.i8(field.dimensionCount);
    w.u8(field.arrayBaseMachineType);
    w.i32(field.instanceOffset);
    return;
  }
  w.i32(field.modifiers);
  w.i32(field.machineType);
  if (w.revision.version >= 0x145) w.i32(field.fishType);
  w.i8(field.dimensionCount);
  w.i32(field.arrayBaseMachineType);
  w.i32(field.instanceOffset);
}

/**
 * `ScriptInstance`: a script and the values of its reflected fields.
 *
 * ⚠️ **This is the only part of the format that is genuinely self-describing,
 * and it is the only one where the layout is data.** The stream carries a field
 * table — name, modifiers, machine type — and then one value per field, sized by
 * that type. There is no way to read the values without having read the table,
 * and no way to skip a field whose type is unknown.
 *
 * ⚠️ The layout is behind a **pointer**, not a reference: the id is read raw and
 * a repeat means "the same layout as before", which for a level full of copies
 * of one script is most of them. Treating it as a plain inline struct would
 * re-read a table that is not there.
 *
 * `DIVERGENT` fields are in the table but **not** in the value stream unless the
 * `reflectDivergent` flag that precedes it says so.
 */
function readScriptInstance(s: Serializer, readers: ReadonlyMap<string, PartReader>): ScriptInstance {
  const { version } = s.revision;
  const script = s.resource();

  let serialize = true;
  if (version > 0x1a0) serialize = s.bool();
  if (!serialize) return { script, fields: [], serialize };

  // A layout is written once and named by pointer after; its instance size with it.
  const { id: pointer } = s.pointer((self, id) => {
    const fields: ScriptFieldLayout[] = [];
    const count = self.count();
    for (let i = 0; i < count; i += 1) fields.push(readFieldLayout(self));
    // Below 0x1ec the layout carries a reflection table: a name and an index each
    // (cwlib's `InstanceLayout`). Without it the LBP1 scripts read it as values.
    let reflection: { name: string; index: number }[] | undefined;
    if (self.revision.version < 0x1ec) {
      reflection = [];
      const names = self.count();
      for (let i = 0; i < names; i += 1) reflection.push({ name: self.str(), index: self.i32() });
    }
    const layout: ScriptLayout = reflection
      ? { fields, reflection, instanceSize: self.i32() }
      : { fields, instanceSize: self.i32() };
    IDS.set(layout, id);
    const taped = tapeObjectAt(self, id);
    if (taped) TAPED.set(layout, taped);
    self.pointers.set(id, layout);
  });
  if (pointer === 0) return { script, fields: [], serialize };
  const layout = s.pointers.get(pointer) as ScriptLayout;
  const { instanceSize } = layout;

  const reflectDivergent = version > 0x19c ? s.bool() : false;
  const fields: ScriptField[] = [];
  for (const field of layout.fields) {
    if (field.divergent && !reflectDivergent) {
      fields.push({ ...field, stored: false, value: undefined });
      continue;
    }
    if (version > 0x198 && version < 0x19d) s.u8(); // cwlib's `ScriptInstance` writes 0
    let value: ScriptValue;
    switch (field.machineType) {
      case MACHINE_BOOL:
        value = s.bool();
        break;
      case MACHINE_CHAR:
        value = s.i16();
        break;
      case MACHINE_S32:
        value = s.i32();
        break;
      case MACHINE_F32:
        value = s.f32();
        break;
      case MACHINE_V4:
        value = s.vector4();
        break;
      case MACHINE_M44:
        value = s.matrix();
        break;
      case MACHINE_SAFE_PTR:
        value = readThingRef(s, readers);
        break;
      case MACHINE_OBJECT_REF:
        value = readScriptObject(s, readers);
        break;
      default:
        throw new SerializerError(
          `script field machine type 0x${field.machineType.toString(16)} has no reader`,
        );
    }
    fields.push({ ...field, stored: true, value });
  }
  return { script, fields, instanceSize, serialize, layout, reflectDivergent };
}

/** `readScriptInstance`'s mirror: the layout by pointer, then each stored field's value. */
function writeScriptInstance(w: Writer, instance: ScriptInstance, ctx: PartWriteContext): void {
  const { version } = w.revision;
  w.ref(instance.script);
  const layout = instance.layout;
  const serialize = instance.serialize ?? true;
  if (version > 0x1a0) w.bool(serialize);
  if (!serialize) return;
  writeShared(w, layout, (self, value) => {
    self.i32(value.fields.length);
    for (const field of value.fields) writeFieldLayout(self, field);
    if (self.revision.version < 0x1ec) {
      const reflection = value.reflection ?? [];
      self.i32(reflection.length);
      for (const { name, index } of reflection) {
        self.str(name);
        self.i32(index);
      }
    }
    self.i32(value.instanceSize);
  });
  if (!layout) return;
  if (version > 0x19c) w.bool(instance.reflectDivergent ?? false);
  for (const field of instance.fields) {
    if (!field.stored) continue;
    if (version > 0x198 && version < 0x19d) w.u8(0);
    const value = field.value;
    switch (field.machineType) {
      case MACHINE_BOOL:
        w.bool(value as boolean);
        break;
      case MACHINE_CHAR:
        w.i16(value as number);
        break;
      case MACHINE_S32:
        w.i32(value as number);
        break;
      case MACHINE_F32:
        w.f32(value as number);
        break;
      case MACHINE_V4:
        w.vector4(value as readonly number[]);
        break;
      case MACHINE_M44:
        w.matrix(value as Float32Array);
        break;
      case MACHINE_SAFE_PTR:
        ctx.thing(w, value as Thing | undefined);
        break;
      case MACHINE_OBJECT_REF:
        writeScriptObject(w, value as ScriptObject | undefined, ctx);
        break;
      default:
        throw new SerializerError(`script field machine type 0x${field.machineType.toString(16)} has no writer`);
    }
  }
}

/** `PScript`: a script attached to a Thing, and its fields' values. */
export function readScript(s: Serializer, readers: ReadonlyMap<string, PartReader>): ScriptInstance {
  const { version } = s.revision;
  // cwlib's `PScript`: "unknown", written false -- but one LBP1 chunk holds true.
  const unknown = version > 0x179 && version < 0x1a1 ? s.bool() : undefined;
  const instance = readScriptInstance(s, readers);
  return unknown ? { ...instance, unknown } : instance;
}

/** `readScript`'s mirror: the unknown bool (cwlib writes false), then the instance. */
export function writeScript(w: Writer, instance: ScriptInstance, ctx: PartWriteContext): void {
  const { version } = w.revision;
  if (version > 0x179 && version < 0x1a1) w.bool(instance.unknown ?? false);
  writeScriptInstance(w, instance, ctx);
}

/** `ScriptObjectType`: what a boxed script value holds. */
const OBJ_NULL = 0;

const OBJ_ARRAY_BOOL = 1;

const OBJ_ARRAY_S32 = 3;

const OBJ_ARRAY_F32 = 4;

const OBJ_ARRAY_VECTOR4 = 5;

const OBJ_ARRAY_SAFE_PTR = 10;

const OBJ_ARRAY_OBJECT_REF = 11;

const OBJ_RESOURCE = 12;

const OBJ_INSTANCE = 13;

const OBJ_STRINGW = 14;

const OBJ_AUDIOHANDLE = 15;

const OBJ_STRINGA = 16;

/** The boxed objects a stream has met, by pointer, beside the layouts in `Serializer.pointers`. */
const OBJECTS = new WeakMap<Serializer, Map<number, ScriptObject>>();

/**
 * `ScriptObject`: a boxed value in a script field.
 *
 * ⚠️ Pointer-shared like the field layout, and for the same reason — one array
 * can be referenced by many scripts. `AUDIOHANDLE` is a type with **no bytes at
 * all**: it reads its id and stops.
 */
function readScriptObject(s: Serializer, readers: ReadonlyMap<string, PartReader>): ScriptObject | undefined {
  const type = s.i32();
  if (type === OBJ_NULL) return undefined;
  if (type === OBJ_INSTANCE) {
    const id = peekId(s);
    const instance = s.reference((self) => readScriptInstance(self, readers));
    if (instance) {
      IDS.set(instance, id);
      const taped = s.tape?.objectOf(instance);
      if (taped) TAPED.set(instance, taped);
    }
    return { type: 'instance', instance };
  }
  const shared = OBJECTS.get(s) ?? OBJECTS.set(s, new Map()).get(s)!;
  const { id } = s.pointer((self, pointer) => {
    self.pointers.set(pointer, true);
    const object = readScriptObjectBody(self, type, readers);
    IDS.set(object, pointer);
    const taped = tapeObjectAt(self, pointer);
    if (taped) TAPED.set(object, taped);
    shared.set(pointer, object);
  });
  return id === 0 ? undefined : shared.get(id);
}

const OBJECT_TYPES: Record<ScriptObject['type'], number> = {
  bools: OBJ_ARRAY_BOOL, s32s: OBJ_ARRAY_S32, f32s: OBJ_ARRAY_F32, vector4s: OBJ_ARRAY_VECTOR4,
  things: OBJ_ARRAY_SAFE_PTR, objects: OBJ_ARRAY_OBJECT_REF, resource: OBJ_RESOURCE, instance: OBJ_INSTANCE,
  stringW: OBJ_STRINGW, audioHandle: OBJ_AUDIOHANDLE, stringA: OBJ_STRINGA,
};

/** `readScriptObject`'s mirror: the type, then the object by pointer (an instance by reference). */
function writeScriptObject(w: Writer, object: ScriptObject | undefined, ctx: PartWriteContext): void {
  if (!object) {
    w.i32(OBJ_NULL);
    return;
  }
  w.i32(OBJECT_TYPES[object.type]);
  if (object.type === 'instance') {
    const { instance } = object;
    writeShared(w, instance, (self, value) => writeScriptInstance(self, value, ctx));
    return;
  }
  writeShared(w, object, (self, value) => writeScriptObjectBody(self, value, ctx));
}

/** `readScriptObjectBody`'s mirror. An audio handle writes nothing after its id. */
function writeScriptObjectBody(w: Writer, object: ScriptObject, ctx: PartWriteContext): void {
  switch (object.type) {
    case 'bools':
      w.i32(object.values.length);
      for (const value of object.values) w.bool(value);
      break;
    case 's32s':
      w.intVector(object.values, true);
      break;
    case 'f32s':
      w.i32(object.values.length);
      for (const value of object.values) w.f32(value);
      break;
    case 'vector4s':
      w.i32(object.values.length);
      for (const value of object.values) w.vector4(value);
      break;
    case 'stringW':
      w.wstr(object.value);
      break;
    case 'stringA':
      w.str(object.value);
      break;
    case 'resource':
      w.i32(object.resourceType);
      if (object.resourceType !== 0) w.ref(object.resource);
      break;
    case 'audioHandle':
      break;
    case 'things':
      w.i32(object.values.length);
      for (const value of object.values) ctx.thing(w, value);
      break;
    case 'objects':
      w.i32(object.values.length);
      for (const value of object.values) writeScriptObject(w, value, ctx);
      break;
    case 'instance':
      throw new SerializerError('a script instance is not a pointer-shared object');
  }
}

/** A boxed object's bytes after its pointer, on its first mention. */
function readScriptObjectBody(s: Serializer, type: number, readers: ReadonlyMap<string, PartReader>): ScriptObject {
  let object: ScriptObject;
  switch (type) {
    case OBJ_ARRAY_BOOL:
      object = { type: 'bools', values: s.array((self) => self.bool()) };
      break;
    case OBJ_ARRAY_S32:
      // A signed vector in cwlib (`ScriptObjectUID`): zigzagged when compressed.
      object = { type: 's32s', values: s.intVector(true) };
      break;
    case OBJ_ARRAY_F32:
      object = { type: 'f32s', values: s.array((self) => self.f32()) };
      break;
    case OBJ_ARRAY_VECTOR4:
      object = { type: 'vector4s', values: s.array((self) => self.vector4()) };
      break;
    case OBJ_STRINGW:
      object = { type: 'stringW', value: s.wstr() };
      break;
    case OBJ_STRINGA:
      object = { type: 'stringA', value: s.str() };
      break;
    case OBJ_RESOURCE: {
      // The resource's own type is written first, and `INVALID` means no
      // descriptor follows at all.
      const resourceType = s.i32();
      object = { type: 'resource', resourceType, resource: resourceType !== 0 ? s.resource() : undefined };
      break;
    }
    case OBJ_AUDIOHANDLE:
      object = { type: 'audioHandle' };
      break;
    case OBJ_ARRAY_SAFE_PTR:
      object = { type: 'things', values: s.array((self) => readThingRef(self, readers)) };
      break;
    case OBJ_ARRAY_OBJECT_REF:
      object = { type: 'objects', values: s.array((self) => readScriptObject(self, readers)) };
      break;
    default:
      throw new SerializerError(`script object type ${type} has no reader`);
  }
  return object;
}
