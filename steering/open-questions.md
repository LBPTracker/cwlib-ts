# Open questions — what the files still do not say

Read before planning a work session on the reader or the writer. Nothing here blocks reading a
level or writing a plan: what is left is three things about the chip tint only Create Mode can
answer, one loose end from the export, and the files that still will not open. When one gets
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
  params — scale and offset, or a 2x3 matrix when `subType` is 1 — and **which way V runs against
  a texture's first row** is unmeasured. lbprender drawing a textured mesh is the measurement: a
  texture upside down or offset by the transform's amount says which.
- **sRGB.** Nothing in a texture says how it is sampled except `GTF ` flags bit 0, which is on
  normal maps (4,393 of 4,393). Bits 1 and 2 of the same byte (`flags` 2 on 16,231, 6 on 7,388) are
  the candidates for "colour data"; untested.
- **`alphaMode` and `alphaLayer`.** Raw values 0–5 and 0 / 1 / 128 / 192, which line up with names
  (`_alpha`, `_glassy`, `_refract`) and with nothing measured. The eboot's material setup is where
  the blend states live.
- **A user `TEX ` from a level.** None is in a corpus here: `fixtures/archive`'s levels name
  hashed type-1 dependencies and none was fetched. The game's own 2,944 `TEX ` read; that a user's
  are the same DDS-in-a-chunk-table is the hypothesis a fetch would test.
- **The other 3,081 diffuse graphs.** The summary names the first sample and colour it finds;
  mix, blend and Thing-colour graphs need the boxes evaluated, and the box types 13–19 are cwlib's
  partial list.

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
- **Branch `0x4431`** — LBP Vita: one level in the saves, `f331efa7`, version `0x3e2`, and nothing
  in the archive sample. ❗ **Bonsai is the corpus that was missing**: its Vita levels are on this
  branch, revision `0x87`, and a search for "a" alone finds 847 of them; six of six music levels
  fail with "the world Thing carried no WORLD part" ([level-files.md](level-files.md)). Vita has a
  Music Sequencer, so this one is in the way of music.
- **The game's own archives** — *What of the game's own Things opens* in
  [level-files.md](level-files.md). Not refused by the bound and still failing: **188 plans and
  113 levels**, since the container's header gates moved 567 plans and 116 levels to the bound.
  Levels: 25 "the world Thing carried no WORLD part", parts with no reader (`POPPET_POWERUP` on 14,
  `TAG_SYNCHRONIZER` on 9), and missed test markers. Plans: missed test markers and leftover
  tails — the shape of one part reader taking the wrong count. Below the bound, 7,068 plans and
  262 levels are the coverage the allowed-set decision lacked. None of this is in the way of music;
  it is in the way of lbprender, which draws the game's own furniture. The full tally of 2026-10-19
  is in the side-session notes, not here; `test/archive.test.ts` opens the files.

The archive's leftovers are not in the way of music; Vita is. The next one is
found by `dev/archive-sample.mjs` for what Mm's servers held, and by a search
over Bonsai's API for what has been published since: every real reader bug since 2026-09-05 came
out of a file no PS3 save on this machine contains.
