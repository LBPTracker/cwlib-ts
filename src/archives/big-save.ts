/**
 * A save as cwlib's toolkit lists it: `types/save/BigSave.java` (ennuo/toolkit
 * `d6a2ef8`), a save archive rooted at an `RBigProfile`, its resources each
 * given a path -- the inventory's plans, the moon's levels and adventures, the
 * levels inside each adventure, and the rest by magic.
 *
 * ⚠️ **Ported from Java and proven on no file**: no save here is rooted at a
 * big profile (steering/java-parity.md). Java's other constructor, which folds
 * downloaded levels' archives in, is not ported: it is the toolkit's merging
 * of several saves, not a format.
 */

import type { Inflate } from '../io/resource.ts';
import { readAdventureCreateProfile } from '../resources/adventure-create-profile.ts';
import { readBigProfile, type BigProfile } from '../resources/big-profile.ts';
import type { ResourceRef } from '../io/serializer.ts';
import type { Slot } from '../structs/slot.ts';
import { toHex } from '../io/hex.ts';
import { readFar, readSaveKey, type SaveKey } from './savearchive.ts';

/** cwlib's `ResourceType.BIG_PROFILE`. */
const BIG_PROFILE = 28;

/** cwlib's `ResourceType` folders and extensions, by the magic's first three letters. */
const TYPES: Readonly<Record<string, readonly [string, string]>> = {
  TEX: ['textures/', '.tex'], GTF: ['textures/', '.tex'], MSH: ['meshes/', '.mol'], ANM: ['animations/', '.anim'],
  GSB: ['guid_subst/', '.gsub'], GMT: ['gfx_materials/', '.gmat'], LVL: ['levels/', '.bin'], FSH: ['scripts/', '.ff'],
  CHA: ['character_settings/', '.cha'], SSP: ['softphys_settings/', '.sph'], FNT: ['fonts/', '.fnt'],
  MAT: ['physics_materials/', '.mat'], DLC: ['dlc/', '.dlc'], JNT: ['joints/', '.joint'], CON: ['constants/', '.con'],
  POP: ['poppet_settings/', '.pop'], CLD: ['cached/levels/', '.cld'], PRF: ['profiles/synced/', '.pro'],
  BEV: ['bevels/', '.bev'], GAM: ['game/', '.game'], NWS: ['network_settings/', '.nws'], PCK: ['packs/', '.pck'],
  BPR: ['profiles/big/', '.bpr'], SLT: ['slots/', '.slt'], ADC: ['adventure_data/create/', '.adc'],
  IPR: ['profiles/local/', '.ipr'], LMT: ['limits/', '.lmt'], TUT: ['tutorials/', '.tut'], GLT: ['guids/', '.glst'],
  AUM: ['audio_materials/', '.aum'], SSF: ['fluid_settings/', '.flu'], PLN: ['plans/', '.plan'],
  TXL: ['texture_lists/', '.yuv'], MUS: ['music_settings/', '.mus'], MIX: ['mixer_settings/', '.mix'],
  REP: ['replays/', '.rep'], PAL: ['palettes/', '.pal'], SMH: ['static_meshes/', '.smh'],
  ATX: ['animated_textures/', '.atx'], VOP: ['audio/', '.vop'], PIN: ['pins/', '.pin'], INS: ['instruments/', '.rinst'],
  OUT: ['outfits/', '.oft'], PBR: ['paintbrushes/', '.pbr'], REC: ['recordings/', '.rec'], PTG: ['paintings/', '.ptg'],
  QST: ['quests/', '.qst'], ABK: ['animations/banks/', '.abnk'], AST: ['animations/sets/', '.aset'],
  SMP: ['skeletons/maps/', '.smap'], SRG: ['skeletons/registries/', '.sreg'], SAS: ['skeleton/animation_styles/', '.sas'],
  CHK: ['streaming_chunks/', '.chk'], ADS: ['adventure_data/shared/', '.ads'], ADP: ['adventure_data/play_profiles/', '.adp'],
  AMP: ['animations/maps/', '.amap'], CCD: ['cached_costume_data/', '.ccd'], DLA: ['datalabels/', '.dla'],
  ADM: ['adventure_data/maps/', '.adm'], BST: ['bonesets/', '.boneset'],
};

/** cwlib's `BigSave.generatePath`: by magic, a JPEG or PNG by its first word, else unknown. */
export function savePath(bytes: Uint8Array, sha1: string): string {
  if (bytes.length < 4) return `resources/unknown/${sha1}`;
  const type = TYPES[String.fromCharCode(bytes[0], bytes[1], bytes[2])];
  if (type) return `resources/${type[0]}${sha1}${type[1]}`;
  const word = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  if (word === 0xffd8ffe0) return `resources/textures/${sha1}.jpg`;
  if (word === 0x89504e47) return `resources/textures/${sha1}.png`;
  return `resources/unknown/${sha1}`;
}

export interface BigSaveEntry {
  readonly path: string;
  readonly sha1: string;
  readonly bytes: Uint8Array;
  /** The moon's slot, or the adventure's, the entry is the root of. */
  readonly slot?: Slot;
}

export interface BigSave {
  readonly key: SaveKey;
  readonly profile: BigProfile;
  readonly entries: readonly BigSaveEntry[];
}

const hashOf = (ref: ResourceRef | undefined): string | undefined => (ref?.hash ? toHex(ref.hash) : undefined);
const isAdventure = (slot: Slot): boolean => slot.adventure !== undefined && slot.root === undefined;
const isLevel = (slot: Slot): boolean => slot.adventure === undefined && slot.root !== undefined;

/** List a save archive, in the clear, rooted at an `RBigProfile`. */
export async function readBigSave(archive: Uint8Array, inflate: Inflate): Promise<BigSave> {
  const key = readSaveKey(archive);
  if (key.rootType !== BIG_PROFILE) throw new Error("save archive doesn't have an RBigProfile root resource");
  const resources = new Map((await readFar(archive)).map((r) => [r.sha1, r.bytes]));
  const root = resources.get(key.rootHash);
  if (root === undefined) throw new Error('unable to locate the RBigProfile root resource');
  const profile = await readBigProfile(root, inflate);
  const locked = new Set([key.rootHash]);
  const entries: BigSaveEntry[] = [];
  const add = (entry: BigSaveEntry): void => {
    entries.push(entry);
    locked.add(entry.sha1);
  };

  for (const item of profile.inventory) {
    const sha1 = hashOf(item.plan);
    const bytes = sha1 && resources.get(sha1);
    if (!sha1 || !bytes) continue;
    // cwlib's `generatePath(InventoryItem)`: the plan's path by its magic.
    add({ path: savePath(bytes, sha1), sha1, bytes });
  }
  for (const { slot } of profile.myMoonSlots) {
    const sha1 = hashOf(isAdventure(slot) ? slot.adventure : slot.root);
    const bytes = sha1 && resources.get(sha1);
    if (!sha1 || !bytes) continue;
    if (isLevel(slot)) add({ path: `levels/${slot.name || 'Unnamed Level'}`, sha1, bytes, slot });
    if (!isAdventure(slot)) continue;
    const path = `adventures/${slot.name || 'Unnamed Adventure'}`;
    add({ path, sha1, bytes, slot });
    const adventure = await readAdventureCreateProfile(bytes, inflate).catch(() => undefined);
    for (const { slot: local } of adventure?.slots ?? []) {
      const localSha1 = isLevel(local) ? hashOf(local.root) : undefined;
      const localBytes = localSha1 && resources.get(localSha1);
      if (!localSha1 || !localBytes) continue;
      add({ path: `${path}/levels/${local.name || 'Unnamed Level'}`, sha1: localSha1, bytes: localBytes, slot: local });
    }
  }
  for (const [sha1, bytes] of resources) {
    if (!locked.has(sha1)) entries.push({ path: savePath(bytes, sha1), sha1, bytes });
  }
  return { key, profile, entries };
}
