# Steering index — cwlib-ts

A TypeScript reader and writer for LittleBigPlanet's serialised resources: the container, the Thing
stream and its 53 part readers, plans, streaming chunks, `FAR4` saves, toolkit `.mod`s, the
music sequencer and its instruments as data, the game's FileDB, FARC archives, meshes, textures and materials, and the
`.plan` writer. It exists for [lbptracker](https://github.com/LBPTracker/lbptracker), a faithful re-implementation of LBP3's
Music Sequencer, and was its `packages/cwlib-ts` until 2026-10-18. "Faithful" reaches down to
here: a field read one byte off is a song played wrong.

Rules for this repository's steering, the same as lbptracker's:
- **All steering files must always be written in English.**
- One topic per file under `steering/`. When adding a topic, create `steering/<topic>.md`
  (English, kebab-case name) and add a one-line entry to the list below saying *when to read it*.
- **Each fact lives in exactly one file, in one of the two repositories; every other file points
  at it.** A fact about the bytes — what a file holds, how it is laid out, what proves the reader —
  lives here. A fact about what the game *does* with them — the sampler, the clock, the mix, the
  editor's limits — lives in lbptracker's `steering/`.
- **The code splits the same way.** Every resource's reader, writer and the types that hold its
  data live here, whichever project needs them — `RInstrument` included (`src/resources/instrument.ts`).
  What a project does with that data — lbptracker's sampler model and zone walk, lbprender's
  scene — stays in that project. Pointers go both ways, as plain relative links to the sibling
  checkout (`../../lbptracker/steering/…` from a file here); prefer pointing down, from
  lbptracker to here, and keep the upward ones to what a reader here cannot do without.
- A wrong turn earns a place in `answered-questions.md` only if it is a trap the next reader could
  fall into again, and it is written as the trap, not as the story. Session history belongs to the
  auto-memory.
- Facts in steering must be **measured**, not remembered. Every non-obvious claim here was taken
  out of the game's own bytes or a real file; if you add one, say how you measured it. Where
  something is still a guess, or is a decision rather than a measurement, it lives in
  `open-questions.md`. Question numbers are one sequence shared with lbptracker; a number not
  found here is there.

Paths in steering are this repository's (`src/things/level.ts`, `dev/verify-export.ts`), except
`tools/…` and `fixtures/…`, which are lbptracker's: the Java oracles and the Python reference live
in its `tools/`, and the corpora — other people's levels, never committed — in its `fixtures/`.

Steering files (read on demand, per the hints):
- [steering/level-files.md](steering/level-files.md) — **read before writing a parser for any LBP
  resource, save or archive**: the container and its dependency table, the Thing stream, plans,
  streaming chunks, `FAR4` saves, the toolkit's `.mod`, the game's FileDB, its GUID remap and FARCs, its meshes (`RMesh`,
  `PRenderMesh`), decorations and stickers, textures (`GTF `, `TEX `), materials (`RGfxMaterial`), bevels (`RBevel`), physics materials (`RMaterial`), backdrops (`RStaticMesh`), level settings, palettes, outfit lists, joint settings, pins, the costume index, slots and packs, the corpora, the version bound, and the technique for finding a reader bug.
- [steering/sequencer-data-model.md](steering/sequencer-data-model.md) — **read before touching
  `project.ts`, `notes.ts`, `chips.ts` or `resources/instrument.ts`**: the `PSequencer` and `PInstrument`
  schemas with field names and struct offsets, `Colour`, the `RInstrument` and sample-slot
  layouts, the stream conventions (endianness, stream order, varints,
  revision gates), the 4-byte note record and how it was confirmed, and the circuit board
  timeline and its banding.
- [steering/export-to-game.md](steering/export-to-game.md) — **read before touching `writer.ts`,
  `write-plan.ts` or `chips.ts`**: why the export is a `.plan`, the Thing shape measured over 17
  real sequencer plans, the chassis constants and the deviations from them, the author, the cell
  geometry run backwards, the inventory block and its icon, the two builds, and what proves a
  writer that has no corpus.
- [steering/lbp-modding-toolchain.md](steering/lbp-modding-toolchain.md) — read before trusting or
  porting anything from ennuo's toolkit: what it covers, the provenance rule, its known
  approximations, and the table of places we deliberately differ from it.
- [steering/java-parity.md](steering/java-parity.md) — read before porting a reader, writer or tool
  from Java cwlib, or saying what this library covers: the parts walked but not kept, the resources
  with no reader, the writing and the tools Java has and this does not, and the revision range.
- [steering/tools.md](steering/tools.md) — read before reaching for anything in `dev/`: what each
  harness is for, the trap it exists because of, and the environment variables.
- [steering/open-questions.md](steering/open-questions.md) — read before planning a session: the
  chip tint, the plan called too big, colouring a mesh, a quest objective's first field, and
  what still will not open.
- [steering/answered-questions.md](steering/answered-questions.md) — **read before re-deriving
  anything**: per settled question, the answer in a line, where its measurement lives, and the
  wrong turns taken on the way.

From lbptracker's steering, the ones a reader here most often needs: `eboot-re.md` (the address
conventions and the delta trap, before opening the eboot), `game-assets.md` (the samples, the
FARCs, and the asset-licensing stance), `sequencer-engine-inputs.md` (`RInstrument`, the clip the
eboot builds, the board's limits) and `level-sources.md` (the public archive and Bonsai).

## Working here

- `npm install`, then `npm run check` — typecheck, then `node --test` on the `.ts` sources; 117
  tests on 2026-10-25, the corpus ones skipping without `fixtures/` beside them or without
  `LBP_GAME`, `LBP_LEVELS` or `LBP_TOOLKIT` (`steering/tools.md`).
- `npm run build` writes `dist/`; `prepare` runs it, which is what a git install of this package
  gets. ❗ **Consumers run `dist/*.js`, never `src/`**: Node 24 refuses to strip types under
  `node_modules`. The README has why and how the `exports` map keeps the specifiers `.ts`.
- **`src/` is in folders by role**, and a module's public specifier is its path under `src/`
  (`@lbptracker/cwlib/resources/mesh.ts`): `io/` the readers, writer and container; `archives/`
  FARC, FileDB, saves, ZIP, `.mod`, `PARAM.SFO`; `things/` the Thing walk, with one file per part
  under `things/parts/` and `parts.ts` binding them; `resources/` one file per resource type, where
  a new resource reader goes; `structs/` the structs more than one resource or part reads (a slot, a
  PSN identity); `sequencer/` the music sequencer as data and the `.plan` writer;
  `platform/` the Node and browser adapters. Moving a file is a breaking change for every consumer.
- ⚠️ **Strip-only TypeScript**: no `enum`, `namespace`, parameter properties or decorators —
  `erasableSyntaxOnly` enforces it. `src/` imports itself only by relative path, which is what lets
  the build keep `rewriteRelativeImportExtensions` on.
- ⚠️ **Platform APIs are injected, never imported**: `loadResource(bytes, inflate)` takes its
  inflater, `platform/node.ts` and `platform/web.ts` supply one each.
- A change here reaches lbptracker as a commit **pushed** to `origin` (github.com/LBPTracker/cwlib-ts)
  and `npm update @lbptracker/cwlib` there; lbptracker's `steering/tracker-architecture.md` (*cwlib
  is a git dependency*) has how to try one before pushing. Commit on `main`; ask before pushing.
