/**
 * The Thing graph: what a level actually is.
 *
 * A level is one `worldThing`, whose `WORLD` part holds every other Thing in
 * the level. Each Thing is a UID, a few scalars, a 64-bit mask of which parts it
 * carries, and then those parts inline in a fixed order.
 *
 * ## Why every part type has to be implemented, not just the interesting ones
 *
 * ⚠️ **lbptracker's `steering/tracker-architecture.md` said this walk needed eight part
 * readers. It needs all of them, and the difference is not a detail.** The
 * reasoning behind "eight" was that only nine part types ever share a Thing with
 * a `SEQUENCER` — which is true, and irrelevant. Parts carry no length, object
 * references expand inline at their first mention, and `PWorld.things` is an
 * array of such references, so reaching the 443rd Thing means having fully read
 * the 442 before it. A part this reader does not know is not a part it can step
 * over; it is the end of the parse.
 *
 * The measured number, from `tools/PartCensus.java` over the 10 level files that
 * load: **33 distinct part types across 81,946 Things**. `PartCensus`'s own
 * header says as much — "a TypeScript walk cannot skip anything" — so the tool
 * was right and the conclusion drawn from it was not.
 *
 * ## What is deliberately absent, and the one deprecated part that is not
 *
 * The LBP3 range this project accepts (`serializer.ts`: version `0x3b7`-`0x3ff`;
 * nothing range-checks the subVersion, which is `0x0` and `0x205`-`0x218` in the
 * archive sample and `0x12c`-`0x1ab` in LBP3 PS4's own story chunks --
 * steering/level-files.md) rules out most deprecated parts by itself:
 *
 * - `head & 0xffff >= 0x13c` excludes indices `0x36`-`0x3c` — the six LBP1 parts;
 * - the same test at `0x18c` excludes `PARTICLE_EMITTER_2` (`0x3d`).
 *
 * ⚠️ **`CREATOR_ANIM` is NOT ruled out, and this said it was.** It goes at
 * `subVersion >= 0x107`, and **subVersion 0 is in range** — nine of the ten
 * corpus levels and every LBP2 level are on it. Below `0x107` it sits on mask bit
 * `0x29` and every part above `0x28` is one bit higher than its index (`partBit`).
 * Reading those files with the live bits made a `PWormhole` (index `0x30`, bit
 * `0x31`) parse as a `PQuest` of type 2, and two of twelve levels off Bonsai
 * failed on "quest type 2 has no reader" — measured 2026-10-04. The shift is the
 * game's own: its Thing loader, at `v0xd49d92` in `eboot-v128.bin`, tests the
 * creator-anim bit only when the head is `<= 0x106ffff` and then tests
 * `TRANSITION` on bit `0x2a` instead of `0x29`, every later part following.
 */

import { Serializer, SerializerError, vitaRevision } from '../io/serializer.ts';
import type { Writer } from '../io/writer.ts';
import type { PartWriteContext, PartWriter } from './write-parts.ts';


/**
 * cwlib `Branch.LEERDAMMER` and the two of its revisions this reader needs.
 *
 * ❗ **A branch can turn a version gate on early, and two of the gates in
 * `fillThing` are branch gates wearing a version gate's clothes.** Every LBP1
 * level in the archive sample is on this branch at revision 0x17, so both of
 * these fire and neither was implemented.
 */
const LEERDAMMER = 0x4c44;
const LD_RESOURCES = 0x2;
const LD_TEST_MARKER = 0x5;
/** `PCreature` gains the submerged pair here; the branch is on 0x17, so it has them. */
export const LD_SUBMERGED = 0xf;
/** Any LEERDAMMER revision at all. `isLeerdammer()` in cwlib. */
export const LD_ANY = 0x0;

/** cwlib `Revision.has(branch, revision)`. */
export function onLeerdammer(
  revision: { branchId: number; branchRevision: number },
  since: number,
): boolean {
  return revision.branchId === LEERDAMMER && revision.branchRevision >= since;
}

/**
 * The parts, in **declaration order** — which is the order they serialise in.
 *
 * ⚠️ Declaration order is not index order, and the difference is load-bearing:
 * `Part.fromFlags` in cwlib iterates `Part.values()`, so `LEVEL_SETTINGS`
 * (index `0x0a`) is written after `GENERATED_MESH` (`0x09`) but before
 * `SPRITE_LIGHT` (`0x0b`), while `TRIGGER_EFFECTOR` (`0x36`) sits between
 * `TRIGGER` (`0x05`) and `YELLOWHEAD` (`0x06`). Sorting this table by index
 * would desynchronise every Thing that carries more than one part.
 *
 * `since` is the part's `PartHistory` value: a part is present only when the
 * stream's parts-revision has reached it, whatever its flag bit says.
 */
export const PARTS: readonly {
  readonly name: string;
  readonly index: number;
  readonly since: number;
  /** A part long gone: the version from which no Thing holds it (cwlib's `Part.hasPart`). */
  readonly until?: number;
}[] = [
  { name: 'BODY', index: 0x00, since: 0x01 },
  { name: 'JOINT', index: 0x01, since: 0x02 },
  { name: 'WORLD', index: 0x02, since: 0x03 },
  { name: 'RENDER_MESH', index: 0x03, since: 0x04 },
  { name: 'POS', index: 0x04, since: 0x05 },
  { name: 'TRIGGER', index: 0x05, since: 0x06 },
  // ❗ The parts the game dropped, in cwlib's declaration order, which is the order
  // a Thing writes them: without them a Thing of the LBP1 palettes at 0x15e and
  // 0x15f read a `PARTICLE_EMITTER_2` as its `CAMERA_TWEAK`. None has a reader, so
  // a non-null one is an `UnimplementedPartError`, as it is a failure in cwlib.
  { name: 'TRIGGER_EFFECTOR', index: 0x36, since: 0x07, until: 0x13c },
  { name: 'PAINT', index: 0x37, since: 0x08, until: 0x13c },
  { name: 'YELLOWHEAD', index: 0x06, since: 0x09 },
  { name: 'AUDIO_WORLD', index: 0x07, since: 0x0a },
  { name: 'ANIMATION', index: 0x08, since: 0x0b },
  { name: 'GENERATED_MESH', index: 0x09, since: 0x0c },
  { name: 'PARTICLE_CLUMP', index: 0x38, since: 0x0d, until: 0x13c },
  { name: 'PARTICLE_EMITTER', index: 0x39, since: 0x0e, until: 0x13c },
  { name: 'CAMERA_ZONE', index: 0x3a, since: 0x0f, until: 0x13c },
  { name: 'LEVEL_SETTINGS', index: 0x0a, since: 0x10 },
  { name: 'SPRITE_LIGHT', index: 0x0b, since: 0x11 },
  { name: 'KEYFRAMED_POSITION', index: 0x3b, since: 0x12, until: 0x13c },
  { name: 'CAMERA', index: 0x3c, since: 0x13, until: 0x13c },
  { name: 'SCRIPT_NAME', index: 0x0c, since: 0x14 },
  { name: 'CREATURE', index: 0x0d, since: 0x15 },
  { name: 'CHECKPOINT', index: 0x0e, since: 0x16 },
  { name: 'STICKERS', index: 0x0f, since: 0x17 },
  { name: 'DECORATIONS', index: 0x10, since: 0x18 },
  { name: 'SCRIPT', index: 0x11, since: 0x19 },
  { name: 'SHAPE', index: 0x12, since: 0x1a },
  { name: 'EFFECTOR', index: 0x13, since: 0x1b },
  { name: 'EMITTER', index: 0x14, since: 0x1c },
  { name: 'REF', index: 0x15, since: 0x1d },
  { name: 'METADATA', index: 0x16, since: 0x1e },
  { name: 'COSTUME', index: 0x17, since: 0x1f },
  { name: 'PARTICLE_EMITTER_2', index: 0x3d, since: 0x20, until: 0x18c },
  { name: 'CAMERA_TWEAK', index: 0x18, since: 0x21 },
  { name: 'SWITCH', index: 0x19, since: 0x22 },
  { name: 'SWITCH_KEY', index: 0x1a, since: 0x23 },
  { name: 'GAMEPLAY_DATA', index: 0x1b, since: 0x24 },
  { name: 'ENEMY', index: 0x1c, since: 0x25 },
  { name: 'GROUP', index: 0x1d, since: 0x26 },
  { name: 'PHYSICS_TWEAK', index: 0x1e, since: 0x27 },
  { name: 'NPC', index: 0x1f, since: 0x28 },
  { name: 'SWITCH_INPUT', index: 0x20, since: 0x29 },
  { name: 'MICROCHIP', index: 0x21, since: 0x2a },
  { name: 'MATERIAL_TWEAK', index: 0x22, since: 0x2b },
  { name: 'MATERIAL_OVERRIDE', index: 0x23, since: 0x2c },
  { name: 'INSTRUMENT', index: 0x24, since: 0x2d },
  { name: 'SEQUENCER', index: 0x25, since: 0x2e },
  { name: 'CONTROLINATOR', index: 0x26, since: 0x2f },
  { name: 'POPPET_POWERUP', index: 0x27, since: 0x30 },
  { name: 'POCKET_ITEM', index: 0x28, since: 0x31 },
  // Deprecated at subVersion 0x107, and read from older files only: see
  // `partBit`. It has no reader, so a non-null one is an `UnimplementedPartError`
  // -- cwlib expects it null too (`Part.serialize`, `i32(0) == 0`).
  { name: 'CREATOR_ANIM', index: 0x3e, since: 0x32 },
  { name: 'TRANSITION', index: 0x29, since: 0x33 },
  { name: 'FADER', index: 0x2a, since: 0x34 },
  { name: 'ANIMATION_TWEAK', index: 0x2b, since: 0x35 },
  { name: 'WIND_TWEAK', index: 0x2c, since: 0x36 },
  { name: 'POWER_UP', index: 0x2d, since: 0x37 },
  { name: 'HUD_ELEM', index: 0x2e, since: 0x38 },
  { name: 'TAG_SYNCHRONIZER', index: 0x2f, since: 0x39 },
  { name: 'WORMHOLE', index: 0x30, since: 0x3a },
  { name: 'QUEST', index: 0x31, since: 0x3b },
  { name: 'CONNECTOR_HOOK', index: 0x32, since: 0x3c },
  { name: 'ATMOSPHERIC_TWEAK', index: 0x33, since: 0x3d },
  { name: 'STREAMING_DATA', index: 0x34, since: 0x3e },
  { name: 'STREAMING_HINT', index: 0x35, since: 0x3f },
];

/** `PCreatorAnim` went at this subVersion, and the part bits above it moved down one. */
const CREATOR_ANIM_GONE = 0x107;

/**
 * Which bit of a Thing's mask says it has this part, or `undefined` when the
 * part cannot be in a Thing of this subVersion at all.
 *
 * ❗ **Below subVersion `0x107` the bits are not the indices.** `PCreatorAnim`
 * (index `0x3e`) has bit `0x29`, and every part from `TRANSITION` (`0x29`) up is
 * one bit higher than its index -- cwlib `Part.hasPart`, and the game's own Thing
 * loader at `v0xd49d92` (head `<= 0x106ffff`). The reader and the plan writer
 * both ask this, so they cannot drift apart.
 */
export function partBit(
  part: { readonly name: string; readonly index: number },
  subVersion: number,
  partsRevision = CREATOR_ANIM_SINCE,
): number | undefined {
  const old = subVersion < CREATOR_ANIM_GONE;
  if (part.name === 'CREATOR_ANIM') return old ? 0x29 : undefined;
  // ❗ Only a Thing whose parts revision has reached `PCreatorAnim` (0x32) has the
  // bits moved for it: cwlib's `hasPart`. Older Things keep every index.
  if (partsRevision < CREATOR_ANIM_SINCE) return part.index;
  return old && part.index > 0x28 ? part.index + 1 : part.index;
}

/** `PartHistory.CREATOR_ANIM`: the parts revision from which the bits above 0x28 move. */
const CREATOR_ANIM_SINCE = 0x32;

/**
 * `PARTS` with each part's mask bit, in declaration order, for the two sides of
 * `CREATOR_ANIM_GONE` -- what `fillThing` walks, so `partBit` runs twice per
 * part at load and never per Thing.
 */
/**
 * The Vita's own parts: at parts revisions 0x30 and 0x31 and bits 0x27 and
 * 0x28, where LBP3 put `POPPET_POWERUP` and `POCKET_ITEM`, the Vita's branch
 * has parts cwlib's table does not (steering/level-files.md, *The Vita branch*).
 */
const VITA_PARTS: Readonly<Record<string, string>> = { POPPET_POWERUP: 'VITA_27', POCKET_ITEM: 'VITA_28' };

const PART_BITS: readonly (readonly { readonly part: (typeof PARTS)[number]; readonly bit: number }[])[] =
  [[0, 0], [0, CREATOR_ANIM_SINCE], [CREATOR_ANIM_GONE, 0], [CREATOR_ANIM_GONE, CREATOR_ANIM_SINCE]].map(
    ([subVersion, partsRevision]) => PARTS.flatMap((part) => {
      const bit = partBit(part, subVersion!, partsRevision);
      return bit === undefined ? [] : [{ part, bit }];
    }),
  );

/** Reads one part's body. Returning nothing is fine; the bytes are what matter. */
export type PartReader = (s: Serializer, thing: Thing) => unknown;

export class UnimplementedPartError extends SerializerError {
  readonly part: string;
  constructor(part: string) {
    super(`no reader for part ${part}`);
    this.part = part;
  }
}

export interface Thing {
  uid: number;
  parent?: Thing;
  groupHead?: Thing;
  planGuid: number;
  flags: number;
  extraFlags: number;
  /** Part name → whatever its reader returned. */
  readonly parts: Map<string, unknown>;
  /*
   * The rest of the header, as read, so a Thing can be written from its values
   * (`writeThing`). Absent on a Thing made afresh, which writes the defaults.
   */
  /** The reference id the Thing had in its file, so it is written back under it (`Writer.reference`). */
  id?: number;
  /** Below version 0x1fd, the world Thing it names first. */
  world?: Thing;
  /** From version 0x1c7. */
  oldEmitter?: Thing;
  /** Between 0x1a6 and 0x1bb, the `PJoint`s listed on the Thing, and their reference ids. */
  joints?: unknown[];
  jointIds?: number[];
  /** From version 0x214. */
  createdBy?: number;
  changedBy?: number;
  /** Below version 0x341: above 0x21a, and from 0x2f2. */
  isStamping?: boolean;
  hidden?: boolean;
  /** The parts revision as stored -- at 0x13c, 7 short of the one the parts are read by. */
  partsRevision?: number;
  /** The part mask as stored, where the Thing has one. */
  partsMask?: bigint;
  /** Each part's reference id, by name: 0 for a part declared and null. */
  partIds?: Map<string, number>;
  /**
   * The body of a part whose reader keeps no value, as its bytes, by name:
   * `VITA_27` and `VITA_28` (`parts/vita.ts`), which have no writer. Kept only
   * where the body met no object first, so the ids in it name objects written
   * before it (`writeThing`).
   */
  partBytes?: Map<string, Uint8Array>;
}

/**
 * Optional trace of what the walk is reading, and where.
 *
 * ⚠️ Keep this. A part that consumes the wrong number of bytes is only reported
 * one Thing later, by the `0xAA` marker, and the byte offset alone does not say
 * which part was wrong. The span of every part is what turns "something before
 * byte 219" into "SHAPE ran 103..217 and should have stopped at 216".
 *
 * Each part and Thing fires **twice**: once on entry with `end` of -1, once on
 * exit with the real end. The entries are what matter when the failure happens
 * deep inside a nested read — the exits never arrive for the frames that are
 * still open, and those are exactly the ones holding the bug.
 */
export type Trace = (event: string, start: number, end: number) => void;
let trace: Trace | undefined;
export function setTrace(fn: Trace | undefined): void {
  trace = fn;
}

/** An empty Thing, registered before its body is read so cycles resolve. */
export function emptyThing(): Thing {
  return { uid: 0, planGuid: 0, flags: 0, extraFlags: 0, parts: new Map<string, unknown>() };
}

/** Read a Thing behind a reference, registering it before its parts are read. */
export function readThingRef(
  s: Serializer,
  readers: ReadonlyMap<string, PartReader>,
): Thing | undefined {
  const at = s.position;
  return s.referenceInto(emptyThing, (self, thing) => {
    // The id, read again from where the reference began: only for a Thing met first here.
    const end = self.position;
    self.position = at;
    thing.id = self.i32();
    self.position = end;
    fillThing(self, thing, readers);
  });
}

/** The id the next reference holds, without consuming it. */
function peekId(s: Serializer): number {
  const at = s.position;
  const id = s.i32();
  s.position = at;
  return id;
}

/**
 * Read one Thing.
 *
 * `readers` maps a part name to its reader; a part that **has a body** and no
 * reader throws `UnimplementedPartError` naming it, which is what makes building
 * this out a loop rather than a guess. A part the Thing merely declares — its
 * mask bit set and its reference null — needs none; see the note at the call.
 */
export function readThing(s: Serializer, readers: ReadonlyMap<string, PartReader>): Thing {
  const thing = emptyThing();
  fillThing(s, thing, readers);
  return thing;
}

function fillThing(
  s: Serializer,
  thing: Thing,
  readers: ReadonlyMap<string, PartReader>,
): Thing {
  const { version, subVersion } = s.revision;
  const thingStart = s.position;
  trace?.('THING', thingStart, -1);

  // `Revisions.THING_TEST_MARKER` is 0x2a1. It is a plain 0xAA and its whole job
  // is to fail loudly here rather than 200 bytes later.
  //
  // ⚠️ **LEERDAMMER has it from its own revision 5, well below 0x2a1.** Reading a
  // 0x272 file without the marker takes the 0xAA as the first byte of the parent
  // reference and everything after is one byte out.
  if (version >= 0x2a1 || onLeerdammer(s.revision, LD_TEST_MARKER)) {
    const marker = s.u8();
    if (marker !== 0xaa) {
      throw new SerializerError(
        `Thing test marker was 0x${marker.toString(16)}, not 0xaa, at byte ` +
          `${s.position - 1} — the part reader before this one consumed the wrong ` +
          `number of bytes`,
      );
    }
  }

  // ❗ **The UID and the parent swap at 0x27f, and this used to read the 0x27f
  // order for every file while a comment above it described the rule.** cwlib
  // `Thing.java:96` is the authority: below 0x27f the parent comes first.
  // Measured 2026-09-06 with `LBP3_MIN_VERSION` lowered to 0x100, over the 21
  // LBP1 levels in `fixtures/archive`: **3 files got past the Thing header, then
  // 10 did.** It changes nothing at the bound this reader actually enforces --
  // 0x3b7 is far above 0x27f -- so it is latent correctness for a range that is
  // still refused, and the measurement only exists because the bound can be
  // lowered by hand. See question 28.
  // ❗ Below 0x1fd a Thing names its world first (cwlib's `Thing.world`); without it
  // the game's plans at 0x1a7..0x1f8 read their first part 40 bytes late.
  if (version < 0x1fd) {
    s.label('world');
    thing.world = readThingRef(s, readers);
  }
  if (version >= 0x27f) {
    thing.uid = s.i32();
    s.label('parent');
    thing.parent = readThingRef(s, readers);
  } else {
    s.label('parent');
    thing.parent = readThingRef(s, readers);
    thing.uid = s.i32();
  }
  s.label('groupHead');
  thing.groupHead = readThingRef(s, readers);
  if (version >= 0x1c7) thing.oldEmitter = readThingRef(s, readers);
  // Between 0x1a6 and 0x1bb, joints listed on the Thing: references to `PJoint`s.
  if (version >= 0x1a6 && version < 0x1bc) {
    const joint = readers.get('JOINT');
    // `s.references`, with each id kept.
    const count = s.i32();
    if (count < 0) throw new SerializerError(`negative array length ${count}`);
    thing.joints = [];
    thing.jointIds = [];
    for (let i = 0; i < count; i += 1) {
      thing.jointIds.push(peekId(s));
      thing.joints.push(s.reference((self) => {
        if (!joint) throw new UnimplementedPartError('JOINT');
        return joint(self, thing);
      }));
    }
  }

  // `isToolkit()` is false for anything the game wrote.
  if (version >= 0x214) {
    thing.createdBy = s.i16();
    thing.changedBy = s.i16();
  }

  if (version >= 0x341) {
    if (version >= 0x254) thing.planGuid = s.guid();
    // The Vita widened them to 16 bits at its revision 0x62 (cwlib's `Thing`).
    thing.flags = vitaRevision(s.revision) >= 0x62 ? s.i16() : s.u8();
    if (subVersion >= 0x110) thing.extraFlags = s.u8();
  } else {
    if (version > 0x21a) thing.isStamping = s.bool();
    if (version >= 0x254) thing.planGuid = s.guid();
    if (version >= 0x2f2) thing.hidden = s.bool();
  }

  // ⚠️ **The parts revision comes first: how far the parts table had got when
  // this Thing was written. It is in the stream, and this reader used to guess
  // it from the version.** The guess -- `CONTROLINATOR` up to 0x3e2,
  // `STREAMING_HINT` after -- agreed with every file in the corpus, because it
  // is derived from the same table; what it could not do is consume the bytes
  // the Thing writes for it, and the byte eaten to make the part mask decode
  // was recorded as "one byte cwlib does not account for". It is this field: an
  // `s32`, a **one-byte zigzag varint** in a compressed stream and four bytes in
  // one that is not. The first uncompressed resource -- a streaming island's
  // plan -- read three bytes short and produced a plausible, wrong part list.
  // `PartHistory.STREAMING_HINT` is 0x3f, `CONTROLINATOR` 0x2f.
  // cwlib: "I have no idea why they did this" -- at 0x13c the stored revision is 7 short.
  // Both marked on a tape, so a part can be added to the Thing (`addPart` in `write-level.ts`).
  thing.partsRevision = s.mark('partsRevision', (self) => self.s32());
  const partsRevision = thing.partsRevision + (version === 0x13c ? 7 : 0);
  // The part mask. `u64` here is a varint when the stream is compressed, and a
  // part index can be as high as 0x35, so this really does need 64 bits.
  //
  // ⚠️ **`u64Big`, not `u64`.** A `number` has 53 bits of mantissa and the
  // highest part index is 53, so a mask carrying `STREAMING_HINT` alongside any
  // low part comes back rounded and the low part vanishes without a word. See
  // `Serializer.u64Big` for the measurement.
  //
  // ⚠️ **And LEERDAMMER has the mask from its revision 2**, which is cwlib's
  // `isCompressed`. Without it a 0x272 Thing was read with `mask = -1` -- every
  // declared part treated as present -- and the parts revision it had just read
  // was garbage anyway, so nothing was read at all.
  const masked = version >= 0x297 || onLeerdammer(s.revision, LD_RESOURCES);
  const mask = masked ? s.mark('partsMask', (self) => self.u64Big()) : -1n;
  if (masked) thing.partsMask = mask;
  const partIds = new Map<string, number>();
  thing.partIds = partIds;
  // `mask` can exceed 2^53, so it is read as a BigInt -- and then split once
  // into two 32-bit halves, so the test below is a shift rather than a BigInt
  // allocated per part per Thing. `1 << bit` alone would wrap at 32.
  const lo = Number(mask & 0xffffffffn);
  const hi = Number((mask >> 32n) & 0xffffffffn);

  const vita = vitaRevision(s.revision) >= 0;
  const bits = PART_BITS[(subVersion < CREATOR_ANIM_GONE ? 0 : 2) + (partsRevision < CREATOR_ANIM_SINCE ? 0 : 1)]!;
  for (const { part: declared, bit } of bits) {
    if (partsRevision < declared.since) continue;
    if (declared.until !== undefined && version >= declared.until) continue;
    if (((bit < 32 ? lo >>> bit : hi >>> (bit - 32)) & 1) === 0) continue;
    const name = (vita && VITA_PARTS[declared.name]) || declared.name;
    const part = { ...declared, name };
    const read = readers.get(part.name);
    const partStart = s.position;
    trace?.(part.name, partStart, -1);
    // ❗ **The refusal belongs INSIDE the reference, not in front of it.** A
    // part's mask bit says the Thing has the field; the reference id that
    // follows says whether it holds anything. Refusing on the bit alone rejects
    // a level for a part that is null in it -- measured 2026-09-05: `EFFECTOR`
    // appears in 13 of the archive sample's LBP1 levels and **every one of the
    // 13 is a null reference**, one byte and no body. Those levels were being
    // turned away over a field that is not there.
    //
    // ⚠️ It also means `UnimplementedPartError` now says what it always claimed
    // to: this file has data for a part nothing here can read. A part that is
    // merely *declared* costs nothing and is skipped.
    s.label(part.name);
    partIds.set(part.name, peekId(s));
    let bodyStart = -1;
    let known = 0;
    const value = s.reference((self) => {
      if (!read) throw new UnimplementedPartError(part.name);
      bodyStart = self.position;
      known = self.referenced.size;
      return read(self, thing);
    });
    // A body whose reader keeps nothing -- the Vita's two parts -- is kept as
    // its bytes, where it met no object first: then every id in it names one
    // written before it, and the bytes can stand in a stream written from values.
    if (value === undefined && bodyStart >= 0 && s.referenced.size === known) {
      (thing.partBytes ??= new Map()).set(part.name, s.data.slice(bodyStart, s.position));
    }
    trace?.(part.name, partStart, s.position);
    thing.parts.set(part.name, value);
    if (typeof value === 'object' && value !== null && !PART_OF.has(value)) PART_OF.set(value, { name: part.name, id: partIds.get(part.name)! });
  }

  trace?.(`THING ${thing.uid}`, thingStart, s.position);
  return thing;
}

/**
 * `fillThing`'s mirror: a Thing written from its values, the header as it was
 * read and each part through its writer, in declaration order under the mask.
 *
 * A Thing read from a file writes what it read: its parts revision and mask as
 * stored, each part under its own reference id (`partIds`). A Thing made afresh
 * has neither, and gets the parts revision of the newest part the table knows
 * and the mask of the parts it holds.
 *
 * ⚠️ A part's value is the key its reference is written under (its tape object
 * first, as `Writer.reference` keys every struct); a part whose value is
 * not an object -- a name, a count -- gets a key of its own, so it is never
 * taken for another mention.
 */
export function writeThing(
  w: Writer,
  thing: Thing,
  ctx: PartWriteContext,
  writers: ReadonlyMap<string, PartWriter>,
): void {
  const { version, subVersion } = w.revision;
  if (version >= 0x2a1 || onLeerdammer(w.revision, LD_TEST_MARKER)) w.u8(0xaa);
  if (version < 0x1fd) ctx.thing(w, thing.world);
  if (version >= 0x27f) {
    w.i32(thing.uid);
    ctx.thing(w, thing.parent);
  } else {
    ctx.thing(w, thing.parent);
    w.i32(thing.uid);
  }
  ctx.thing(w, thing.groupHead);
  if (version >= 0x1c7) ctx.thing(w, thing.oldEmitter);
  if (version >= 0x1a6 && version < 0x1bc) {
    const joints = thing.joints ?? [];
    const joint = writers.get('JOINT');
    w.i32(joints.length);
    joints.forEach((value, i) => writePartReference(w, 'JOINT', value, thing.jointIds?.[i], joint, ctx));
  }
  if (version >= 0x214) {
    w.i16(thing.createdBy ?? 0);
    w.i16(thing.changedBy ?? 0);
  }
  if (version >= 0x341) {
    if (version >= 0x254) w.guid(thing.planGuid);
    if (vitaRevision(w.revision) >= 0x62) w.i16(thing.flags);
    else w.u8(thing.flags);
    if (subVersion >= 0x110) w.u8(thing.extraFlags);
  } else {
    if (version > 0x21a) w.bool(thing.isStamping ?? false);
    if (version >= 0x254) w.guid(thing.planGuid);
    if (version >= 0x2f2) w.bool(thing.hidden ?? false);
  }

  const vita = vitaRevision(w.revision) >= 0;
  const nameOf = (part: (typeof PARTS)[number]): string => (vita && VITA_PARTS[part.name]) || part.name;
  // cwlib: at 0x13c the stored revision is 7 short (`fillThing`).
  const short = version === 0x13c ? 7 : 0;
  const stored = thing.partsRevision ?? Math.max(0, ...PARTS.map((p) => (thing.parts.has(nameOf(p)) ? p.since : 0))) - short;
  const partsRevision = stored + short;
  w.s32(stored);
  const masked = version >= 0x297 || onLeerdammer(w.revision, LD_RESOURCES);
  const bits = PART_BITS[(subVersion < CREATOR_ANIM_GONE ? 0 : 2) + (partsRevision < CREATOR_ANIM_SINCE ? 0 : 1)]!;
  let mask = thing.partsMask;
  if (mask === undefined) {
    mask = masked ? 0n : -1n;
    if (masked) for (const { part, bit } of bits) if (thing.parts.has(nameOf(part))) mask |= 1n << BigInt(bit);
  }
  if (masked) w.u64Big(mask);
  for (const { part, bit } of bits) {
    if (partsRevision < part.since) continue;
    if (part.until !== undefined && version >= part.until) continue;
    if (((mask >> BigInt(bit)) & 1n) === 0n) continue;
    const name = nameOf(part);
    const bytes = thing.partBytes?.get(name);
    const write = writers.get(name) ?? (bytes && ((self: Writer) => self.bytes(bytes)));
    writePartReference(w, name, thing.parts.get(name), thing.partIds?.get(name), write || undefined, ctx);
  }
}

/**
 * Each part value a Thing read holds, by the value: its part's name and its
 * reference id. A part another part names -- a contact's `PShape` -- is written
 * by `writeNamedPart` under the same id and key as its Thing writes it.
 */
const PART_OF = new WeakMap<object, { readonly name: string; readonly id: number }>();

/** The part a value was read as, where it was. */
export function partOf(value: unknown): { readonly name: string; readonly id: number } | undefined {
  return typeof value === 'object' && value !== null ? PART_OF.get(value) : undefined;
}

/**
 * A reference to a part value from somewhere other than its Thing -- a
 * contact's shape -- written as its Thing writes it: the same key, the same id,
 * its body at whichever mention comes first. False when the value is no part read.
 */
export function writeNamedPart(w: Writer, value: object, ctx: PartWriteContext, writers: ReadonlyMap<string, PartWriter>): boolean {
  const part = PART_OF.get(value);
  if (!part) return false;
  writePartReference(w, part.name, value, part.id, writers.get(part.name), ctx);
  return true;
}

/** One part's reference: null for an id of 0 or no value, else its body at its first mention. */
function writePartReference(
  w: Writer,
  name: string,
  value: unknown,
  id: number | undefined,
  write: PartWriter | undefined,
  ctx: PartWriteContext,
): void {
  if (id === 0 || (value === undefined && id === undefined)) {
    w.i32(0);
    return;
  }
  const key = typeof value === 'object' && value !== null ? value : {};
  w.reference(key, (self) => {
    if (!write) throw new UnimplementedPartError(name);
    write(self, value as never, ctx);
  }, id);
}
