/** `INSTRUMENT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, type ResourceRef } from '../../io/serializer.ts';
import { decodeEntities, escapeEntities } from './entities.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** What an `INSTRUMENT` part yields — one placement on a sequencer's board. */
export interface InstrumentPart {
  /** The `RInstrument` GUID, or 0 when the placement is empty. */
  readonly guid: number;
  readonly name: string;
  /**
   * `PInstrument.Colour` at `+0x20`, exactly as the file holds it: the chip's
   * tint, packed **RGBA**, and UI only -- nothing musical reads it.
   *
   * `chips.ts` has the colour each instrument ships with, and what
   * `0xffffffff` means. Carried out rather than stepped over because a writer
   * needs it and because it is the one thing about a placement a composer sets
   * that has no other home.
   */
  readonly colour: number;
  readonly loops: number;
  readonly key: number;
  readonly scale: number;
  readonly level: number;
  readonly pan: number;
  readonly echoSend: number;
  readonly reverbSend: number;
  /** The note records, four bytes each, exactly as they sit on disk. */
  readonly notes: Uint8Array;
  /**
   * The chip's icon texture GUID, or 0.
   *
   * ❗ Carried out because a **writer** needs it: the icon is a property of the
   * instrument the chip holds, not of the music, and a plan written without one
   * puts a blank chip on the board. `INSTRUMENT_CHIPS` in `chips.ts` is the
   * table measured out of the corpus.
   */
  readonly icon: number;
  /** The `RInstrument` reference as the file holds it (cwlib `instrument`): its hash and flags with the GUID. */
  readonly instrument?: ResourceRef;
  /** The icon reference as the file holds it (cwlib `icon`); version 0x379 on. */
  readonly iconRef?: ResourceRef;
  /** The name exactly as the file holds it, where `escapeEntities(name)` would not give it back (as `Microchip.rawName`). */
  readonly rawName?: string;
  readonly scrollX?: number;
  readonly scrollY?: number;
  readonly cursorX?: number;
  readonly cursorY?: number;
}

/**
 * `PInstrument`: one instrument placed on a music sequencer's board.
 *
 * The note list comes back as raw bytes rather than decoded notes, because
 * `src/sequencer/notes.ts` already decodes that record and is the measured reader for
 * it. Four bytes each: `x | triplet<<7`, `y | end<<7`, volume, timbre.
 */
export function readInstrumentPart(s: Serializer): InstrumentPart {
  const { version } = s.revision;
  let scrollX: number | undefined;
  let scrollY: number | undefined;
  let cursorX: number | undefined;
  let cursorY: number | undefined;
  const resource = s.resource();
  const stored = version >= 0x35b ? s.wstr() : '';
  const name = decodeEntities(stored);
  const colour = s.i32();
  const loops = s.i32();
  const key = s.i32();
  const scale = s.i32();
  const level = s.f32();
  const pan = s.f32();
  const echoSend = s.f32();
  const reverbSend = s.f32();
  if (version >= 0x389) {
    scrollX = s.i16();
    scrollY = s.i16();
    cursorX = s.i16();
    cursorY = s.i16();
  }
  const count = s.count();
  const notes = s.bytes(count * 4).slice();
  const icon = version >= 0x379 ? s.resource() : undefined;
  return {
    guid: resource?.guid ?? 0,
    icon: icon?.guid ?? 0,
    name,
    colour,
    loops,
    key,
    scale,
    level,
    pan,
    echoSend,
    reverbSend,
    notes,
  scrollX, scrollY, cursorX, cursorY,
    instrument: resource, iconRef: icon,
    ...(escapeEntities(name) !== stored ? { rawName: stored } : {}),
  };
}

/** A reference as kept, or one made of `guid` where the value names another. */
function refOf(kept: ResourceRef | undefined, guid: number): ResourceRef | undefined {
  if (kept && (kept.guid ?? 0) === guid) return kept;
  if (!kept && guid === 0) return undefined;
  return guid === 0 ? undefined : { guid, flags: kept?.flags };
}

/** `readInstrumentPart`'s mirror; the name escaped again (`escapeEntities`). */
export function writeInstrumentPart(w: Writer, v: InstrumentPart, _ctx: PartWriteContext): void {
  const { version } = w.revision;
  w.ref(refOf(v.instrument, v.guid));
  if (version >= 0x35b) {
    w.wstr(v.rawName !== undefined && decodeEntities(v.rawName) === v.name ? v.rawName : escapeEntities(v.name));
  }
  w.i32(v.colour);
  w.i32(v.loops);
  w.i32(v.key);
  w.i32(v.scale);
  w.f32(v.level);
  w.f32(v.pan);
  w.f32(v.echoSend);
  w.f32(v.reverbSend);
  if (version >= 0x389) {
    w.i16(v.scrollX ?? 0);
    w.i16(v.scrollY ?? 0);
    w.i16(v.cursorX ?? 0);
    w.i16(v.cursorY ?? 0);
  }
  w.i32(v.notes.length / 4);
  w.bytes(v.notes);
  if (version >= 0x379) w.ref(refOf(v.iconRef, v.icon));
}
