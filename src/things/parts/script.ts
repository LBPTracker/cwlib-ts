/** `SCRIPT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError } from '../../io/serializer.ts';
import { readThingRef, type PartReader } from '../thing.ts';
import { things } from './common.ts';

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

interface FieldLayout {
  readonly machineType: number;
  readonly divergent: boolean;
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
function readFieldLayout(s: Serializer): FieldLayout {
  const { version } = s.revision;
  s.str(); // name
  if (version >= 0x3d9) {
    const flags = s.i16();
    const machineType = s.u8();
    s.u8(); // fishType
    s.i8(); // dimensionCount
    s.u8(); // arrayBaseMachineType
    s.i32(); // instanceOffset
    return { machineType, divergent: (flags & MODIFIER_DIVERGENT) !== 0 };
  }
  const flags = s.i32();
  const machineType = s.i32();
  if (version >= 0x145) s.i32(); // fishType
  s.i8(); // dimensionCount
  s.i32(); // arrayBaseMachineType
  s.i32(); // instanceOffset
  return { machineType, divergent: (flags & MODIFIER_DIVERGENT) !== 0 };
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
function readScriptInstance(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const { version } = s.revision;
  s.resource(); // script

  let serialize = true;
  if (version > 0x1a0) serialize = s.bool();
  if (!serialize) return;

  const pointer = s.i32();
  if (pointer === 0) return;

  let layout = s.pointers.get(pointer) as FieldLayout[] | undefined;
  if (layout === undefined) {
    const fields: FieldLayout[] = [];
    const count = s.count();
    for (let i = 0; i < count; i += 1) fields.push(readFieldLayout(s));
    s.i32(); // instanceSize
    layout = fields;
    s.pointers.set(pointer, layout);
  }

  const reflectDivergent = version > 0x19c ? s.bool() : false;
  for (const field of layout) {
    if (field.divergent && !reflectDivergent) continue;
    switch (field.machineType) {
      case MACHINE_BOOL:
        s.bool();
        break;
      case MACHINE_CHAR:
        s.i16();
        break;
      case MACHINE_S32:
        s.i32();
        break;
      case MACHINE_F32:
        s.f32();
        break;
      case MACHINE_V4:
        s.skipVector4();
        break;
      case MACHINE_M44:
        s.skipMatrix();
        break;
      case MACHINE_SAFE_PTR:
        readThingRef(s, readers);
        break;
      case MACHINE_OBJECT_REF:
        readScriptObject(s, readers);
        break;
      default:
        throw new SerializerError(
          `script field machine type 0x${field.machineType.toString(16)} has no reader`,
        );
    }
  }
}

/** `PScript`: a script attached to a Thing. */
export function readScript(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  readScriptInstance(s, readers);
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

/**
 * `ScriptObject`: a boxed value in a script field.
 *
 * ⚠️ Pointer-shared like the field layout, and for the same reason — one array
 * can be referenced by many scripts. `AUDIOHANDLE` is a type with **no bytes at
 * all**: it reads its id and stops.
 */
function readScriptObject(s: Serializer, readers: ReadonlyMap<string, PartReader>): void {
  const type = s.i32();
  if (type === OBJ_NULL) return;
  if (type === OBJ_INSTANCE) {
    s.reference((self) => readScriptInstance(self, readers));
    return;
  }
  const pointer = s.i32();
  if (pointer === 0) return;
  if (s.pointers.has(pointer)) return;
  s.pointers.set(pointer, true);

  switch (type) {
    case OBJ_ARRAY_BOOL: {
      const n = s.count();
      for (let i = 0; i < n; i += 1) s.bool();
      break;
    }
    case OBJ_ARRAY_S32:
      s.intVector();
      break;
    case OBJ_ARRAY_F32: {
      const n = s.count();
      for (let i = 0; i < n; i += 1) s.f32();
      break;
    }
    case OBJ_ARRAY_VECTOR4: {
      const n = s.count();
      for (let i = 0; i < n; i += 1) s.skipVector4();
      break;
    }
    case OBJ_STRINGW:
      s.wstr();
      break;
    case OBJ_STRINGA:
      s.str();
      break;
    case OBJ_RESOURCE: {
      // The resource's own type is written first, and `INVALID` means no
      // descriptor follows at all.
      const resourceType = s.i32();
      if (resourceType !== 0) s.resource();
      break;
    }
    case OBJ_AUDIOHANDLE:
      break;
    case OBJ_ARRAY_SAFE_PTR:
      things(s, readers);
      break;
    case OBJ_ARRAY_OBJECT_REF: {
      const n = s.count();
      for (let i = 0; i < n; i += 1) readScriptObject(s, readers);
      break;
    }
    default:
      throw new SerializerError(`script object type ${type} has no reader`);
  }
}
