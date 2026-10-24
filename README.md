# `@lbptracker/cwlib`

Reading LittleBigPlanet's serialised resources, in TypeScript, with no dependencies. Named after [ennuo's cwlib](https://github.com/ennuo/toolkit), which is the reference this was
checked against rather than ported from.

```ts
import { loadResource } from '@lbptracker/cwlib/resource.ts';
import { readLevel, musicSequencers } from '@lbptracker/cwlib/level.ts';
import { nodeInflate } from '@lbptracker/cwlib/platform/node.ts';

const level = readLevel(loadResource(bytes, nodeInflate));
console.log(level.things.length, musicSequencers(level).length);
```

## What it reads

| | |
|---|---|
| `resource.ts` | the `LVLb` / `PLNb` container: revision, branch, the zlib chunk table |
| `stream.ts` | the big-endian reader, and `Revision` with the version and branch gates |
| `thing.ts`, `parts.ts` | the Thing graph and its part readers — `partReaders().size` is the number (50 as of 2026-09-06) |
| `level.ts` | the walk: worlds, plans, streamed `CHKb` chunks and islands; `readThings` picks one by magic |
| `project.ts`, `notes.ts` | the music sequencer as data — note records, chaining, automation |
| `savearchive.ts` | PS3 `FAR4` saves, XXTEA with a constant key; the same archive in the clear, read and written |
| `mod.ts` | Craftworld Toolkit `.mod` packages, read and written |
| `filedb.ts`, `farc.ts` | the game's FileDB (GUID → path, SHA-1), its GUID remap (old GUID → new) and its FARC archives (SHA-1 → bytes, read lazily) |
| `mesh.ts` | the game's `RMesh` (`MSHb`): positions, normals, every UV channel, joints and weights, a triangle list and a material per primitive, the bones |
| `texture.ts` | `GTF ` and `TEX ` textures: every mip and face as BC blocks or unswizzled RGBA8, ready for WebGPU, and a pure-TypeScript BC decode |
| `staticmesh.ts` | the game's `RStaticMesh` (`SMHb`): a level's backdrop — positions, normals, two UV channels, a triangle list and a material per primitive |
| `bevel.ts` | the game's `RBevel` (`BEVb`): the profile a shape's edge is swept with, its material slots and settings |
| `material.ts` | the game's `RGfxMaterial` (`GMTb`): the whole box-and-wire graph, the texture slots, and `materialSummary` for a renderer to start from |
| `psf.ts`, `zip.ts` | `PARAM.SFO`, and a stored/deflated ZIP reader and writer |
| `backup.ts` | the pile: a folder, a zip of one, or a save, in and resources out |
| `platform/` | the inflate adapters and the FARC's file access, Node and browser |

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
