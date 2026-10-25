# Open questions — what the files still do not say

Read before planning a work session on the reader or the writer. Nothing here blocks reading a
level or writing a plan: what is left is three things about the chip tint only Create Mode can
answer, one loose end from the export, what a quest objective's first field is, whether the game
opens a level edited here, and the files that
still will not open. When one gets
resolved, move the answer into the descriptive file it belongs to and delete the entry; numbers
are shared with lbptracker's [open-questions.md](../../lbptracker/steering/open-questions.md).

## 49. The chip's tint — three things the file cannot say

`PInstrument.Colour` is read, drawn, carried through MIDI and written back
([sequencer-data-model.md](sequencer-data-model.md)), and *49* in
[answered-questions.md](answered-questions.md) is the part that is settled. What is left needs the
game, not the bytes:

- **The low byte.** It is `ff` on 24 of the 25 values the corpus holds, and `00` on the factory
  green all fifteen percussion instruments ship with. `chipColour` drops it, because honouring it
  as an opacity draws every untinted drum kit invisible — but "drop it" is a choice, not a
  reading. **What would settle it**: place a percussion chip and a synth chip in Create Mode and
  look at whether one is fainter than the other.
- **Whether a creator's non-white tint is drawn.** 1,838 of 68,568 placements (2.7%) carry a
  colour that is neither white nor their instrument's own. ✔ Half of this is answered: the game
  draws the field — a plan of `0xffffffff` chips imported as a white board (2026-09-14), where a
  game that coloured chips by instrument would have shown the families. Nobody has yet watched a
  coloured tint. **What would settle it**: import a plan exported from the tracker since that date,
  whose untinted chips now carry their family colours explicitly, and look at the board.
- **The decision this left behind.** The tracker reads the neutral white as the family colour, on
  the board and in an exported plan — the owner's choice, and a deliberate departure from how the
  game shows a white level. Nothing measurable would change it; it is recorded so that nobody
  mistakes the family colours on a white level's board for what the game shows.
- **What palette the tweak menu offers.** The 25 corpus values are hues at a few saturations, not
  an obvious grid, and the editor here offers a free `<input type="color">` — which may be able to
  write a colour the game's own picker cannot reach. Harmless if so. **What would settle it**:
  `gamedata/scripts/tweak*.ff` through `lbpres.py --raw` ([lbptracker's tools.md](../../lbptracker/steering/tools.md)).

## 51. "Too big" — why the game would not place an exported sequencer

Reported 2026-09-21 by a player: an exported plan arrives in the popit and the game calls it too
big when they try to put it down. **Not reproduced here**, and which song it was is not known.

One cause was found and fixed on the bytes: `POS` carried the identity where the game's own gadget
sits at 0.7333 (*The chassis* in [export-to-game.md](export-to-game.md)), so every export was 1.364
times the size. ⚠️ That it is **the** cause is inferred. What would settle it: place a 0.2.28 plan
and a 0.2.29 plan of the same song in Create Mode. If 0.2.29 still fails, the next suspects are the
ones the corpus bounds and the writer does not — the board's `sizeX`/`sizeY` and the chip count on
a long song, against the largest board in `fixtures/plans` — and the way to find it is the
bisection of *46*: swap spans of a plan the game wrote into ours until it places.

## 64. Colouring a mesh — what the texture and the material do not say

The readers are measured ([level-files.md](level-files.md), *The game's textures* and *The game's
materials*); what a renderer still has to decide on its own:

- **The UV transform.** `materialSummary`'s `uvTransform` is cwlib's reading of a sample box's
  params — scale and offset, or a 2x3 matrix when `subType` is 1. Which way V runs is measured
  (as stored, [level-files.md](level-files.md)); the transform is not: the cut-out census that
  settled V ties on 39 of the 46 transformed primitives it can use. A textured mesh whose transform
  is a visible offset or rotation — `scoreboard_wood.gmat` turns its wood a quarter — drawn both
  ways in lbprender is the measurement left.
- **sRGB.** Nothing in a texture says how it is sampled except `GTF ` flags bit 0, which is on
  normal maps (4,393 of 4,393). The other bits are not it: bit 1 marks a PS4 re-export, and
  neither it nor bit 2 separates the textures wired to colour ports from those wired to data
  ports ([level-files.md](level-files.md), *The game's textures*). So the file does not say; a
  renderer decides by the port a texture feeds, and whether the game decodes colour ports as sRGB
  is the eboot's to say.
- **`alphaMode` and `alphaLayer`.** Raw values 0–5 and 0 / 1 / 128 / 192, which line up with names
  (`_alpha`, `_glassy`, `_refract`) and with nothing measured. The eboot's material setup is where
  the blend states live.
- **The other 3,081 diffuse graphs.** The summary names the first sample and colour it finds;
  mix, blend and Thing-colour graphs need the boxes evaluated, and the box types 13–19 are cwlib's
  partial list.

## 65. A quest objective's first `u16`

The game's loader settled every other field of `RQuest` (*Quests* in
[level-files.md](level-files.md)). This one it reads raw and the reflective serialiser does not
name: 101 on 13 of the game's 35 objectives, 0 on 7, and values as far as 13,352 and −15,317 on
the rest. What reads it — the quest log, the objective UI — would say what it is.

## 66. Whether the game opens an edited level

A level, plan or chunk written with no edit is the game's own bytes (*Writing a level*,
level-files.md), so the game opens it. An edited one has never been loaded: whether the game minds
a removed Thing still in the stream outside the world, two Things with one uid after a copy, ids
out of its own numbering, or an island whose bounds and dependency lists no longer match its plan
is not known. **What would settle it**: move, remove and copy Things in a level of the
corpus with `write-level.ts`, put it in a save and open it in the game.

## 28. What still will not open — the archive sweep's leftovers, and Bonsai's

The reader is measured over 103 archive levels: no failure anywhere in the range it claims, and
19 of 19 LBP1 files identical to cwlib with the bound lowered by hand
([level-files.md](level-files.md)). Levels off Bonsai turned one of the items below, the Vita
branch, into one that stands between a reader and a song. What is left:

- **The allowed-set decision.** `LBP3_MIN_VERSION` is `0x3b7` and all nineteen LBP1 files are
  refused, deliberately: LBP1 has no Music Sequencer, so opening them buys the tracker nothing
  musical, and the range `0x272`–`0x3b7` has zero coverage — admitting it wholesale is exactly the
  plausible-nonsense failure the bound exists to prevent. The right change, if one is wanted, is an
  **allowed set** — `0x272` plus `0x3b7..0x3ff`, refusing the untested span between — and it is a
  design decision to take on purpose.
- **Branch `0x4431`** — LBP Vita. ✔ cwlib's Vita gates are ported, and the Vita's own parts at
  bits `0x27`/`0x28` have a partial reading of our own (2026-10-25): all 148 of the game's Vita
  plans and 19 of its 25 Vita levels read, the levels to their last byte. ⚠️ The other 6
  contradict the reading, and their bytes cannot say where (*The Vita branch* in
  [level-files.md](level-files.md)); what the two parts are and their fields mean is open, and
  the PS4 eboot cannot say: it has no code for the branch. The 18 synced profiles, all Vita `PRFb`s (17 in crossplay `.cpv`s,
  one in a save), read to their end only with an integer after the PSN id that cwlib does not
  have; its values repeat across levels, and what it is is open too (*Profiles* in
  [level-files.md](level-files.md)). Before that: one level in the saves,
  `f331efa7`, version `0x3e2`, and nothing in the archive sample. ❗ **Bonsai is the corpus that was missing**: its Vita levels are on this
  branch, revision `0x87`, and a search for "a" alone finds 847 of them; six of six music levels
  fail with "the world Thing carried no WORLD part" ([level-files.md](level-files.md)). Vita has a
  Music Sequencer, so this one is in the way of music.
- **The game's own archives** — *What of the game's own Things opens* in
  [level-files.md](level-files.md). Not refused by the bound and still failing: **186 plans and
  28 levels** (`dev/things-census.ts` lists them; on 2026-10-25, with the Vita gates, it fails 31 plans
  and 18 levels, the 18 all Vita). Levels: 25 "the world Thing carried no WORLD
  part", all crossplay Vita (`.cpv`, `0x3e2`/`0x3eb`) and so the Vita branch above, 18 of them now; then
  `manglewood_hub_container.bin` (a short read), `fickle_mistress.bin` and the pre-alpha
  `sack_town.bin`. Every level that opens reads to its last byte since the game's loader gave
  `RLevel` its missing reference (*`readLevel` reads to the end* in [level-files.md](level-files.md)). In the story chunks, none since 2026-10-24: every island of the 41,741 chunks opens
  (*Streaming levels* in [level-files.md](level-files.md)). Plans: none since 2026-10-25 — the last six, a
  live-streaming-choice switch and five Move DLC palette plans, read as the game's loaders read
  them (*`playerMode` at 0x3eb* in [level-files.md](level-files.md), which also has whether
  `playerMode` belongs to 0x3eb or to the crossplay build). Below the bound, 7,068 plans and 265 levels are the coverage the allowed-set
  decision lacked. None of this is in the way of music; it is in the way of lbprender, which draws
  the game's own furniture.

The archive's leftovers are not in the way of music; Vita is. The next one is
found by `dev/archive-sample.mjs` for what Mm's servers held, and by a search
over Bonsai's API for what has been published since: every real reader bug since 2026-09-05 came
out of a file no PS3 save on this machine contains.
