/** `INSTRUMENT`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { decodeEntities } from './entities.ts';

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
  const resource = s.resource();
  const name = version >= 0x35b ? decodeEntities(s.wstr()) : '';
  const colour = s.i32();
  const loops = s.i32();
  const key = s.i32();
  const scale = s.i32();
  const level = s.f32();
  const pan = s.f32();
  const echoSend = s.f32();
  const reverbSend = s.f32();
  if (version >= 0x389) {
    s.i16(); // scrollX
    s.i16(); // scrollY
    s.i16(); // cursorX
    s.i16(); // cursorY
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
  };
}
