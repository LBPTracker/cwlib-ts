# Tools — the reader's harnesses

Read before reaching for anything in `dev/`. Every script carries its own command lines in its
docstring; this file says what each is *for*, the trap it exists because of, and the environment
variables that steer it. Nothing here is a fact about the game — those live in the descriptive
files.

- Node 24 runs every `dev/*.ts` directly: `node dev/walk-levels.ts <dir>`. They read relative
  paths like `fixtures/plans` from the **working directory**, and the fixtures are lbptracker's,
  so run them from an lbptracker checkout (`node ../cwlib-ts/dev/…`) or pass the directory.
- The Java oracles — `CwlibTrace`, `PartCensus`, `ModCheck`, `InstrumentColours` — live in
  lbptracker's `tools/` and link against the toolkit jar; how to build and run them, and the JDK
  trap, are in [lbptracker's tools.md](../../lbptracker/steering/tools.md).

## The level corpus

| tool | what it does |
|---|---|
| lbptracker's `tools/PartCensus.java` | which Thing parts a level corpus actually uses, overall and on the Things carrying a `SEQUENCER` or an `INSTRUMENT`. Its `INSTRUMENT` count for the ten-level corpus, **62,158**, is what `test/project.test.ts` pins the TypeScript walk against |
| lbptracker's `tools/CwlibTrace.java` | **ask cwlib what it reads from a level, and where.** `CwlibTrace parts <level>` gives the Thing count and each Thing's decoded part list; `CwlibTrace spans <level>` turns on cwlib's own serialiser log and prints every part boundary **with its byte offset** |
| `dev/trace-level.ts` | the other half: our reader's part spans in the same units, so a divergence is a diff that names the part and therefore the cwlib file to open |
| `dev/walk-levels.ts` | walk a directory of resources and name the next part with no reader, rather than throwing a stack trace |
| `dev/verify-levels.ts` | the golden fixture: the walk against `fixtures/levels/sequencers.jsonl`, plus the structural check that every board cell is whole and distinct |
| `dev/board-probe.ts` | the measurement behind `boardCell` — why the cell of a component on an open board is the delta in the board's basis and not the bare delta |
| `dev/fetch-plan.ts` | a root level's **plan dependencies**, out of the public archive: `node dev/fetch-plan.ts <root hash or local file>` drops every type-38 dependency into `fixtures/plans/`. How the 17 real sequencer plans behind [export-to-game.md](export-to-game.md) were gathered |
| `dev/dump-fields.ts` | **every primitive read the parse makes, with its offset and its VALUE** — the technique [level-files.md](level-files.md) calls for, since widths align at any offset and values do not. `dump-fields.ts <file> [PART,PART] [start..end]`, on any level, plan or chunk; a parse that throws still prints what it read. This is how the parts the reader discards were read back out for the writer |
| `dev/chip-table.ts` | **the check on `src/chips.ts`**, which `tools/InstrumentColours.java` now writes: `(RInstrument GUID) → (planGuid, icon)` tallied over every sequencer in the directories given, reporting any GUID that answers twice. It also tallies `PInstrument.Colour`, which the table cannot get from a corpus at all — a creator re-tints a chip and the corpus then holds the choice, not the default |
| `dev/verify-export.ts` | **what proves the plan writer**: every sequencer in the files given written out, read back and compared — settings field by field, note records byte for byte — plus a span-by-span diff of the non-musical parts against the game's own bytes |
| `dev/mesh-census.ts` | **what proves `readMesh`**: every `MSHb` in the four FARCs read, per revision, then each convention's count — winding against the normals, joints against the bones, weighted vertices against their bone's box, UV edges, the bind poses. The table in [level-files.md](level-files.md), *The game's meshes*, is its output. ⚠️ A convention read off cwlib is a hypothesis until it has a row here: two of its vertex packs failed |
| `dev/story-census.ts` | **the story levels' chunks**: every `FAR4` under the install's `gamedata/` through `readFar`, every `CHKb` in them through `readThings`, by subVersion, with the islands that do not open grouped. ❗ The story chunks are only there, not in the four FARCs |
| `dev/things-census.ts` | **what of the game's own Things opens**: every `PLNb` and `LVLb` in the four FARCs through `readThings`, refused or failing grouped by error, and with a file argument every failure listed by revision, SHA-1 and path — the work list. ⚠️ Do not pipe it into `head`: the pipe closing kills it before the list is written |
| `dev/texture-census.ts` | **what proves `readTexture`**: every `GTF ` and `TEX ` in the four FARCs read, failures by format, then the layout checks — each texture's smoothness as read against the other layout (Morton for linear BC blocks, linear for swizzled texels), each small mip against its box-filtered parent with a rolled control, the bump bit against the paths. `node dev/texture-census.ts out/textures` also writes decoded samples there as PNG; `out/` is gitignored, because they are Sony's |
| `dev/material-census.ts` | **what proves `readMaterial` and `materialSummary`**: every `GMTb` read per revision; the graph's box types and ports; each port against the textures wired to it; every texture slot and every mesh primitive's material resolved through the FileDB and the GUID remap; each sample's UV channel against the meshes that use it. ⚠️ Without `orbisguids.remap` nine in ten of those references "do not resolve" |
| `dev/uv-census.ts` | **which way V runs**: a cut-out texture's triangles lie over its opaque texels, so each alpha-clipped primitive's triangle centroids are looked up as stored, with V flipped, and with U flipped as the control. `transform` does the same for cwlib's UV transform against none. ⚠️ Only sparse textures and centroids inside the unit square tell the readings apart; over all cut-outs the margin shrinks to 68.5% against 58.5% |
| `dev/dry-search.ts` | the archive's index by name: `dry-search.ts "music gallery"` over `dry.db`, printing slot id, game and root hash. The way to find a level to fetch when all you have is its title |
| `dev/fetch-textures.ts` | **the user `TEX ` corpus**: every hashed type-1 dependency of a directory of levels, out of the public archive into `fixtures/textures/`, each checked against its SHA-1. Run from an lbptracker checkout. ⚠️ They are other people's images — photographs among them — so look at a decode to check it and do not keep the PNGs |
| `dev/archive-sample.mjs` | **a corpus from the archive's own index**: `node dev/archive-sample.mjs 60` reads `dry.db`, picks an even spread of ids per game, downloads the root levels into `fixtures/archive/` and leaves them for `walk-levels.ts` |

- ❗ **Reach for `CwlibTrace` before tracing bytes by hand.** Question 28 spent one session on a hex
  dump and another guessing at version gates; twelve real reader bugs then came out of the span
  diff, none needing a hex dump. `ResourceSystem.LOG_LEVEL` is what turns cwlib's log on.
- ⚠️ `CwlibTrace parts` prints `825 things (278 non-null)`; **compare the non-null count.** cwlib's
  `things` list holds nulls and `readWorld` filters them; comparing against the total once produced
  a bogus "0 of 21 read correctly".
- ⚠️ `PartCensus.java`'s output was once read as scoping the walk down to "eight part readers". It
  answers *what sits on a sequencer's Thing*, which would matter if a Thing could be reached
  directly — it cannot, the stream is sequential. **`partReaders()` returns 50 today.** Count it, do
  not quote it.
- ⚠️ **Reach for `archive-sample.mjs` before arguing about reader coverage from the ten-level
  corpus**, which is one creator on one console generation. The 103-level sweep behind
  `LBP3_MIN_VERSION` took one command, and every real `parts.ts` bug found on 2026-09-05 came out of
  a file no PS3 save here contains. It needs the index (`LBP_DRY_DB`) and a Python to query it with
  (`LBP_PYTHON`), because no Node this repo targets ships SQLite.
- ⚠️ **`tools/RawDump.java` is gone**, deleted 2026-09-02. It walked a level's Thing graph through
  the toolkit jar and dumped every music sequencer's note records; `src/level.ts`
  does that now and nothing in the pipeline needs Java. What it leaves behind is
  `fixtures/levels/sequencers.jsonl` — 129,696 rows over **19 files** (⚠️ its `level` field is a
  float, not a name; the source file is `file`), which `verify-levels.ts` still checks the walk
  against. **It cannot be regenerated**, so it covers its own corpus and nothing newer, and it still
  contains the 23,911 duplicate rows the tool used to emit — see *The `RawDump` duplication* in
  [lbp-modding-toolchain.md](lbp-modding-toolchain.md) before trusting a raw row count.

## Environment variables

| variable | read by | meaning |
|---|---|---|
| `LBP_FIXTURES` | `test/thing.test.ts`, `test/write.test.ts`, `test/texture.test.ts` (`textures/`) | lbptracker's `fixtures/`; default `../lbptracker/fixtures`, the sibling checkout |
| `LBP_LEVELS` | `test/resource.test.ts`, `test/project.test.ts`, `test/plan.test.ts` | a directory of level resources; default the toolkit checkout's `sequencerdump` data. The corpus tests **skip** without it |
| `LBP_PLANS` | `test/write.test.ts` | the gallery plans, overriding `$LBP_FIXTURES/plans` |
| `LBP_GAME` | `test/archive.test.ts`, `test/mesh.test.ts`, `test/texture.test.ts`, `test/material.test.ts`, `test/story.test.ts`, `dev/mesh-census.ts`, `dev/texture-census.ts`, `dev/material-census.ts` | an installed LBP3 PS4 build, the folder holding `base_001.farc` and `output/`; default `D:\PS4Games\CUSA00063`. The FileDB and FARC tests **skip** without it |
| `LBP_DRY_DB`, `LBP_PYTHON` | `dev/archive-sample.mjs` | the archive index `dry.db`, and the interpreter that queries it — no Node this repository targets ships SQLite |
| `DRY_DB` | `dev/dry-search.ts` | the same index |
