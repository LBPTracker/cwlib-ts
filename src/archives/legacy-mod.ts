/**
 * The legacy one-file mod, `MODb` or `MODe` -- what Craftworld Toolkit wrote
 * before its zip `.mod` (`mod.ts`): cwlib's `Mod.fromLegacyMod` and
 * `Crypto.decrypt` (ennuo/toolkit `d6a2ef8`).
 *
 * ⚠️ **Ported from Java and proven on no file**: no legacy mod was on this
 * disk (steering/java-parity.md). Everything below is Java's reading.
 *
 * ```
 * "MOD" "b"|"e"
 * e: u8 customKey (refused), then AES-CBC: 16-byte IV, the rest; the key PBKDF2-
 *    HMAC-SHA256 of "purchasecollege", the IV as salt, 65,536 rounds, 256 bits;
 *    PKCS#5 padding; the plain text opens "MODb"
 * u8  revision (LM_TOOLKIT 3 .. LM_MAX 6)
 * i8  compatibility, u8 major, u8 minor, str ID
 * author: wstr from LM_TYPES (6), str before; wstr title, wstr description
 * i32 entries { str path, i32 size, guid, u32 date from LM_SLOTS_TIMESTAMPS (4) }
 * items: i32 (u16 before LM_TYPES) { InventoryItemDetails, u32 location, u32 category,
 *        plan descriptor, wstr translatedLocation, wstr translatedCategory,
 *        i32 min, i32 max revision from LM_MINMAX (5) }   -- walked, dropped, as Java
 * slots: Slot[] from LM_SLOTS_TIMESTAMPS                  -- walked, dropped, as Java
 * i32 patches { u8 type (0, LAMS, alone), str tag, i32 key, wstr text }
 * each entry's bytes, in entry order; then a bytearray, the icon
 * ```
 *
 * Every integer is compressed (cwlib's `USE_ALL_COMPRESSION`), and the structs
 * are read at the revision Java gives them: head `0xffff` before `LM_TYPES`,
 * `0x01ae03fa` from it.
 */

import { readInventoryItemDetails } from '../structs/inventory.ts';
import { readSlot } from '../structs/slot.ts';
import { Serializer, SerializerError, latin1, type RevisionInfo } from '../io/serializer.ts';
import { DEFAULT_MOD_INFO, MIN_SAFE_GUID, type ModEntry, type ModInfo, type TranslationPatch } from './mod.ts';

const LEGACY_PASSWORD = 'purchasecollege';
const LM_TOOLKIT = 0x3;
const LM_SLOTS_TIMESTAMPS = 0x4;
const LM_MINMAX = 0x5;
const LM_TYPES = 0x6;
const LM_MAX = 0x6;
const LM_OLD_HEAD = 0xffff;
const LM_HEAD = 0x01ae03fa;
const USE_ALL_COMPRESSION = 7;
const LAMS_TYPE = 0;

const head = (word: number): RevisionInfo => ({
  version: word & 0xffff, subVersion: word >>> 16, branchId: 0, branchRevision: 0,
});

/** cwlib's `Crypto.decrypt`: AES-CBC, the IV in front, the key from the password and the IV. */
async function decrypt(data: Uint8Array): Promise<Uint8Array> {
  const iv = data.slice(0, 16);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(LEGACY_PASSWORD), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: iv, iterations: 65536 },
    material,
    { name: 'AES-CBC', length: 256 },
    false,
    ['decrypt'],
  );
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data.slice(16)));
}

/** Read a legacy `MODb` or `MODe`, into what `readMod` returns for a zip `.mod`. */
export async function readLegacyMod(
  bytes: Uint8Array,
): Promise<{ config: ModInfo; entries: ModEntry[]; patches: TranslationPatch[]; icon?: Uint8Array }> {
  if (latin1(bytes.subarray(0, 3)) !== 'MOD') throw new SerializerError('not a legacy mod: no "MOD" header');
  const type = latin1(bytes.subarray(3, 4));
  let data: Uint8Array;
  if (type === 'e') {
    if (bytes[4] !== 0) throw new SerializerError('a legacy mod with its own key: cwlib no longer reads them either');
    data = await decrypt(bytes.subarray(5));
    if (latin1(data.subarray(0, 4)) !== 'MODb') throw new SerializerError('a legacy mod that does not decrypt to "MODb"');
    data = data.subarray(4);
  } else if (type === 'b') {
    data = bytes.subarray(4);
  } else {
    throw new SerializerError(`a legacy mod of serialisation type "${type}"`);
  }

  // The revision is one byte; the structs after it are read at the head it implies.
  const revision = data[0];
  if (revision < LM_TOOLKIT) throw new SerializerError(`a legacy mod below LM_TOOLKIT (revision ${revision})`);
  if (revision > LM_MAX) throw new SerializerError(`a legacy mod of revision ${revision}, past LM_MAX`);
  const s = new Serializer(data.subarray(1), head(revision >= LM_TYPES ? LM_HEAD : LM_OLD_HEAD), USE_ALL_COMPRESSION);
  s.i8(); // compatibility
  const version = `${s.u8()}.${s.u8()}`;
  const ID = s.str();
  const author = revision >= LM_TYPES ? s.wstr() : s.str();
  const title = s.wstr();
  const description = s.wstr();
  const config: ModInfo = { ...DEFAULT_MOD_INFO, ID, version, author, title, description };

  // Java hands a GUID already taken the next free one from MIN_SAFE_GUID: "workbench's guid duping".
  const rows: { path: string; size: number; guid: number }[] = [];
  const used = new Set<number>();
  let next = MIN_SAFE_GUID;
  const entries = s.i32();
  for (let i = 0; i < entries; i += 1) {
    const path = s.str();
    const size = s.i32();
    let guid = s.guid();
    if (revision >= LM_SLOTS_TIMESTAMPS) s.u32(); // date
    if (used.has(guid)) {
      while (used.has(next)) next += 1;
      guid = next;
    }
    used.add(guid);
    rows.push({ path, size, guid });
  }

  const items = revision >= LM_TYPES ? s.i32() : s.u16();
  for (let i = 0; i < items; i += 1) {
    readInventoryItemDetails(s);
    s.u32(); // location
    s.u32(); // category
    s.resource(true); // plan
    s.wstr(); // translatedLocation
    s.wstr(); // translatedCategory
    if (revision >= LM_MINMAX) {
      s.i32(); // minRevision
      s.i32(); // maxRevision
    }
  }
  if (revision >= LM_SLOTS_TIMESTAMPS) s.array(readSlot);

  const keys: { tag: string; string: string }[] = [];
  const patchCount = s.i32();
  for (let i = 0; i < patchCount; i += 1) {
    if (s.u8() !== LAMS_TYPE) throw new SerializerError('a legacy mod patch that is not LAMS: cwlib reads only those');
    const tag = s.str();
    s.i32(); // the LAMS key
    keys.push({ tag, string: s.wstr() });
  }
  const patches: TranslationPatch[] = patchCount > 0 ? [{ type: 'TRANSLATION', name: 'Translations', languages: ['*'], keys }] : [];

  const out: ModEntry[] = rows.map(({ path, size, guid }) => ({ path, guid, bytes: s.bytes(size) }));
  const icon = s.bytes(s.i32());
  return { config, entries: out, patches, ...(icon.length > 0 ? { icon } : {}) };
}
