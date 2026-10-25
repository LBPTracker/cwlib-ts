/** `SCRIPT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError, type ResourceRef } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';

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
    return { name, machineType, fishType, divergent, dimensionCount, arrayBaseMachineType, instanceOffset };
  }
  const flags = s.i32();
  const machineType = s.i32();
  const fishType = version >= 0x145 ? s.i32() : 0;
  const dimensionCount = s.i8();
  const arrayBaseMachineType = s.i32();
  const instanceOffset = s.i32();
  const divergent = (flags & MODIFIER_DIVERGENT) !== 0;
  return { name, machineType, fishType, divergent, dimensionCount, arrayBaseMachineType, instanceOffset };
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
  if (!serialize) return { script, fields: [] };

  // A layout is written once and named by pointer after; its instance size with it.
  const { id: pointer } = s.pointer((self, id) => {
    const fields: ScriptFieldLayout[] = [];
    const count = self.count();
    for (let i = 0; i < count; i += 1) fields.push(readFieldLayout(self));
    self.pointers.set(id, { layout: fields, instanceSize: self.i32() });
  });
  if (pointer === 0) return { script, fields: [] };
  const { layout, instanceSize } = s.pointers.get(pointer) as { layout: ScriptFieldLayout[]; instanceSize: number };

  const reflectDivergent = version > 0x19c ? s.bool() : false;
  const fields: ScriptField[] = [];
  for (const field of layout) {
    if (field.divergent && !reflectDivergent) {
      fields.push({ ...field, stored: false, value: undefined });
      continue;
    }
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
  return { script, fields, instanceSize };
}

/** `PScript`: a script attached to a Thing, and its fields' values. */
export function readScript(s: Serializer, readers: ReadonlyMap<string, PartReader>): ScriptInstance {
  return readScriptInstance(s, readers);
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
    return { type: 'instance', instance: s.reference((self) => readScriptInstance(self, readers)) };
  }
  const shared = OBJECTS.get(s) ?? OBJECTS.set(s, new Map()).get(s)!;
  const { id } = s.pointer((self, pointer) => {
    self.pointers.set(pointer, true);
    shared.set(pointer, readScriptObjectBody(self, type, readers));
  });
  return id === 0 ? undefined : shared.get(id);
}

/** A boxed object's bytes after its pointer, on its first mention. */
function readScriptObjectBody(s: Serializer, type: number, readers: ReadonlyMap<string, PartReader>): ScriptObject {
  let object: ScriptObject;
  switch (type) {
    case OBJ_ARRAY_BOOL:
      object = { type: 'bools', values: s.array((self) => self.bool()) };
      break;
    case OBJ_ARRAY_S32:
      object = { type: 's32s', values: s.intVector() };
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
