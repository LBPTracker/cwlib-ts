/** `MICROCHIP`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import { decodeEntities, escapeEntities } from './entities.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

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
  /** Below version 0x2e4. */
  readonly circuitBoardVisible?: boolean;
  /** Below version 0x2e9: what the chip hangs on, and where, before `offset`. */
  readonly parentThing?: Thing;
  readonly cachedParentPos?: Float32Array;
  readonly localTransform?: Float32Array;
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
  /**
   * The byte `hideInPlayMode` was read from, where it is neither 0 nor 1: the
   * game's own boards hold others (0x74 on a board in `base_001.farc`
   * `024be227`), and only it writes the part back as it was.
   */
  readonly hideInPlayModeByte?: number;
  /**
   * The name exactly as the file holds it, where `escapeEntities(name)` would
   * not give it back: the game does not always escape (`'Wood Ringer'`, its
   * apostrophes bare, on a board of `chunk1_001.farc` `9f349085`). Written while
   * `name` is still what it decodes to.
   */
  readonly rawName?: string;
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
  // Below 0x2e9 the chip is placed by its parent and two matrices (cwlib's
  // `PMicrochip`): the archive's sackbot plans at 0x2c3 read 42 bytes short.
  const circuitBoardVisible = version < 0x2e4 ? s.bool() : undefined;
  let parentThing: Thing | undefined;
  let cachedParentPos: Float32Array | undefined;
  let localTransform: Float32Array | undefined;
  if (version < 0x2e9) {
    parentThing = readThingRef(s, readers);
    cachedParentPos = s.matrix();
    localTransform = s.matrix();
  }
  const hideByte = version >= 0x283 ? s.u8() : undefined;
  const hideInPlayMode = hideByte === undefined ? undefined : hideByte !== 0;
  const wiresVisible = version >= 0x2b8 ? s.bool() : undefined;
  const lastTouched = version >= 0x2e4 ? s.s32() : undefined;
  const offset = version >= 0x2e9 ? s.vector4() : undefined;

  let name = '';
  let rawName: string | undefined;
  let sizeX = 0;
  let sizeY = 0;
  const components: Component[] = [];
  if (version >= 0x34d) {
    const stored = s.wstr();
    name = decodeEntities(stored);
    if (escapeEntities(name) !== stored) rawName = stored;
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
    ...(version < 0x2e4 ? { circuitBoardVisible } : {}),
    ...(version < 0x2e9 ? { parentThing, cachedParentPos, localTransform } : {}),
    ...(hideByte !== undefined && hideByte > 1 ? { hideInPlayModeByte: hideByte } : {}),
    ...(rawName !== undefined ? { rawName } : {}),
  };
}

/** `readMicrochip`'s mirror; the name escaped again (`escapeEntities`). */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function writeMicrochip(w: Writer, v: Microchip, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  ctx.thing(w, v.board);
  if (version < 0x2e4) w.bool(v.circuitBoardVisible ?? false);
  if (version < 0x2e9) {
    ctx.thing(w, v.parentThing);
    w.matrix(v.cachedParentPos ?? IDENTITY);
    w.matrix(v.localTransform ?? IDENTITY);
  }
  if (version >= 0x283) w.u8(v.hideInPlayMode ? (v.hideInPlayModeByte ?? 1) : 0);
  if (version >= 0x2b8) w.bool(v.wiresVisible ?? false);
  if (version >= 0x2e4) w.s32(v.lastTouched ?? 0);
  if (version >= 0x2e9) w.vector4(v.offset ?? [0, 0, 0, 0]);
  if (version >= 0x34d) {
    w.wstr(v.rawName !== undefined && decodeEntities(v.rawName) === v.name ? v.rawName : escapeEntities(v.name));
    w.i32(v.components.length);
    for (const c of v.components) {
      ctx.thing(w, c.thing);
      w.f32(c.x);
      w.f32(c.y);
      w.f32(c.angle);
      w.f32(c.scaleX);
      w.f32(c.scaleY);
      w.bool(c.flipped);
    }
    w.f32(v.sizeX);
    w.f32(v.sizeY);
  }
  if (subVersion >= 0x1d) w.bool(v.keepVisualVertical ?? false);
  if (subVersion >= 0x2d) w.u8(v.broadcastType ?? 0);
}
