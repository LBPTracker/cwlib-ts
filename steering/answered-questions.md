# Answered questions — where each answer lives, and the wrong turns on the way

Questions about the files that are **settled and implemented**. The measurement behind each now
lives in the descriptive file named at the top of its entry; what stays here is the answer in a
line, the evidence that is not restated elsewhere, and **the wrong turns** — which are the useful
part.

Numbers are the question's historical label, one sequence shared with lbptracker, whose
[answered-questions.md](../../lbptracker/steering/answered-questions.md) holds the ones about the
engine, the chain and the page; a number not found here is there. Code refers to them (*36*,
*46*, …).

The recurring lessons, each with the entry that taught it: a dump you produce to support a
conclusion is a dump you are not reading (*the PS3 backup*); a reader that fails inside a part may
have entered the wrong part (*54*).

---

## 16. The board cell of a component on an open circuit board — the delta in the board's basis

**Answer**: three dot products against the board matrix's columns, each divided by the column's
squared length; 100.00% of 1,030 open-board placements on a cell, with the odd-multiple
fingerprint intact — [sequencer-data-model.md](sequencer-data-model.md),
`dev/board-probe.ts`.

⚠️ The Java tool this replaced computed `thing.translation − board.translation`, rotated by the
**child's** inverse normalised rotation. It scored the same 100.00% on this corpus and was wrong
twice over: the child's rotation instead of the board's (they agree only because a component lies
flat against its board), and normalising instead of undoing the scale. Both are invisible on the
ten levels available, which is why the property test matters more than the agreement. The instinct
that produced the entry — *"it seems absurd that the game transforms rotations just to work out the
sequencer's structure"* — was half right in a useful way: the quaternion round-trip is absurd; the
frame change is not, and the corpus separated the two in ten minutes.

## 25. Plans (`PLNb`) — read, and they hold most of the music

**Answer**: `readPlan`, the nested Thing stream with its own reference table, and 172 sequencers
inside plans against 19 in the levels beside them — [level-files.md](level-files.md).

⚠️ `PLNb` had been in the level magic list all along, meaning "read a plan as if it were a world",
which produced eleven loud failures for a backup that was fine; taking the magic *out* was right
for an hour and wrong as a resting place. The magic was never the problem; the reader was.
`POCKET_ITEM` and `YELLOWHEAD` were written for two plans that failed by name — the growth path
working — and one plan at revision `0x272` is refused by the bound on purpose.

## 26. Streaming levels — the whole chain, down to the islands

**Answer**: `RLevel` → `StreamingManager` → `CHKb` chunks → islands → a whole `PLNb` each; 171
chunks, 2,553 islands, 10,837 Things, 9 sequencers — [level-files.md](level-files.md).

⚠️ **Three byte-width bugs it uncovered had all been invisible for the same reason**: everything
the corpus had ever contained was compressed, and a compressed stream hides whole classes of error
because a varint under 128 is one byte — exactly what a `u8` is. `isCompressed` read and ignored;
the parts revision guessed from the version instead of read from the stream; `FieldLayoutDetails`
as `enum32` where it is bytes (with it wrong, 101 of 2,553 islands died and the rest quietly lost
most of their Things — the first measurement said "0 sequencers in any island"). **The first
uncompressed resource is worth more than a hundred more compressed ones.** Fifteen part readers
came with it, every part an island scene uses.

## 35. Dependency types — answered by measurement

**Answer**: 1 texture, 9 a level inside an adventure, 38 plan, 46 recording, 61 streaming chunk,
62 an adventure's shared data — every row checked against the magic of the resource actually
downloaded — [level-files.md](level-files.md).

⚠️ **An adventure (`ADCb`) is not a level and would have opened as nothing.** Four of twelve
"adventure map" hashes off the index are one; `readBackup` skips it on its magic and its levels are
the type-9 dependencies. With the walk unticked a perfectly good hash would have done nothing,
silently, indistinguishable from a broken one — so the walk is not optional when the root cannot
itself be opened. No chunk found so far contains a sequencer; the plumbing is proved and the
payoff still hypothetical.

## 36. The island that would not parse — one byte

**Answer**: `PControlinator.parentBoneIndex` is one byte and was read as `i32` —
[level-files.md](level-files.md), which has the general lesson (`cf7` hides field widths) and the
technique.

The find, which is the part to copy: `setTrace` put the failure inside `CONTROLINATOR`; wrapping
every `Serializer` method logged each read as `(name, start, end, value)`; the tail of `SWITCH` read
plausibly, so that part was aligned and the next field was not — `parentBoneIndex = 4,161,536`,
which is `0x003F8000`: a zero byte followed by three quarters of the `1.0f` of the identity matrix
after it. Dumping the raw bytes then settled it in one look. 31 of 32 archived chunks → 32 of 32,
5,832 Things recovered, the golden fixture unchanged.

## 46. Does the game open a plan this writer wrote? — yes, once the icon is not null

**Answer**: LBP3 imports an exported `.plan` as an ordinary popit object, on one condition:
`InventoryItemDetails.Icon` must carry a descriptor. With a null one the resource never becomes
ready — its status byte stays 9 instead of reaching 4 — and `AddInventoryItem` never adds it.
The measurement, and which icon to default to, are in [export-to-game.md](export-to-game.md).

⚠️ **The first default was the wrong gadget's icon** — `electronics_inventory_logic_sequencer.tex`,
which belongs to the *logic* sequencer, picked because its name reads right. The music sequencer's
is found rather than recognised: follow the mesh (127558) to the only plan that depends on it
(120863) and read that plan's own `Icon`. It imported either way; only the picture in the popit was
wrong. **A name that reads right is not a derivation.**

Measured in the game itself, 1.28 under shadPS4, on 2026-09-10, by the project's owner — and the
**method** is the part worth copying, because the fault was in a field nothing about the file
looked wrong in:

1. **A control that fails.** The game's own sequencer imports; the same object read by this
   project and written back does not. Two files, one difference to find.
2. **Graft the halves.** Original Thing data with the writer's tail: no. The writer's Thing data
   with the original tail: **yes**. That put the fault in `InventoryItemDetails` and took the whole
   Thing graph — the part with all the interesting decisions in it — out of the running in one
   experiment.
3. **Degrade one field at a time**, from the working original rather than towards it. `Colour` −1
   imports, a null `CreationHistory` imports, an empty creator imports, a null `Icon` **does not**.
4. **Confirm the other way round.** Adding an icon to three failing files — the round trip, the
   demo plan, a real exported song — made all three import.

⚠️ **The descriptor only has to be there.** An icon that resolves to nothing, a hash in no archive,
imports just as well: this is a presence check inside the loader, not a texture it needs.

❗ **Everything else this writer simplifies was cleared by the same bisection, and the list is
worth keeping** — it is the difference between "a plan is fragile" and "a plan needs one field".
Innocent, all measured rather than assumed: `createdBy`/`changedBy` of −1, `Colour` −1, a null
`CreationHistory`, an empty `NetworkPlayerID`, no `STICKERS`, a single-link `GROUP` chain, fewer
Things than the original, a shorter dependency table, and multi-chunk payloads.

⚠️ **The wrong turn this project would have taken on its own** is in the shape of the question it
had written down: *36* used to enumerate four things to suspect — container, object, board, sound
— in risk order, and the fault was in none of them. It was in the one part of the file the reader
had never read and the writer had transcribed from cwlib without a corpus to check it against.
**The unread field is where to look**, not the elaborate part.

## 48. Eighteen instruments have no chip — all 68 do now

**Answer**: read the table out of the game instead of out of a corpus. A chip is placed from its
instrument's own `instrument_*.plan`, so that plan carries the `planGuid`, the icon **and** the
chip's factory colour; `tools/InstrumentColours.java` walks all 68 through the FileDB and prints
the row — [export-to-game.md](export-to-game.md). The corpus tally that had 50 of them agrees on
**50 of 50 rows**, which is what makes the other 18 trustworthy rather than merely present.

⚠️ The route was written down in this question a day before it was taken, and it was right: the
plan that *names* an instrument is the plan a chip is placed *from*. **A corpus can only answer for
what somebody used**; the game's own data answers for everything it ships.

## 49. `PInstrument.Colour` — packed RGBA, and the neutral white draws white

**Answer**: the chip's tint, one factory colour per instrument family; `0xffffffff` is the neutral
the newer editors write, and **the game draws it as a white chip** —
[sequencer-data-model.md](sequencer-data-model.md) has the measurements, `chips.ts` the table and
`drawnColour` the tracker's reading of white as the family colour, which is the owner's decision
and which the plan writer follows. What is *not* settled is what the game does with the low byte
and whether it draws a creator's non-white tint; both are *49* in
[open-questions.md](open-questions.md), under the same number.

❌ **"White is the identity of a tint, so the game shows the family colour" was wrong for four
days, and it was shipped.** The first half is right — the neutral is what an editor writes, and
nobody paints twelve thousand chips white — and the second half does not follow from it: the
identity of a tint leaves the chip as it is, and the chip as it is is white. The tracker drew those
chips coloured and the plan writer copied the byte, so a level sent back to the game arrived as a
white board, which is how the owner found it (2026-09-14, `Smite`, 552 chips). **An inference about
what the game draws is a guess until the game draws it**, however good the corpus argument that led
to it; the import that settled it took a minute.

❌ **The wrong turn was made before the question was asked.** The plan writer had put the constant
`0x41000000` in this field for a day, on a comment claiming every measured plan holds it — while
the reader was throwing the field away, so nothing in the project could contradict it. The corpus
holds 25 values and that is not one of them. **A constant written for a field the reader skips is
unfalsifiable by construction**; the fix was to read the field, and the tell was that `0x41000000`
is 8.0f, which is what a misread float looks like.

❌ **And the first count of "how many chips did a creator re-tint?" was wrong by more than
double, in the direction that flatters the feature.** The table spells its colours unsigned
(`0xff0000ff`) and `readInstrumentPart` returns `s.i32()`, so red, magenta, yellow and white
never compared equal to their own family's value: 6.5% re-tinted, where the answer is 2.7%.
**A comparison between two spellings of the same number fails silently and plausibly** — nothing
throws, the count merely comes out high, and 6.5% is exactly as believable as 2.7%. It was caught
by reading the diff, not by a test; `test/song.test.ts` pins the signedness now.

⚠️ And the field looked like a per-file default twice on the way. `0x00bfffff` dominates the older
levels and `0xffffffff` the newer ones, so either reading — "the editor's default changed" and "the
creator painted them" — fits a per-revision tally. Neither is it: the first is the *synth family's*
colour, and the corpus is mostly synths, and the second is the neutral. **Correlating a value with
a file before correlating it with the instrument put two plausible stories in front of the true
one.**

## 47. The zlib window — either CINFO, and the browser is fine

**Answer**: the game writes `0x68` (CINFO 6, a 16 KiB window) and accepts `0x78` (CINFO 7) just as
happily. Settled by the same in-game session as *46*: plans written by
`packages/lbp-tracker-lib/dev/export-plan.ts` carry `68 da`/`68 de` and plans written by the page
carry `78 da`/`78 9c`, and both import. `nodeDeflate` still asks for `windowBits: 14` so that a hex
dump of our output lines up with the game's own — [export-to-game.md](export-to-game.md).

⚠️ This had been written down as the likeliest cause if a page-written file failed where a
CLI-written one worked. It was a reasonable hypothesis and it was **not** the answer; keeping it as
a suspect cost nothing, and acting on it before the bisection would have cost a session.

## The PS3 backup that "cannot be read" — it reads fine

**Answer**: the numbered files are the game's own `FAR4` archive under XXTEA with a constant key;
28 resources, 28 of 28 SHA-1s matching, 11 sequencers — [level-files.md](level-files.md).

❌ **Two rounds of evidence were produced for the wrong answer, and this is the most instructive
entry here.** Round one was a guess wearing a measurement's clothes: "472,960 bytes at 8.000 bits
per byte, all 256 values present, no run of four zeros" — every word true, every word equally true
of **compressed** data, which is what an LBP resource is made of. It never discriminated between
the two hypotheses on the table, and read as decisive because it had numbers in it. Round two was
a real measurement of the wrong question: `PFDB` in `PARAM.PFD`, two saves sharing 0 of 29,560
16-byte blocks, nothing inflating at 4,096 offsets — all sound, all establishing only "this is
ciphertext". *Whose*, under what key, was never asked, because round two was built to defend round
one. **The answer was in the bytes already printed**: the file ends `2d ba 61 d2 46 41 52 34` —
`FAR4`, in the clear — in a hex dump produced *as part of proving the file unreadable*. What broke
the deadlock was a question from outside: how can a site serve the same level both as a PS3 backup
and as loose resources? Only by *building* the backup, which means the encryption is public, which
means it is in that repository — `TEA_KEY` in `save_archive.rs`, thirty lines from the top.

❗ **"I cannot read it" is a claim about the reader, not the file.** And ⚠️ **the recipe was already
in steering**, three days earlier, in the file the index says to read before writing a parser for
any LBP archive. The measurement theatre was spent re-deriving — wrongly — something already
written down.

## A GUID with no FileDB row — renumbered, not missing

**Answer**: the PS4 build re-exported its materials and textures under new GUIDs and kept the
old ones in `output/orbisguids.remap`; the meshes and materials still name the old ones —
*The GUID remap* in [level-files.md](level-files.md).

⚠️ The trap: *"no FileDB row"* reads like *"content this install does not ship"*, and steering
said so, with DLC as the likely reason, for the 12 GUIDs of `ascetic.lvl` that did not resolve.
All 12 were in the remap. Measured on the game's own meshes the miss is not a corner: **11,667 of
12,346** material references and 24,968 of 29,915 texture slots need it. Before calling a GUID
missing, look it up in every table in `output/`, not only the `.map`.

---

## The truncated file and the container nobody knew — a header with fewer fields

**Answer**: below head `0x271` a resource has no branch pair and below `0x297` no compression
flags, so their chunk table starts five bytes earlier than in every level the reader had seen —
*The container* in [level-files.md](level-files.md), measured on the game's 5,941 meshes.

⚠️ Two files of the archive sample failed in `loadResource` and were filed as two different
things: `0x26e` as "the chunk table is not where this reader looks", an open container question,
and `0-aaaffe` (`0x237`) as **a file the archive stores truncated — nothing to fix**. Both were the
same missing gate. The trap is the second: *"chunk 0/N runs past the end of the file"* reads like a
short file, and on an old revision it is a header field this reader assumed. The error has named
the revision since *28* for exactly this reason; on a container failure, look up the header gates
for that revision before blaming the file.

---

## 28. The LBP1 readers — 19 of 19 identical to cwlib

**Answer**: with `LBP3_MIN_VERSION` lowered by hand, all nineteen LBP1 files in the archive sample
read Thing for Thing identically to cwlib; the bound itself stays at `0x3b7` — the sweep, the
bound and what is left are in [level-files.md](level-files.md) and *28* in
[open-questions.md](open-questions.md).

Twelve readers were wrong below LBP3 and every one was found by the span diff, none by a hex dump:

| reader | what was wrong |
|---|---|
| `fillThing` | UID before parent below **0x27f**; the `0xAA` marker also on LEERDAMMER rev 5; the parts mask also on LEERDAMMER rev 2 — the comment directly above the UID line already said so |
| `readPos` | the local matrix is stored too below **0x341** — 64 bytes; the comment said *"regenerated above 0x341"* above a line that read one matrix always |
| `Polygon` | `requiresZ` arrives at **0x341**; below it there is no flag byte and every vertex is a v3. This reader read the flag anyway and then picked the vertex width from whatever that byte happened to be — **a field that does not exist yet costs more than its own width when something downstream branches on it** |
| `readShape` | six gates: the colour as a v4 below **0x389**, `brightness` absent below 0x301, `behavior`/`colorOff`/`brightnessOff` below 0x303, `interactPlayMode`/`EditMode` at or below 0x306, `lethalType` an enum32 at or below 0x345, three bools for the flags word below 0x2b5 |
| `readRef` | `childrenSelectable`, `stripChildren` — gone at **0x321** |
| `readGroup` | no flags byte below **0x341**; `COPYRIGHT`, `EDITABLE`, `PICKUP_ALL_MEMBERS` as separate bools at three gates |
| `readMetadata` | did not exist; LAMS keys, and the four translation-tag strings below LEERDAMMER rev 8 |
| `readRenderMesh` | `editorColor` as a v4 at or below **0x31a** — 15 bytes |
| `readTrigger` | `zOffset` only from **0x322**, read always — 4 bytes |
| `readJoint` | `modDriven`, `interactPlayMode`/`EditMode`, `modScaleActive`; `tweakTarget*` are **ints** at or below 0x280; `behaviour` only from 0x2c4 |
| `readSwitch` | `oldActivation` below 0x2a0, and the whole connector block (`> 0x1fa && < 0x327`), fifty-odd bytes; `connectorPos` is a `vectorarray` of **v4** |
| `readCreature` | the submerged pair, `hasScubaGear`, `outOfWaterJumpBoost` are `version >= X` **or LEERDAMMER** — ten bytes, and fixing them closed the last four files at once |

❌ **"0 of 21 read correctly" was a measurement error**: it compared against cwlib's total Thing
count, which includes nulls that `readWorld` filters. Compare the non-null count. ⚠️ And the scope
note in `serializer.ts` was wrong about its own code — it said cwlib's older branches had been
stripped in the port, when `parts.ts` carries 238 distinct version gates spanning `0x137`–`0x3f0`
and 163 subVersion gates; the branches were all there, never run against a file old enough to take
one, so "widening the range" means finding which ported branches are wrong, not adding them.

## 54. "Quest type 2 has no reader" — it was a wormhole, under a mask bit that moves

**Answer**: below subVersion `0x107` the part mask carries `PCreatorAnim` on bit `0x29` and every
part above index `0x28` one bit higher; read with the live bits, an LBP2 level's `PWormhole`
(index `0x30`, bit `0x31`) parsed as a `PQuest`. The rule and its eboot address are in *The Thing
stream* in [level-files.md](level-files.md); `partBit` in `thing.ts` applies it, and `readQuest`
now reads every type as the game's loader does (`v0xdc0290`). Two of twelve "music" levels off
Bonsai, #24 and #19883, open with 3 and 4 songs; the archive sample, the plans and the toolkit
corpora read identically before and after (142 files, 441 sequencers), and so does the golden
fixture.

The wrong turns, in the order they were taken, because each was reasonable:

- ❌ **"The quest's type-2 block is unknown, so decode it from the bytes."** Nine and ten bytes
  followed the type, and they decoded plausibly as strings, keys and object references, three
  different ways. Bytes that fit a guess are not evidence for it when the guess has enough free
  fields to fit anything.
- ❌ **"cwlib's `subVersion` gates do not hold on subVersion-0 files"** — said in `parts.ts` about
  `extraFlags`, and briefly believed here because cwlib's `PQuest` would read only the type and one
  byte. The game's own `PQuest` loader was found next to its named reflection (`v0xdc0bb0` names
  `m_eType`; the loader is the function before, recognisable by `cmp …, 0x9d0000`,
  `0x1410000`, `0x51ffff`), and it has exactly cwlib's gates. So the part *was* two bytes long at
  subVersion 0, and the next eight did not belong to it.
- ✔ **What settled it**: the mask decoded to `RENDER_MESH POS TRIGGER SCRIPT SHAPE SWITCH` plus bit
  `0x31`, and cwlib's `Thing.java` has a line *"Offset due to PCreatorAnim"* that `thing.ts` had
  dropped on the strength of its own header — which said the accepted range rules the creator anim
  out, true only from subVersion `0x107`. As a `PWormhole` at subVersion 0 (no
  `ActiveTypeForTwoWayHole`, which the game's loader `v0xd46f20` gates on `0x1110000`) the bytes
  are exactly eight fields in both files, and the next Thing's header starts on the following
  byte.

⚠️ **The trap to keep**: a reader that fails *inside* a part may have entered the wrong part. Before
decoding a body, check that the part is the one the mask means at this revision. And a header that
says "the range rules this out" is a claim about a range; check it against the lowest subVersion in
that range, which here is 0.

## 55. A null descriptor with an inline type — the type is still there

- **The symptom**: Manglewood hub's container world (`02_manglewood/01_manglewood_hub/
  manglewood_hub_container.bin`) failed reading a SHA-1 past its end, and with it the page lost
  the level's main world too: all 1,157 chunks at the origin.
- ✔ **What settled it**: tracing every read (lbprender, 2026-10-22) showed the chunk list's count of
  54 read 53 chunk files and a "null" — the null was the second byte of chunk file 38's one
  `userResources` descriptor, `00 07`: flag 0, then the type 7. `Serializer.resource` returned at
  the flag, as a comment there said a null must ("the type is not there when the flag is zero"),
  unmeasured. Reading the type after a null too, all 117 LBP3 worlds read as before bar this one,
  which now reads; 1,393 descriptors in those worlds are non-null and this is the only null.

⚠️ **The trap to keep**: a rule for the rare case written without a single instance of it is a guess,
however confident its comment. When a list's count comes out one entry short with a null in it,
look at the byte before the null.

## 56. Two LBP3 levels that failed on the Thing marker — gates written as comments

- **The symptom**: the two story levels stored whole in one `.bin`, `pre_alpha_story_levels/
  sack_town.bin` (subVersion `0xc8`) and `04_bunkum/03_fickle_mistress/fickle_mistress.bin`
  (`0x144`), failed on the `0xAA` marker at bytes 14,869 and 569,855. Every other LBP3 level in
  the install is at a subVersion high enough to hide the cause.
- ✔ **What settled it**: tracing every read (lbprender, 2026-10-22). Four readers in `parts.ts`
  read fields cwlib gates on `subVersion`, some with the gate only in a comment:
  `PAnimationTweak.rootRotationX` (`> 0x146`), `PConnectorHook`'s `spinDamping`, `audioEnable`
  and `hookType` (`> 0x103`, `> 0x13d`, `> 0x14e`), `PAtmosphericTweak.maxParticles` (`> 0x135`,
  with a `u8` and `f32` in its place for `0xb9..0xd3`); and `PPoppetPowerup` refused the
  `InventoryItem` array below `0x124`, which Sack Town fills with 3 items. With cwlib's gates on
  every field of those parts and `InventoryItem` ported (its details only above version `0x37c`),
  both levels read to their end; each fix moved Sack Town's failure on to the next one, and each
  failing part's bytes end exactly where the next Thing or reference begins.

⚠️ **The trap to keep**: a gate written as a comment beside an unconditional read (`// rootRotationX,
subVersion > 0x146`) is a guess that every file is above it. A reader transcribed from cwlib keeps
every gate as code, including the ones no corpus file exercises yet.

## 57. Three story-chunk islands that failed on the Thing marker — a world read only to its Things

- **The symptom**: one island in each of three LBP3 PS4 story chunks — `3787a9bc` (`03_ziggurat/
  06_titan_2`), `e864d09e` (`c07_meet_giant`), `1f4a50ed` (`c09_titan_02_outro`), version
  `0x3f9`, subVersion `0x1a9`/`0x1ab` — failed with "Thing test marker was 0x0, not 0xaa" at
  bytes 66,091, 17,241 and 196,985. They are the only islands whose plan holds a world Thing.
- ✔ **What settled it**: the part trace (lbprender, 2026-10-22) on `e864d09e` showed `WORLD`
  running 10335..17233 and the same Thing's `POS` starting there and reading a Thing 8 bytes later.
  `readWorld` stopped after `PWorld.things`, which is all `readLevel` ever needs — its outermost
  world ends the parse — and so never read `maxVel` and the ~100 fields cwlib's `PWorld.serialize`
  has after it. With the rest of `PWorld` read (`readWorldTail` in `src/level.ts`), all three
  islands read and each plan's Thing array ends on its last byte, the check `readPlan` makes.

⚠️ **The trap to keep**: a reader that stops early because its caller stops there is a reader of a
prefix. Once anything can embed the struct — a plan, a creature — what follows it is read from the
middle of the struct's tail. `readLevel`'s outermost world is the one place the tail is skipped.
