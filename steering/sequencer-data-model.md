# The sequencer's data model — recovered schemas

Everything below was read out of LBP3 1.28's own serialiser functions — which emit a `lea` to the
field's name string next to a `lea` to the member offset — and then confirmed against real
levels. Addresses are **vaddrs** in the eboot; [lbptracker's eboot-re.md](../../lbptracker/steering/eboot-re.md) has the conventions and
the delta trap. What the engine *does* with this data — the sampler, the 27 `Params`, the clock,
the voice pool — is in [lbptracker's synth-engine.md](../../lbptracker/steering/synth-engine.md); the containers it arrives in are in
[level-files.md](level-files.md). The sampler patch's layout is here (*`RInstrument`*, read by
`src/resources/rinstrument.ts`); what the engine makes of it — the zone a note lands in, the unison stack,
the playback formula — and the clip the eboot builds per placement, `Key` and `Scale`, the
board's size limit and the thermometer are lbptracker's, in
[sequencer-engine-inputs.md](../../lbptracker/steering/sequencer-engine-inputs.md).

## The object graph

```
Thing
 ├─ PSequencer     the grid: tempo, swing, channels, master FX, playhead
 ├─ PMicrochip     the circuit board the instruments sit on — the timeline
 └─ (child Things, one per placement)
      └─ PInstrument    one instrument placed on the grid: its own note grid + per-instrument FX
           └─ RInstrument   (resource, type 48)  the sampler patch: 8 sample slots + key splits
                └─ SampleGuids[8] ──▶ .smp files in the FARCs (game-assets.md)
```

`PSequencer` and `PInstrument` are **Parts of a Thing**, listed in the part-name table at file
`0xe4e196+` alongside `PBody`, `PScript`, `PAudioWorld`, `PSwitch`, … They are components, which
is why a sequencer can be wired to logic like anything else.

## Resource type ids

From the ordered `R*` name list at file `0xe4e405` (`RTexture` = 1, confirmed independently:
`PInstrument.Icon` serialises with type tag `1` and is a texture):

| id | type | id | type |
|---|---|---|---|
| 36 | `RAudioMaterials` | 40 | `RMusicSetting` |
| 41 | `RMixerSettings` | 46 | `RVoIPRecording` |
| **48** | **`RInstrument`** | **49** | **`RSample`** |

`PInstrument.Instrument` serialises with type tag `0x30` = 48 → a reference to an `RInstrument`.
ennuo's `ResourceType.java` agrees (`INSTRUMENT = 48`, `SAMPLE = 49`).

**A chip is three GUIDs and a colour, not one GUID.** Beside the `RInstrument` it plays, a
placement carries the popit plan it came from (the Thing's `planGuid`), the icon drawn on it
(`PInstrument.Icon`) and the tint it wears (`Colour`, below). None of the three reaches playback
and all are properties of the instrument rather than of the music, except where a creator has
re-tinted; `src/sequencer/chips.ts` is the measured
`RInstrument → (plan, icon, colour)` table for **all 68** of the game's instruments, read out of
their own popit plans.

## `PSequencer` — serialiser at `v0xd37d10`

Offsets from the part's base; the allocation is `0x60` bytes.

| offset | type | field | present when | notes |
|---|---|---|---|---|
| `+0x10` | f32 | `Tempo` | | |
| `+0x14` | f32 | `Swing` | | a **0..1 ratio**, clamped to 0.99 on the way to the engine (`v0x1c5d0c`) |
| `+0x18` | f32 | `EchoFeedback` | | |
| `+0x1c` | f32 | `EchoTime` | | multiplied by 0.5 before it reaches the engine; a delay in **beats** |
| `+0x20` | f32 | `EchoMix` | | |
| `+0x24` | i32 | `ReverbSetting` | version > `0x370` | a preset index through a remap table — [lbptracker's lbp-audio-engine.md](../../lbptracker/steering/lbp-audio-engine.md) |
| `+0x28` | bool | `Loop` | version > `0x36e` | |
| `+0x2c` | f32 | `StartPoint` | | |
| `+0x30` | i32 | `NumChannels` | | the mixer channels in use, 1..6 |
| `+0x34`…`+0x48` | f32 ×6 | `Volume[0..5]` | | each multiplied by 0.75 on the way to the engine |
| `+0x4c` | f32 | `PlayHead` | version > `0x369` | a board position in **world units**: `v0x1c5cda` turns it into a step count with `x·32/105` |
| `+0x54` | bool | `IsPlaying` | version > `0x369` | runtime state, serialised anyway |
| `+0x56` | bool | `MusicSequencer` | version > `0x36c` | ⚠️ see below |
| `+0x57` | bool | `AnimationSequencer` | **sub**version > `0x28` | ⚠️ see below |
| | i32 | `Behavior` | version > `0x371` | from the toolkit; the serialiser walk stopped at `AnimationSequencer` |
| | i32, Thing ref | `TriggerPlayer`, `PreviewThing` | version > `0x3a0` | likewise; the `0x60` allocation leaves room past `+0x57` |

⚠️ **`MusicSequencer` and `AnimationSequencer` are two modes of the same part.** The game walks
every Thing when a sequencer starts and tests `[part+0x56]` (`v0x1c5773`) to decide which ones
take part in music playback. A tracker only cares about music sequencers, but a level parser must
not assume every `PSequencer` is one.

⚠️ **The engine's state block has eight mixer channels, the part serialises six.** The push into
the audio state at `v0x1c6250` copies **eight** floats from `+0x34`, times 0.75, into
`[state+0x1a68 + 12·i]`; the last two are `PlayHead` and the word after it. Nothing routes a row
there: a placement's channel is clamped to `NumChannels − 1` ([lbptracker's synth-engine.md](../../lbptracker/steering/synth-engine.md))
and the serialised array holds six. This is what resolved a suspicion this file used to carry that
the schema was wrong somewhere between `+0x48` and `+0x50`.

## `PInstrument` — serialiser at `v0xd36c60`

| offset | type | field | present when | notes |
|---|---|---|---|---|
| `+0x10` | ref(48) | `Instrument` | | → `RInstrument` |
| `+0x18` | string | `Name` | version ≥ `0x35b` | the Thing's label — 4,353 of 62,158 corpus placements carry one, 23 distinct strings, all the editor's own defaults (`Synth: Ray Gun`) |
| `+0x20` | i32 | `Colour` | | the chip's tint, **packed RGBA** — UI only, and see below |
| `+0x24` | i32 | `Loops` | | **1 in every one of 105,785 corpus instruments** |
| `+0x28` | i32 | `Key` | | a transposition: `key mod 12`, C at 12, 0 the untouched default — [lbptracker's synth-engine.md](../../lbptracker/steering/synth-engine.md) |
| `+0x2c` | i32 | `Scale` | | 0 chromatic, 1..5 a table the engine snaps to |
| `+0x30` | f32 | `Level` | | per-instrument gain |
| `+0x34` | f32 | `Pan` | | `0..1`, centre 0.5 |
| `+0x38` | f32 | `EchoSend` | | reaches the engine as the bipolar offset `2·EchoSend − 1` |
| `+0x3c` | f32 | `ReverbSend` | | |
| `+0x40`…`+0x46` | u16 ×4 | `uiscrollx`, `uiscrolly`, `uicurx`, `uicury` | version ≥ `0x389` | editor viewport |
| `+0x48` | ref(1) | `Icon` | version ≥ `0x379` | texture |
| `+0x60` | i32 | *(unnamed)* | | copied into the engine's clip as its **length in steps**; not named by the serialiser walk |
| `+0x68` | array | **`Notes`** | | **4 bytes per element** — the note grid; the array's count sits at `+0x70` |

### `Colour` — packed RGBA, and white means "no tint"

The field the engine never reads is the one a composer sees most: it is the colour of the chip on
the board. Three measurements settle what is in it, all taken 2026-09-10.

**It is RGBA, not ARGB.** Over 68,568 placements (the ten-level corpus, the 17 gallery plans and
the 103-level archive sample — `dev/chip-table.ts`) there are **25 distinct
values**, and 24 of them end in `ff`. Read as ARGB that is a palette in which every colour a
creator ever picked has full blue and an alpha that varies over `00`, `40`, `80`, `bf`, `ff`, so
most chips would be invisible; read as RGBA it is a set of saturated hues at full opacity, and the
one exception is the factory green below.

**A chip is placed from the instrument's own popit plan, and that plan carries the colour.**
`tools/InstrumentColours.java` reads `PInstrument.Colour` out of all 68 `instrument_*.plan` files
in the game's own data, and the answer is one colour per **instrument family**: synth
`0x00bfffff` (23 instruments), percussion `0x40ff0100` (15), plucked and the Move pack
`0xff0000ff` (13), tuned percussion `0x0000ffff` (7), wind and voice `0xff00ffff` (5), SFX
`0xffffffff` (3), keys `0xffff00ff` (2). The table lives in
`src/sequencer/chips.ts` beside the plan GUID and the icon, which the same run re-measured
and which agreed with the corpus tally on 50 of 50 rows.

⚠️ **`0xffffffff` is the neutral tint, and the game draws it as a WHITE chip.** It appears in
**no file below revision `0x3ec`** — 0 of the 27,094 placements in the four oldest corpus levels —
and then takes over: 6,868 of 7,524 at `0x3ef`, and 12,545 of 12,706 at `0x3f4`, where `Ascetic`'s
own 1,150 chips are every one of them white. A creator does not paint twelve thousand chips white;
an editor writes the neutral. ✔ **What the neutral looks like was measured in the game on
2026-09-14**: a plan whose 552 chips carried it, copied out of Festerd_Jester's `Smite`, imported
as a white board — every chip Thing's `planGuid` and icon correct, so nothing else explains it.
Across the three corpora that is 45,222 placements at the instrument's own colour, 21,508
untinted and **1,838 (2.7%) tinted to something else**.

❗ **The tracker reads the neutral as the instrument's own colour, and that is a decision, not a
reading** — the owner's, made twice: for what the board shows when a level opens, and for what an
exported plan carries. `drawnColour` in `chips.ts` is where it happens; the byte itself is kept,
so a MIDI file and a song file carry it unchanged, and the plan writer is the one place that
writes the reading rather than the byte. The consequence worth knowing: a white level sent back
through the tracker arrives in the game coloured, which is not what the original looks like there.

⚠️ **The field is signed and the table is not.** `readInstrumentPart` returns `s.i32()`, so a red
chip is −16776961 where `chips.ts` writes `0xff0000ff`; comparing the two directly reported every
red, magenta, yellow and white placement in the corpus as re-tinted, and 6.5% looked as plausible
as 2.7%. `factoryColour` normalises, and `test/song.test.ts` pins it.

⚠️ Two things about it are still guesses and live in [open-questions.md](open-questions.md): what
the game does with the low byte (the percussion family's factory green carries `00` where every
other value carries `ff`), and whether Create Mode draws a creator's own non-white tint — which
the white result makes very likely, and nobody has yet watched.

**`Notes` element size is 4 bytes**, measured: the array's growth helper (`v0xd68370`, passed as
the element callback) allocates `count * 4`. The same mechanism gives 1 for `Name`, a string — so
the multiplier is the element size, not a coincidence.

## `RInstrument` — serialiser at `v0xc68a70`

The resource `PInstrument.Instrument` names: type 48, magic `INSb`, a `.rinst` in the FileDB.
`src/resources/rinstrument.ts` reads it. The serialiser builds field names with `sprintf("%s_%d", base, i)`,
so the save format has flat numbered fields rather than nested arrays; each array is preceded by an
explicit count, and the integers are varints.

| base name | count | member stride | what it is |
|---|---|---|---|
| `Samples_0..7` | 8 | `0x10` from `+0x48` | the sample-slot structs below |
| `SampleGuids_0..7` | 8 | `4` from `+0xc8` | GUIDs → `.smp` files in the FARCs ([lbptracker's game-assets.md](../../lbptracker/steering/game-assets.md)) |
| `Splitnotes_*` | 9 | from `+0xe8` | key-split bounds |
| `Numstack` | 1 | `+0x10c` | the unison stack's layer count |
| `Params[i]_*` | 27 | two f32 at `+0x110 + 8i` | the synth block, each a range `(x, y)`, each written as its own two-element array so its count repeats |
| `Arpeggio_*` | 32 | bytes, default `0xf` | arpeggiator pattern |
| `Arpeggiate` | 1 | bool | arpeggiator on/off |

✔ **Measured across the game's 68 `.rinst` files** (lbptracker's `tools/ExtractGuid.java` pulls
them out): every one parses to its payload's last byte (`test/rinstrument.test.ts`), at revisions
`0x3ba`, `0x3d5` and `0x3f9` (subVersions `0x1a3`, `0x1a6`). What the values mean to the engine —
`Splitnotes` descending with each bound owning the zone above it, `Numstack` **not** the count of
slots in use (test `SampleGuids[i] != 0` for that), `basenote` a MIDI note — is
[lbptracker's sequencer-engine-inputs.md](../../lbptracker/steering/sequencer-engine-inputs.md).

### The sample slot — serialiser at `v0xcc0e90`

Each of the 8 slots is 16 bytes in the resource (152 in the engine's own record):

| offset | type | field | stream position | meaning |
|---|---|---|---|---|
| `+0x00` | i32 | `basenote` | 1st | the note the sample was recorded at |
| `+0x04` | f32 | `basebpm` | 2nd | the sample's own tempo, for tempo-synced slots |
| `+0x08` | f32 | `finetune` | **6th (last)** | fine pitch offset |
| `+0x0c` | bool | `pitched` | 3rd | pitch-shift with the note, or play at a fixed rate |
| `+0x0d` | bool | `fitbpm` | 4th **and 5th** | rate-match the sample to the sequencer tempo |

⚠️ **Member offset order and stream order are not the same**, and confusing them produces a
parser that silently reads `finetune` where `pitched` lives. The serialiser emits `basenote,
basebpm, pitched, fitbpm, fitbpm, finetune`.

**There is no third bool.** The serialiser emits three `bool` calls, but the third passes the *same*
member pointer and the *same* name string as the second: at `v0xcc0ed6` the compiler hoists
`lea r15, [r14+0xd]` and `lea r12, ["fitbpm"]` into registers and makes the identical call twice,
at `v0xcc0eea` and `v0xcc0ef8`. `fitbpm` is serialised twice into the same field — a duplicate in
the game's own code, not a hidden setting. An earlier reading listed a phantom bool at `+0x0e`;
ennuo's toolkit independently reports the same double write. The unit of `finetune` (semitones) is
the engine's, in [lbptracker's sequencer-engine-inputs.md](../../lbptracker/steering/sequencer-engine-inputs.md).

## Stream conventions

1. **Big-endian**, including in the PS4 build — [level-files.md](level-files.md).
2. **Stream order is not member order.** The sample slot is the worked example (*The sample
   slot* in lbptracker's [sequencer-engine-inputs.md](../../lbptracker/steering/sequencer-engine-inputs.md)). Always take the
   order from the serialiser's call sequence, never from the offsets.
3. **Integers are varints when the resource's flags say so** — every level and plan in the corpus.
   Array counts, `i32` and `s32` fields are LEB128, signed ones **zigzag**; floats stay fixed
   4-byte big-endian. The first bytes of `piano.rinst`'s payload:

   ```
   08            count = 8 slots
   a8 01         s32 baseNote : varint 168 → zigzag → 84   (C6)
   43 15 80 00   f32 baseBpm  : 149.5
   01 00 00      pitched, fitbpm, fitbpm
   00 00 00 00   f32 fineTune : 0.0
   90 01         next slot's baseNote: 144 → zigzag → 72   (C5)
   …
   08            count = 8 SampleGuids
   c9 be 07      varint → 122697   = piano_c6.smp
   c8 be 07      varint → 122696   = piano_c5.smp
   ```

   `src/io/stream.ts` (`varint`) and `serializer.ts` (`COMPRESSED_INTEGERS`) handle
   it; ⚠️ a compressed corpus hides field-width bugs, [level-files.md](level-files.md).
4. **Fields are gated on the file's revision** — the gates in the tables above are from the toolkit,
   confirmed by the corpus parsing, and `PMicrochip`'s `Name`, `Components`, `CircuitBoardSizeX/Y`
   arrive at version ≥ `0x34d`.

## The note record — 4 bytes

Confirmed against real levels: the field roles against 18, the chain-and-duration model against
1.6 million notes from 22.

| byte | bits | field | word bits |
|---|---|---|---|
| `0` | `0..6` | `x` — step position within the clip (0–127) | 0..6 |
| `0` | `7` | the sub-step's low bit — with byte 3 bit 6, a third of a step | 7 |
| `1` | `0..6` | `y` — the note, 0–127 | 8..14 |
| `1` | `7` | `end` — last record of this note | 15 |
| `2` | `0..7` | `volume` (default `0x60` = 96) | 16..23 |
| `3` | `0..3` | `timbre`'s low nibble — the note's **modulation**, `× 1/15` | 24..27 |
| `3` | `4..5` | **discarded by the game** (the clip filler clears them) | 28..29 |
| `3` | `6` | the sub-step's shift: `subStep = bit7 << bit30` → 0, 1 or 2. Default `timbre` is `0x40` | 30 |

Read bytes 2 and 3 as **unsigned**; the toolkit reads them as signed Java bytes while its writer
masks with `& 0xff`. The right-hand column is the same record as the 32-bit little-endian word the
engine decodes with `bextr` ([lbptracker's synth-engine.md](../../lbptracker/steering/synth-engine.md)).

**A note is a chain of records, not a single record.** Consecutive entries in `Notes` belong to the
same held note until one has `end` set. Each record carries its own `y`, `volume` and modulation,
so a held note can **glide in pitch and change volume and timbre step by step** — the format has
per-step automation built in, and a tracker that models a note as (pitch, start, length, velocity)
cannot represent what the game can. Model the chain. Over the corpus's 2,027,633 notes: **53.9%**
have more than one control point, 6.7% bend (up to 48 points on one note, bends up to 95
semitones, median bend length two steps), 5.2% automate the volume, 3.9% the timbre.

### How the record was confirmed

18 real levels were decompressed with `tools/lbpres.py` and scanned for arrays shaped like `Notes`:
a big-endian `u32` count followed by `count` 4-byte records. Every predicate is a *falsifiable
consequence* of the layout above:

| prediction | measured |
|---|---|
| bytes 2 and 3 are 7-bit | **0** records out of ~20,000 with either byte > 127 |
| byte 2's default is `0x60` | the modal value in 578 of 737 arrays is exactly **96** |
| byte 3's default is `0x40` | the modal value in 625 of 737 arrays is exactly **64** |
| byte 0 low 7 is a step index | non-decreasing across every accepted array; never exceeds 63 |
| byte 1 low 7 is a pitch | spans **12–95**, C0–B6: a musical range, not a full 0–127 spread |
| byte 0 bit 7 is a rare flag | set in only 12 of 737 arrays |

**The control.** The identical scan over a byte-shuffled copy of each level — same length, same
byte histogram, no structure — found **0** conforming arrays out of 80,810 candidates, against 737
out of 111,050 in the real data. Decoded arrays read as unmistakable music: an ostinato alternating
A4 with G♯4 then F♯4 then C♯4 at a constant volume of 59, a C♯1 bassline at volume 96 with `timbre`
sweeping 64→79 across each note.

### Duration: the records are control points, not a filled span

```
duration_in_steps = x_of_last_record - x_of_first_record + 1      (positions carry the sub-step as thirds)
```

A one-record note lasts one step; a two-record note can last *any* length with nothing in between.
Counting records instead of measuring the span makes every note look 1 or 2 steps long and the
format look broken. Over **1,626,983 notes** from 105,785 instruments in 22 levels:

| steps | 1 | 2 | 3 | 4 | 6 | 8 | 16 | 32 |
|---|---|---|---|---|---|---|---|---|
| share | 44.4% | 38.0% | 2.3% | 6.0% | 1.1% | 2.6% | 1.4% | 1.3% |

**93.6% of all notes land on a power-of-two duration**, which is what real music looks like. ✔ The
`+ 1` is the engine's: its gate closes at `lastStep + 1 + endSubStep/3` (*30* in
[lbptracker's answered-questions.md](../../lbptracker/steering/answered-questions.md)). Of 905,453 multi-point notes, 698,649 carry no
automation, 106,797 vary `y`, 92,216 `volume`, 62,153 `timbre`.

- **`end` really does terminate**: across all 105,785 instruments, zero arrays had records left
  over after the last `end`-flagged one.
- ⚠️ **Points are occasionally out of order** — about 81 notes in 1.6 million have a last record
  whose `x` precedes the first. Sort a note's points by position before using them; but
  ⚠️ **`Track.records` keeps the file's own bytes**, because `makeNote` sorts a chain and
  re-encoding a sorted chain moves the end flag (`Wayward` writes step 28 before step 23 with the
  flag on the second). Anything comparing or rewriting records byte for byte uses `records`.

### Two fields the editor writes and the engine ignores

- **Bit 30 has a resting value.** `subStep = bit7 << bit30`, so bit 30 says nothing on a record whose
  bit 7 is clear — and the editor writes it there anyway, decided by the **file**, not the note.
  Over the ten levels' 1,448,224 records, of the 1,439,351 at sub-step 0, 971,954 carry bit 30 and
  467,397 do not:

  | revision | bit 30 set at sub-step 0 | clear |
  |---|---|---|
  | 0x3b8 | 0 | 263,412 |
  | 0x3e2 | 83,653 | 203,945 |
  | 0x3e6 | 161,397 | 40 |
  | 0x3e7, 0x3ec, 0x3ee, 0x3ef, 0x3f4, 0x3f8, 0x3f9 | all | 0 |

  A level saved across an editor change holds both. It is uniform within a note in 953,777 of
  953,791, within a clip in 62,075 of 62,106, within a sequencer in 141 of 149. ⚠️ A record at
  sub-step 1 must have bit 30 CLEAR and one at sub-step 2 must have it SET whatever the file rests
  at, and every level that sets the resting bit still carries both thirds (`0x3ee` has 163 records
  at one third and 166 at two). Nothing sounds different, and reconstructing byte 3 without it made
  78% of the corpus's clips come back as a different file — it travels in the MIDI meta
  ([lbptracker's midi-interchange.md](../../lbptracker/steering/midi-interchange.md)).
- **Bits 28..29 are cleared by the clip filler** (lbptracker's
  [sequencer-engine-inputs.md](../../lbptracker/steering/sequencer-engine-inputs.md)). The corpus sets them on 52% of 1,739,058
  records, in sticky runs, across 94% of clips, which looked like four instruments per clip; the
  plugin's table select they index is always 0 at runtime.

### The order records are written in

Three keys, each at 100%, each found by the failures the one before left:

| key | population | agreeing |
|---|---|---|
| position **ascending** | 59,029 clips with two notes or more | 58,693 (99.43%) |
| then pitch **descending** | 27,124 clips holding two notes at one position | **27,124 (100%)** |
| then the end **ascending** — the shorter note first | 333 clips still tied on both | **333 (100%)** |

⚠️ A fourth key would be a guess: among the 254 clips holding a pair tied on all three, nothing
reaches agreement (modulation ascending 98.8%, volume descending 94.9%). The order there is the
order the author placed the notes in — 8 clips of 62,158.

### What the corpus says about the rest

| field | measured over 105,785 instruments |
|---|---|
| clip length (highest `x` used) | **31 dominates** (60,318 clips), then 63; never above 63 — the editor's grid is 32 steps and a clip may be doubled to 64 |
| `PInstrument.Loops` | 1 in every instrument |
| `PInstrument.Scale` | 0 in 105,680 |
| `PInstrument.Key` | 0 in 101,536; the rest 12..23 |
| `PSequencer.Swing` | 0.0 in 103,538; 13 of 338 sequencers use it, up to 0.75 |
| `PSequencer.Tempo` | 240 most common, then 125, 180, 130, 140, 120; 30–240 overall |
| `PSequencer.NumChannels` | 308 of 338 sequencers run one channel |
| `PSequencer.EchoTime` | 2.00 on 189 of 338, 1.00 on 95, 1.50 on 47; `EchoFeedback` 0–0.9 (median 0.45), `EchoMix` 0–1 (median 0.5) |

Most-used instrument GUIDs, a reasonable priority order for an instrument palette: `129085`
(Square Wave), `129081` (Ray Gun), `148321` (Baiyon Kit), `129031` (Acoustic Kit), `129084` (Sine
Wave), `129089` (Triangle Wave), `129083` (Saw Wave), `186897` (Music Box), `132205` (Electric
Guitar), `129080` (Pulse Wave).

## The timeline: instruments are components on a circuit board

A music sequencer is a Thing carrying **both** a `PSequencer` and a `PMicrochip`. The instruments
are separate Things, children of the microchip's `CircuitBoardThing`, each with a `PInstrument`;
`PMicrochip.Components` is an array of `CompactComponent` `{Thing, x, y, angle, scaleX, scaleY,
flipped}` giving each one a **position on the board**, which is its position on the timeline.

**Board position to grid index** — measured at `v0x1c4ad0`–`v0x1c4b23`, which stores both at
`[obj+0x58]` and `[obj+0x5c]`:

```
gridX = floor(2*x / 105.0 - 0.5)     # constants v0xe60f98 = 105.0f, v0xe60f9c = -0.5f
gridY = floor(-y / 105.0)            # board Y grows upward, rows downward
step  = gridX * 16 + note.x
```

A cell is **52.5 world units wide and 105 tall**, X carries a half-cell bias, and **16 steps per
cell** is measured twice over: `v0x1c5cda` converts a world length to steps with `x·32/105`, and
the plugin's scheduler compares `cell << 4` against its step position. Over all 61,128 placements on
closed boards every stored `x` is an exact multiple of 52.5 and every `y` an **odd** multiple of it
(rows are 105 and a component sits at the row's centre), which is the fingerprint the open-board
recovery below has to reproduce. Rows run 0..24; the toolkit's `floor(x / 52.5)` without the bias
is a real divergence ([lbp-modding-toolchain.md](lbp-modding-toolchain.md)).

**An open board stores no components.** While the board is open in the editor the game promotes its
components to real Things parented to the board and leaves `Components` empty; the only layout left
is a 4×4 per Thing. The cell is the world-space translation delta **expressed in the board's own
basis** — three dot products against the board matrix's columns, each divided by that column's
squared length, no quaternion — `boardCell` in `src/things/level.ts`. Measured over the
corpus's 1,030 open-board placements: the bare delta puts 78.93% on a cell (one board is attached
to something rotated), the board's basis **100.00%**, worst fractional part 0.0004 of a cell, and
all 1,030 carry the odd-multiple fingerprint. `dev/verify-levels.ts` asserts the stronger property
over the whole corpus: **62,158 board cells whole and distinct**.

**Cell to board position, and the chip's own size** — the inverse, which a writer needs
([export-to-game.md](export-to-game.md)):

```
x      = (gridX + 1) * 52.5
y      = -(gridY + 0.5) * 105
scaleY = 1.4666666f                          (0x3fbbbbbb)
scaleX = scaleY * (ceil((highest step + 1) / 16) - 1)
```

✔ Measured over **3,724 instrument components** in 17 LBP3 sequencer plans: `scaleY` is that one
value on every one of them, and `scaleX` is an exact multiple of it — ×3 on 2,056, ×2 on 625, ×7 on
457, ×1 on 384. ⚠️ **Two of the multiples are not the product**: three cells is `4.4f` and six is
`8.8f`, each one ulp above `cells * 1.4666666f`, so the widths are a table of the game's own bit
patterns rather than an expression.

**The tile** — the board's square is 105 world units a side, and a placed instrument covers one:
its default note grid is 32 steps, which is two of the 52.5-unit half-tile positions `gridX`
counts in. Measured 2026-09-06 over the ten-level corpus plus `Ascetic` (74,864 clips): of the
72,726 chips with a neighbour further along their row, **63,337 sit exactly 2 cells (32 steps)
apart**, 1,059 three, 3,966 four; the notes of **66,837 clips need exactly 2 cells** (highest
`x` 16..31), 3,105 one, 1,062 three, 3,253 four, 478 eight; and only **55** clips have notes
reaching past the next chip on their row — overlap is possible and rare. The game's editor calls
the default grid *four bars* and grows it *two bars* at a time (reported by the project's owner),
so **a bar is 8 steps**, two beats, and a tile is four bars. ⚠️ A grid of 64 steps as the default
would make 64,483 of those neighbours overlap; the 8-step bar makes 82.

**Row to mixer channel** — the board is cut into `NumChannels` horizontal bands of equal height
(`v0x1608d0` writes the channel into the clip header, `v0x1c7909`–`v0x1c793c` computes the divisor):

```
rows    = floor(circuitBoardSizeY / 105 + 0.5)    the board's height in cells, 3..25 in the corpus
divisor = max(rows / NumChannels, 1)              integer division
channel = clamp(row / divisor, 0, NumChannels-1)
```

`channelVolume` in `src/sequencer/project.ts` bands, carrying `circuitBoardSizeY` out as
`Sequencer.boardRows`; in all 51 corpus sequencers with tracks the highest placement sits strictly
inside its board. ⚠️ The plugin's `mod 8` is a bounds guard on an already-clamped value, not the
mapping, and a modulo shipped for two months: it re-routes 667 of 1,821 tracks on the ten
multi-channel sequencers.

## Defaults and ranges worth knowing

From the toolkit's field initialisers — for authoring, and as a sanity check when a parsed value
looks wrong.

| where | field | default / range |
|---|---|---|
| `PInstrument` | `Loops` | `1` |
| | `Level` | `1.0` |
| | `Pan` | **`0.5`** — pan is `0..1` centred at `0.5`, not `-1..+1` |
| `Note` | `volume` / `timbre` | `0x60` / `0x40` |
