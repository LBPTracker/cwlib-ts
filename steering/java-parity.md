# What Java cwlib has and this library does not

Read before porting a reader, a writer or a tool from ennuo's cwlib, and before saying what this
library covers. **Only the gaps are listed**: what Java reads, writes or does and this library does
not. What this library has is in [level-files.md](level-files.md) beside each reader and writer,
and where it does the same thing differently is *Where we deliberately differ* in
[lbp-modding-toolchain.md](lbp-modding-toolchain.md) (rows 1 to 55 on 2026-10-25, with a 3b).
Whether Java's reading is *right* is a separate question: Java is a reading of the format, not
evidence about it.

Measured 2026-10-24 and 2026-10-25 by listing the classes under `lib/cwlib/src/main/java/cwlib/`
(`resources/`, `structs/things/parts/`, `types/`, `io/`, `util/`, `singleton/`) of
[ennuo/toolkit](https://github.com/ennuo/toolkit) at `main` `d6a2ef8` (2026-09-19, the last commit
to touch `lib/cwlib/`) against this repository's
modules and the return type of every reader `partReaders()` binds; revised as each gap closed, last
at 0.4.52. ⚠️ A checkout of the toolkit can be far behind, and its HEAD does not say so: the one
on this machine is at `fee2239`, but its `lib/cwlib/` is `bb79e81` (2024-04-30), 147 files'
worth behind — `RTranslationTable.patch`, `MeshExporter` and `RMesh` among them. Name the commit
whose `lib/cwlib/` you read (`git log -1 -- lib/cwlib/`), and read `d6a2ef8` with `git show`.

## Thing parts: fields walked and not returned

Every field cwlib names in a part, at a revision this library reads, is returned under its name in
the part's interface in `src/things/parts/` — the structures inside too (`NpcBehavior`, `Poppet`,
`WhipSim`, `SwitchOutput`, `ContactCache`, `EyetoyData`…). ⚠️ 0.4.49 said so and was wrong: on
2026-10-25 every read that kept no value was matched against its class at `d6a2ef8`, and 12 were
named and reachable at `0x3b7` and up — `PShape`'s `colorOff`, `lethalType`, `playerNumberColor`
and `flags`, `PCheckpoint`'s `activeFlags`, `unk1` and `unk2`, `EmittedObjectSource`'s `f0`–`f5`
and `b0`, the Vita's `PSwitch.cursorScreenArea` and `PGeneratedMesh.textureScale`; returned since
0.4.57. `PPos`'s `thingOfWhichIAmABone` and `animHash` ride on its matrix since 0.4.58 (`PosPart`). The same pass found `PPhysicsTweak` lacking two blocks cwlib reads at subVersions
`0x1`–`0x16` (level-files.md, *Ported from Java, proven on no file*). Left:
- **Fields only below the revision bound** (`0x3b7`, *Revisions*): `PSwitch`'s `connectorPos`,
  `connectorGrabbed`, `looseConnectorGrabbed` and old `stickerPlan`, `PMaterialTweak`'s old
  `colorIndex`, `PShape`'s old forms of `colorOff` (four floats), `lethalType` (an enum32),
  `playerNumberColor` and `flags`, `PJoint`'s `tweakTargetMaxLength` and `tweakTargetMinLength` as
  integers, the old switches' single-output activation.
- **Reads with no name in cwlib either**: the rest of the one-line reads that keep nothing — about
  70 reachable at `0x3b7` and up, gated on subVersions or the Vita's branch — are reads cwlib
  writes as constants (`serializer.u8(0)`, `bool(false)`), some with a name in a comment
  (`PPhysicsTweak`'s attractor block: `attractDistance`, `visualEffectBrightness_On`…). The
  Vita-only parts (`vita.ts`) have no table in cwlib at all.

## Resources

- **Read, but less than Java**:
  - `RGfxMaterial`: the compiled shaders are kept as blobs (Java builds them, *Tools*).
  - `InventoryItemDetails` (inside `RPlan`, `RLevel`, the poppet power-up): the two layouts at and
    below version `0x37c` refuse — below the revision bound, *Revisions*.
  - `RAdventureCreateProfile` at subVersions `0xee`–`0xf0` refuses, as Java does ("legacy
    adventure data not supported").

What Java reads and this library reads **only as Java does, on no file**, is not a gap and is listed
in [level-files.md](level-files.md), *Ported from Java, proven on no file*.

## Writing

Java's one serializer writes every resource it reads, from its fields. Here a level, a plan and a
streaming chunk are written back from the bytes they were read from, with a few edits (*Writing a
level*, level-files.md), and a sequencer `.plan` from values; what is missing:

- **Things from their values**: a field of a part changed and written, or a part added to a Thing —
  every edit but a `PPos` matrix, the list of Things and the Things in it.
- **Any other resource written** from its values: a mesh, a texture, a profile, an adventure…
  Their dependencies can be rewritten in place, and `hashinate` is ported (*Dependencies
  rewritten*, level-files.md).

## Tools

- **Importers**: models and animations (`ModelImporter`, `AnimationImporter`,
  `BlendPacketImporter`), and an `RStaticMesh` built from them (`StaticMeshBuilder`).
- **Shaders**: material shaders assembled (`CgAssembler`, `GfxAssembler`).
- **JSON** (`gson/`): any resource back from JSON, and Java's own field names. To JSON is `toJson`
  (`src/io/json.ts`), of this library's objects; back needs a writer for every resource.

## Revisions

This library refuses anything outside `0x3b7`–`0x3ff` (`requireLbp3`); Java reads LBP1, LBP2, the
Vita and the toolkit branches. The older gates are ported here but unproved: with the bound lowered
by hand, 2 of 19 LBP1 levels at `0x272` opened (`src/io/serializer.ts`, header). The 01.28 update's
`patch_001.farc` holds 4 plans from before LBP2, at revisions `0x1b4` and `0x1c3`, which those gates
would be tried on ([level-files.md](level-files.md), *The 01.28 update*). On the Vita's
branch, 6 of the game's 25 Vita levels still do not read, through Vita-only parts cwlib has no table
for either ([level-files.md](level-files.md), *The Vita branch*). The mesh gate in `readMesh` has
never met a file.
