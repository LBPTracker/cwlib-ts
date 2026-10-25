/**
 * Parts written from their values: each part reader's mirror, so a part changed
 * or added can be written into a level, a plan or a chunk on its tape
 * (`write-level.ts`). cwlib's one serializer writes every part it reads; here a
 * writer sits beside each reader, in its file -- `writeBody` beside `readBody` --
 * and this table finds it by that name.
 *
 * ❗ **A writer is checked against the game's own parts, not against its
 * reader.** `dev/part-census.ts` writes every part of every Thing in the game's
 * FARCs from its value and compares the bytes with the file's; the counts are in
 * steering/level-files.md, *Parts written from their values*. A read cwlib
 * writes as a constant is written as cwlib writes it, 0 or false, so a part
 * holding something else there changes in those bytes alone.
 *
 * A Thing a part names goes through `ctx.thing`, which on a tape writes it as the
 * tape does: its id, and its body at its first mention.
 */

import type { Writer } from '../io/writer.ts';
import type { Thing } from './thing.ts';
import * as animation from './parts/animation.ts';
import * as animationTweak from './parts/animation-tweak.ts';
import * as atmosphericTweak from './parts/atmospheric-tweak.ts';
import * as audioWorld from './parts/audio-world.ts';
import * as body from './parts/body.ts';
import * as cameraTweak from './parts/camera-tweak.ts';
import * as checkpoint from './parts/checkpoint.ts';
import * as connectorHook from './parts/connector-hook.ts';
import * as controlinator from './parts/controlinator.ts';
import * as costume from './parts/costume.ts';
import * as creature from './parts/creature.ts';
import * as decorations from './parts/decorations.ts';
import * as effector from './parts/effector.ts';
import * as emitter from './parts/emitter.ts';
import * as enemy from './parts/enemy.ts';
import * as fader from './parts/fader.ts';
import * as gameplayData from './parts/gameplay-data.ts';
import * as generatedMesh from './parts/generated-mesh.ts';
import * as group from './parts/group.ts';
import * as hudElem from './parts/hud-elem.ts';
import * as instrument from './parts/instrument.ts';
import * as joint from './parts/joint.ts';
import * as levelSettings from './parts/level-settings.ts';
import * as materialOverride from './parts/material-override.ts';
import * as materialTweak from './parts/material-tweak.ts';
import * as metadata from './parts/metadata.ts';
import * as microchip from './parts/microchip.ts';
import * as npc from './parts/npc.ts';
import * as physicsTweak from './parts/physics-tweak.ts';
import * as pocketItem from './parts/pocket-item.ts';
import * as poppetPowerup from './parts/poppet-powerup.ts';
import * as pos from './parts/pos.ts';
import * as powerUp from './parts/power-up.ts';
import * as quest from './parts/quest.ts';
import * as ref from './parts/ref.ts';
import * as renderMesh from './parts/render-mesh.ts';
import * as script from './parts/script.ts';
import * as scriptName from './parts/script-name.ts';
import * as sequencer from './parts/sequencer.ts';
import * as shape from './parts/shape.ts';
import * as spriteLight from './parts/sprite-light.ts';
import * as stickers from './parts/stickers.ts';
import * as streamingData from './parts/streaming-data.ts';
import * as streamingHint from './parts/streaming-hint.ts';
import * as switchPart from './parts/switch.ts';
import * as switchInput from './parts/switch-input.ts';
import * as switchKey from './parts/switch-key.ts';
import * as tagSynchronizer from './parts/tag-synchronizer.ts';
import * as transition from './parts/transition.ts';
import * as trigger from './parts/trigger.ts';
import * as vita from './parts/vita.ts';
import * as windTweak from './parts/wind-tweak.ts';
import * as wormhole from './parts/wormhole.ts';
import * as yellowhead from './parts/yellowhead.ts';

/** What a part writer needs beyond the stream: how to write a reference to a Thing. */
export interface PartWriteContext {
  thing(w: Writer, thing: Thing | undefined): void;
}

/** Writes one part's body from what its reader returned. */
export type PartWriter = (w: Writer, value: never, ctx: PartWriteContext) => void;

/** Each part, the module its reader is in, and the reader's name. */
const READERS: readonly (readonly [string, Record<string, unknown>, string])[] = [
  ['BODY', body, 'readBody'],
  ['POS', pos, 'readPos'],
  ['JOINT', joint, 'readJoint'],
  ['TRIGGER', trigger, 'readTrigger'],
  ['SHAPE', shape, 'readShape'],
  ['GROUP', group, 'readGroup'],
  ['LEVEL_SETTINGS', levelSettings, 'readLevelSettingsPart'],
  ['GENERATED_MESH', generatedMesh, 'readGeneratedMesh'],
  ['RENDER_MESH', renderMesh, 'readRenderMesh'],
  ['SWITCH_KEY', switchKey, 'readSwitchKey'],
  ['DECORATIONS', decorations, 'readDecorations'],
  ['STICKERS', stickers, 'readStickers'],
  ['CHECKPOINT', checkpoint, 'readCheckpoint'],
  ['PHYSICS_TWEAK', physicsTweak, 'readPhysicsTweak'],
  ['SWITCH', switchPart, 'readSwitch'],
  ['MICROCHIP', microchip, 'readMicrochip'],
  ['CAMERA_TWEAK', cameraTweak, 'readCameraTweak'],
  ['SEQUENCER', sequencer, 'readSequencerPart'],
  ['SWITCH_INPUT', switchInput, 'readSwitchInput'],
  ['CONTROLINATOR', controlinator, 'readControlinator'],
  ['EMITTER', emitter, 'readEmitter'],
  ['SPRITE_LIGHT', spriteLight, 'readSpriteLight'],
  ['SCRIPT', script, 'readScript'],
  ['MATERIAL_TWEAK', materialTweak, 'readMaterialTweak'],
  ['ENEMY', enemy, 'readEnemy'],
  ['CREATURE', creature, 'readCreature'],
  ['YELLOWHEAD', yellowhead, 'readYellowHead'],
  ['NPC', npc, 'readNpc'],
  ['POCKET_ITEM', pocketItem, 'readPocketItem'],
  ['TRANSITION', transition, 'readTransition'],
  ['FADER', fader, 'readFader'],
  ['ANIMATION_TWEAK', animationTweak, 'readAnimationTweak'],
  ['WIND_TWEAK', windTweak, 'readWindTweak'],
  ['STREAMING_DATA', streamingData, 'readStreamingData'],
  ['STREAMING_HINT', streamingHint, 'readStreamingHint'],
  ['REF', ref, 'readRef'],
  ['POWER_UP', powerUp, 'readPowerUp'],
  ['ANIMATION', animation, 'readAnimation'],
  ['ATMOSPHERIC_TWEAK', atmosphericTweak, 'readAtmosphericTweak'],
  ['SCRIPT_NAME', scriptName, 'readScriptName'],
  ['METADATA', metadata, 'readMetadata'],
  ['EFFECTOR', effector, 'readEffector'],
  ['WORMHOLE', wormhole, 'readWormhole'],
  ['MATERIAL_OVERRIDE', materialOverride, 'readMaterialOverride'],
  ['CONNECTOR_HOOK', connectorHook, 'readConnectorHook'],
  ['VITA_27', vita, 'readVita27'],
  ['VITA_28', vita, 'readVita28'],
  ['INSTRUMENT', instrument, 'readInstrumentPart'],
  ['GAMEPLAY_DATA', gameplayData, 'readGameplayData'],
  ['AUDIO_WORLD', audioWorld, 'readAudioWorld'],
  ['COSTUME', costume, 'readCostume'],
  ['QUEST', quest, 'readQuest'],
  ['POPPET_POWERUP', poppetPowerup, 'readPoppetPowerup'],
  ['TAG_SYNCHRONIZER', tagSynchronizer, 'readTagSynchroniser'],
  ['HUD_ELEM', hudElem, 'readHudElem'],
];

/** Every part with a writer, by its name in `PARTS`: its module's `write…` beside its `read…`. */
export function partWriters(): Map<string, PartWriter> {
  const writers = new Map<string, PartWriter>();
  for (const [name, module, reader] of READERS) {
    const write = module['write' + reader.slice(4)];
    if (typeof write === 'function') writers.set(name, write as PartWriter);
  }
  return writers;
}
