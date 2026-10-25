# What Java cwlib has and this library does not

Read before porting a reader, a writer or a tool from ennuo's cwlib, and before saying what this
library covers. **Only the gaps are listed**: what Java reads, writes or does and this library does
not. What this library reads is in [level-files.md](level-files.md) beside each reader, and the
places where it reads the same thing differently are *Where we deliberately differ* in
[lbp-modding-toolchain.md](lbp-modding-toolchain.md) (rows 1 to 26 on 2026-10-25, with a 3b).
Whether Java's reading is *right* is a separate question: Java is a reading of the format, not
evidence about it.

Measured 2026-10-24 and again 2026-10-25 at 0.4.26, by listing the classes under
`lib/cwlib/src/main/java/cwlib/` (`resources/`, `structs/things/parts/`, `types/`, `io/`, `util/`) of
[ennuo/toolkit](https://github.com/ennuo/toolkit) at `main` `d6a2ef8` (2026-09-19, the last commit
to touch `lib/cwlib/`) against this repository's modules and the return type of every reader
`partReaders()` binds. ⚠️ A checkout of the toolkit can be far behind that: one at `bb79e81`
(2024-04-30) lacks 147 files' worth of `lib/cwlib/` changes — so name the commit you read, and
re-check a line against the current checkout before relying on it.

## Thing parts: fields walked and not returned

Every part of `Part.java` has a reader (`CREATOR_ANIM` none, and Java too expects it null), so any
file in range walks to its end, and since 0.4.32 **every reader returns its part** — but only the
fields a reader of a level needs, where Java keeps every one. What each returns is its interface in
`src/things/parts/`; a field a part walks and does not return is a gap here, and keeping it is a
return value on a reader that already reads it. The part with the most left out is `CREATURE`
(its state machine, whip, jetpack and the rest; the settings and the Thing lists are returned),
then `NPC`, `YELLOWHEAD`'s `Poppet`, `PHYSICS_TWEAK` and `SWITCH`. Keeping one is a return
value on a reader that already reads every field.

## Resources

- **No reader** (2, and `BigSave` in `types/save/`): `RBigProfile` and `RLocalProfile`. Neither the
  install nor the saves on this machine hold one (a census of the FARCs and the saves by magic,
  2026-10-25), so a reader would have nothing to be proven on.
- **Read, but less than Java**:
  - `RGfxMaterial`: the compiled shaders are kept as blobs (Java's `CgAssembler`/`GfxAssembler`,
    below, build them).
  - `RTranslationTable`: the old text layout (a UTF-16 file of tags and lines) is refused; the game
    holds none.
  - `RAdventureCreateProfile`: the inline `AdventureData` below subVersion `0x140` and
    `PlayedLevelData` on the Vita's branch refuse; the game's three are past the one and off the other.
  - `InventoryItemDetails` (inside `RPlan`, `RLevel`, the poppet power-up): the two layouts at and
    below version `0x37c` refuse — below the revision bound, *Revisions*.
  - `RDLC` and `RGuidSubst`: read in the engine's text form only (`GSBt`, `DLCt`), the one the game
    ships; Java reads `RDLC`'s binary form and another text layout for `RGuidSubst`.

## Writing

Java's one serializer reads and writes every resource. This library writes a sequencer `.plan` and
the container around it (`src/sequencer/write-plan.ts`, `src/io/writer.ts`), a `FAR4` in the clear
with a zeroed hashinate (`writeFar`), a toolkit `.mod` (`writeMod`), a FileDB (`writeFileDB`) and a ZIP — and nothing else: no
level or other resource, no `FARC` rebuild (`FileArchive.save`), no mod
patches (`TranslationPatch`).

## Tools

Java exports `RMesh` to glTF (`MeshExporter`), imports models and animations (`ModelImporter`,
`AnimationImporter`, `BlendPacketImporter`), builds an `RStaticMesh` (`StaticMeshBuilder`),
assembles material shaders (`CgAssembler`, `GfxAssembler`), converts resources to JSON (`gson/`),
gathers a resource's dependencies (`GatherData`) and resolves resources across archives
(`ResourceSystem`). This library has none of these.

## Revisions

This library refuses anything outside `0x3b7`–`0x3ff` (`requireLbp3`); Java reads LBP1, LBP2, the
Vita and the toolkit branches. The older gates are ported here but unproved: with the bound lowered
by hand, 2 of 19 LBP1 levels at `0x272` opened (`src/io/serializer.ts`, header). On the Vita's
branch, 6 of the game's 25 Vita levels still do not read, through Vita-only parts cwlib has no table
for either ([level-files.md](level-files.md), *The Vita branch*). The mesh gate in `readMesh` has
never met a file.
