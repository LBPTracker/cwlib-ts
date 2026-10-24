/**
 * `RInstrument` (resource type 48, magic `INSb`) -- the sampler patch.
 *
 * Eight sample slots, eight sample GUIDs, nine key-split boundaries, the 27
 * synth parameters and the arpeggiator. The GUIDs address plain RIFF/WAV files
 * in the FARC archives through the game's FileDB; lbptracker's
 * steering/game-assets.md has that chain and `tools/ExtractGuid.java` walks it.
 *
 * Field order is from the game's own serialisers (`v0xc68a70`, the slot at
 * `v0xcc0e90`), cross-checked against every one of the 68 `.rinst` files the
 * game ships -- steering/sequencer-data-model.md, *`RInstrument`*. Integers
 * here are varints: see `ByteReader.varuint` / `.varint` and the warning there.
 *
 * What the engine does with a patch -- which slot a note lands in, the unison
 * stack, the playback rate, the 27 parameters' meaning -- is lbptracker's
 * (steering/sequencer-engine-inputs.md, steering/synth-engine.md there).
 */

import { ByteReader } from '../io/stream.ts';

export const MAX_SLOTS = 8;
/** 8 zones; `[0]` is a constant, `[1..8]` are the bounds. */
export const MAX_SPLITS = 9;
export const MAX_PARAMS = 27;
export const MAX_ARPEGGIO = 32;

/** One of the 8 sample slots. 16 bytes in the game's memory. */
export interface SampleSlot {
  /** The note the sample was recorded at. */
  readonly baseNote: number;
  /** The sample's own tempo, for loops. */
  readonly baseBpm: number;
  /** Fine pitch offset, in **semitones** -- measured in lbptracker, see its `pitchRatio`. */
  readonly fineTune: number;
  /** Pitch-shift with the note, or play at a fixed rate (percussion). */
  readonly pitched: boolean;
  /** Rate-match the sample to the sequencer tempo. */
  readonly fitBpm: boolean;
}

export interface InstrumentParam {
  readonly x: number;
  readonly y: number;
}

export interface RInstrument {
  readonly slots: readonly SampleSlot[];
  /** GUIDs into the FileDB; 0 means the slot is unused. */
  readonly sampleGuids: readonly number[];
  readonly splitNotes: readonly number[];
  /**
   * ⚠️ **Not the number of slots in use** -- `sampleGuids[i] !== 0` is. It is
   * the unison stack's layer count; lbptracker's
   * steering/sequencer-engine-inputs.md has the measurement.
   */
  readonly numStack: number;
  readonly params: readonly InstrumentParam[];
  readonly arpeggio: readonly number[];
  readonly arpeggiate: boolean;
}

export class InstrumentFormatError extends Error {}

function expectCount(reader: ByteReader, expected: number, what: string): void {
  const count = reader.varuint();
  if (count !== expected) {
    throw new InstrumentFormatError(
      `${what}: expected ${expected} entries, header says ${count} ` +
        `(at byte ${reader.position})`,
    );
  }
}

function readSlot(reader: ByteReader): SampleSlot {
  const baseNote = reader.varint();
  const baseBpm = reader.f32();
  const pitched = reader.bool();
  // The serialiser emits `fitbpm` twice into the same member -- a duplicate in
  // the game's own code, not two settings. Measured at v0xcc0eea / v0xcc0ef8.
  const fitBpm = reader.bool();
  reader.bool();
  const fineTune = reader.f32();
  return { baseNote, baseBpm, pitched, fitBpm, fineTune };
}

/**
 * Parse an RInstrument from the *decompressed* payload of an `INSb` resource
 * (`loadResource(...).data`).
 *
 * Throws unless the payload is consumed exactly. That check is the reason to
 * trust this: a misread varint leaves the cursor somewhere else, and across 68
 * real instruments all of them land on the final byte.
 */
export function readInstrument(payload: Uint8Array): RInstrument {
  const reader = new ByteReader(payload);

  expectCount(reader, MAX_SLOTS, 'Samples');
  const slots: SampleSlot[] = [];
  for (let i = 0; i < MAX_SLOTS; i += 1) slots.push(readSlot(reader));

  expectCount(reader, MAX_SLOTS, 'SampleGuids');
  const sampleGuids: number[] = [];
  for (let i = 0; i < MAX_SLOTS; i += 1) sampleGuids.push(reader.varuint());

  expectCount(reader, MAX_SPLITS, 'Splitnotes');
  const splitNotes: number[] = [];
  for (let i = 0; i < MAX_SPLITS; i += 1) splitNotes.push(reader.varint());

  const numStack = reader.varint();

  // Each param is written as its own two-element array, so the count repeats.
  const params: InstrumentParam[] = [];
  for (let i = 0; i < MAX_PARAMS; i += 1) {
    expectCount(reader, 2, `Params[${i}]`);
    params.push({ x: reader.f32(), y: reader.f32() });
  }

  expectCount(reader, MAX_ARPEGGIO, 'Arpeggio');
  const arpeggio: number[] = [];
  for (let i = 0; i < MAX_ARPEGGIO; i += 1) arpeggio.push(reader.i8());

  const arpeggiate = reader.bool();

  if (reader.remaining !== 0) {
    throw new InstrumentFormatError(
      `${reader.remaining} bytes left over after the instrument ` +
        `(read ${reader.position} of ${payload.length})`,
    );
  }

  return { slots, sampleGuids, splitNotes, numStack, params, arpeggio, arpeggiate };
}

/** The slots that are actually in use, paired with their sample GUID. */
export function usedSlots(
  instrument: RInstrument,
): { slot: SampleSlot; guid: number; index: number }[] {
  const out: { slot: SampleSlot; guid: number; index: number }[] = [];
  for (let i = 0; i < instrument.slots.length; i += 1) {
    if (instrument.sampleGuids[i]) {
      out.push({ slot: instrument.slots[i], guid: instrument.sampleGuids[i], index: i });
    }
  }
  return out;
}
