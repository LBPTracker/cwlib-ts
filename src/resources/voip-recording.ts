/**
 * `VOIP_RECORDING` -- a recorded voice: magic `VOPb`, inside the crossplay
 * `.cpv`s (`minigame2_002_crossplayvita_03.cpv`). One length-prefixed block of
 * audio, kept as it is: its codec is not read here.
 *
 * ❗ cwlib has the type and no class; all four of the game's end on their last
 * byte with the block alone (steering/level-files.md, *Small resources*).
 */

import { openSerializer, type Inflate } from '../io/resource.ts';
import { SerializerError, type RevisionInfo } from '../io/serializer.ts';
import { Writer } from '../io/writer.ts';

export interface VoipRecording {
  readonly revision: RevisionInfo;
  readonly data: Uint8Array;
}

/** Read a `VOPb`. Throws on anything else, and unless the walk ends on the payload's last byte. */
export async function readVoipRecording(bytes: Uint8Array, inflate: Inflate): Promise<VoipRecording> {
  const { resource, revision, s } = await openSerializer(bytes, inflate);
  if (resource.magic !== 'VOPb') throw new SerializerError(`not a VoIP recording: "${resource.magic}"`);
  const data = s.bytes(s.i32());
  if (s.remaining !== 0) throw new SerializerError(`VOPb read ended ${s.remaining} bytes before the end of its payload`);
  return { revision, data };
}

/** `readVoipRecording`'s mirror: the payload, from the value. */
export function encodeVoipRecording(value: VoipRecording, header: { revision: RevisionInfo; compressionFlags: number }): Uint8Array {
  const w = new Writer(header.revision, header.compressionFlags);
  w.i32(value.data.length);
  w.bytes(value.data);
  return w.done();
}
