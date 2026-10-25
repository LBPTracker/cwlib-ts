/** `MICROCHIP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { decodeEntities } from './entities.ts';

/**
 * One component placed on a circuit board: which Thing, and where on the grid.
 *
 * ❗ **`scaleX` is the chip's width and it is derived, not decorative.** Measured
 * over 3,746 components in 17 real LBP3 sequencer plans: `scaleY` is
 * 1.4666666 on every one of them and `scaleX` is an exact multiple of it --
 * 4.4 (×3) on 2,057, 2.9333 (×2) on 625, 10.2667 (×7) on 457, and so on. A
 * writer that leaves them at 1 draws every instrument as a one-cell stub, so
 * they are carried out of the reader rather than stepped over.
 */
export interface Component {
  readonly thing?: Thing;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly flipped: boolean;
}

/** What a `MICROCHIP` part yields: the board's name and what is on it. */
export interface Microchip {
  readonly name: string;
  readonly components: readonly Component[];
  /**
   * The board's own extent, in world units.
   *
   * ❗ **`sizeY` is what routes a track to a mixer channel.** The engine cuts the
   * board into `NumChannels` horizontal bands -- `floor(sizeY / 105 + 0.5)` rows
   * divided by the channel count -- and a placement's channel is its band. Both
   * fields were read and discarded here until 2026-09-05; see `channelVolume` in
   * `project.ts` and answered question 9.
   */
  readonly sizeX: number;
  readonly sizeY: number;
  /**
   * The board Thing.
   *
   * ⚠️ Needed because `components` is **empty while the board is open in the
   * editor**: the game promotes the components to real Things parented to the
   * board and stops maintaining the compact list. `musicSequencers` in
   * `level.ts` rebuilds it from the Thing graph in that case.
   */
  readonly board?: Thing;
  /** Version `0x283` on. */
  readonly hideInPlayMode?: boolean;
  /** Version `0x2b8` on. */
  readonly wiresVisible?: boolean;
  /** Version `0x2e4` on. */
  readonly lastTouched?: number;
  /** Version `0x2e9` on. */
  readonly offset?: readonly [number, number, number, number];
  /** subVersion `0x1d` on. */
  readonly keepVisualVertical?: boolean;
  /** subVersion `0x2d` on. */
  readonly broadcastType?: number;
}

/**
 * `PMicrochip`: a circuit board.
 *
 * This is the part the whole level parse exists for — a music sequencer is a
 * `SEQUENCER` on a Thing whose `MICROCHIP` holds one component per instrument,
 * and the component's `x`/`y` are the board cell that `project.ts` turns into a
 * track's step offset and row.
 */
export function readMicrochip(
  s: Serializer,
  readers: ReadonlyMap<string, PartReader>,
): Microchip {
  const { version, subVersion } = s.revision;
  const board = readThingRef(s, readers); // circuitBoardThing
  const hideInPlayMode = version >= 0x283 ? s.bool() : undefined;
  const wiresVisible = version >= 0x2b8 ? s.bool() : undefined;
  const lastTouched = version >= 0x2e4 ? s.s32() : undefined;
  const offset = version >= 0x2e9 ? s.vector4() : undefined;

  let name = '';
  let sizeX = 0;
  let sizeY = 0;
  const components: Component[] = [];
  if (version >= 0x34d) {
    name = decodeEntities(s.wstr());
    const count = s.count();
    for (let i = 0; i < count; i += 1) {
      const thing = readThingRef(s, readers);
      const x = s.f32();
      const y = s.f32();
      const angle = s.f32();
      const scaleX = s.f32();
      const scaleY = s.f32();
      const flipped = s.bool();
      components.push({ thing, x, y, angle, scaleX, scaleY, flipped });
    }
    sizeX = s.f32(); // circuitBoardSizeX
    sizeY = s.f32(); // circuitBoardSizeY
  }

  const keepVisualVertical = subVersion >= 0x1d ? s.bool() : undefined;
  const broadcastType = subVersion >= 0x2d ? s.u8() : undefined;
  return {
    name, components, board, sizeX, sizeY, hideInPlayMode, wiresVisible, lastTouched, offset,
    keepVisualVertical, broadcastType,
  };
}
