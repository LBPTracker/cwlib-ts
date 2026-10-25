# What Java cwlib has and this library does not

Read before porting a reader, a writer or a tool from ennuo's cwlib, and before saying what this
library covers. It lists what exists there and not here; whether Java's reading is *right* is a
separate question, and [lbp-modding-toolchain.md](lbp-modding-toolchain.md) has the rule for it —
Java is a reading of the format, not evidence about it.

Measured 2026-10-24, and again 2026-10-25 at 0.4.6, by listing the classes under `lib/cwlib/src/main/java/cwlib/` (`resources/`,
`structs/things/parts/`, `types/`, `io/`, `util/`) of
[ennuo/toolkit](https://github.com/ennuo/toolkit) at `main` `d6a2ef8` (2026-09-19, the last commit
to touch `lib/cwlib/`) against this repository's modules and the return type of every reader `partReaders()` binds.
On 2026-10-25 `main` was still `d6a2ef8`. ⚠️ A checkout of the toolkit can be far behind that: one at
`bb79e81` (2024-04-30) lacks 147 files' worth of `lib/cwlib/` changes, `RCachedCostumeData`,
`ROutfitList` and the two newer importers among them — so name the commit you read. Each line below
is closed by a commit here; re-check against the current checkout before relying on one.

## Thing parts: every one is read, seventeen are kept

`partReaders()` binds 53 readers and `readLevel`/`readPlan` install `WORLD`: 54 of the 55 entries of
`PARTS`, which is every part of `Part.java`. `CREATOR_ANIM` has none, and Java too expects it null.
So any file in range walks to its end. What differs is what a reader returns:

- **Kept** (22): `POS`, `SHAPE`, `RENDER_MESH`, `GENERATED_MESH`, `DECORATIONS`, `JOINT`,
  `STICKERS`, `SWITCH`, `SPRITE_LIGHT`, `LEVEL_SETTINGS`, `GROUP`, `GAMEPLAY_DATA`, `INSTRUMENT`,
  `SEQUENCER`, `MICROCHIP`, `QUEST` (its keys, 0.4.6), `WORLD`, from 0.4.12 `COSTUME`,
  `MATERIAL_OVERRIDE`, `ATMOSPHERIC_TWEAK` and `ANIMATION` (empty in all 783 of the game's), and
  from 0.4.13 `SCRIPT` (the instance's fields and their values).
- **Walked, nothing returned** (32): `BODY`, `CREATURE`, `ENEMY`, `NPC`, `EMITTER`, `TRIGGER`,
  `CHECKPOINT`, `SWITCH_KEY`, `SWITCH_INPUT`, `CONTROLINATOR`, `WORMHOLE`, `POWER_UP`,
  `POPPET_POWERUP`, `POCKET_ITEM`, `HUD_ELEM`, `FADER`, `TAG_SYNCHRONIZER`, `TRANSITION`, `REF`,
  `PHYSICS_TWEAK`, `MATERIAL_TWEAK`, `CAMERA_TWEAK`, `WIND_TWEAK`, `ANIMATION_TWEAK`,
  `AUDIO_WORLD`, `CONNECTOR_HOOK`, `EFFECTOR`, `SCRIPT_NAME`, `STREAMING_DATA`,
  `STREAMING_HINT`, `METADATA`, `YELLOWHEAD`. Java builds an object for each. Keeping one is a return value on a reader that
  already reads every field.

## Resources: Java's 29 classes, and which have a reader here

`resources/` holds 28 classes and `resources/custom/` one, and `BigSave` is in `types/save/`.

- **A reader here, on Java's walk** (23): `RLevel` and `RPlan` (`readThings`, `things/level.ts`; the plan's inventory details from 0.4.15),
  `RStreamingChunk` (`readChunk`, `readChunkIslands`), `RMesh`, `RTexture`, `RGfxMaterial`,
  `RBevel`, `RStaticMesh`, `RInstrument`, and from 2026-10-24 `RMaterial`
  (`readPhysicsMaterial`), `RPalette`, `ROutfitList`, `RJoint` (`readJointSettings`), `RPins`,
  `RCachedCostumeData`, `RSlotList`, `RPacks`, `RAnimation`, `RScript` (its instructions kept as
  64-bit words, not decoded per class), `RBoneSet` (the toolkit's own format: its one file,
  none of the game's) from 0.4.16 `RTranslationTable` (the binary layout; the text one is
  refused, the game having none), from 0.4.17 `RFontFace` (the install's 11 loose fonts) and from 0.4.19
  `RSyncedProfile` (the saves' one profile). Where one reads differently from Java, *Where we deliberately differ* in
  [lbp-modding-toolchain.md](lbp-modding-toolchain.md) has the row (numbered 1 to 26 on 2026-10-25, with a 3b).
- **A reader here and no reading in Java** (1): `RQuest`, whose `serialize` is empty.
  `readQuest` is a reading of our own, proven on all 25 of the game's `QSTb`; its keys are what
  the levels' `PQuest`s name ([level-files.md](level-files.md), *Quests*).
- **A reader of another form than Java's** (2, from 0.4.18): `RGuidSubst` and `RDLC`, which the
  game holds only in the engine's text serialisation (`GSBt`, `DLCt`): `readGuidSubst` and
  `readDlc`, read to every file's last line ([level-files.md](level-files.md), *Text resources*);
  Java reads `RDLC`'s binary form and another text layout for `RGuidSubst`.
- **No reader here** (3, and `BigSave`): `RBigProfile`, `RLocalProfile`, `RAdventureCreateProfile`,
  none of which the saves on this machine or the install holds (2026-10-25). ⚠️ The resource census of 2026-10-24 went by magic, and
  `RTranslationTable` has none: it was in the FARCs all along (*Translation tables* in
  [level-files.md](level-files.md)). The profiles and `BigSave` are save data, so a reader would
  be proven on a save, not on the install.

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
by hand, 2 of 19 LBP1 levels at `0x272` opened (`src/io/serializer.ts`, header). The Vita branch's gates
in the Thing stream are cwlib's and read all 148 of the game's Vita plans; its levels hold
Vita-only parts cwlib has no table for, which a partial reading of our own takes 19 of 25 levels
through ([level-files.md](level-files.md), *The Vita branch*). The mesh gate in `readMesh` has never met a file.
