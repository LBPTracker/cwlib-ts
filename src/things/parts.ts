/**
 * The Thing part readers.
 *
 * One function per part type. None of them keeps anything it does not need —
 * what matters is that each consumes **exactly** the right number of bytes,
 * because the next Thing starts immediately after and there is no length to
 * resynchronise from.
 *
 * ## The format checks itself, once per Thing
 *
 * Every Thing begins with a `0xAA` marker (`thing.ts`). That is the only reason
 * building this by transcription is tractable: a part that reads one byte too
 * few or too many does not produce subtly wrong data, it fails loudly at the
 * *next* Thing. Treat a marker failure as "the part before this one is wrong",
 * not as a corrupt file.
 *
 * ## Revision gates
 *
 * Fields are gated on `version` (the head's low half) and `subVersion` (its high
 * half). ⚠️ **Nine of the ten corpus levels report `subVersion` 0** — by cwlib's
 * own test (`isLBP3()` is `head >> 16 != 0`) they are LBP2-revision files that
 * LBP3 wrote. Every `subVersion >= n` gate is therefore false on them, and that
 * is right: the game's own loaders compare the whole head word (`PQuest` at
 * `v0xdc0290` against `0x9d0000`, `0x1410000` and `0x51ffff`, `PWormhole` at
 * `v0xd46f20` against `0x1110000`), so a subVersion-0 file takes the old side of
 * every one. This header used to say a gate had failed on them; the failure
 * was a part read under the wrong mask bit (`partBit` in `thing.ts`).
 */

import { Serializer } from '../io/serializer.ts';
import { type PartReader } from './thing.ts';
import { readAnimation } from './parts/animation.ts';
import { readAnimationTweak } from './parts/animation-tweak.ts';
import { readAtmosphericTweak } from './parts/atmospheric-tweak.ts';
import { readAudioWorld } from './parts/audio-world.ts';
import { readBody } from './parts/body.ts';
import { readCameraTweak } from './parts/camera-tweak.ts';
import { readCheckpoint } from './parts/checkpoint.ts';
import { readConnectorHook } from './parts/connector-hook.ts';
import { readControlinator } from './parts/controlinator.ts';
import { readCostume } from './parts/costume.ts';
import { readCreature } from './parts/creature.ts';
import { readDecorations } from './parts/decorations.ts';
import { readEffector } from './parts/effector.ts';
import { readEmitter } from './parts/emitter.ts';
import { readEnemy } from './parts/enemy.ts';
import { readFader } from './parts/fader.ts';
import { readGameplayData } from './parts/gameplay-data.ts';
import { readGeneratedMesh } from './parts/generated-mesh.ts';
import { readGroup } from './parts/group.ts';
import { readHudElem } from './parts/hud-elem.ts';
import { readInstrumentPart } from './parts/instrument.ts';
import { readJoint } from './parts/joint.ts';
import { readLevelSettingsPart } from './parts/level-settings.ts';
import { readMaterialOverride } from './parts/material-override.ts';
import { readMaterialTweak } from './parts/material-tweak.ts';
import { readMetadata } from './parts/metadata.ts';
import { readMicrochip } from './parts/microchip.ts';
import { readNpc } from './parts/npc.ts';
import { readPhysicsTweak } from './parts/physics-tweak.ts';
import { readPocketItem } from './parts/pocket-item.ts';
import { readPoppetPowerup } from './parts/poppet-powerup.ts';
import { readPos } from './parts/pos.ts';
import { readPowerUp } from './parts/power-up.ts';
import { readQuest } from './parts/quest.ts';
import { readVita27, readVita28 } from './parts/vita.ts';
import { readRef } from './parts/ref.ts';
import { readRenderMesh } from './parts/render-mesh.ts';
import { readScript } from './parts/script.ts';
import { readScriptName } from './parts/script-name.ts';
import { readSequencerPart } from './parts/sequencer.ts';
import { readShape } from './parts/shape.ts';
import { readSpriteLight } from './parts/sprite-light.ts';
import { readStickers } from './parts/stickers.ts';
import { readStreamingData } from './parts/streaming-data.ts';
import { readStreamingHint } from './parts/streaming-hint.ts';
import { readSwitch } from './parts/switch.ts';
import { readSwitchInput } from './parts/switch-input.ts';
import { readSwitchKey } from './parts/switch-key.ts';
import { readTagSynchroniser } from './parts/tag-synchronizer.ts';
import { readTransition } from './parts/transition.ts';
import { readTrigger } from './parts/trigger.ts';
import { readWindTweak } from './parts/wind-tweak.ts';
import { readWormhole } from './parts/wormhole.ts';
import { readYellowHead } from './parts/yellowhead.ts';

export { readAudioWorld, type AudioWorldPart } from './parts/audio-world.ts';
export { readBody, type BodyPart } from './parts/body.ts';
export { readCameraTweak } from './parts/camera-tweak.ts';
export { readCheckpoint, type CheckpointPart } from './parts/checkpoint.ts';
export { readControlinator } from './parts/controlinator.ts';
export { readCostume, type CostumePart, type CostumePiece, type CostumePrimitive } from './parts/costume.ts';
export { readAnimation, type AnimationPart } from './parts/animation.ts';
export { readMaterialOverride, type MaterialOverridePart, type RegionOverride } from './parts/material-override.ts';
export { readAtmosphericTweak, type AtmosphericTweakPart } from './parts/atmospheric-tweak.ts';
export { readCreature } from './parts/creature.ts';
export { readDecorations, type Decoration } from './parts/decorations.ts';
export { readEmitter, type EmittedObjectSource, type EmitterPart } from './parts/emitter.ts';
export { readEnemy, type EnemyPart } from './parts/enemy.ts';
export { readConnectorHook, type ConnectorHookPart } from './parts/connector-hook.ts';
export { readPocketItem, type PocketItemPart } from './parts/pocket-item.ts';
export { readTagSynchroniser, type TagSynchronizerPart } from './parts/tag-synchronizer.ts';
export { readWindTweak, type WindTweakPart } from './parts/wind-tweak.ts';
export { readFader, type FaderPart } from './parts/fader.ts';
export { readMetadata, type MetadataPart } from './parts/metadata.ts';
export { readPowerUp, type PowerUpPart } from './parts/power-up.ts';
export { readRef, type RefPart } from './parts/ref.ts';
export { readScriptName } from './parts/script-name.ts';
export { readStreamingData, type StreamingDataPart } from './parts/streaming-data.ts';
export { readStreamingHint, type StreamingHintPart } from './parts/streaming-hint.ts';
export { readTransition, type TransitionPart } from './parts/transition.ts';
export { readEffector, type EffectorPart } from './parts/effector.ts';
export { readWormhole, type WormholePart } from './parts/wormhole.ts';
export { decodeEntities, escapeEntities } from './parts/entities.ts';
export { readGameplayData, type GameplayDataPart } from './parts/gameplay-data.ts';
export { readGeneratedMesh, type GeneratedMeshPart } from './parts/generated-mesh.ts';
export { readGroup, type GroupPart } from './parts/group.ts';
export { readInstrumentPart, type InstrumentPart } from './parts/instrument.ts';
export { readJoint, type JointPart } from './parts/joint.ts';
export {
  readLevelSettingsPart,
  type LevelLighting,
  type LevelSettingsPart,
} from './parts/level-settings.ts';
export { readMaterialTweak, type MaterialTweakPart } from './parts/material-tweak.ts';
export { readMicrochip, type Component, type Microchip } from './parts/microchip.ts';
export { readNpc } from './parts/npc.ts';
export { readPhysicsTweak } from './parts/physics-tweak.ts';
export { readPos } from './parts/pos.ts';
export { readRenderMesh, type RenderMeshPart } from './parts/render-mesh.ts';
export { readScript, type ScriptField, type ScriptFieldLayout, type ScriptInstance, type ScriptObject, type ScriptValue } from './parts/script.ts';
export { readSequencerPart, type SequencerPart } from './parts/sequencer.ts';
export { readShape, type ShapePart } from './parts/shape.ts';
export { readSpriteLight, type SpriteLightPart } from './parts/sprite-light.ts';
export { readStickers, type Decal, type StickersPart } from './parts/stickers.ts';
export { readSwitch, type SwitchPart, type SwitchTarget } from './parts/switch.ts';
export { readSwitchInput } from './parts/switch-input.ts';
export { readSwitchKey, type SwitchKeyPart } from './parts/switch-key.ts';
export { readTrigger, type TriggerPart } from './parts/trigger.ts';
export { readYellowHead } from './parts/yellowhead.ts';
export { SerializerError } from '../io/serializer.ts';

/** Everything implemented so far, ready to hand to `readLevel`. */
export function partReaders(): Map<string, PartReader> {
  const readers = new Map<string, PartReader>();
  const bind = (name: string, read: (s: Serializer, r: ReadonlyMap<string, PartReader>) => void) => {
    readers.set(name, (s) => read(s, readers));
  };
  bind('BODY', readBody);
  bind('POS', readPos);
  bind('JOINT', readJoint);
  bind('TRIGGER', readTrigger);
  bind('SHAPE', readShape);
  bind('GROUP', readGroup);
  bind('LEVEL_SETTINGS', readLevelSettingsPart);
  bind('GENERATED_MESH', readGeneratedMesh);
  bind('RENDER_MESH', readRenderMesh);
  bind('SWITCH_KEY', readSwitchKey);
  bind('DECORATIONS', readDecorations);
  bind('STICKERS', readStickers);
  bind('CHECKPOINT', readCheckpoint);
  bind('PHYSICS_TWEAK', readPhysicsTweak);
  bind('SWITCH', readSwitch);
  bind('MICROCHIP', readMicrochip);
  bind('CAMERA_TWEAK', readCameraTweak);
  readers.set('INSTRUMENT', (s) => readInstrumentPart(s));
  bind('SEQUENCER', readSequencerPart);
  readers.set('GAMEPLAY_DATA', (s) => readGameplayData(s));
  readers.set('AUDIO_WORLD', (s) => readAudioWorld(s));
  bind('SWITCH_INPUT', readSwitchInput);
  bind('CONTROLINATOR', readControlinator);
  bind('EMITTER', readEmitter);
  bind('SPRITE_LIGHT', readSpriteLight);
  bind('SCRIPT', readScript);
  bind('MATERIAL_TWEAK', readMaterialTweak);
  bind('ENEMY', readEnemy);
  bind('CREATURE', readCreature);
  bind('YELLOWHEAD', readYellowHead);
  readers.set('COSTUME', (s) => readCostume(s));
  bind('NPC', readNpc);
  bind('POCKET_ITEM', readPocketItem);
  bind('TRANSITION', readTransition);
  bind('FADER', readFader);
  bind('ANIMATION_TWEAK', readAnimationTweak);
  bind('WIND_TWEAK', readWindTweak);
  bind('STREAMING_DATA', readStreamingData);
  bind('STREAMING_HINT', readStreamingHint);
  bind('REF', readRef);
  bind('POWER_UP', readPowerUp);
  bind('ANIMATION', readAnimation);
  bind('ATMOSPHERIC_TWEAK', readAtmosphericTweak);
  bind('SCRIPT_NAME', readScriptName);
  readers.set('QUEST', (s) => readQuest(s));
  bind('METADATA', readMetadata);
  bind('EFFECTOR', readEffector);
  bind('WORMHOLE', readWormhole);
  bind('MATERIAL_OVERRIDE', readMaterialOverride);
  bind('CONNECTOR_HOOK', readConnectorHook);
  readers.set('POPPET_POWERUP', (s) => readPoppetPowerup(s));
  readers.set('TAG_SYNCHRONIZER', (s) => readTagSynchroniser(s));
  readers.set('HUD_ELEM', (s) => readHudElem(s));
  bind('VITA_27', readVita27);
  bind('VITA_28', readVita28);
  return readers;
}
