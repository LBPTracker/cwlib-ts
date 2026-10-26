# Tools — the reader's harnesses

Read before reaching for anything in `dev/`. Every script carries its own command lines in its
docstring; this file says what each is *for*, the trap it exists because of, and the environment
variables that steer it. Nothing here is a fact about the game — those live in the descriptive
files.

- Node 24 runs every `dev/*.ts` directly: `node dev/walk-levels.ts <dir>`. They read relative
  paths like `fixtures/plans` from the **working directory**, and the fixtures are lbptracker's,
  so run them from an lbptracker checkout (`node ../cwlib-ts/dev/…`) or pass the directory.
- `dev/game.ts` is not a harness: it is where the censuses that read the installed game get
  `LBP_GAME`, its four FARCs, the FileDB with each row's path, and the GUID remap. A new census
  of the game starts from it.
- The Java oracles — `CwlibTrace`, `PartCensus`, `ModCheck`, `InstrumentColours` — live in
  lbptracker's `tools/` and link against the toolkit jar; how to build and run them, and the JDK
  trap, are in [lbptracker's tools.md](../../lbptracker/steering/tools.md).

## The level corpus

| tool | what it does |
|---|---|
| lbptracker's `tools/PartCensus.java` | which Thing parts a level corpus actually uses, overall and on the Things carrying a `SEQUENCER` or an `INSTRUMENT`. Its `INSTRUMENT` count for the ten-level corpus, **62,158**, is what `test/project.test.ts` pins the TypeScript walk against |
| lbptracker's `tools/CwlibTrace.java` | **ask cwlib what it reads from a level, and where.** `CwlibTrace parts <level>` gives the Thing count and each Thing's decoded part list; `CwlibTrace spans <level>` turns on cwlib's own serialiser log and prints every part boundary **with its byte offset** |
| lbptracker's `tools/PlanTrace.java` | `CwlibTrace spans` for a plan: cwlib's part boundaries in its `thingData`, which cwlib parses only when asked (`RPlan.getThings`) |
| `dev/span-diff.ts` | **the two traces diffed for a whole folder**: every level and plan in it through `CwlibTrace`/`PlanTrace` and through `readThings`, grouped by the first boundary they disagree on and the part open there. `LBP_JAVA` (a JDK 25 `java`) and `LBP_CWLIB_CP` (the toolkit jar and the two classes) name the machine's Java. How the revisions below LBP3 were brought to cwlib's reading |
| `dev/trace-level.ts` | the other half: our reader's part spans in the same units, so a divergence is a diff that names the part and therefore the cwlib file to open |
| `dev/walk-levels.ts` | walk a directory of resources and name the next part with no reader, rather than throwing a stack trace |
| `dev/verify-levels.ts` | the golden fixture: the walk against `fixtures/levels/sequencers.jsonl`, plus the structural check that every board cell is whole and distinct |
| `dev/board-probe.ts` | the measurement behind `boardCell` — why the cell of a component on an open board is the delta in the board's basis and not the bare delta |
| `dev/fetch-plan.ts` | a root level's **plan dependencies**, out of the public archive: `node dev/fetch-plan.ts <root hash or local file>` drops every type-38 dependency into `fixtures/plans/`. How the 17 real sequencer plans behind [export-to-game.md](export-to-game.md) were gathered |
| `dev/dump-fields.ts` | **every primitive read the parse makes, with its offset and its VALUE** — the technique [level-files.md](level-files.md) calls for, since widths align at any offset and values do not. `dump-fields.ts <file> [PART,PART] [start..end]`, on any level, plan or chunk; a parse that throws still prints what it read. This is how the parts the reader discards were read back out for the writer |
| `dev/chip-table.ts` | **the check on `src/sequencer/chips.ts`**, which `tools/InstrumentColours.java` now writes: `(RInstrument GUID) → (planGuid, icon)` tallied over every sequencer in the directories given, reporting any GUID that answers twice. It also tallies `PInstrument.Colour`, which the table cannot get from a corpus at all — a creator re-tints a chip and the corpus then holds the choice, not the default |
| `dev/verify-export.ts` | **what proves the plan writer**: every sequencer in the files given written out, read back and compared — settings field by field, note records byte for byte — plus a span-by-span diff of the non-musical parts against the game's own bytes |
| `dev/mesh-census.ts` | **what proves `readMesh`**: every `MSHb` in the four FARCs read, per revision, then each convention's count — winding against the normals, joints against the bones, weighted vertices against their bone's box, UV edges, the bind poses. The table in [level-files.md](level-files.md), *The game's meshes*, is its output. ⚠️ A convention read off cwlib is a hypothesis until it has a row here: two of its vertex packs failed |
| `dev/story-census.ts` | **the story levels' chunks**: every `FAR4` under the install's `gamedata/` through `readFar`, every `CHKb` in them through `readThings`, by subVersion, with the islands that do not open grouped — then every shape in them, the counts behind *Shapes* in [level-files.md](level-files.md). ❗ The story chunks are only there, not in the four FARCs |
| `dev/things-census.ts` | **what of the game's own Things opens**: every `PLNb` and `LVLb` in the four FARCs through `readThings` — and of the levels, how many read to the payload's last byte (`LVLb whole`) and why the others stop in their tail — refused or failing grouped by error, and with a file argument every failure listed by revision, SHA-1 and path — the work list. ⚠️ Do not pipe it into `head`: the pipe closing kills it before the list is written |
| `dev/texture-census.ts` | **what proves `readTexture`**: every `GTF ` and `TEX ` in the four FARCs read, failures by format, then the layout checks — each texture's smoothness as read against the other layout (Morton for linear BC blocks, linear for swizzled texels), each small mip against its box-filtered parent with a rolled control, the bump bit against the paths. `node dev/texture-census.ts out/textures` also writes decoded samples there as PNG; `out/` is gitignored, because they are Sony's |
| `dev/json-census.ts` | **what proves `toJson`/`fromJson`**: each resource, level and plan of the FARCs read, to JSON and back, encoded, and compared with the payload — `lost to JSON` where only the trip through JSON changed the bytes; for textures and static meshes also whether the value reads back to the same JSON. `node dev/json-census.ts [MAGIC,…|all] [limit]` |
| `dev/material-census.ts` | **what proves `readMaterial` and `materialSummary`**: every `GMTb` read per revision; the graph's box types and ports; each port against the textures wired to it; every texture slot and every mesh primitive's material resolved through the FileDB and the GUID remap; each sample's UV channel against the meshes that use it. ⚠️ Without `orbisguids.remap` nine in ten of those references "do not resolve" |
| `dev/uv-census.ts` | **which way V runs**: a cut-out texture's triangles lie over its opaque texels, so each alpha-clipped primitive's triangle centroids are looked up as stored, with V flipped, and with U flipped as the control. `transform` does the same for cwlib's UV transform against none. ⚠️ Only sparse textures and centroids inside the unit square tell the readings apart; over all cut-outs the margin shrinks to 68.5% against 58.5% |
| `dev/bevel-census.ts` | **what proves `readBevel`**: every `BEVb` in the four FARCs read per revision, then the profiles — vertex counts, the range of y and z, mapping modes, material slots — the numbers in [level-files.md](level-files.md), *Bevels* |
| `dev/physics-material-census.ts` | **what proves `readPhysicsMaterial`**: every `MATb` in the four FARCs read per head word, then the ranges of the physical constants, the sound families, the collision bits and the flags — [level-files.md](level-files.md), *Physics materials* |
| `dev/animation-census.ts` | **what proves `readAnimation`**: every `ANMb` in the four FARCs read per head word, then frame counts and rates, bones, morphs, locators, the `fat` byte, and the checks on the unpacked values — no rotation past unit length, every value finite — [level-files.md](level-files.md), *Animations* |
| `dev/script-census.ts` | **what proves `readScript`**: every `FSHb` in the four FARCs read per head word, then the checks that its tables hold together — names inside the pool, types inside the type table, each function's ranges tiling the shared tables — and the opcodes the instructions use — [level-files.md](level-files.md), *Scripts* |
| `dev/quest-keys.ts` | **what proves an `RQuest`'s keys are a level's**: every `QUEST` part in the four FARCs' levels and plans and in the story chunks, its `questKey` and `objectiveKey` looked up among the `QSTb`s' keys, and its `questId` and `objectiveId` strings against theirs — [level-files.md](level-files.md), *Quests*. Slow: it parses every story chunk |
| `dev/resources-census.ts` | **what proves the smaller readers** — palettes, outfit lists, joint settings, pins, the costume index, slot lists, packs, quests: every file of each magic in the four FARCs through its reader, per head word, with the first failures by path. `node dev/resources-census.ts PALb,OUTb` narrows it. A new reader whose proof is "it reads" joins its table rather than getting a census of its own — [level-files.md](level-files.md), *Smaller resources* |
| `dev/settings-census.ts` | **the game's levels' lighting**: every `PLevelSettings` in the `LVLb`s of the four FARCs that parse, and the ranges of its values — [level-files.md](level-files.md), *Level settings* |
| `dev/staticmesh-census.ts` | **what proves `readStaticMesh`**: every `SMHb` in the four FARCs read, then each run's indices with `vertexStart` against the vertex count and the winding against the normals — [level-files.md](level-files.md), *Backdrops* |
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
  directly — it cannot, the stream is sequential. **`partReaders()` returns 53 today**
  (2026-10-24, 0.2.74), and `readLevel`/`readPlan` add `WORLD`. Count it, do not quote it.
- ⚠️ **Reach for `archive-sample.mjs` before arguing about reader coverage from the ten-level
  corpus**, which is one creator on one console generation. The 103-level sweep behind
  `LBP3_MIN_VERSION` took one command, and every real part-reader bug found on 2026-09-05 came out of
  a file no PS3 save here contains. It needs the index (`LBP_DRY_DB`) and a Python to query it with
  (`LBP_PYTHON`), because no Node this repo targets ships SQLite.
- ⚠️ **`tools/RawDump.java` is gone**, deleted 2026-09-02. It walked a level's Thing graph through
  the toolkit jar and dumped every music sequencer's note records; `src/things/level.ts`
  does that now and nothing in the pipeline needs Java. What it leaves behind is
  `fixtures/levels/sequencers.jsonl` — 129,696 rows over **19 files** (⚠️ its `level` field is a
  float, not a name; the source file is `file`), which `verify-levels.ts` still checks the walk
  against. **It cannot be regenerated**, so it covers its own corpus and nothing newer, and it still
  contains the 23,911 duplicate rows the tool used to emit — see *The `RawDump` duplication* in
  [lbp-modding-toolchain.md](lbp-modding-toolchain.md) before trusting a raw row count.

## Environment variables

| variable | read by | meaning |
|---|---|---|
| `LBP_FIXTURES` | `test/thing.test.ts`, `test/write.test.ts`, `test/texture.test.ts` (`textures/`), `test/instrument.test.ts` (`rinst/`) | lbptracker's `fixtures/`; default `../lbptracker/fixtures`, the sibling checkout |
| `LBP_LEVELS` | `test/resource.test.ts`, `test/project.test.ts`, `test/plan.test.ts`, `test/archive.test.ts`, `dev/verify-levels.ts`, `dev/walk-levels.ts`, `dev/board-probe.ts` | a toolkit checkout's `tools/sequencerdump`, the folder holding `data*`; the PS3 levels are its `data`. **No default**: the corpus tests skip without it, and the scripts stop unless given a directory |
| `LBP_TOOLKIT` | `test/bone-set.test.ts` | a checkout of ennuo/toolkit, for the one file of its own the tests read, `lib/cwlib/src/main/resources/binary/characters.boneset`. **No default**: the test skips without it |
| `LBP_PLANS` | `test/write.test.ts` | the gallery plans, overriding `$LBP_FIXTURES/plans` |
| `LBP_RINST` | `test/instrument.test.ts` | the game's 68 `.rinst` files, overriding `$LBP_FIXTURES/rinst` (lbptracker's `tools/ExtractGuid.java` writes them) |
| `LBP_GAME` | `test/archive.test.ts`, `test/physics-material.test.ts`, `test/animation.test.ts`, `test/script.test.ts`, `test/vita.test.ts`, `test/resources.test.ts`, `test/mesh.test.ts`, `test/texture.test.ts`, `test/material.test.ts`, `test/staticmesh.test.ts`, `test/story.test.ts`, and every census of the game through `dev/game.ts` | an installed LBP3 PS4 build, the folder holding `base_001.farc` and `output/`. **No default**: the FileDB and FARC tests skip without it, and every census of the game stops (`dev/game.ts`) |
| `LBP_PATCH` | `test/patch.test.ts` | the folder of `LBP_GAME`'s update, the one holding `patch_001.farc` and its own `output/` (`CUSA00063-patch`, 01.28, over the 01.00 install; *The 01.28 update* in level-files.md). **No default**: the test skips without it |
| `LBP_DRY_DB`, `LBP_PYTHON` | `dev/archive-sample.mjs` | the archive index `dry.db`, required; and the interpreter that queries it, `python` on the PATH unless this names another |
| `DRY_DB` | `dev/dry-search.ts` | the same index, required |

❗ **None of these has a default that is a path on one machine.** A required variable that is not
set skips a test or stops a script with a line naming it (`dev/env.ts`); `LBP_FIXTURES` is the one
default, and it is the sibling checkout's relative path.
