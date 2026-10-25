/** `SEQUENCER`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer } from '../../io/serializer.ts';
import { readThingRef, type PartReader, type Thing } from '../thing.ts';
import type { Writer } from '../../io/writer.ts';
import type { PartWriteContext } from '../write-parts.ts';

/** What a `SEQUENCER` part yields. */
export interface SequencerPart {
  readonly tempo: number;
  readonly swing: number;
  readonly echoFeedback: number;
  readonly echoTime: number;
  readonly echoMix: number;
  readonly reverbSettings: number;
  readonly loop: boolean;
  readonly startPoint: number;
  readonly numChannels: number;
  readonly volumes: readonly number[];
  /** False for an animation or logic sequencer — those carry no music. */
  readonly musicSequencer: boolean;
  readonly playHead?: number;
  readonly isPlaying?: boolean;
  readonly triggerPlayer?: number;
  readonly animationSequencer?: boolean;
  readonly behavior?: number;
  /** cwlib's `previewThing`; version 0x3a1 on. */
  readonly previewThing?: Thing;
}

/**
 * `PSequencer`: the music sequencer itself.
 *
 * ⚠️ `volume` is a **fixed six floats**, not a length-prefixed array. Six is the
 * channel count the UI exposes; `numChannels` says how many are in use and is
 * read separately.
 */
export function readSequencerPart(s: Serializer, readers: ReadonlyMap<string, PartReader>): SequencerPart {
  const { version, subVersion } = s.revision;
  let animationSequencer: boolean | undefined;
  let behavior: number | undefined;
  let playHead: number | undefined;
  let isPlaying: boolean | undefined;
  let triggerPlayer: number | undefined;
  let previewThing: Thing | undefined;
  const tempo = s.f32();
  const swing = s.f32();
  const echoFeedback = s.f32();
  const echoTime = s.f32();
  const echoMix = s.f32();
  const reverbSettings = version > 0x370 ? s.i32() : 0;
  const loop = version > 0x36e ? s.bool() : false;
  const startPoint = s.f32();
  const numChannels = s.i32();
  const volumes: number[] = [];
  for (let i = 0; i < 6; i += 1) volumes.push(s.f32());
  if (version > 0x369) {
    playHead = s.f32();
    isPlaying = s.bool();
  }
  const musicSequencer = version > 0x36c ? s.bool() : false;
  if (subVersion > 0x28) animationSequencer = s.bool();
  if (version > 0x371) behavior = s.i32();
  if (version > 0x3a0) {
    triggerPlayer = s.i32();
    previewThing = readThingRef(s, readers);
  }
  return {
    tempo,
    swing,
    echoFeedback,
    echoTime,
    echoMix,
    reverbSettings,
    loop,
    startPoint,
    numChannels,
    volumes,
    musicSequencer,
  playHead, isPlaying, triggerPlayer,
    animationSequencer, behavior, previewThing,
  };
}

/** `readSequencerPart`'s mirror. */
export function writeSequencerPart(w: Writer, v: SequencerPart, ctx: PartWriteContext): void {
  const { version, subVersion } = w.revision;
  w.f32(v.tempo);
  w.f32(v.swing);
  w.f32(v.echoFeedback);
  w.f32(v.echoTime);
  w.f32(v.echoMix);
  if (version > 0x370) w.i32(v.reverbSettings);
  if (version > 0x36e) w.bool(v.loop);
  w.f32(v.startPoint);
  w.i32(v.numChannels);
  for (let i = 0; i < 6; i += 1) w.f32(v.volumes[i] ?? 0);
  if (version > 0x369) {
    w.f32(v.playHead ?? 0);
    w.bool(v.isPlaying ?? false);
  }
  if (version > 0x36c) w.bool(v.musicSequencer);
  if (subVersion > 0x28) w.bool(v.animationSequencer ?? false);
  if (version > 0x371) w.i32(v.behavior ?? 0);
  if (version > 0x3a0) {
    w.i32(v.triggerPlayer ?? 0);
    ctx.thing(w, v.previewThing);
  }
}
