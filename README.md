# `@lbptracker/cwlib`

Reading LittleBigPlanet's serialised resources, in TypeScript, with no dependencies. Named after [ennuo's cwlib](https://github.com/ennuo/toolkit), which is the reference this was
checked against rather than ported from.

```ts
import { readThings, musicSequencers } from '@lbptracker/cwlib/things/level.ts';
import { nodeInflate } from '@lbptracker/cwlib/platform/node.ts';

const level = await readThings(bytes, nodeInflate);
console.log(level.things.length, musicSequencers(level.things).length);
```

## What it reads

Every module is imported by its path under `src/`: `@lbptracker/cwlib/<folder>/<module>.ts`.

| | |
|---|---|
| **`io/`** | |
| `resource.ts` | the `LVLb` / `PLNb` / … container: revision, branch, the zlib chunk table, the dependency table |
| `stream.ts`, `serializer.ts` | the big-endian readers: the fixed-width header one, and the payload's with its revision gates and compressed integers |
| `text-resource.ts` | the engine's text serialisation (`GSBt`, `DLCt`, `MUSt`, `SSPt`, … 19 magics): tab-indented fields, arrays of `[i]`, read typed or as a tree |
| `writer.ts`, `hex.ts` | the payload writer and the container around it; SHA-1s as hex |
| **`archives/`** | |
| `gather.ts` | everything a resource needs: its dependency tables walked through a resolver the caller injects |
| `farc.ts`, `filedb.ts` | the game's FARC archives (SHA-1 → bytes, read lazily, and written), its FileDB (GUID → path, SHA-1; read and written) and its GUID remap |
| `savearchive.ts` | PS3 `FAR4` saves, XXTEA with a constant key; the same archive in the clear, read and written |
| `mod.ts`, `zip.ts`, `psf.ts` | Craftworld Toolkit `.mod` packages (with their icon and translation patches), a stored/deflated ZIP reader and writer, `PARAM.SFO` |
| **`things/`** | |
| `thing.ts`, `parts.ts`, `parts/` | the Thing graph and its part readers, one file per part — `partReaders().size` is the number (53 as of 2026-10-24) |
| `level.ts` | the walk: worlds, plans, streamed `CHKb` chunks and islands; `readThings` picks one by magic |
| **`resources/`** | |
| `mesh.ts` | `RMesh` (`MSHb`): positions, normals, every UV channel, joints and weights, a triangle list and a material per primitive, the bones |
| `texture.ts` | `GTF ` and `TEX ` textures: every mip and face as BC blocks or unswizzled RGBA8, ready for WebGPU, and a pure-TypeScript BC decode |
| `material.ts` | `RGfxMaterial` (`GMTb`): the whole box-and-wire graph, the texture slots, and `materialSummary` for a renderer to start from |
| `bevel.ts`, `staticmesh.ts` | `RBevel` (`BEVb`), the profile a shape's edge is swept with; `RStaticMesh` (`SMHb`), a level's backdrop |
| `physics-material.ts` | `RMaterial` (`MATb`): a shape's physics — density, friction, bounce, its sound family, what it collides with, whether it breaks |
| `palette.ts`, `outfit-list.ts` | `RPalette` (`PALb`), a page of the popit; `ROutfitList` (`OUTb`), costumes as their pieces |
| `slot-list.ts`, `packs.ts` | `RSlotList` (`SLTb`) and `RPacks` (`PCKb`): slots — a level's id, root, name, author, labels — and the DLC packs that hold them |
| `joint-settings.ts`, `pins.ts`, `cached-costume-data.ts` | `RJoint` (`JNTb`), what a kind of joint does; `RPins` (`PINb`), the pin definitions; `RCachedCostumeData` (`CCDb`), the costume index |
| `animation.ts` | `RAnimation` (`ANMb`): a skeletal animation — the bones, then per frame the rotations, positions, scales and morph weights of the bones that move, unpacked to floats |
| `script.ts` | `RScript` (`FSHb`): a compiled Fish class — its type, field, property and function tables, the 64-bit instructions, the string and constant pools |
| `script-instructions.ts` | an `RScript`'s instructions decoded: each word's opcode and its class's fields |
| `bone-set.ts` | `RBoneSet` (`BSTb`): the toolkit's own format, the playable characters' skeletons as its model importer keeps them |
| `quest.ts` | `RQuest` (`QSTb`): a story quest — its texts, prize, objectives, the slots that activate and complete it, its key; a reading of our own |
| `font-face.ts` | `RFontFace` (`FNTb`, loose in `gamedata/fonts/`): a bitmap font — the glyph table, its lookup chains, each glyph's bitmap |
| `guid-subst.ts`, `dlc.ts` | `RGuidSubst` (`GSBt`) and `RDLC` (`DLCt`) in the game's text form: GUID swaps (a language's dialogue, a character's animations) and the DLC packs' GUIDs and files |
| `synced-profile.ts` | `RSyncedProfile` (`PRFb`, in a save): time played, the Sackboy the player wears, the creature avatars, the colours, the PSN id |
| `adventure-create-profile.ts` | `RAdventureCreateProfile` (`ADCb`): an adventure's level slots, its planet and areas as world Things, the links between levels |
| `adventure-shared-data.ts` | the adventure shared data (`ADSb`): one `AdventureData` — the adventure's items, quests and start points |
| `animated-texture.ts`, `guid-list.ts`, `voip-recording.ts` | `ATXb` (a flipbook: its atlas and frame size), `GLTb` (a list of GUIDs), `VOPb` (a recorded voice, as bytes) |
| `tutorials.ts` | `RTutorials` (`TUTb`): the tutorial videos by group, each with its title, description and thumbnail |
| `thing-recording.ts` | `RThingRecording` (`RECb`): a Thing's recorded path, per frame a position, an angle and a flag, as the game's loader reads it — the newest packed into a bit stream, decoded |
| `translation.ts` | `RTranslationTable` (`.trans`, no magic): the game's text by LAMS key, one table per language, and the tag-to-key hash; read and written |
| `instrument.ts` | `RInstrument` (`INSb`): the sampler patch — slots, sample GUIDs, key splits, the 27 parameters, the arpeggiator |
| **`structs/`** | |
| `slot.ts`, `network.ts`, `inventory.ts` | the structs more than one resource or part reads: a slot, a PSN identity, an item's inventory details |
| **`sequencer/`** | |
| `project.ts`, `notes.ts`, `chips.ts` | the music sequencer as data — note records, chaining, automation, the chips' plans and colours |
| `write-plan.ts` | a sequencer written back out as a `.plan` |
| `backup.ts` | the pile: a folder, a zip of one, or a save, in and sequencers out |
| **`platform/`** | the inflate adapters and the FARC's file access, Node and browser |

## Two things to know before using it

❗ **A level is told from everything else by its first four bytes** — `LVLb` or `PLNb` — and never by
its name. A backup is full of `ICON0.PNG`, `PARAM.SFO`, costumes and photographs.

⚠️ **Platform APIs are injected, never imported.** `loadResource(bytes, inflate)` takes its inflater
as an argument, which is what lets the same parser run under `node --test` and in a browser tab
against a file the user picked. Follow that pattern for anything else platform-shaped.

## Scope

`LBP3_MIN_VERSION` in `serializer.ts` refuses anything older than `0x3b7`. The readers themselves go
much further down — all 19 LBP1 files in the archive sample parse Thing-for-Thing identically to
cwlib with the bound lowered by hand — but the range between `0x272` and `0x3b7` has no test
coverage at all, and the bound is what keeps "we do not support this" from becoming "we read it and
produced something". See *28* in [`steering/open-questions.md`](steering/open-questions.md).

Verified against 22 real levels and, for the Thing walk, against a cwlib dump of 129,696 sequencer
rows.

## Building, testing, depending on it

This was `packages/cwlib-ts` in [lbptracker](https://github.com/LBPTracker/lbptracker) until 0.2.48.
What is known about the formats, and how each fact was measured, is in [`steering/`](steering/) —
start with [`CLAUDE.md`](CLAUDE.md), which indexes it.

- `npm run check` — typecheck, then `node --test` on the `.ts` sources directly.
- `npm run build` — `tsc -p tsconfig.build.json` into `dist/`: `.js`, `.d.ts` and maps. `prepare`
  runs it, so a git dependency builds itself on install.

⚠️ **Consumers get `dist/`, not `src/`.** Node refuses to strip types from anything under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and a git dependency is a real copy
there, not a symlink. `exports` maps `@lbptracker/cwlib/<name>.ts` to `dist/<name>.js`, so the
import specifiers are the same either way.

The corpus tests read lbptracker's `fixtures/`: `LBP_FIXTURES` points at it, and the default is an
lbptracker checkout next to this one; `LBP_PLANS` overrides its gallery plans. `LBP_LEVELS` (a
toolkit checkout's `tools/sequencerdump`) and `LBP_GAME` (an installed LBP3 PS4 build) have no
default: the tests that need them skip without them. `steering/tools.md` has every variable.
