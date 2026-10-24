# What Java cwlib has and this library does not

Read before porting a reader, a writer or a tool from ennuo's cwlib, and before saying what this
library covers. It lists what exists there and not here; whether Java's reading is *right* is a
separate question, and [lbp-modding-toolchain.md](lbp-modding-toolchain.md) has the rule for it —
Java is a reading of the format, not evidence about it.

Measured 2026-10-24 by listing the classes under `lib/cwlib/src/main/java/cwlib/` (`resources/`,
`structs/things/parts/`, `types/`, `io/`, `util/`) of
[ennuo/toolkit](https://github.com/ennuo/toolkit) at `main` `d6a2ef8` (2026-09-19, the last commit
to touch `lib/cwlib/`) against this repository's modules at 0.2.74 and the return type of every
reader `partReaders()` binds. ⚠️ A checkout of the toolkit can be far behind that: one at
`bb79e81` (2024-04-30) lacks 147 files' worth of `lib/cwlib/` changes, `RCachedCostumeData`,
`ROutfitList` and the two newer importers among them — so name the commit you read. Each line below
is closed by a commit here; re-check against the current checkout before relying on one.

## Thing parts: every one is read, sixteen are kept

`partReaders()` binds 53 readers and `readLevel`/`readPlan` install `WORLD`: 54 of the 55 entries of
`PARTS`, which is every part of `Part.java`. `CREATOR_ANIM` has none, and Java too expects it null.
So any file in range walks to its end. What differs is what a reader returns:

- **Kept** (16): `POS`, `SHAPE`, `RENDER_MESH`, `GENERATED_MESH`, `DECORATIONS`, `JOINT`,
  `STICKERS`, `SWITCH`, `SPRITE_LIGHT`, `LEVEL_SETTINGS`, `GROUP`, `GAMEPLAY_DATA`, `INSTRUMENT`,
  `SEQUENCER`, `MICROCHIP`, `WORLD`.
- **Walked, nothing returned** (38): `BODY`, `CREATURE`, `ENEMY`, `NPC`, `EMITTER`, `TRIGGER`,
  `CHECKPOINT`, `SWITCH_KEY`, `SWITCH_INPUT`, `CONTROLINATOR`, `QUEST`, `WORMHOLE`, `POWER_UP`,
  `POPPET_POWERUP`, `POCKET_ITEM`, `HUD_ELEM`, `FADER`, `TAG_SYNCHRONIZER`, `TRANSITION`, `REF`,
  `PHYSICS_TWEAK`, `MATERIAL_TWEAK`, `MATERIAL_OVERRIDE`, `CAMERA_TWEAK`, `WIND_TWEAK`,
  `ATMOSPHERIC_TWEAK`, `ANIMATION_TWEAK`, `AUDIO_WORLD`, `ANIMATION`, `CONNECTOR_HOOK`, `EFFECTOR`,
  `SCRIPT`, `SCRIPT_NAME`, `STREAMING_DATA`, `STREAMING_HINT`, `COSTUME`, `METADATA`,
  `YELLOWHEAD`. Java builds an object for each. Keeping one is a return value on a reader that
  already reads every field.

## Resources with a Java class and no reader here

`RAnimation` and `RBoneSet` (so a mesh's morphs stay walked, names only), `RGuidSubst`, `RScript`,
`RBigProfile`, `RLocalProfile`, `RSyncedProfile`, `RAdventureCreateProfile`, `BigSave`, `RQuest`,
`RDLC`, `RFontFace`, `RTranslationTable`.

Which of them the game itself ships, so a reader can be proven on real files (four FARCs,
2026-10-24): `RAnimation` as 2,664 `ANMb`, `RScript` as 534 `FSHb`, and `RQuest` as 25 `QSTb`. `RGuidSubst` and `RDLC` are there only in their
text form (`GSBt`, `DLCt`), and the rest not at all. ⚠️ cwlib's `RQuest.serialize` is empty, so a
`QSTb` reader has no reading to port.

Readers here that Java also has: `readChunk` and `readChunkIslands` (`RStreamingChunk`),
`readInstrument` (`RInstrument`), and from 2026-10-24 in `src/resources/`: `readPhysicsMaterial`
(`RMaterial`), `readPalette`, `readOutfitList`, `readJointSettings` (`RJoint`), `readPins` and
`readCachedCostumeData`, then `readSlotList` and `readPacks` over `src/structs/slot.ts` — two of
them reading more than Java does
([lbp-modding-toolchain.md](lbp-modding-toolchain.md), *Where we deliberately differ*, 10 and 11).

## Writing

Java's one serializer reads and writes every resource. This library writes a sequencer `.plan` and
the container around it (`src/sequencer/write-plan.ts`, `src/io/writer.ts`), a `FAR4` in the clear with a zeroed
hashinate (`writeFar`), a toolkit `.mod` (`writeMod`) and a ZIP — and nothing else: no level or
other resource, no `FARC` rebuild (`FileArchive.save`), no FileDB (`FileDB.build`), no mod patches
(`TranslationPatch`).

## Tools

Java exports `RMesh` to glTF (`MeshExporter`), imports models and animations (`ModelImporter`,
`AnimationImporter`, `BlendPacketImporter`), builds an `RStaticMesh` (`StaticMeshBuilder`),
assembles material shaders (`CgAssembler`, `GfxAssembler`), converts
resources to JSON (`gson/`), gathers a resource's dependencies (`GatherData`) and resolves resources
across archives (`ResourceSystem`). This library has none of these; it decodes a texture level to
RGBA8 (`decodeLevel`) and keeps the shaders as blobs.

## Revisions

This library refuses anything outside `0x3b7`–`0x3ff` (`requireLbp3`); Java reads LBP1, LBP2, the
Vita and the toolkit branches. The older gates are ported here but unproved: with the bound lowered
by hand, 2 of 19 LBP1 levels at `0x272` opened (`src/io/serializer.ts`, header). The Vita branch's one
mesh gate is in `readMesh` and has never met a file.
