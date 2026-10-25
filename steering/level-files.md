# Level files — containers, saves, archives and the corpora

Read before writing a parser for any LBP resource, save or archive. Everything below is the
*carrier*: the formats a sequencer arrives in. What the sequencer's own data looks like once the
Thing graph is open is in [sequencer-data-model.md](sequencer-data-model.md); the implementation
is this repository's `src/`, and lbptracker's `tools/lbpres.py` is the Python reference for the container.

Everything here is read by `src/io/resource.ts` and written back by
`writer.ts` — the container, the chunk table and the dependency table have a write side since
2026-09-09, and [export-to-game.md](export-to-game.md) is where that lives.

All integers are **big-endian**, including in the PS4 build — measured: the array serialiser at
eboot `v0xcc0f20` reads four bytes and byte-swaps them with `movbe` before storing (`v0xcc0f9d`,
`v0xcc1025`). LBP's formats are PS3-era and stayed that way.

## The container — `LVLb`, `PLNb`, `CHKb`, …

Derived from the bytes of real level resources, and verified on 18 levels spanning revisions
`0x3b8`–`0x3f9`: every chunk inflates, every inflated length matches its declared `rawSize`, and
the offset just past the last chunk lands **exactly** on `depsOffset` in all 18 — an offset the
parser never uses, so 18 hits on it is not a coincidence.

```
0x00  char[4]  magic        "LVLb" level, "PLNb" plan, "CHKb" streaming chunk, "ADCb" adventure …
0x04  u32      revision     0x3ee etc. A non-zero high half is a branch id:
                            0x021303f9 = branch 0x0213, revision 0x03f9 (LBP3)
0x08  u32      depsOffset   start of the dependency table = end of the payload
0x0c  u16 x 2  branchId, branchRevision        head >= 0x271
0x10  u8       compressionFlags                head >= 0x297; LEERDAMMER 0x272 from its revision 2
0x11  bool     isCompressed
0x12  u16      0x0001              ┐ only when compressed
0x14  u16      numChunks           │
0x16           numChunks x (u16 compressedSize, u16 rawSize)
...            chunk payloads back to back, each a complete zlib stream
```

The offsets are a header with every field, which every level and plan the reader takes has: the
`0x07010001` at `0x10` in every level seen is flags 7, compressed, and the `0x0001`.

- Chunks are `0x8000` bytes raw except the last, which is short. ⚠️ Both sizes in the table are
  `u16`, which is *why*: `0x10000` would not fit, and a chunk that deflates larger than `0xffff`
  cannot be written at all.
- ⚠️ **The zlib header is `0x68 0xNN`, not `0x78 0xNN`** — CINFO 6, a 16 KiB window. Grepping a
  resource for the familiar `78 9c` / `78 da` finds nothing and looks like proof the payload is not
  zlib. It is.
- ❗ **The branch pair and the flags are younger than the container**, and a reader that always
  reads them takes an older resource's chunk table from five bytes too far on: it "fails to
  inflate" or "runs past the end". Below head `0x271` the compressed bool follows `depsOffset`
  directly; below `0x297` there are no flags, so no `COMPRESSED_INTEGERS`. The gates are cwlib's
  `SerializedResource.java`. ✔ Measured on the game's meshes, **1,409 of them below `0x271` and
  1,745 below `0x297`**, every one of which now lands its chunk data on `depsOffset` — as do the
  archive sample's `0x26e` level and `0-aaaffe` (`0x237`), once put down to a container nobody knew
  and to a truncated file.
- ❗ **Below `0x189` there is no compressed flag: the payload is always compressed**, and the chunk
  table follows the dependency offset; **below `0x109` there is no dependency offset either**, and
  the chunks run to the end of the file (cwlib's `SerializedResource`). ✔ Measured on the game's 44
  bevels at `0x132`–`0x188`, which `loadResource` had refused: all 44 now end their chunk data on the
  dependency table and walk to their last byte (*Bevels* below). No file below `0x109` was here.
- ⚠️ **In a resource reference the flag's bits swap below version `0x191`**: 1 is a GUID and 2 a
  SHA-1 there, the other way round above (cwlib's `Serializer.resource`). The same 44 bevels need it.
- ⚠️ **A chunk whose two sizes are equal is stored, not deflated**, with no zlib header at all —
  cwlib's `Compressor.decompressData`. 8 chunks of the game's meshes are so, one of them the fourth
  of `spawn_point_start_chrome.mol`, which otherwise failed to inflate.
- ❗ **A compressed resource with a table of zero chunks stores its payload as it is**, from the
  table's end to `depsOffset` (the same cwlib function). ✔ Measured 2026-10-24 over the four
  FARCs: 71 of the game's 178 `PALb`, 51 of 59 `OUTb`, all 24 `ATXb`, 3 of 91 `RECb`, 2 of 4
  `VOPb`, 1 of 2 `GLTb` and 1 of 2 `TUTb` are written so — a few dozen bytes that would not
  shrink. `loadResource` called them "chunk data ends at 0x16" until it read them this way; the
  122 palettes and outfit lists now walk to their last byte. `inflateChunkTable` in
  `src/io/resource.ts` is where the rule lives, for textures as well.
- ❗ **An uncompressed resource has no chunk table.** The payload starts straight after the flag
  and runs to `depsOffset`. `CHKb` chunks are stored that way, and a reader that ignored the flag
  took "96 chunks" out of the payload's own first bytes.
- ❗ **A resource is told from everything else by its first four bytes, never by its name.** A
  backup is full of `ICON0.PNG`, `PARAM.SFO`, costumes and photographs, and every resource is
  named after its SHA-1. `looksLikeLevel` in `src/sequencer/backup.ts` accepts `LVLb`,
  `PLNb` and `CHKb`.

### The dependency table

Measured 2026-09-05. It sits **after** the payload, at `depsOffset`: `u32 count`, then per entry
`u8 kind` — 1 for a 20-byte SHA-1, 2 for a `u32` GUID — followed by a `u32` resource type. ✔ On
"Music Gallery #3" the walk of 160 variable-length entries ended at exactly the last byte of the
file (`0x52d02` of `0x52d02`), which is the check that the reading is right. `readDependencies` in
`src/io/resource.ts`.

❗ **A hashed dependency is a USER resource and a GUID one is a GAME asset.** The hashed ones are in
the public archive under the same URL scheme as the level; the GUIDs are in the game's FileDB and
are **not in the archive at all**. On that level: 20 hashed, 140 GUIDs.

The types, each checked against the magic of the resource actually downloaded for it rather than
read off an enum:

| type | magic | what it is |
|---|---|---|
| 1 | `TEX ` | a texture |
| 9 | `LVLb` | **a level inside an adventure** |
| 38 | `PLNb` | a plan |
| 46 | `VOPb` | a recording |
| 61 | `CHKb` | **a streaming chunk** |
| 62 | `ADSb` | an adventure's shared data, 35–270 bytes |

The GUID side, measured 2026-10-19 on `ascetic.lvl`'s GUID dependencies resolved through LBP3 PS4
1.28's `orbisguids.map` and FARCs (lbprender's `test/game.test.ts`); "what it is" is the FileDB
path's extension and folder, not a reading of the resource:

| type | magic | FileDB path |
|---|---|---|
| 1 | `GTF ` | ⚠️ a **game** texture is `GTF `, not the `TEX ` a user texture is (35 of 35 that resolved) |
| 2 | `MSHb` | `….mol`: a mesh — *The game's meshes* below |
| 5 | `ANMb` | `….anim` |
| 7 | `GMTb` | `gamedata_orbis/gmat/….gmat`: a render material — *The game's materials* below (3 of 3, all through the remap) |
| 11 | `FSHb` | `gamedata/scripts/….ff`: a compiled script |
| 13 | none: plain text, starting `#` | `gamedata/audio/sound_objects/….txt` |
| 16 | `MATb` | `….mat`: a physics material, `base_wood.mat`, `dark_matter.mat` |
| 24 | `BEVb` | `gamedata/bevels/….bev` |
| 38 | `PLNb` | `….plan`: the same type a user plan has |
| 48 | `INSb` | `….rinst`: an instrument |

❗ **A GUID with no FileDB row has usually been renumbered, not left out**: the 12 on that level
with no row (7 of type 1, 2 of 2, 3 of 7) are all old GUIDs in `orbisguids.remap`, and all 12 land
on a row and on bytes through it — *The GUID remap* below. The game's own meshes and materials
name their materials and textures the same way.

The `R*` resource-type ids themselves come from the eboot's ordered name list (`RTexture` = 1,
`RInstrument` = 48, `RSample` = 49) — [sequencer-data-model.md](sequencer-data-model.md).

## The Thing stream

`RLevel` → `PWorld.things`; `RPlan` → its Thing array. **The stream is strictly sequential**:
references are inline ids that expand at their first mention, parts carry no lengths, and
`PWorld.things` is an array of them, so reaching the 443rd Thing means having fully read the 442
before it. That is why `partReaders()` in `src/things/parts.ts` has **53** readers rather
than the nine part types that ever share a Thing with a sequencer — count it, do not quote it.

Per Thing, in stream order — every gate below was taken from cwlib's `Thing.java` and then
confirmed against files:

- the **UID**, then the **parent** — ⚠️ the other way round below `0x27f`;
- the **parts revision**, an `s32` **in the stream** before the part mask, one zigzag byte when
  compressed and four when not. It was guessed from the version for two days and recorded as *"one
  byte cwlib does not account for"*;
- the **`0xAA` test marker**, at `version >= 0x2a1` — ⚠️ and also on the LEERDAMMER branch from its
  own revision 5. It is a per-Thing checksum over the whole walk, and it reports a misalignment
  **one Thing late**, so the byte it names is never the byte that is wrong;
- the **parts mask**, likewise present on LEERDAMMER from revision 2. Without it the mask was `-1`
  and every declared part was treated as present. ⚠️ **The mask can exceed 2^53**: the highest
  part index is 53, so a Thing with `STREAMING_HINT` and a low part cannot be held in a `number`.
  `BigInt(s.u64())` does not fix it — the bits have to survive the accumulation, which is what
  `u64Big` in `serializer.ts` is for;
- ⚠️ **below subVersion `0x107` a mask bit is not a part index.** The deprecated `PCreatorAnim`
  (index `0x3e`) has bit `0x29`, read only from parts revision `0x32`, and every part from
  `TRANSITION` (`0x29`) up is **one bit higher** than its index; at `0x107` and above the creator
  anim is gone and the bits are the indices. ✔ Confirmed in the game's Thing loader, `v0xd49d92`
  in `eboot-v128.bin`: with the head `<= 0x106ffff` it tests the creator-anim bit and then tests
  `TRANSITION` on bit `0x2a` rather than `0x29`. `partBit` in `thing.ts` is the rule, for the reader
  and the plan writer both. This is not a pre-LBP3 corner: **subVersion 0 is in range**, it is
  every LBP2 level and nine of the ten corpus levels;
- the parts, each read by its own gates.

Three traps that were each found on the first file of a new kind:

- ⚠️ **`PStreamingHint.connected` is a double reference** — `s.references(builder)` reads an id
  and then the builder reads another. Empty in every corpus file, so the loop never ran.
- ⚠️ **A level can carry a second world Thing** — one has a `WORLD` inside a `CREATURE` — so only
  only the outermost's Things are the level's; `WORLD` was once installed on a *copy* of the reader map.
- ⚠️ **Nine of the fifteen LBP1 divergences were a version gate that existed in the reader's own
  comment and not in its code.** Parts were ported with their gates documented and then written
  for the LBP3 branch only; a grep for "at or below", "above 0x" and "regenerated" in `src/things/parts/`
  is a work list for anything still unported. And `connectorPos` is a `vectorarray`, whose cwlib
  return type is `Vector4f[]`: **a helper's name does not say its element width.**

### `cf7` hides field-width bugs — the archive's chunks are the only `cf0` corpus

With `COMPRESSED_INTEGERS` set — which every level and plan in the corpus has, the flags byte reads
`cf7` — every 32- and 64-bit integer is a LEB128 varint (7 bits per byte, low group first) and
signed ones are zigzagged; floats stay fixed 4-byte big-endian. So **an `i32` whose value is zero
is a single byte**, and a field declared `s.i32()` that is really one byte reads correctly on all
62,158 placements of the golden fixture and is wrong the moment it meets an uncompressed stream.
`CHKb` chunks are `cf0`, and three fields died on the first one:

| field | declared | is |
|---|---|---|
| `FieldLayoutDetails.machineType`, `fishType`, `arrayBaseMachineType` from `0x3d9` | `enum32` | **`u8`** — nine bytes per field on an uncompressed stream, none on a compressed one. With it wrong 101 of 2,553 islands died and the rest quietly lost most of their Things |
| `PCostume.creatureFilter` | `u8` | `i32` — the same mistake the other way |
| `PControlinator.parentBoneIndex` | `i32` | **one byte** — read as `4,161,536`, which is `0x003F8000`: a zero byte followed by three quarters of the `1.0f` of the identity matrix after it |

❗ **A field whose value is usually zero or small is untested for width by a compressed corpus.**
The 32 archived chunks — 5,832 Things, all parsing clean — are the `cf0` regression corpus; run
anything that touches a field width against them before believing the ten-level corpus.

## Plans — `PLNb`

A plan is a saved Thing rather than a world — a costume, a vehicle, or a music sequencer copied into
somebody's popit. `readPlan` in `src/things/level.ts` opens one and `readLevelProject`
dispatches on the magic. `RPlan` is four fields and only the third matters:

```
bool  isUsedForStreaming   subVersion >= 0xcc          (Revisions.STREAMING_PLAN)
i32   revision             the plan's own, IGNORED -- the resource's revision wins
i32   length               \  thingData
byte  data[length]         /  a Thing[] as a reference array: i32 count, then each
...   inventoryData        version >= 0x197 and not streaming: InventoryItemDetails
u32   location, category   the same, LAMS keys from version 0x2bb
```

⚠️ **The Things are in a nested stream with a fresh reference table.** Reference ids inside
`thingData` mean nothing outside it, so the blob gets its own `Serializer` with the same revision
and compression flags. Reading it in place works by accident on a plan holding one Thing. Two
proofs the wrapper offsets are right: the Thing array **fills `thingData` exactly** — 0 bytes left
on 220 of 220, asserted — and every one of 83,188 Things carries the `0xAA` marker.

✔ **`readPlan` reads the inventory block too, to the payload's last byte** (0.4.15,
2026-10-25): `inventory` is `InventoryItemDetails` (`src/structs/inventory.ts`, cwlib's layout
above version `0x37c`) and the two keys, and `unreadTail` says why when a plan does not end there.
All 10,556 game plans that open end there (`dev/things-census.ts`, Vita ones included), as do the
212 in the PS3 saves (`test/plan.test.ts`) and the plan the writer makes (`test/write.test.ts`);
a streaming island's plan has no block, and every island of the story chunks still reads clean.
What the game's 10,556 hold (scratch census, 2026-10-25):

- ✔ **`type` is cwlib's `InventoryObjectType` flag and names what the folder does**: `stick_` is
  `STICKER` (`1 << 3`, 3,342), `cos_` `COSTUME`, `mat_` `PRIMITIVE_MATERIAL`, `obj_`
  `READYMADE`, `decor_` `DECORATION`, `instr_` `INSTRUMENT` (`1 << 29`), `music_` `MUSIC`,
  `gad_` `GADGET` (one plan of each type, read by eye); 956 are 0, the story's own pieces such as `game_outro_a_base_virtual_6.plan`.
- `creator`: `MM_Studio` on 6,570, `Sumo_Digital` 2,687, `The_Station` 387, `Tarsier_Studios`
  348, empty on 392, none on 77.
- `titleKey` set on 7,834 (a LAMS key), a creator's own `name` on 118, an `icon` on 8,672;
  `dateAdded` is 0 on all of them.

❗ **Nine tenths of the music in a creator's backup is in plans, not levels.** Six real PS3 saves,
663 resources: **224 plans**, all but one parsing — the exception is at revision `0x272`, refused by
the bound on purpose — and **172 music sequencers inside plans against 19 inside the levels beside
them**. A gallery level is a rack of speakers pointing at plans; the songs are the
plans. `test/plan.test.ts` pins the counts. ⚠️ `PLNb` was once in the level
magic list meaning "read a plan as if it were a world", which produced eleven loud failures for a
backup that was fine; the magic was never the problem, the reader was.

## Streaming levels — `CHKb` and islands

An LBP3 adventure is not one level: `RLevel` → `StreamingManager` → `LevelData.chunkFileList`
names a pile of `CHKb` resources; each chunk holds **islands**; each island holds a whole `PLNb`
resource; that holds the Things. Measured against the two PS3 saves that use it (*Meched Inc.*,
42 chunks; *New Heights*, 129):

```
ChunkFile      sha1 chunkHash                       subVersion > 0x130
               StreamingCheckpoint[] QuestTracker[] QuestSwitch[] CollectableData[]
               i32 n, then n resource descriptors WITH AN INLINE TYPE   (>= 0xde)
                 -- the type follows a null descriptor (flag 0) too
               v3 min, v3 max, 4 bools, i32 n + n GUIDs, i32 n + n SHA-1s
StreamingIsland i32 timeZone, i32 flags, v3 min, v3 max
               bytearray planData        <- a complete PLNb resource, header and all
               the same four lists, then the GUID and hash lists
RStreamingChunk  StreamingIsland[] (references), then an intvector of chunk codes
```

**171 chunks, 2,553 islands, 10,837 Things, 9 music sequencers**, every island opening and the
chunk's own stream ending exactly on its last byte; `plan.test.ts` pins all four numbers. The 32
chunks fetched from the public archive (three levels, PS3 and PS4) hold 5,832 Things and **no
sequencer at all** — the plumbing is proved and the payoff still hypothetical.

The game's own story levels (`official_adventure_levels/…_container.bin`, subVersion
`0x19f`–`0x1ab`) put two things in front of that layout, measured on the 57 game levels the two
changes opened — 39 by the gates, 18 by the type-2 rule (`dev/things-census.ts`, 2026-10-19):

```
StreamingManager  editingThingsList, LevelData[] (references), i32 numIslands,
                  i32 numPendingIslands  > 0x1ff only,  descriptor fartDesc, v3 startingPoint,
                  i32 zoneShape, zoneSize, numInUsePlans,  i32 maintainIslandsCount  >= 0x1a9
LevelData         SlotID, i32 type,  ChunkFile[] (references)  NOT WHEN type IS 2,
                  v3 offset, v3 min, v3 max, LevelData parent,  guid farcGuid  >= 0x1ac
```

- ❗ **A `LevelData` of type 2 has no chunk list.** Every story container carries a second
  `LevelData` after the main one (type 0, its chunks), of type 2, whose type is followed straight
  by the offset — 12 bytes, usually zero — and plausible bounds, then the main one as its parent.
  Read with a count there, 18 containers failed a Thing marker a few bytes on; without it all 18
  end right. cwlib does not know it, and its own reader fails on these files with "Test
  serialization marker is invalid" (`CwlibTrace parts`, 2026-10-19). Only types 0 and 2 occur.
- ⚠️ The two gates on `farcGuid` and `numPendingIslands` were in a comment and not in the code;
  the PS3 saves are `0x213`, past both, so nothing failed until the game's own `0x1ab`.

### The story levels' chunks — 88 `FAR4`s beside the FARCs

❗ **The game's story chunks are not in the four FARCs**, which hold no `CHKb` at all. Each story
level has a `.farc` and a `_container.farc` under `gamedata/lbp3/…` (`official_adventure_levels`,
`marketing_demo2`): **88 archives that are `FAR4` in the clear** — a save's layout, unencrypted,
like a `.mod`'s `data.farc` — and hold nothing but `CHKb`. `readFar` opens all 88 with every SHA-1
checking out: **41,741 chunks, subVersions `0x12c`–`0x1ab`, 41,741 read, 288,519 Things**; 9
islands do not open (`dev/story-census.ts`, 2026-10-19). The level's world, `…_container.bin`, is
an `LVLb` in the FARCs; `test/story.test.ts` pins Needlepoint Peaks, 880 + 63 chunks and 9,214
Things.

❗ **A chunk's Things are in the chunk's own space, and the level says where it goes.** An island's
bounds run from `(0, 0, 0)` to the chunk's size; the level's worlds list every chunk in their
`ChunkFile`s with the box it fills, and **the box's min x and y is where the chunk's origin goes**
(z is already the world's). Measured on Needlepoint Peaks (lbprender's `dev/chunkplace.ts`): its
two worlds, `needlepoint_peaks.bin` and `…_container.bin`, list 880 and 63 chunks — every chunk of
the two archives, the main one and the container's; **943 of 943 islands have bounds the size of
their chunk's box**; 4,611 of 4,810 positioned Things lie within `[0, size]` in x and y, the rest
overhanging, and 4,708 inside the box's z as stored. Drawn without the offset, every chunk sits on
the others at the origin. `readLevel` returns the boxes as `LevelParse.chunks` (SHA-1, min, max);
`readChunkIslands` returns the islands' `bounds`.

The island and the lists it shares with `ChunkFile` were measured on the `0x213` PS3 saves, and
three things change below:

| subVersion | the island | measured |
|---|---|---|
| `0x213` | `i32` timeZone, `i32` flags, then the bounds | the PS3 saves |
| `0x12c`–`0x1ab` | **one `i32`** before the bounds; which of the two is not known | 41,741 of 41,741 |
| `0x213` | the chunk ends in an `intvector` of chunk codes | the PS3 saves |
| `0x12c`–`0x1ab` | **no chunk code list**: the island list is the whole chunk | 41,512 of 41,741 read so before the gates below; dropping the hash list instead read 36,622 and left bytes over on 4,890 |
| `<= 0x169` | an island ends after its collectables, no GUID or hash list — cwlib's `ChunkFile` gate | the `0x12c`–`0x167` chunks |

The streaming structs (`StreamingCheckpoint`, `QuestTracker`, `QuestSwitch`, `CollectableData`,
`ChunkFile`) now carry cwlib's subVersion gates; they had been written past all of them. The two
gates in the island are bracketed by measurement — absent at `0x1ab`, present at `0x213` — and no
file here sits between. `HUD_ELEM` got its reader from cwlib (2 islands), and a plan now reads a
`WORLD` part the way a level reads an inner world — **all of `PWorld`, not only up to `things`**,
because the world Thing's other parts follow it; the 3 islands holding one read since 0.2.73
(question 57 in [answered-questions.md](answered-questions.md)). ✔ **None is left**: all 41,741
chunks of the 88 archives read with no island refused (`dev/story-census.ts`, 2026-10-24 and
2026-10-25), `game_outro`'s six that had read short among them; `test/story.test.ts` holds
`titan_2`'s 757 chunks and `game_outro`'s 912 to it.

⚠️ **An island that will not open is reported, not swallowed.** Islands are independent resources
in one list, so one failing says nothing about its neighbours: `LevelParse.problems` carries them
out and `readBackup` puts them in `failed`. This is the one place in the reader where a partial
result is honest; everything else is one stream, where a bad read poisons what follows.

## The `FAR4` save archive — how a PS3 backup opens

A PS3 level backup is a save-game folder: `PARAM.SFO`, `PARAM.PFD`, `ICON0.PNG` and numbered files
`0`, `1`, … The numbered files are **the game's own `FAR4` save archive, XXTEA-encrypted** — not
PS3 savedata encryption — and the key is a constant that every tool for these files carries:

```
TEA_KEY = 0x01B70CBD 0x149607D6 0x07F94DD5 0x10DB8CA0   (big-endian 32-bit words)
```

The recipe, from `sequencerdump`: sort the fragments **by name as strings**, XXTEA-decrypt each,
strip the last 4 bytes of the *final* one, concatenate, append `46 41 52 34` = `"FAR4"`, then walk
the archive's entries and keep the `LEVEL` and `PLAN` resources. The layout, from the **end**
backwards — the last four bytes are `FAR<rev>` **and are never encrypted**, which is how a save is
recognised without decrypting anything:

```
len-4    char[4]  "FAR4"        rev 2..5; 5 is the Vita and is little-endian in places
len-8    u32      entryCount
len-0x1c sha1     hashinate      HMAC-SHA1 over the archive, rev > 2 (Vita: len-0x20)
         Fat[]    entryCount x 0x1c: sha1[20], u32 offset, u32 size   — always big-endian
         byte[]   the save key, 0x84 bytes: revision, localUserID, root type, root hash
         byte[]   the resources, back to back from offset 0
```

`fatOffset = len - 8 - entryCount*0x1c - 0x14` (rev > 2), minus 4 more on rev 5. The save key is
skippable; the FAT alone gets every resource out. The archive is cut into **0x240000-byte chunks**,
one file each, and each chunk is XXTEA'd on its own. ⚠️ **Only single-chunk saves are measured**;
`src/archives/savearchive.ts` verifies every resource against the SHA-1 in the table,
which turns that unmeasured boundary into a loud failure rather than a corrupt level.

✔ Measured 2026-09-04 on `BCES00850LEVEL01EE7CEE/0` (472,960 bytes): 28 resources, **28 of 28
SHA-1s matching their bytes**, one 275 KB `LVLb` holding **11 music sequencers**, in 102 ms. A wrong
key does not produce 28 matching SHA-1s. Two independent implementations agree on the key and the
table — ennuo's `cwlib/util/Crypto.java` + `SaveArchive.java`, and Zaprit's
[lbp_archive_dl](https://github.com/Zaprit/lbp_archive_dl) `save_archive.rs`, which **writes** one:
a site can serve the same level as a backup zip and as loose resources because it holds the
plaintext and *builds* the save on the way out. The encryption is something a download acquires.

- ❗ `PARAM.SFO` is not encrypted either: `src/archives/psf.ts` reads `SUB_TITLE`, which is
  how the pages title a drop "FJ's Music Hub by Festerd_Jester" rather than `32406766.zip`.
- ❗ **`FAR4` is not `FARC`.** The game's own `base_001.farc` is a different archive family, with
  no save key and no hashinate: *The game's archives* below.
- ⚠️ A uid is unique inside a level and **not** across a backup: a folder of forty routinely holds
  two sequencers numbered 7, so anything keyed on a sequencer must key on `file#uid`.
- ⚠️ This project told its users for two days that a PS3 save "cannot be read", with the recipe
  above already in steering. The wrong turn is *The PS3 backup* in
  [answered-questions.md](answered-questions.md).

## The toolkit's `.mod` — a zip, a FileDB and a `FAR4` in the clear

Not a game format: a `.mod` is Craftworld Toolkit's own package, defined by nothing but cwlib's
`types/mods/Mod.java`, and the game never sees one — the toolkit installs its rows into a FileDB
and a FARC. `src/archives/mod.ts` reads and writes it; the page opens one like a zip and
the Import/Export view writes one around the `.plan` ([export-to-game.md](export-to-game.md)).

| entry | what |
|---|---|
| `config.json` | `ModInfo`: `ID`, `type` ("pack"), `title`, `version`, `author`, `description` |
| `data.map` | a FileDB, revision `0x01480100` — LBP3 rows: `i16` path length, path, `u32` date, `u32` size, SHA-1, `u32` GUID; ascending GUID |
| `data.farc` | the rows' bytes as a `FAR4`: sorted by SHA-1 hex, padded to 4, a 0x84-byte save key holding only the revision (head `0x021803f9`, branch `0x4d5a`/`0xc` — the toolkit's own "Mizuki"), the table, a **zeroed** hashinate |
| `icon.png` | optional; read and written as the bytes it is (Java re-encodes its `ImageIcon`) |
| `patches.json` | optional, and only when there are patches: Gson's `ModPatch[]`, of which cwlib has one kind — `{"type": "TRANSLATION", "name", "languages": [...], "keys": [{"tag", "string"}]}`, `languages` `["*"]` from a legacy mod. `type` is matched without case, any other dropped (`PatchSerializer`). ⚠️ Nothing in the toolkit at `d6a2ef8` applies one; `translationPatchTable` makes its keys a table for `patchTranslationTable` |

A new row's GUID is the first free one from `0x00180000`, cwlib's "not used by any game".

✔ **Measured 2026-09-21 against cwlib itself, both ways** — `tools/ModCheck.java`
([lbptracker's tools.md](../../lbptracker/steering/tools.md)): `Mod` opens a file `writeMod` wrote, every row held under its hash; and a
mod `Mod.save` wrote around a gallery plan opens here as its 116-chip sequencer. Entry for entry,
**`data.farc` is byte-identical** to cwlib's and `data.map` differs only inside the date.
⚠️ No `.mod` from the wild was on this disk; the legacy one-file `MODb`/`MODe` that
`Mod.fromLegacyMod` still reads is not read here.

⚠️ **`data.farc` ends in the magic a save does and is not encrypted.** `readBackup` finds a save
by that magic and XXTEA-decrypts it, so a mod read as a pile fails every SHA-1 — except that a
one-plan farc *begins* with `PLNb` and opens by luck, with a save error beside it.
`readBackupZip` asks `looksLikeMod` before anything else; `readFar` in `savearchive.ts` is the
archive without the cipher. `data.map` is read by `readFileDB`, the game's own FileDB reader.

## The game's archives — the FileDB and the FARCs

A GUID dependency is a game asset, and two files turn it into bytes: the **FileDB** maps the GUID
to a path and a SHA-1, and a **FARC** holds the bytes under that SHA-1. Where an install keeps them
is in [lbptracker's game-assets.md](../../lbptracker/steering/game-assets.md); the layouts are
here. Both were cwlib's reading first (`types/databases/FileDB.java` and
`types/archives/FileArchive.java`, toolkit checkout at `fee22399`) and are measured on LBP3 PS4
1.28's own `output/orbisguids.map` and its four FARCs, 2026-10-19.

### The FileDB — `readFileDB` in `src/archives/filedb.ts`

```
u32  revision           (revision >> 16) >= 0x148 picks the LBP3 row
u32  count
per row         LBP3     LBP2 (cwlib only)
  path length   u16      u32
  path          utf-8, no NUL
  date          u32      s64       seconds
  size          u32
  sha1          20 bytes
  guid          u32
```

✔ `orbisguids.map`, revision `0x01480100` — the revision the toolkit's `.mod` stamps too: 107,673
rows whose walk ends on byte 11,088,903 of 11,088,903, no GUID twice. ⚠️ **No LBP2 FileDB was on
this disk**; the LBP2 row is cwlib's and pinned only by a synthetic test.

- ⚠️ **A row does not promise bytes.** 1,480 rows carry an all-zero SHA-1, and 32,819 rows (the
  zeros among them) name a SHA-1 that none of the four FARCs holds — content the install does not
  ship. A resolver must expect a miss.
- ⚠️ **A SHA-1 can sit in two FARCs**: the 74,854 rows that resolve find 75,128 entries. Any
  archive that has it will do; the bytes are the hash.
- cwlib rewrites a path starting with `.` (some Vita databases store only the extension) to a
  hash-named one. Not ported: no such database was on this disk.
- ✔ **Written too** (`writeFileDB`, 0.4.34, cwlib's `FileDB.build` with the rows in the order
  given): `orbisguids.map` read and written back with its own revision is the same 11,088,903
  bytes (`test/filedb.test.ts`); `writeMod`'s `data.map` is written by it. ⚠️ `output/orbischunkids.map`
  beside it is **not** a FileDB — it opens `00 01 00 01 00 01 a4 99`, no revision and count — and is
  not read here.

### FARC — `openFarc` in `src/archives/farc.ts`

```
0              byte[]   the resources, back to back from offset 0
len-8-n*0x1c   Fat[n]   sha1[20], u32 offset, u32 size        big-endian
len-8          u32      n
len-4          char[4]  "FARC"
```

✔ All four archives, **74,169 entries, every one read and hashed: 74,169 SHA-1s match**, every
entry's size equals its FileDB row's, and every entry has a FileDB row. In each archive the entries
tile `[0, fatOffset)` exactly — no gap, no overlap, no padding — and the table is sorted by SHA-1.

| archive | bytes | entries |
|---|---|---|
| `base_001.farc` | 1,759,365,872 | 19,545 |
| `chunk1_001.farc` | 3,344,395,907 | 50,159 |
| `craftworld_001.farc` | 138,755,737 | 1,770 |
| `intro_001.farc` | 90,232,029 | 2,695 |

- ❗ **The offset is unsigned, and it matters.** `chunk1_001.farc` puts 18,251 entries past 2^31;
  cwlib reads it with `u32()`, and an `i32` would put them before the file. The format's own limit
  is therefore 4 GiB an archive.
- ❗ **Nothing is read but the table until an entry is asked for.** The file comes in as a
  `RandomAccess` — `openFileAccess(path)` in `platform/node.ts`, `blobAccess(file)` in
  `platform/web.ts` — injected like the inflater. A row that runs into the table is refused at
  open, so a misread table fails loudly rather than handing out the wrong bytes.
- The entries are **not all resources**: the magics include `RIFF` (the sequencer's samples),
  PNG, JPEG, `GTF ` textures, and several hundred headerless blobs. 51 `INSb` instruments sit in
  `base_001.farc` alone.
- ✔ **Written too** (`writeFarc`, `writeFarcTable`, 0.4.35): the resources back to back in the
  order given, then the table sorted by SHA-1. **`intro_001.farc` comes back byte for byte** —
  90,232,029 bytes — from its own entries read in the order they lie, and each of the four
  archives' tables is written back as it is from its rows in any order (`test/farc.test.ts`). The
  order the data lies in is not the SHA-1 order and is not measured here; a rebuild that must match
  keeps the old offsets' order. `writeFarcTable` alone is the tail for an archive too big to hold.

### The GUID remap — `readGuidRemap` in `src/archives/filedb.ts`

`output/orbisguids.remap` sits beside the FileDB, and a resolver that skips it loses most of the
game's materials and textures: **the PS4 build re-exported its render assets under new GUIDs, and
the meshes and materials still name the old ones.** Of the 12,346 material GUIDs on the game's
mesh primitives, **679 have a FileDB row and 11,667 resolve only through the remap**; of the
29,915 texture slots in the game's materials, 4,936 and 24,968 (`dev/material-census.ts`,
2026-10-19).

```
u32  0x00ea03e7         not understood
u32  n                  56,271
n x  u32 old, u32 new
u32  n again
n x  u32 length, path, u32 new        the old path: gamedata/gmat/… where the row says gamedata_orbis/gmat/…
```

✔ On LBP3 PS4 1.28's own file: the walk ends on byte 4,330,948 of 4,330,948; **row i's GUID is
pair i's new GUID on 56,271 of 56,271**; no old GUID is a FileDB row (0 of 56,271) and 36,326 new
ones are; no GUID appears twice on either side. Behind it: `.tex` 37,517, `.gmat` 18,087, `.mol`
446, and a few shader programs, movies and lists. Resolve a GUID through the FileDB first and
through the remap when that misses.

⚠️ cwlib has it as `types/databases/RemapDB.java` and names the pair `(to, from)`, the direction
its toolkit uses it in — rewriting a PS4 FileDB back to the old GUIDs. Its comment that the path
row's GUID is "the same as row.to" is wrong: it is the pair's second word.

### Gathering what a resource needs — `gatherDependencies` in `src/archives/gather.ts`

cwlib's `Resources.collect` (ennuo/toolkit `d6a2ef8`), which a mod is built from: each resource with
a binary header (`b` or `e` fourth byte) has its dependency table walked, every row fetched
through a `resolve` the caller injects, dependencies before what needs them and the root last.

- ✔ **On the game** (`test/gather.test.ts`, 2026-10-25): `obj_jam_jar.plan` gathers 11 resources
  with nothing missing; `goty_levels/x-nobody-x.bin`, the biggest level in the FileDB, 1,256 —
  by row type 532 textures (1), 325 scripts (11), 176 gfx materials (7), 98 meshes (2) and 50
  plans (38) among them — in about half a second.
- ❗ **What a FARC does not hold, a gather through the FARCs misses.** That level's 18 missing rows
  all have FileDB rows: 8 `gamedata/audio/*.fsb` banks (type 0), and 10 rows of type 10 — 8 GUIDs
  for one `empty_video.bik`, a `.fsb` and a `.bik` under `gamedata_orbis/`. Every one of those
  11 paths lies loose in the install, so a resolver that is to miss nothing reads loose files by
  FileDB path as well.
- ❗ **527 of the game's 534 scripts name themselves** in their own dependency table — the loop
  Java's comment fears, and why it skips every `SCRIPT` row. Here a row already seen, by GUID or
  by SHA-1, is not fetched again, so the walk cannot loop and scripts are gathered too.

### One install opened — `openGame` in `src/archives/game.ts`

cwlib's `ResourceSystem.extract` over one install: a GUID is its FileDB row, or the remap's when
the FileDB misses (Java's `get` does not look there; only the toolkit's window loads a
`RemapDB`); a row's SHA-1 is looked for in the FARCs, and failing that its path is read loose
through an injected `loose` (`looseFiles(root)` in `platform/node.ts`), Java's `extractFromDisk`.

- ✔ **With the loose files, `x-nobody-x.bin` gathers whole** (`test/game.test.ts`): 1,267
  resources and none missing — the 1,256 above and the 11 loose files, the 8 GUIDs of
  `empty_video.bik` landing on one.
- ❗ **Where the FileDB's 107,673 rows lie** (scratch census, 2026-10-25): 74,854 in a FARC, 28,365
  loose and none both; 4,454 in neither. Loose: 27,254 `.mp3`, 638 `.fsb`, 358 `.bik`, 92
  `.farc`, 11 `.fnt`, 7 `.fev`, 5 `.prx` — and 28,359 of them hash to their row's SHA-1. In
  neither: 1,480 rows with an empty path and a zero SHA-1, 2,960 `.mp3`, 8 `.fnt`, 6 `.fsb`.
- ⚠️ **A loose file is not always its row's bytes.** The 5 `gamedata_orbis/spu/*.prx` are a tenth
  of their rows' size or less, and `chunk1_001.farc` is a row of its own whose size matches and
  whose SHA-1 does not; `base_001.farc`'s row hashes true. `resolve` hands a loose file over as
  it is, as Java does, so a caller that must have the row's bytes checks the hash.
- ⚠️ `looseFiles` reads a whole file, so a row naming a FARC (over 2 GiB for `chunk1_001.farc`)
  throws there; open a FARC with `openFileAccess` instead.

### What of the game's own Things opens

Every `PLNb` and `LVLb` in the four archives through `readThings`, `dev/things-census.ts`
(2026-10-19, evening): **10,370 of 17,624 plans and 229 of 522 levels parse.** 7,068 plans and 265
levels are refused by the version bound or the oldest header layout — most at `0x397`, the LBP2-era
assets LBP3 still ships — and **186 plans and 28 levels fail on something else**: 25 of the levels
are crossplay Vita, and the others `manglewood_hub_container.bin`, `fickle_mistress.bin` and the
pre-alpha `sack_town.bin`. The morning's count was 10,368 and 147; what moved it:

- two part readers ported from cwlib, `POPPET_POWERUP` (the popit puzzles, 14 levels) and
  `TAG_SYNCHRONIZER` (the crossplay levels, 9);
- ❗ **two streaming gates that were in a comment and not in the code**: `LevelData.farcGuid` from
  subVersion `0x1ac` and `StreamingManager.numPendingIslands` above `0x1ff`. The PS3 saves that
  proved the streaming chain are `0x213`, where both are present; **LBP3 PS4's own story levels
  are `0x19f`–`0x1ab`**: 39 of them open now. `space.bin` read its 1,476 chunk files correctly and
  then failed a Thing marker 100 KB later, which is how a gate this small shows itself;
- a `LevelData` of type 2 has no chunk list (18 levels) — *Streaming levels* above;
- cwlib's subVersion gates in the streaming structs, which also opened the story chunks (2). `maintainIslandsCount` is gated at `0x1a9` with them.

### `readLevel` reads to the end

Since 2026-10-25 `readLevel` reads the outermost world's tail, the world Thing's other parts
and the rest of `RLevel` — `PlayerRecord`, the tutorial inventory and its cached data, the
Vita's music GUIDs, `dceUuid`, `AdventureData` — cwlib's `RLevel.java` gate for gate, and
requires the payload's last byte. Where that fails the Things are still returned and
`LevelParse.unreadTail` says why. ✔ **It holds on 249 of the 251 `LVLb` in the FARCs that
open, all 82 of the archive sample's, Bonsai's 15, the 10 PS3 levels of the toolkit's
`sequencerdump/data` and the fixture** (2026-10-25).

- ❗ **It found a gate at once.** `StreamingManager` reads `streamingZoneShape`,
  `streamingZoneSize` and `numInUsePlans` from subVersion `0x160` only, as cwlib has it; this
  reader read them always, and LBP3's pre-alpha `stitchem_manor.bin` (`0x130`) and the outro
  `game_outro.bin` (`0x151`) still "opened" — their worlds hold one Thing each, and the three
  integers came out of what followed. Every story level is past the gate.
- ✔ **`RLevel` has three reads cwlib does not**, from the game's loader `v0xc51f60` (found by
  its head-word compares, 2026-10-25; the reflective serialiser `v0xc52a20` beside it names the
  fields and has no gates): a struct for subVersions `0x8e`–`0xaf`, **a reference for `0xb0`–
  `0x125`** to a `0x88`-byte object the loader frees at once, and a buffer at `0xf0` exactly.
  The reference is the byte `pod2.bin` (`0xe2`) and `sack_town.bin` (`0xc8`) had over — null
  in both, and before `savedThroughPusher`, not after it — so **all 251 `LVLb` in the FARCs
  that open now read to their last byte**. cwlib's own gates there (`0x35`–`0x90`, `0x35`–`0xb2`,
  `0x95`–`0x129`, `0xf1`–`0xf9`, `0xfa` on) are the loader's too. ⚠️ The loader reads no Vita
  music GUIDs, which cwlib reads at the Vita's revision `0x70`: *The Vita branch* below.

### `playerMode` at 0x3eb, and the plans that failed last

**The game's plans that open but do not read went from 31 to 6, and then to none,** on
2026-10-25 (`dev/things-census.ts`: 10,556 plans read, each to the Thing array's last byte;
`test/game-plans.test.ts` holds the last six):

- ⚠️ **`playerMode` is not monotonic in the version.** It is the last byte of `PSwitch`,
  `PSwitchInput` and `PControlinator`, and cwlib reads it from 0x3ed. The game's crossplay plans
  at 0x3eb (`gamedata/lbp2/dlc/crossplay/`) carry it — 22 read only with it, and cwlib fails on
  them at the same byte (a `GROUP` read as a back-reference to Thing 1, its own body then read
  as the next part) — while the 11 plans at 0x3ec in the PS3 saves read only without it.
  `hasPlayerMode` in `src/things/parts/common.ts` is exactly that: 0x3eb, and above 0x3ec.
  ❗ Every 0x3eb resource the game has that carries one of the three parts is crossplay (the
  other 71 at 0x3eb, Knights of Old 2 and Ultrashirt, read either way), so whether the byte
  belongs to the version or to the crossplay build is not known.
- `PWindTweak` had taken subVersion 0x172 for granted; cwlib's gates, ported whole, read the
  two plans below it (`sack_town_obj_pumpinator_2a_6.plan` at 0xc8, `mat_base_wind.plan` at
  0x16b). The 0x3eb crossplay `obj_sack_boy` plan read with the `playerMode` fix.
- ✔ **The last 6 were settled by the game's loaders** in `eboot-v128.bin` (2026-10-25), each a
  read cwlib has not:
  - `gad_gamelivestreaming_choice.plan` (subVersion `0x186`): `PSwitch`'s loader (`v0xd0510a`)
    reads **five wide strings** for a switch of type `0x4b` from subVersion `0x166` — `Red`,
    `Blue`, `Green`, `Black`, `White` here — and only interns them from `0x187`. cwlib throws
    there, and its comment guesses four below `0x187`.
  - five LBP2 Move DLC `*_stick_palette_identity_*.plan` at 0x3c1 and 0x3c7, whose one Thing
    ended at byte 138 of 294 in cwlib as here: `PStickers`' loader (`v0xcfff80`) reads, after
    `EyetoyData` and **for versions `0x3bc`–`0x3cb` only**, an array of descriptors
    (`v0xd77400`) and drops it. Each of the five has one hash there, not in the FARCs; the
    `SHAPE` that follows is reference id 6, as the run of ids says. Their one decal is the
    corpus's only `PAINT` below `0x3d0`, but the gate is the version: the eight sticker parts
    at `0x3ce` have no such array. The same loader reads `EyetoyData` from `0x15e`, where
    cwlib has `0x15d` — no file between.

Before the container's header gates, 567 plans and 116 levels died in the container instead of at
the bound. That makes the game's own archives the largest corpus this reader has met, and the first
with anything in the span below the bound: *28* in [open-questions.md](open-questions.md).

### The Vita branch — `DOUBLE11`, `0x4431`

The four FARCs hold **173 Things resources on the Vita's branch**: the crossplay levels
(`gamedata/lbp2/dlc/crossplay/…/*_crossplayvita_*.cpv`, `gamedata/lbp2/e3demo2/…`), 25 `LVLb`
and 148 `PLNb`, all at version `0x3e2` and subVersion 0, branch revisions `0x54` to `0x87`
(`0x87` is cwlib's `D1_MAX`). cwlib's `Revision.isVita()` is the branch id **and** a head
from `0x3c1` to `0x3e2`; `vitaRevision` in `src/io/serializer.ts` is that, and every gate on
it is cwlib's `has(DOUBLE11, n)` (ennuo/toolkit `d6a2ef8`): the Thing's flags (16 bits from
`0x62`), `PWorld`'s Vita fields and its early return, `GlobalSettings` and `PLevelSettings`'
`nonLinearFog`, `MoveCursor`, and the parts `PShape`, `PTrigger`, `PSwitch`,
`PPhysicsTweak`, `PMaterialTweak`, `PGeneratedMesh`, `PEnemy`, `PEmitter`, `PCreature`,
`PControlinator`, `PCheckpoint`, the decal, the decoration, `NpcBehavior` and
`InputRecording`.

- ✔ With them **all 148 plans read**, where none did (`dev/things-census.ts`, 2026-10-25),
  and 7 of the 25 levels, to their payload's last byte (*`readLevel` reads to the end* above).
  Nothing off the branch moved: the census's other rows are the same files.
- ❗ **The other 18 levels hold parts no reader had**, and cwlib fails on them too
  (`CwlibTrace`: a `ClassCastException` at the same byte). Their Things have **parts revision
  `0x31`** and mask bit `0x27` or `0x28`. On LBP3 those bits are `POPPET_POWERUP` and
  `POCKET_ITEM`, from parts revisions `0x30` and `0x31`; **on the Vita the same two revisions
  and bits are parts of its own**, which cwlib's `Part` table does not have. `VITA_PARTS` in
  `src/things/thing.ts` sends them on the branch to `readVita27` and `readVita28`
  (`src/things/parts/vita.ts`), **a reading of our own and a partial one**:

  ```
  0x27  u8 (0, 2), u8 (0..12, even), wstr name, f32, i32 0, f32 1.0, f32 1.0, 2 × Thing ref
  0x28  u8 (0, 2), u8 2, u8 (0, 1), u8 closed (0, 1), 3 × u8 0, u32 (8 when closed),
        and when not closed a Thing reference
  ```

  ✔ **12 of the 18 levels read to the payload's last byte with them**, so 19 of the 25 Vita
  levels do (`test/vita.test.ts`). The other 6 contradict them somewhere and do not open.
- What the parts are: `0x27` is always on a Thing with a `SCRIPT`, beside `POS` and
  `RENDER_MESH` or alone, and **its string is a name the creator gave** (`Beam 1`, `Box1`,
  `Timer Hand`, `Count - Timer`, `Rec3`, `Sackboy`); `0x28` is always on a Thing with a
  `SCRIPT` and a `SWITCH`. Every field is a width only; the two references of `0x27` are 0 on
  almost every one and 1 on a few, which a pair of bytes would read the same.
- ❗ **The PS4 eboot does not read the Vita's branch** (2026-10-25): no instruction in it
  compares with `0x4431` — the one `mov` of it is in a GPU texture-format table — nor with its
  byte-swapped or shifted forms, and `RLevel`'s loader has no Vita field. So it cannot settle
  these parts, and the game on PS4 presumably never loads a `.cpv`.
- ⚠️ **Why the 6 are not settled from their bytes.** In `gamescom_011_crossplayvita_03.cpv` the
  world's Thing array ends two elements before the reader expects — `PWorld`'s tail begins
  (`maxVel` 100, `maxAVel` 1) at element 1,203 of 1,205 — so two bytes the readers take into a
  body are two null elements. Reading any one world-level `0x27` without its two references
  makes the level whole: **null elements are interchangeable, and the check cannot say which
  instance is the short one**; doing it for every instance of one kind makes none whole.
- ❗ **A level that reads proves its parts only to its last byte: the trap behind this.**
  `readLevel` used to stop after the outermost world's `things`. That array is references, so
  a body read too short left zero bytes that read as null references, the walk went on, and the
  level "opened": the same readers opened 12 of the 18 that way before there was anything to
  check them against. A level whose `unreadTail` is set has not proved its parts.

## The game's meshes — `RMesh`

`readMesh` in `src/resources/mesh.ts`: magic `MSHb`, dependency type 2, FileDB paths ending `.mol`. The field
list is cwlib's `resources/RMesh.java` and `structs/mesh/` (toolkit `fee22399`) and was a hypothesis
until measured on **every `MSHb` in LBP3 PS4 1.28's four FARCs, 5,941 of them**, revisions `0x237`
to `0x3f9` and subVersions up to `0x16b`, 4,896,968 vertices — `dev/mesh-census.ts`, 2026-10-19.
✔ **5,941 of 5,941 read to exactly the last byte of their payload**; no revision fails. `readMesh`
throws when one does not, as `readPlan` does.

```
i32 x 7           numVerts, numIndices, numEdgeIndices, numTris, streamCount, attributeCount, morphCount
char[16] x 32     morph names, NUL-padded
                  version >= 0x239: f32[] minUV, f32[] maxUV, f32 areaScaleFactor
i32 x (streamCount + 2)   stream offsets: 0, each stream's end, the last end again (5,941 of 5,941)
byte[numVerts * 16] x streamCount    0 positions, 1 skinning, 2.. one morph each
bytearray         attributes: numVerts x attributeCount x (f32 u, f32 v), interleaved per vertex
bytearray         indices: (numIndices + numEdgeIndices) x u16, the primitives' and then an edge list
                  subVersion >= 0x16b: bytearray triangleAdjacencyInfos
Primitive[]       resource gfxMaterial; (< 0x149 a second one); (>= 0x179) resource textureAlternatives;
                  i32 minVert, maxVert, firstIndex, numIndices, region
Bone[]            char[32] name, i32 flags, i32 animHash, s32 parent, firstChild, nextSibling,
                  m44 skinPose, invSkinPose, v4 obbMin, obbMax, MeshShapeVertex[], MeshShapeInfo[],
                  f32 shapeMinZ, shapeMaxZ, v4 boundBoxMin, boundBoxMax, boundSphere
...               mirroring, u8 primitiveType, softbody, implicit shapes, cullBones, regionIDsToHide,
                  hairMorphs (>= 0x141), ..., (subVersion >= 0xd6) u8 skeletonType — walked, not kept
```

What each convention rests on, every one a count over the same 5,941:

| convention | measurement |
|---|---|
| the index buffer is `numIndices + numEdgeIndices` u16s | 5,941 of 5,941. ⚠️ Not `numIndices` alone, which is all cwlib's own constructor writes |
| strip or list | `primitiveType` 6, a strip, on 5,802; 5, a list, on 139 |
| strips restart on `0xffff`, the parity restarting with them | read so, **5,180,865 of 5,187,415 non-degenerate triangles (99.87%) wind counter-clockwise about their vertices' own normals** — the strip parity and the normal unpacking checked against each other |
| degenerate triangles are stitching, dropped | `numTris` is the non-degenerate count on every mesh that draws no run twice |
| ⚠️ a run can be drawn twice | 345 meshes, LBP2 costumes mostly, give two primitives the same `firstIndex` and `numIndices` under two materials. The distinct runs tile `[0, numIndices)` in all 5,941 |
| position: stream 0, bytes 0–11, f32 | the winding above. Bytes 12–15, cwlib's softbody cluster and weight, are `0x000000ff` on 4,664,668 vertices |
| normal: stream 1, bytes 4–6, cwlib's `unpackNormal24` | the winding above, and `x² + y² ≤ 1` on every vertex |
| joints: stream 1, bytes 3, 7, 11, 15, **0-based** | never at or past the bone count, and `bones − 1` is reached on 3,471 meshes. ⚠️ cwlib's `fixupSkinForExport` subtracts one |
| weights: bytes 2, 1, 0 and the remainder to 255, in that joint order | a slot with no weight points at joint 0 on 88% of such slots, against 6% with the bytes the other way round; the three never sum past 255; a single-bone vertex is `ff 00 00` |
| bone matrices column-major, like `PPos` | 99.99% of weighted vertices taken to bone space by `invSkinPose` land in their bone's own box (3,015,586 of 3,015,903, bone 0 left out), against 10–18% read row-major, depending on how tight the box. `skinPose · invSkinPose = I` on all 114,635 bones; a parent is always below its child |
| UV channels interleaved per vertex | 74–90% of triangle edges are shorter than 0.1 in each channel, against 14% read channel-major. 12 meshes have one channel, 2,852 two, 3,077 three. ⚠️ `minUV`/`maxUV` are **not** a channel's bounds: values below `minUV` are common |
| materials | 12,344 of 12,403 primitives name an `RGfxMaterial` by GUID, none by SHA-1, 59 none |

- ❗ **The packs at stream 1 bytes 8 and 12 are not what cwlib calls them.** Unpacked like the
  normal, its "tangent" is perpendicular to the normal on 2.4% of vertices — on 78% of a 400-mesh
  sample of `base_001.farc` the two have `|cos| > 0.9` — and its "smooth normal" falls on the
  normal's side on 48%, which is chance. `readMesh` returns neither until something says what they
  are.
- ⚠️ `minVert`/`maxVert` are not a bound: six meshes carry nonsense there (`newton_low_poly.mol`,
  `-2147412636..1480`) and 13,626 indices fall outside their primitive's range. The triangles never
  need them.
- ✔ **Morphs** (on 558 meshes, up to 29) are one 16-byte-a-vertex stream each, and from 0.4.27
  `morphs` returns them: per vertex an `f32` offset and a `u32` normal, cwlib's `getMorphs` and
  `unpackNormal32`. Over all 5,567,384 morph vertices the stream count is two more than the morph
  count on every mesh, the normal has unit length to 0.02 on 99.99%, and 78% of offsets are zero —
  the vertices a morph leaves alone. ⚠️ One mesh, `c7a1a3b0` (morph 8), has 21 offsets that are no
  float (`ffff000d`, NaN as read); they are returned as written.

### `PRenderMesh` — what draws a Thing

`readRenderMesh` in `src/things/parts/render-mesh.ts` returns `RenderMeshPart`: the mesh reference, the bone Things,
the animation and where in it, `editorColor`, `castShadows`, `visibilityFlags`,
`poppetRenderScale`. Over the 93 levels that open from lbptracker's `fixtures/levels`, the toolkit
checkout and the archive sample — 13,033 render meshes, 2026-10-19:

- **`boneThings[0]` is the Thing itself** whenever there are any (10,605; 2,428 have none), and a
  bone Thing's own `POS` is the bone's world matrix.
- ⚠️ **It is not one per bone.** Of the 9,101 whose mesh resolves in the PS4 install and that have
  bone Things, the list is as long as the mesh's bones on 8,714; 384 carry three for a one-bone
  mesh — the music sequencer's chassis `sequencer.mol` (127558), whose plan shape
  [export-to-game.md](export-to-game.md) writes as `[self, null, null]`, and `note.mol` (96644) —
  and 3 carry 43 for the 49-bone DC cape. **Nulls are common and only ever trail** (1,516 lists end
  in them): a renderer takes `boneThings[joint]` when it is there and the Thing's own matrix when it
  is not. `test/mesh.test.ts` pins `ascetic.lvl`'s 104.
- `visibilityFlags`: 3 on 11,937, 2 on 1,073, 0 on 23 — cwlib's bit 0 play mode, bit 1 edit mode.

### Written as glTF — `meshToGlb` in `src/resources/mesh-gltf.ts`

cwlib's `MeshExporter.GLB.FromMesh` (ennuo/toolkit `d6a2ef8`): one glTF mesh per primitive
`region`, positions, normals, every UV channel, the bones as a skin, the morphs as targets named in
`extras.targetNames`; each material as `gltfMaterials` (`src/resources/gltf-material.ts`) makes it
from the graph, its textures embedded as PNG (`encodePng`, `src/io/png.ts`), or else a name the
caller gives (`materialName`).

- ✔ **All 5,941 of the game's meshes validate with no error and no warning** under Khronos's
  `gltf-validator` 2.0.0-dev.3.10 (scratch census, 2026-10-25; 537 MB of `.glb`); `test/mesh-gltf.test.ts`
  reads one back and `sack_boy.mol` whole. Every one is skinned. Getting there measured four
  things Java's export does not deal with, each a row of *Where we deliberately differ*:
  - ❗ **335,720 vertices name one joint in two slots, both weighted**: the remainder weight goes
    to the fourth joint byte (`readMesh`), often the first slot's joint again. glTF refuses the
    repeat; the export folds it into the first slot, which skinning makes the same pose.
  - **An inverse bind matrix's last row is (0, 0, 0, 1) only to 2.4e-7** on the element 15 —
    elements 3, 7 and 11 are exactly 0 on every bone — and glTF wants it exact; it is written so.
  - **NaN**: 21 morph offsets of `c7a1a3b0` and 20 values of `22e0a38f`'s second UV channel,
    written 0.
  - **Two meshes have no vertex at all**, `9cb6855f` and `d875feda`: skeletons of 43 bones, one
    with 29 morph names. They are written as the skeleton alone.
- A bone's node is its local pose, `parent.invSkinPose × skinPose`, as translation, rotation and
  scale — Java's decomposition; a raw `matrix` fails glTF's TRS check on float noise.
- ✔ **With their materials and textures, all 5,941 still validate with no error** (scratch census,
  2026-10-25, 9.8 GB of `.glb` with every texture inlined per mesh): every material every mesh names
  resolves and reads; of 11,795 (counted per mesh), 10,666 carry a base-colour texture and 7,761 a
  normal map. The one warning left, on 7,998 primitives, is that a normal-mapped material has no
  tangents — `readMesh` does not return the stream (*java-parity.md*), so a viewer makes its own.
  - The material is `materialSummary`'s reading: port 0's first texture sample upstream as the base
    colour, port 3's as the normal map, a colour box as `baseColorFactor`, `GFX_TWO_SIDED` as
    `doubleSided` and `GFX_ALPHA_CLIP` as `MASK` at `alphaTestLevel` (cwlib's names, not measured).
    ⚠️ The first sample upstream is not always the colour: `sack_boy_weave_base.gmat`'s is
    `sackboy_knit_ps4_ao.tex`, an AO map, the colour being the Thing's.
  - ❗ **A colour box holds 0 to 1**: 8,067 of the game's 8,166 (over its 11,011 materials, max 6).
    Java divides them by 255; they go in as they are, clamped to 1 as glTF wants — one material's
    diffuse colour reaches past it.
  - A normal map goes in as Java converts it, x = 1 − alpha and y = green, with z rebuilt as the
    game's shader does, `sqrt(|1 − x² − y²|)` (lbprender's steering/game-shaders.md), where Java
    writes 1. The sign of x is Java's and is not measured.
  - A sample's UV matrix goes in as `KHR_texture_transform` (151 rotated or skewed); a shear has
    no place there and is lost, on 4. Wrap 1 is `REPEAT`, 2 `MIRRORED_REPEAT`, the rest
    `CLAMP_TO_EDGE`. A cube or volume texture has no glTF image and is left out.

## Shapes — `PShape` and `PGeneratedMesh`

A level's material geometry — wood, cardboard, stone — is not a mesh: it is a Thing's `PShape`
outline, extruded, and drawn as its `PGeneratedMesh` says. `readShape` returns `ShapePart` (the
polygon as `x, y, z` per vertex, the loops, the physical material, thickness, colour as ARGB,
brightness, bevel size) and `readGeneratedMesh` returns `GeneratedMeshPart` (the gfx material, the
`RBevel`, `uvOffset`, `planGUID`, `visibilityFlags`, `noBevel`, `includeSides`); the bytes walked
are the same as before. Counted over the story chunks' **80,002 shapes** (`dev/story-census.ts`,
2026-10-19):

| what | count |
|---|---|
| the loops sum to the vertex count | **80,002 of 80,002** — the loops are runs of the vertex list, in order |
| one loop / more / none | 78,172 / 1,828 / 2 |
| with a `PGeneratedMesh` | 65,637; of those, a gfx material and a bevel named on 63,322, a gfx material alone on 2,306, neither on 9 |
| `visibilityFlags` | 3 on 64,818, 2 (edit mode only, by cwlib's bits) on 819 |
| the Thing's world z a multiple of 100 | 76,985 |
| thickness 10 / 90 / 50 / 190 / other | 32,418 / 28,347 / 5,071 / 5,625 / 8,541 — one layer is 100 units, less a 10 gap |
| the stored z: none / all 0 / varying / one other value | 26,194 / 32,118 / 5,767 / 4,963 |
| ⚠️ the stored z, all equal to **minus the Thing's world z** | **10,960** |

- ❗ **A shape's front face is at z = +thickness in its own space, its back on its plane.** Not
  from the shape's bytes but from its decorations, which sit on the front: on Needlepoint Peaks
  their offsets' z is the owner's thickness — 90-thick shapes carry theirs at 90–110, 190-thick at
  190, 10-thick at 10–20 (lbprender's `dev/decorations.ts`, *Decorations* below).
- ⚠️ **A shape's stored z is not where its face is**: on 10,960 shapes it is exactly minus the
  Thing's world z, which would put all of them at 0. What the game does with it is not known; a
  renderer that extrudes in the Thing's own z ignores it.
- ❗ **Shapes are stacked on one layer**, and `zBias` is how some of them are ordered: on
  Needlepoint Peaks, its chunks placed, 922 pairs of shapes overlap with their faces in one plane
  and about two thirds differ in `zBias` (lbprender's `dev/coplanar.ts`). It is a byte read as signed: 0 on 1,476 of
  2,074 shapes, 10 on 270, 246 (−10) on 247, the rest between. `ShapePart.zBias` keeps it as
  stored; which sign is nearer is not measured.
- ❗ **`colorOpacity` is a percentage, and 0 means the shape is not seen.** On Needlepoint Peaks'
  2,042 play-mode shapes (lbprender's `dev/markers.ts`): 100 on 1,099, 40–97 on 18, and **0 on
  925** — 901 of them the 913 shapes drawn with `proc_base_virtual.gmat`, a material with no
  texture that feeds the Thing's colour to the diffuse and glow ports (`alphaMode` 2, no shadow).
  Drawn opaque, those are the large white slabs a story level does not have. `ShapePart.colorOpacity`
  keeps the byte; 255 below version `0x3c1`, where the field is absent.
- ❗ **A later loop is a hole in the first**: on Needlepoint Peaks, the Casino and the Caverns
  (lbprender's `dev/holes.ts`), all 200 loops after the first lie wholly inside it and wind the
  other way. `ShapePart.loops` keeps them in stored order; the first is the outline.
- What `uvOffset` is — `(u, v, 0, 1)` on most, with a fourth component of 1.316 on some — and the
  scale a face is mapped at are a reading, not a measurement. The bevel is `RBevel`, *Bevels* below.

## Decorations — `PDecorations`

A decoration is a mesh stuck onto a Thing — a rivet, a button, a rope knot. `readDecorations`
returns `Decoration[]`: its `PRenderMesh`, its `offset` (a 4x4 column-major like `PPos`), the bone,
triangle and barycentric point it was placed on, its angle and scale, `reversed`, `playModeFrame`
and `planGUID`; the bytes walked are cwlib's `Decoration.java`. Measured on Needlepoint Peaks, its
chunks placed, **520 decorations** (lbprender's `dev/decorations.ts`, 2026-10-20):

- ❗ **The offset is in the owning Thing's space**: the owner's `PPos` times the offset is where
  the decoration is drawn. With that reading, **519 of 520** have their origin inside their
  shape's outline.
- ❗ **They sit on the shape's front face**: the offset's z is the owner's `PShape.thickness`, or
  up to 20 beyond it (*Shapes* above).
- ⚠️ **`decorationScale` is not known to add anything**: the offset's own columns already scale
  the mesh, and match `decorationScale` on 45 of 520, are 1 on 11, and neither on 464.

## Stickers — `PStickers`

A sticker is a texture laid on a Thing's surface. `readStickers` returns `StickersPart`: the
Thing's `decals` and one list per costume piece; each `Decal` keeps its texture, its centre
`(u, v)`, its axes `xvec` and `yvec`, the colour, type, metadata index, play-mode frame, scorch
flag and plan. The bytes walked are cwlib's `Decal.java` and `PStickers.java`, unchanged; the eyetoy
list is still walked and discarded. Measured on Needlepoint Peaks, its chunks placed (lbprender's
`dev/stickers.ts`, 2026-10-20):

- **970 decals** on 827 Things: 301 on 175 shapes, 56 on 39 meshes, 613 on Things that have neither
  part. Every one is type 0, and 969 name a texture by GUID (the game's `stickers/` folders), one
  none.
- ❗ **A mesh's decal space is its UV channel 1**: all 56 mesh decals have their centre inside channel
  1's range, 7 of them outside channel 0's. On the 8 decals of three-channel meshes channel 2 holds
  the centre too, so which of 1 and 2 is meant there is not settled.
- ❗ **A decal's `xvec` and `yvec` are half-axes** of its texture in that space: P − (u, v) =
  (2s − 1)·xvec + (2t − 1)·yvec, the texture's rows taken as stored. Only so do the two fits below
  agree.
- ⚠️ **On a shape the decal space is not the face's texture mapping.** It is U = x·sx·k,
  V = 1 − y·sy·k, x and y in the Thing's space and sx, sy its matrix's scale — world-size units,
  which the two blue tits at scales 3.46 and 3.72 show. Fitted two ways that agree (lbprender's
  `dev/decalfit.ts` and `dev/stickeroffset.ts`): over all 301 decals on Needlepoint Peaks' shapes,
  origin (0, 1) with +x and −y puts the most centres inside their own outline, 245, for k from
  1/575 to 1/625; on the two blue tits, shapes cut to their sticker's silhouette, that origin with
  half-axes lays the alpha over both outlines at IoU 0.91 for k from 1/540 to 1/550. lbprender
  takes 1/545; its `open-questions.md` (*12*) holds what is left.
- `color` is −21163 on the birds; what a 16-bit colour does to a sticker is not read.

## Joints — `PJoint`

`readJoint` returns `JointPart`: the two Things `a` and `b`, where it holds each (`aContact`,
`bContact`, in that Thing's own space), its length and angle, cwlib's `type`, `renderScale` and
`hideInPlayMode`; the rest of cwlib's `PJoint` is walked. Measured on Needlepoint Peaks, its chunks
placed (lbprender's `dev/joints.ts`, 2026-10-20): **380 joints**, every one with both Things posed and
none with a `PPos` of its own but the one rail.

| type | mesh | count |
|---|---|---|
| 0 | none | 3 |
| 1, 2, 5 | `joint_string.mol` | 5, 11, 125 |
| 3 | `joint_chain.mol` | 14 |
| 4 | `joint_piston.mol` | 37 |
| 6 | `joint_rod.mol` | 1 |
| 7, 8, 9 | `joint_bolt.mol`, `joint_bolt_sprung.mol`, `joint_bolt_motor.mol` | 20, 9, 152 |
| 12 | `joint_rail.mol` | 1 |

- ✔ **A contact is in its Thing's space**: on the two motor bolts holding the blue tits, `a`'s and
  `b`'s contacts taken through their Things' `PPos` land on one x and y, and 100 apart in z — the
  bolt reaches across two layers. Across all bolts most land apart only because of that z.
- Which type is which tool is read off the mesh each draws with, not from a name in the bytes.
- `settings` names a `.joint` file under `gamedata/joints/`: `pin.joint` on every string, chain,
  piston, rod and plain bolt, `cog.joint` on the sprung and motor bolts, `neck.joint` on the three
  type 0 (lbprender, 2026-10-20). Physics settings by their names; no rope look is in them — the
  ropes' materials are lbprender's *Joints*.

## Prize bubbles — `PGameplayData`

`readGameplayData` returns `GameplayDataPart`: `gameplayType`, `fluffCost` and `prize`, the plan
its `EggLink` names (a reference: two Things naming one link share the plan). Measured on
Needlepoint Peaks (lbprender's `dev/prizes.ts`, 2026-10-20): 166 Things carry the part — 85 score
bubbles (`resource_sponge.mol`, type 3, fluff 1, no prize) and 81 prize bubbles
(`collectible_sphere.mol`) whose prize plan is in the game. ✔ **Each prize plan's dependency table
holds exactly one texture, its inventory icon**: the sticker itself for a sticker plan, a
`…_icon.tex` for a decoration, costume or material — so the icon is found without reading the
plan's inventory block (`readPlan`'s `inventory`, *Plans* above).

## Wires — `PSwitch` outputs

`readSwitch` returns `SwitchPart`: the switch's `type` (cwlib's `SwitchType`), `hideInPlayMode`,
and each output port's wires as `SwitchTarget`s — the Thing and its input port (0 below `0x327`).
The outputs are references from `0x329` on, so two switches naming one output share its list. The
bytes walked are unchanged. On Needlepoint Peaks, its chunks placed
(`../lbprender/dev/wires.ts`, 2026-10-21): **3,253 switches, 2,316 wires, 738 of them between two
Things that both have a `PPos`**; between those, 831 units at the median and 7,805 at most. The
two most common types, 36 and 37, are 658 each; no switch is hidden in play mode.

## Costumes, material overrides, weather, scripts — kept for a renderer

From 0.4.12 four parts, and from 0.4.13 `SCRIPT`, return what they read (`src/things/parts/`); their walks are unchanged,
so the censuses are the same files. Over the story chunks and the FARCs' levels (2026-10-25):

- `PCostume` (`CostumePart`, 1,310 Things): its base mesh resolves to a `.mol` on all 1,310,
  its material to a `.gmat` on 993 (306 null, 11 GUIDs not in the FileDB); every one lists
  more than eight pieces, most null — 4,782 piece meshes are `.mol`, 61 not in the FileDB.
- `PMaterialOverride` (`MaterialOverridePart`, 239): its mesh is a `.mol` on all 239; 33 of its
  48 region overrides name a `.gmat`, 15 none.
- `PAtmosphericTweak` (`AtmosphericTweakPart`, 824): `atmosType` is 0 on 709, 3 on 92, 5 on
  11, 4 on 10, 2 on 2; which number is which weather is not measured.
- `PScript` (`ScriptInstance`, 0.4.13, 20,329): the script and, per field of its layout, name,
  machine and Fish types and value — a boxed object as a typed value, the same object met
  twice through its pointer the same value, and a `DIVERGENT` field the instance does not
  reflect marked `stored: false`. 20,209 scripts are an `.ff` in the FileDB (119 GUIDs not, 1
  none); 20,024 instances have fields, 305 none. The commonest are the tweakers' UI
  (`ColourTex`, `TweakPlayerNumber`, 19,901 each) and the speech bubbles' text (`Text`, a wide
  string holding a LAMS key such as `NP_TU01B_130_NEWTON`); the commonest scripts
  `post_it_note.ff` (3,743), `collision_tweaker.ff`, `launcher.ff`, `trigger_speech_bubble.ff`.
  No script the game's levels carry has "eye" in its name.
- `PAnimation` (`AnimationPart`, 783): ⚠️ **empty in every one** — a null reference and two
  zero floats — so the game's own files do not say here what a Thing plays.


### Emitters, creature parts, checkpoints, triggers, wormholes, effectors — kept from 0.4.28

Six readers that walked their part now return what a reader of the level needs, the walk itself
unchanged (the Thing and story censuses identical before and after, 2026-10-25): `EmitterPart`
(the plan it emits, frequency, phase, lifetime, how many, scale and velocity, where relative to
itself, the source Things), `EnemyPart` (cwlib's `EnemyPart` — 0 leg, 1 eye, 2 brain, 3 wheel,
4 rocket, 5 paint — radius, snap vertex, centre offset, the Thing whose animation drives it),
`CheckpointPart` (lives, infinite or not, the spawning list, start point, name, type),
`TriggerPart` (cwlib's `TriggerType` — 0 radius, 1 rect, 2 switch, 3 touch, 4 radius 3D — the
Things in it, radius, z range), `WormholePart` and `EffectorPart` (viscosity, density, gravity,
whether it is water). On Needlepoint Peaks (`test/story.test.ts`): 7 emitters, each plan a
FileDB row (`needlepoint_peaks_base_virtual_488.plan`…); 29 creature parts, 24 eyes and 5
rockets; 9 checkpoints; 468 triggers, 255 radius and 213 switch.

From 0.4.29 nine more, the walk again unchanged: `BodyPart` (velocity, frozen, the player editing
it), `RefPart` (the plan a Thing is a placed copy of), `MetadataPart` (title and description
keys, type flags, icon — what `InventoryItemDetails` is to a plan), `FaderPart`,
`TransitionPart` (a door's colour and label), `StreamingHintPart` (a box the streamer loads ahead
of), `StreamingDataPart`, `PowerUpPart`, and `SCRIPT_NAME` as its string. Needlepoint Peaks: 1,838
bodies, 246 faders — `fadeAmount` 1 on 244 and 0.5 on 2, which end is opaque not measured — 40
hint boxes (2048 × 1024 × 800 the first), 4,431 streaming data and one script name, `handle`.
Over the FARCs' 18,146 levels and plans, each Thing once: no `REF` at all, and 13 `METADATA`,
every key 0 and no icon, 12 of type 0 and one `BACKGROUND` (`0x100`).

From 0.4.30 seven more: `SwitchKeyPart` (a key's colour, name, hidden, dummy — the packed byte
from version 0x3ed split into its 0x80 and 0x40), `TagSynchronizerPart`, `ConnectorHookPart`,
`AudioWorldPart` (the FMOD event's path, volume, pitch, falloff, play mode), `WindTweakPart`,
`PocketItemPart` and `MaterialTweakPart` (physics, and `hasShadow`, `noBevel`, `zSlice` — how
the tweaked shape is drawn). Needlepoint Peaks: 313 keys (`bot follow`…), 154 sounds, each named
(`spots/lbp2/contraptions/winding_ratchet_loop`…), 287 material tweakers, 2 of them shadowless and
none without its bevel, 9 winds and one connector hook.

From 0.4.31 three a renderer frames a level by: `CameraTweakPart` (the zone's trigger box, camera
type, cut-scene timing and field of view, and from version 0x37e its `nodes`, each a target box,
pitch and zoom), `AnimationTweakPart` (the `RAnimation` it plays, speed, loop, start and end,
the meshes it names) and `HudElemPart` (an on-screen element's layer, scale, offset, colour and
its quads, each a texture frame on four corners). Needlepoint Peaks: 65 camera zones, 56 of
`cameraType` 0 and 9 of 3, one node each (a zoom of 2037, a cut-scene field of view of 1.047 —
60°); 32 animation tweakers, 3 of them playing a looping `.anim`; no HUD element.

From 0.4.32 the last seven, so that every part's reader returns it: `CreaturePart` (its
`RSettingsCharacter`, state, the modifiers, and the Things that are its legs, life sources, eyes
and brains), `NpcPart`, `SwitchInputPart`, `ControlinatorPart`, `PoppetPowerupPart` (the plans a
popit puzzle hands out), `PhysicsTweakPart` (gravity, buoyancy, the configuration, name) and
`YellowHeadPart` (the head, the player, the animation set, the creature to spawn as). Each keeps
only some of its fields — the rest are walked as before, the censuses identical. Needlepoint
Peaks: 3 creatures, 3 NPCs, 58 sensors, 2 controlinators and 539 physics tweakers, of ten
configurations (0 on 255). ⚠️ None of the 3 creatures lists an eye, a leg or a brain: the 24 eye
`PEnemy`s of the level belong to no creature in it.
## Lights — `PSpriteLight`

`readSpriteLight` returns `SpriteLightPart`: the colour when on (four floats as stored), the
multiplier, glow radius, `farDist`, source size and whether it is a spotlight; the bytes walked are
unchanged, the rest (the off colour and multiplier, the falloff texture, the look-at Thing, the
flicker, the tracking) still skipped. On Needlepoint Peaks, its chunks placed
(`../lbprender/dev/lights.ts`, 2026-10-20): **185 lights, 65 spotlights, none on a Thing with a
mesh**; `farDist` 2 to 22.5 (median 3.78), `sourceSize` 0.13 to 0.55, `glowRadius` 20 on every
one, `multiplier` 0.2 to 1.73; their Things' matrices scale 49 to 853 (median 232). So `farDist`
and `sourceSize` are not world units on their own; what they are in is not measured.

## Level settings — `PLevelSettings`

`readLevelSettingsPart` returns `LevelSettingsPart`: the lighting cwlib calls `LevelSettings`
(sun position and its scale, sun, ambient, fog and two rim colours as four floats each, sun
multiplier, exposure, fog near and far), the presets that repeat it, the backdrop ambience and
the backdrop's `RStaticMesh`; the bytes walked are unchanged. Over the game's own 229 levels that
parse (`dev/settings-census.ts`, 2026-10-20):

| | |
|---|---|
| levels with one `PLevelSettings` | 219; none on 9, two on 1 |
| presets | 1 to 5, 3 on 134 |
| a backdrop mesh named | 200 |
| colours | within 0–1 bar a little headroom (sun up to 1.06, rim alpha up to 1.5); alpha 1 elsewhere |
| `sunPosition` / `sunPositionScale` | components −0.93 to 1.42 / 20,000 to 848,036: a direction and a distance |
| `fogNear` / `fogFar` | −1,062 to 200,000 / 1,000 to 300,000 |
| `exposure` / `sunMultiplier` | 0.97 to 2.33 / 1.00 to 2.11 |

✔ **The names and their order are the game's.** LBP3's own `CLevelSettings` serializer (eboot
1.28, file offset 0xd41570; the toolchain in `../lbptracker/steering/eboot-re.md`) names its
fields as it writes them: SunPosition, SunPositionScale, SunColor, AmbientColor, SunMultiplier,
Exposure, FogColor, FogNear, FogFar, RimColor, RimColor2, BakedShadowAmount, BakedShadowBlur,
BakedAOBias, BakedAOScale, DynamicAOAmount, DOFNear, DOFFar, ZEffectAmount, ZEffectBright,
ZEffectContrast, DOFNear2, DOFFar2, DOFFar3 — `readLevelSettings`'s order, field for field. The
version gates are cwlib's, not checked there: one build writes only its own revision.

❗ **`backgroundRepeatFlags` marks a backdrop built as a tile.** `LevelSettingsPart` keeps it and
`backgroundSkyHeight` (subVersion `0xaf` on). Over the 221 sets: the flags are 0 on 136 and 3 on 85,
nothing else. Against the width of the backdrop each names (`dev/settings-census.ts`): **flags 0 with
a backdrop 80,000 units wide or more on 101 of 101 read, flags 3 with one narrower on 59 of 66** —
the LBP3 `env_background_slot_*` family shares one 68,120-unit box (`dev/staticmesh-census.ts`
tallies the boxes), and Needlepoint Peaks, flags 3, runs 114,000 units over a 68,000-unit backdrop.
Which bit is which axis is not told by values that are only 0 and 3. 33 backdrops were not read by
the census, which closes each archive before the next. The sky height is 0 to 100,000.

⚠️ A story level's container world carries a set that looks like a default (sun `1,1,1` ×300,000,
fog 1,000–4,000, the same on the containers sampled); the main world carries the level's.
What the game does with each value is not measured here.

## Backdrops — `RStaticMesh`

`readStaticMesh` in `src/resources/staticmesh.ts`: magic `SMHb`, dependency type 44, FileDB paths
`…/palettes/….smh`, named by `PLevelSettings.backdropMesh`. cwlib's `SerializedResource`,
`RStaticMesh.java` and `structs/staticmesh/` (toolkit `fee22399`), measured on **all 47 in the four
FARCs, revisions `0x335`–`0x3f9`: 47 of 47 read** (`dev/staticmesh-census.ts`, 2026-10-20).

✔ **In LBP3 the backdrop is only ever this mesh.** `PWorld` names two more — a `backdrop` Thing and
a `backdropPlan` (with `backdropNew` and `backdropNewPlan`), LBP2's way — and on **all 117 LBP3
worlds** in the install both are null (lbprender, 2026-10-22, reading them through a probe;
`readWorld` walks them and keeps neither, rightly). A level whose `PLevelSettings` names no
`backdropMesh` — Fickle Mistress (`04_bunkum/03_fickle_mistress`), ambience `amb_empty_world`,
fog (0.3, 0.5, 0.7) — has no backdrop anywhere in its file.

```
0x00 "SMHb"   0x04 u32 head   0x08 u32 depsOffset
0x0c StaticMeshInfo, plain big-endian, where other resources have branch, flags and the compressed bool:
     resource lightmap, risemap, fallmap; i32 primitiveCount, unknownStructCount,
     indexBufferSize, vertexStreamSize;
     StaticPrimitive[]  v4 min, v4 max, resource gmat, i32 vertexStart, indexStart, numIndices, u8 type
     UnknownStruct[]    v3 min, i16 a, i16 b, v3 max, i16 firstPrimitive, i16 numPrimitives
     u32 "HELP"
     the chunk table, always compressed
payload: the vertex stream, 0x20 a vertex  f32 x3 position, u32 normal, f16 x2 uv0,
                                           u32 tangent, f16 x2 uv1, u32 smooth normal
         then u16 indices to the end
```

| convention | measurement |
|---|---|
| ❗ **the container**: `StaticMeshInfo` in the header, then the chunk table with no compressed flag | the chunk data ends on `depsOffset` in 47 of 47 |
| the payload is the vertex stream and then the indices | the indices fill what is left exactly, `indexBufferSize` bytes, in 47 of 47 |
| **a primitive's indices are offset by its `vertexStart`** | with it added, every one of 37,184 runs stays inside the vertices; and **99.4% of 5.34 M triangles wind counter-clockwise about their own normals** (5,308,262 against 32,891), which a wrong offset could not give — the check on the offset, the strip parity and cwlib's `unpackNormal32` together |
| strips (type 6) on 33,344 runs, lists (5) on 3,840; restart on `0xffff` | the winding above |
| every primitive names a gfx material; every backdrop names its three maps | 37,184 of 37,184; 47 of 47 |
| positions in the level's world | Needlepoint Peaks' settings Thing has an identity `PPos`, and its backdrop spans x −31,862 to 36,258 and z −28,768 to 249, around and behind the level's chunks; drawn in lbprender its textures read the right way round (a "SACKTOWN WELCOME" sign) |

The tangent and "smooth normal" packs are not returned (the mesh's equivalents failed their
measurement, *The game's meshes*), nor the `UnknownStruct`s; the three light maps are named but
what they hold is not measured.

## Bevels — `RBevel`

`readBevel` in `src/resources/bevel.ts`: magic `BEVb`, dependency type 24, FileDB paths
`gamedata/bevels/….bev`, named by `PGeneratedMesh.bevel`. The field list is cwlib's
`resources/RBevel.java` and `BevelVertex.java` (toolkit `fee22399`), which have no revision gates,
and it holds: **256 of 256 bevels in the four FARCs read to the last byte of their payload**, revisions
`0x132`–`0x3f9` (`dev/bevel-census.ts`, 2026-10-20) — the 44 below `0x189` once the container's
oldest header and the swapped reference bits were in (*The container* above).

```
i32 4, resource x 4   materials: four RGfxMaterial slots
i32 4, f32 x 4        uvScales
f32                   autoSmoothCutoffAngle (degrees)
BevelVertex[]         f32 y, f32 z, f32 rigidity, s8 smoothWithPrevious, s8 gmatSlot, u8 mappingMode
bool includeBackface, bool smoothWithFront, f32 relaxStrength, f32 subDivRadius,
f32 fixedBevelSize, bool spongy, resource softPhysicsSettings, f32 textureRepeats
```

- The profile, over the 256: 2 to 7+ vertices (101 have more than six); **z from −2.23 to 2.36, most
  between −1 and 1**, the first vertex at the back (z ≈ −1) and the last near the front on the ones
  read by eye; y from −4.04 to 2.77, mostly 0 at the back and negative toward the front — the
  front face inset. What y and z mean (an inset in units of the bevel's width, a depth through the
  shape) is cwlib's and the reference's reading; z is not monotonic on 165 of 256.
- ⚠️ **cwlib's `BevelMappingMode` names 0, 1, 3 and 5; the game's profiles use 0 (67 vertices), 1
  (830), 2 (590), 3 (177) and 4 (33)** — 2 and 4 are not in its enum. `mappingMode` is kept as the
  byte.
- `gmatSlot` 0 on 943 vertices, 1 on 582, 2 on 152, 3 on 20; slot 0 of `materials` is empty on 214
  of 256, the shape's own material taking it. `fixedBevelSize` is non-zero on all 256; `spongy` on
  46; `includeBackface` on 12.

## Physics materials — `RMaterial`

`readPhysicsMaterial` in `src/resources/physics-material.ts`: magic `MATb`, dependency type 16,
FileDB paths `….mat` (`gamedata/materials/base_materials/base_plastic.mat`), named by
`PShape.material` — what a shape weighs, how it slides, bounces and sounds, and whether it breaks;
its look is `RGfxMaterial`. The field list is cwlib's `resources/RMaterial.java` (ennuo/toolkit
`d6a2ef8`), every gate on the head's version alone, and it holds: **86 of 86 in the four FARCs read
to the last byte of their payload, over 46 head words from `0x132` to `0x3f1`**
(`dev/physics-material-census.ts`, `test/physics-material.test.ts`, 2026-10-24) — so the gates at
`0x13c`, `0x167`, `0x168`, `0x1d3`, `0x244` and `0x27b` are each crossed by real files.

```
f32 traction, f32 density                      (< 0x13c: 2 unnamed bytes)
f32 restitution, f32 slidingFriction           (< 0x13c: an unnamed f32)
f32 rollingFriction                            (< 0x13c: 5 unnamed bytes)
i32 soundEnum, bool grabbable                  (< 0x13c: 2 unnamed bytes)
f32 gravityMultiplier, f32 airResistanceMultiplier   (< 0x167: an unnamed f32)
bool limb                                      (< 0x1d3: an unnamed byte)
bool shiftGrip, i32 collideType, i32 collideIgnore
bool dissolvable, bool explodable, bool cuttableByExplosion
>= 0x167: bool breakable, f32 breakMinVel, f32 breakMinForce, f32 explosionMinRadius,
          f32 explosionMaxRadius, f32 explosionMaxVel, (>= 0x168) f32 explosionMaxAngVel,
          f32 explosionMaxForce
>= 0x13c: f32 maxForce      >= 0x244: bool bullet      >= 0x27b: bool circuitBoard, bool disableCSG
```

- `maxForce` is absent, and `NaN` as cwlib defaults it, on exactly the 27 files below `0x13c`; no
  file stores a `NaN`. Where present it runs from 20,130 to `Infinity`.
- `collideType` is `0x1` (normal) on 67 of 86; `collideIgnore` is 0 on 38 and `0x8` (magic wall) on
  28. `soundEnum` is 0 on 35, then 17 other values up to 35 — cwlib's `AudioMaterial`, unchecked
  here against the audio.
- Ranges: traction 0–1, density 0 to `1e11` (a stand-in for immovable), restitution 0–1, sliding
  friction 0–30, gravity multiplier −1 to 1. `grabbable` on 37, `breakable` on 7.
- The Alear branch's `explosionType`, which cwlib reads from a resource's extra data, is a custom
  server's and not in the game.

## Animations — `RAnimation`

`readAnimation` in `src/resources/animation.ts`: magic `ANMb`, FileDB paths `….anim`
(`gamedata/lbp3/character/troll/dwarf/animation/dwarf_look_updown.anim`). The walk is cwlib's
`resources/RAnimation.java` (ennuo/toolkit `d6a2ef8`) and it holds, with the four differences in
rows 16–19 of *Where we deliberately differ* ([lbp-modding-toolchain.md](lbp-modding-toolchain.md)):
✔ **2,664 of 2,664 in the four FARCs read to the last byte of their payload, over 97 head words,
versions `0x34c` to `0x3f9`** (`dev/animation-census.ts`, `test/animation.test.ts`, 2026-10-25).

```
< 0x378   bones[] (i32 animHash, s32 parent, s32 firstChild, s32 nextSibling),
          i32 numFrames, i32 fps, i32 morphCount,
          i16[] rot / pos / scale / morph bones animated,
          vector4[] rotations, positions, scales, f32[] morphs,  u16 0
>= 0x378  i16 numFrames, i16 fps, i16 loopStart, i8 morphCount,
          u8 bones, u8 rot, u8 pos, u8 scale, u8 morph animated, u16 locatorKeys,
          (>= 0x38c) vector4 posOffset, vector4 posScale, (>= 0x3b2) i8 fat,
          u8[] block, locators[] (vector3, string name, i8 looping, i8 type)
block     per bone 8 bytes (i32 animHash, i8 parent, firstChild, nextSibling, pad),
          4 × locatorKeys bytes, the four animated-index lists as bytes, aligned to 2,
          rotations (3 × i16 / 0x7fff; x's low bit the sign of w), then positions,
          scales (3 × f16) and morph weights (f16) — the first bones / morphCount of
          each the base pose, then the animated ones for frames 1 … numFrames − 1;
          then zeros
```

- Ranges: `numFrames` 2–2,000, `fps` 15–30, 1–49 bones, 0–29 morphs, 0–6 locators. 1,534,393
  rotations, none whose stored x, y and z exceed unit length; every position, scale and morph
  weight finite.
- ✔ **A parent comes before its child** in all 100,035 bones, so a pose builds in one pass; and
  **99.97% of them (100,008) name a bone of some `MSHb`** by `animHash` — measured once against
  every mesh bone in the four FARCs (2026-10-25), not in the census.
- ❗ **`fat` 1 makes every value four bytes**: rotations three `f32`, the rest `f32`. Two files
  have it (`th_henry_garage/…/robotic_arm_claw.anim` and one more), and only so do
  their blocks end where their padding begins. The sign of w still rides in the low bit of x's
  word — set on 10 of 3,236 non-zero x, against about half of y's and z's.
- ⚠️ **The block ends in zero padding of one of two lengths**: to the next multiple of 16 (1,554
  files) or that and 16 more (1,103), with nothing in the header to say which. The reader refuses
  any other tail.
- ⚠️ The one head word below `0x378` (`0x34c`, five files) ends in two zero bytes after the
  morphs, where cwlib stops at "TODO: Locators". They are taken as zeros and a non-zero pair is
  refused: an empty locator array and a byte, or a 16-bit `loopStart`, would both write them.
- `posOffset` and `posScale` are read and not applied, as cwlib does; `locatorKeys`' bytes are
  skipped.

## Scripts — `RScript`

`readScript` in `src/resources/script.ts`: magic `FSHb`, dependency type 11, FileDB paths
`gamedata/scripts/….ff` — one compiled Fish class, the code a Thing's `SCRIPT` part names. The
walk is cwlib's `resources/RScript.java` and `structs/script/*` (ennuo/toolkit `d6a2ef8`) without
a change, and it holds: ✔ **534 of 534 in the four FARCs read to the last byte of their payload,
over 60 head words** (`dev/script-census.ts`, `test/script.test.ts`, 2026-10-25).

```
(<= 0x360) resource upToDateScript
string className, resource superClassScript, modifiers
typeReferences[]     u8 machineType, u8 fishType, i8 dimensionCount, u8 arrayBaseMachineType,
                     resource script, i32 typeName
fieldReferences[], functionReferences[]          i32 type, i32 name
fieldDefinitions[]   modifiers, i32 type, i32 name
propertyDefinitions[] … then i32 getFunction, i32 setFunction
functionDefinitions[] … then four ranges into the shared tables (>= 0x3d9 u16 begin, u16
                     length; before, two i32 bounds), i32 stackSize
sharedArguments[]    i32 type, i32 offset
i32 n, n × u64 instructions      i32 n, n × i16 line numbers
localVariables[]     modifiers, i32 type, i32 name, i32 offset
intVector ASCII starts, i32 n, n bytes      intVector UTF-16 starts, i32 n, 2n bytes
(>= 0x30c) longVector s64 constants, i32 n, n × f32 constants, (>= 0x1ec) GUID[] depending
modifiers: i16 from 0x3d9, i32 before
```

- ⚠️ **Only LBP3's scripts are measured**: every one of the 534 is at `0x3ef`, `0x3f8` or
  `0x3f9` (subVersions `0x10d`–`0x1ae`), so the gates at `0x1ec`, `0x30c`, `0x360` and
  `0x3d9` are cwlib's, uncrossed by a real file. Below `0x1ec` the reader refuses, as cwlib does
  ("Inline script format not supported").
- The tables hold together: every function's four ranges tile their shared tables in order, from
  0 to the table's end; every member's name is inside the ASCII pool and its type inside the type
  table; every property's accessors are -1 or a function. 0–422 functions, 0–13,099
  instructions (270,057 in all, 168 distinct low bytes), 1–686 ASCII and 1–41 wide strings, 0–87
  depending GUIDs; 526 have a superclass.
- A type reference's `typeName` is **-1 on the 2,556 with no script** — the built-in types, which
  the pool does not name. The ASCII pool's first string is empty in all 534.
- Six scripts have no line numbers, their functions' line ranges all empty; six have `s64`
  constants. An instruction is kept as its 64 bits (`bytecode`, a `BigUint64Array`): its
  opcode is the low byte, and cwlib's per-class decoding of the rest is not ported.


### The instructions — decoded from 0.4.33

`decodeInstruction` in `src/resources/script-instructions.ts` turns a word of `Script.bytecode` into
its opcode, its name and its class's fields: cwlib's `InstructionType` (203 opcodes, `NOP` 0x00 to
`BIT_XORs64` 0xca) and the classes it builds them from, each packing a machine type in bits 8–15,
a destination or source in 16–31 and one 32-bit field or two 16-bit ones above. ✔ **Every one of the
game's 270,057 instructions decodes, and every index they hold is in range** (`test/script-instructions.test.ts`,
2026-10-25): no opcode past the table; the functions' `bytecode` ranges tile each script's bytecode
exactly; every branch lands inside its function (`i + offset`, 26,987); every call is a
`functionReferences` row (39,859), every member access a `fieldReferences` row (22,232), every
`NEW_OBJECT` and cast a `typeReferences` row, every `LCsw`/`LCsa`/`LCs64` a pool entry. ✔ **`LCv4`'s
index is a float's in `constantsF32`**, a multiple of 4 on all 1,339 — read as a vector's index, 681
run past the pool. Each of the 5,469 functions ends in `RETURN` (4,539) or a branch `B` (930). The
commonest: `ARG` (82,674), `CALL`, `LCi`, `LCf`, `B`.
## Bone sets — `RBoneSet`, the toolkit's and not the game's

`readBoneSet` in `src/resources/bone-set.ts`: magic `BSTb`. ❗ **The game has none**: no `BSTb`
is in the four FARCs. The format is the toolkit's own, on its `MIZUKI` branch (`0x4d5a`), and
the one file is its `lib/cwlib/src/main/resources/binary/characters.boneset` (head `0x021803f9`,
branch revision 5), which its `ModelImporter` loads to know the playable characters'
skeletons. The walk is cwlib's `resources/custom/RBoneSet.java` and `structs/custom/Skeleton.java`
(ennuo/toolkit `d6a2ef8`): an array of skeletons, each `RMesh`'s bones (`readBone`) and then
the mirror bones (`i16`s), their flip types (`u8`s), the cull bones (a matrix and two
4-vectors), and — on the branch's revisions before `0x1` only — a skeleton type byte.

- ✔ **The file reads to its last byte** (`test/bone-set.test.ts`, 2026-10-25): five skeletons of
  43, 39, 40, 35 and 29 bones, each with a mirror and a cull bone per bone, every parent before
  its child, and every mirror its own inverse (`mirror[mirror[i]] = i`).
- ✔ **They are the five playable characters' skeletons.** Measured once against every `MSHb` in
  the four FARCs by bone names in order (2026-10-25): 2,259 meshes share the 43 bones (Sackboy's
  costumes), 94 the 39 (`playercharacter/…_g_…`, the big Toggle), 51 the 40 (`…_d_…`, the
  small one), 63 the 35 (`bird_…`, Swoop) and 80 the 29 (`…_q_…` and `char_quad_…`, Oddsock);
  942, 19, 1, 0 and 31 of them with every bind pose equal to the set's within `1e-5`.
- ⚠️ Two skeletons, the 35 and the 29, give `Bip01 Footsteps` (its own mirror) flip type **8**,
  past cwlib's `FlipType` (0 `MAX` to 6 `COPY`), whose `fromValue` has nothing for it. It is
  kept as the number.

## Slots — `RSlotList` and `RPacks`

`readSlotList` (`src/resources/slot-list.ts`, magic `SLTb`) and `readPacks`
(`src/resources/packs.ts`, `PCKb`) are both arrays over the slot in `src/structs/slot.ts` — cwlib's
`Slot`, `SlotID`, `Label`, `Collectabubble` and `Pack` at ennuo/toolkit `d6a2ef8`, with the
author's `NetworkOnlineID` from `src/structs/network.ts`. ✔ **All 7 slot lists and all 8 pack
files in the four FARCs read to their last byte** (`dev/resources-census.ts`,
`test/resources.test.ts`, 2026-10-24): slot lists at `0x26e`, `0x37a`, `0x3af`, `0x3d5` and `0x3e2`
— the first ending its slots at the `0x2c3` return, the rest crossing the `0x2ea`, `0x2f4`,
`0x33c`, `0x352` and `0x3d0` gates — and packs at `0x3df`–`0x3f9`, two of them LBP3 (subVersions
`0x199`, `0x1a9`), whose slots walk the LBP3-only tail.

- A slot's `name` is empty in the game's own lists and its `translationTag` is the LAMS tag
  (`MAIN_01_ROOKIE_TEST`, `MOVE_MAIN_0`); `developer_slots.slt` has 63, `lbp2story_slots.slt` 82.
- A pack's `timestamp` is Unix seconds (1388534400 is 2014-01-01; −1 and 0 also occur) and its
  `contentId` a 16-character DLC id (`LBPDLCEADACK0001`); `lbp2_packs.pck` holds 345 packs.
- ⚠️ `lbp2_hub_story_themes.pck` gives every pack `contentsType` **4**, which cwlib's
  `ContentsType` (0 group, 1 plans, 2 level, 3 costume, 5 adventure) has no name for. The value is
  kept as the number.
- The Vita's slot fields (`DOUBLE11` at `0x3c1`–`0x3e2`) are in no file here; `readSlot` refuses
  that branch rather than guess them.

## Smaller resources — palettes, outfit lists, joints, pins, the costume index

Five readers in `src/resources/` whose proof is that every file of their type in the four FARCs
reads to its payload's last byte (`dev/resources-census.ts`, 2026-10-24); the walks are cwlib's at
ennuo/toolkit `d6a2ef8` except where a row of *Where we deliberately differ* in
[lbp-modding-toolchain.md](lbp-modding-toolchain.md) says otherwise.

| magic | reader | files | head words |
|---|---|---|---|
| `PALb` | `readPalette` (`palette.ts`) | 178 of 178 | 72, `0x2bb`–`0x3f9` |
| `OUTb` | `readOutfitList` (`outfit-list.ts`) | 59 of 59 | 12, `0x38c`–`0x3f9` |
| `JNTb` | `readJointSettings` (`joint-settings.ts`) | 9 of 9 | 1, `0x336` |
| `PINb` | `readPins` (`pins.ts`) | 1 of 1 | `0x3f9` |
| `CCDb` | `readCachedCostumeData` (`cached-costume-data.ts`) | 1 of 1 | `0x3f9` |

### Palettes

A page of the popit: an array of plan references (5,340 over the 178, none null), a location, a
LAMS description key, and from `0x323` the converted plans. ⚠️ **A converted plan is two
descriptors, a hash then a GUID** — one palette of the 178 has any,
`pal_unthemed_toys_vehicles_palette.pal` at `0x3b4`, six pairs whose GUIDs run 173454–173459, and
read one descriptor at a time it leaves 75 bytes. Which half is the converted plan is not known.

### Outfit lists

Each outfit is a GUID list of the costume pieces and a plan descriptor.

### Joint settings

`RJoint`, `gamedata/joints/….joint`: what a kind of joint does — expand, contract, elasticity and
plasticity of length and angle, two `FCurve`s (three 4-vectors and a type), break resistance, its
drawn material, width, two event names and a mesh. No revision gates; all nine files are `0x336`.

### Pins

`gamedata/data/pins.pin`: one record per pin — id, progress type, category, LAMS title and
description keys, an icon descriptor, the initial and target values, a trophy byte, a 16-bit
behaviour field, and from `0x3f7` an LBP1 trophy byte.

### The costume index

`gamedata/data/cached_costume_data.ccd`: 4,161 rows of plan GUID, LAMS title and description keys,
type, subtype, colour, icon GUID and value — and then, ⚠️ **not in cwlib**, an array of 485
distinct strings of 16 characters (`PLITTLEBIGDEMO01`, `IGCLBP2KADCO0003`, `LBPDLCSONYCO0046` …);
2 bytes of count and 485 × 17 bytes are the 8,247 the file had left. ✔ **They are DLC content
ids: 478 of the 485 are the `contentId` of a pack in the game's eight `PCKb`s** (*Slots* below);
the other seven name no pack there.

## What the FARCs hold, by magic, and what has no reader

Every entry of the four FARCs by its first four bytes, each SHA-1 once, with the FileDB extension
(scratch census, 2026-10-25). ⚠️ **A census by magic misses what has none** — the translation
tables, the `.raw` files — so it is a list, not proof of absence. With a reader: `GTF `/`TEX `,
`PLNb`, `GMTb`, `MSHb`, `ANMb`, `FSHb`, `LVLb`, `BEVb`, `PALb`, `MATb`, `GSBt`, `INSb`, `OUTb`,
`SMHb`, `QSTb`, `PRFb`, `JNTb`, `PCKb`, `SLTb`, `ADCb`, `ADSb`, `CCDb`, `ATXb`, `GLTb`, `VOPb`, `RECb`, `TUTb`, the
`.trans`, and every
text magic (`…t`, 19 of them) as a tree (*Text resources*). Without:

| magic | count | what the FileDB calls them |
|---|---|---|
| none (`00 00`) | 721 `.raw`, beside the 25 `.trans` and 22 `.subt` | 812 of the FileDB's `.raw` are `gamedata/subtitles/<line>.raw`, 12 to 44 bytes of big-endian `u32`s, the first 0 or 3 and the rest rising (`create_thermometer.raw`: 3, 135, 318, 399, 516, 603): a dialogue line's subtitle timings, unit and meaning not measured. Two are `data/colcorrectpresets*.raw`, 904 bytes of mostly floats. Each `languages/<lang>_export.subt` is a `u32` count (587 in English) and then data of no fixed record size that looks compressed or ciphered |
| none (`00 01`) | 347 | `.fpo` 191, `.sbu` 97, `.vpo` 55, `.epo` 2: compiled shaders |
| `RIFF` | 216 | `.smp`, the instruments' samples — read by lbptracker (`packages/lbp-tracker-lib/src/wav.ts`), whose `steering/game-assets.md` has them |

Plus PNGs, JPEGs, `.txt`, `.xml` and the `.rlst` lists, which are not the engine's.

## Small resources — `ATXb`, `GLTb`, `VOPb`, `TUTb`

Four types cwlib names in `ResourceType` and has no class for; readings of our own, each ending
on the payload's last byte in every one of the game's (`test/small-resources.test.ts`, 2026-10-25).

- **`ATXb`, `ANIMATED_TEXTURE`** (`readAnimatedTexture`, 24 files, `texture_library/ui/animated/…`):
  a texture descriptor, `s32` frames, frame width and height, and a `bool` loop. ✔ **The meanings
  are measured**: in all 24 the named texture is a grid of frame-sized cells, as many as or more
  than the frames — 32 frames of 64×64 in a 512×256, 13 of 128×128 in a 512×512 — and loop is true.
- **`GLTb`, `GUID_LIST`** (`readGuidList`, 2 files): an array of `u32` GUIDs.
  `face_covering_costumes.glst` names 38 head meshes, all FileDB rows; `attached_shapes.glst` 101,
  90 of them rows (palette plans), the other 11 neither rows nor in the PS4 remap.
- **`VOPb`, `VOIP_RECORDING`** (`readVoipRecording`, 4 files, inside crossplay `.cpv`s): one
  length-prefixed block of audio, kept as bytes; its codec is not read.
- **`TUTb`, `TUTORIALS`** (`readTutorials`, 0.4.26, 2 files): the fields and their order are the
  eboot's reflective serialisers' — `RTutorials` `v0xc88960` (`TutorialGroupList`), the list
  `v0xcd8130` (`TutorialGroups`), a group `v0xcd84e0` (`NameKey`, `Tutorials`), a tutorial
  `v0xcd88c0` (`LevelGUID`, `VideoGUID`, `NameKey`, `DescriptionKey`, `Image`, `Prerequisites`,
  `Rewards`, `RewardsGUID`, `BonusRewards`) — and **every object is a reference**, which is what
  the small numbers between them were: the list is id 1, the group 2, the tutorials 3 to 11.
  Both end on their last byte. `tutorials_beta.tut` has no group; the other has "How To Play" with
  nine tutorials ("Acting", "Costumes", … "Stickers: Camera"), each a `.bik` and an `Image` that is
  the PS3 GUID of `tutorial_thumbnails/<the video>.tex`, found through the PS4 remap. Their level
  and reward GUIDs are 0 and their three arrays empty, so those elements are not read.

## Thing recordings — `RECb`

`readThingRecording` in `src/resources/thing-recording.ts` reads a `RECb`, cwlib's `THING_RECORDING`
with no class: a Thing's recorded path, in the LBP2 Move DLC's cutscenes and levels (91 files,
`move_cutscene_intro_recording_01.rec`…, versions `0x3bd`–`0x3d9`).

- ❗ **Read as the game's loader reads it, `v0xc79610` in `eboot-v128.bin`** (2026-10-25), found by
  its version compares — `0x3c3`, `0x3c4` three times, `0x3ce`, `0x3d3`, `0x3d6`, every one inside
  the recordings' range; `RThingRecording` is named only in the type table, and resources have
  no RTTI. Three layouts by version:
  - **up to `0x3c3`** an array of matrices (`v0xc924a0`), which the loader turns into frames
    relative to the first;
  - **`0x3c4`–`0x3d3`** three arrays: positions as three raw `f32` each (`v0xc92340` and its
    element `v0xcdbab0`, fixed width though the stream compresses vectors), bytes (`v0xc921c0`)
    and raw `f32`s (`v0xc91ff0`);
  - **from `0x3d4`** one byte array (`v0xb03b50`), decoded afterwards by `v0x921b40`.
  Past `0x3ce` and past `0x3d6` the loader only sets a flag on the recording.
- ✔ **All 91 end on their payload's last byte** (`test/thing-recording.test.ts`): 1 of matrices,
  54 of arrays, 36 packed. In all 54 the three arrays are equally long — a value of each per
  frame — the positions are world units whose z is a layer's depth (-100, -200, -300, a mean
  step of 87 units a frame), the `f32`s lie in [-π, π], an angle, and the bytes are 0 or 16.
- ✔ **The packed frames are decoded** (`decodePackedFrames`, 0.4.25), as `v0x921b40` reads them —
  the same function writes, by a direction flag. A bit stream, bits lowest first in each byte, a
  32-bit value's first eight bits its top byte: the frame count and the first position as whole
  words, then per later frame `dx` and `dy` as 10-bit quantised deltas (`v0xbb81b0` mode 20; range
  ±1000 at a resolution of 2 — the quantisers `v0xadfe20`/`v0xadfe50` make a value
  `min + 2·step·q`, and `v0xadfde0` the fewest bits for `(max − min)/(2·step) + 1`), z never
  moving; the first angle whole and 14-bit deltas (±10 at 0.00125); then one bit for whether any
  flag is set, the first flag in 8 bits and per later frame a bit and, if set, 8 bits added to the
  flag before. **All 36 use their bits to within their last byte's padding** (0 to 7 bits), and
  what comes out is what the arrays hold: flags only 0 or 16, a step of 36 units a frame on
  average, angles from −3.14 to 3.46 (a sum of deltas, so not wrapped).
- What the flag byte means is not known.

## Translation tables — `RTranslationTable`

`readTranslationTable` in `src/resources/translation.ts` reads a `.trans` into a map from LAMS
key to text; `lamsKeyId` is cwlib's `makeLamsKeyID` (ennuo/toolkit `d6a2ef8`), the key of a tag
such as `NP_TU01B_130_NEWTON`, and `translate` takes either. FileDB paths
`gamedata/languages/<language>.trans`, and one per language under `languages/patch/`.

- ❗ **No container and no magic: the FARC entry is the table.** A census of the archives by magic
  does not see these, which is how the resource census of 2026-10-24 counted none (the parity list
  said "not at all"). `u32` count, then `{u32 key, u32 offset}` sorted by key, then UTF-16BE
  strings, each opening with a BOM, at the offset from the end of the key list; all big-endian.
- ✔ **All 46 in the FARCs read** (`test/translation.test.ts`, 2026-10-25): 24 full tables, 36,906
  (Simplified Chinese) to 42,574 (Finnish) keys, English 42,508, and 22 under `patch/` with none.
  None is cwlib's older text layout, which the reader refuses. Keys share strings — English's
  42,508 keys point at 35,302 — and in every table the distinct offsets are exactly the BOMs in
  the string block, starting at 0, so a string runs to the next one's start.
- ✔ **The hash is the game's**, both halves: `ZIGGURAT_QUEST_TITLE_30` is "Boat Race", and the
  33-character `TWEAK_MEMORISER_CHANGE_LABEL_NAME` from a script's string pool, which takes the
  second loop, "Change Label Name".
- What English names (scratch census, 2026-10-25): of the game's plans, 7,557 of 7,834
  `titleKey`s, 6,812 of 6,969 `descriptionKey`s and 8,098 of 8,153 categories — the writer's
  `3423480070` is "My Objects"; every quest title, description and objective that is a tag (59;
  the other 26 are plain text); and 63 of the 70 tags in the FARC levels' and plans' script
  fields. The rest are in no table here.
- ✔ **Written too** (`writeTranslationTable`, 0.4.36, cwlib's `build`): keys sorted, each distinct
  text once at the offset of the first key that uses it. **All 46 come back byte for byte**
  (`test/translation.test.ts`) — no table holds a text twice, and the texts lie in the order of
  their first key. `patchTranslationTable` is cwlib's `patch` at `d6a2ef8`: every key of the
  patch goes in, replacing the table's text. ⚠️ Until 2024 (`bb79e81`) Java skipped a key the table
  already held, and an old checkout still reads so; no patch in the game has text to test either on.

## Fonts — `RFontFace`

`readFontFace` in `src/resources/font-face.ts` reads an `FNTb`: the glyph table and the block of
bitmaps; `findGlyph` looks a character up and `glyphBitmap` inflates one. The layout is cwlib's
`RFontFace` and `GlyphInfo` (ennuo/toolkit `d6a2ef8`), a 16-byte header — magic, head word, data
offset, 0 — and then plain big-endian fields, no container.

- ❗ **The fonts are not in the FARCs.** The FileDB lists 19 `gamedata/fonts/*.fnt` and no archive
  holds one; 11 lie loose in the install's `gamedata/fonts/` (2026-10-25), and those are the
  corpus: `body-md`, `crikey_squat`, `crikey_tall`, `eigerdalsbla`, `helveticaneueltstd-md`
  (the same bytes as `body-md`), `icon_patch_font`, `omnesbla`, `omnesblaita`, `omnessem`,
  `omnessemita`, `tall`, at versions `0x26e`, `0x3b3`, `0x3d9` and `0x3ef`/`0x161`.
- ✔ **All 11 read whole** (`test/font-face.test.ts`): the walk ends where the header's data offset
  says, and the glyphs' bitmaps follow one another with no gap or overlap to the file's last byte.
  Every glyph of the compressed seven — from `0x3b3` on; below `0x272` there is no flag and the
  four `0x26e` fonts, the `omnes` ones, are not — inflates to exactly its width × height, 4 glyphs to 21,754 a font.
- ✔ **`glyphIndex` and `glyphPageUsed` are measured, not just walked**: 128 chain heads, one per
  `character & 127`, running through `nextGlyph` and reaching every glyph with none in the wrong
  chain; and a 512-bit set of 128-character pages, bit `character >> 7` from each word's lowest,
  which is exactly the pages the glyphs fall in. The glyphs are sorted by character.
- ⚠️ An uncompressed font's two bytes per pixel are cwlib's "green and blue"; what they are to the
  game is not measured, nor what unit `advance` is in (`A` in `tall` is 17 px wide, advance 564).

## Text resources — `GSBt` and `DLCt`

`RGuidSubst` and `RDLC` exist in the game only in the engine's text serialisation: the magic alone
on the first line, then one field per line, tab-indented to its depth, name and value apart; an
array is `Name<tab>count` and then its elements `[i]` a level deeper. `TextResource` in
`src/io/text-resource.ts` walks that, and `readGuidSubst` (`resources/guid-subst.ts`) and
`readDlc` (`resources/dlc.ts`) read the two layouts, each requiring every line.

- ❗ **A reading of our own**: cwlib's `RGuidSubst` parses a different text layout and its `RDLC`
  the binary one (ennuo/toolkit `d6a2ef8`); `readDlc`'s field names are cwlib's `DLCFile` and
  `DLCGUID`, which the text names one for one.
- ✔ **All 85 `.gsub` and `.dlc` paths of the FileDB are in the FARCs and read to their last
  line** (`test/text-resources.test.ts`, 2026-10-25) — 82 distinct files: `subtitles.gsub` has
  the bytes of `button_swap.gsub` and `languages/subtitles.gsub`, `lbp2_wip.dlc` those of
  `lbp2_dad.dlc`. 74 `GSBt` hold 34,985 substitutions; 8 `DLCt` list 526 files.
- ✔ **Every text resource reads whole as a tree, with no schema** (`readTextTree`, 0.4.22): a
  field whose next line is `[0]` a level deeper is an array, and its count must equal the elements
  that follow; any other deeper line opens a struct's own fields — a descriptor's `GUID` and `Hash`
  under its path (`Texture  …/brush1.tex`), a slot id's `Type` and `SlotNumber`. A line more than
  one level below the one above it, or a count the elements do not match, throws. All **421 text
  resources of 19 magics** in the FARCs read so (`test/text-resources.test.ts`, 2026-10-25): 225
  `MUSt` (`.mus`, music settings), 74 `GSBt`, 63 `SSPt` (`.sph`, soft-physics settings), 13 `ASTt`,
  9 `CHAt`, 8 `PBRt` (paint brushes), 8 `DLCt`, 6 `SASt`, 5 `ABKt`, and one each of `SLTt`, `LMTt`,
  `AUMt`, `MIXt`, `AMPt`, `SSFt`, `SRGt`, `CONt`, `POPt`, `SMPt`. `textValue` reads a value as a
  quoted string, a boolean, a number or numbers apart by commas (`Wind  -1,0.136752,0`); what is
  left unquoted are enum names (`CAT_BIRD`) and paths. Only `GSBt` and `DLCt` have typed readers.
- ⚠️ **Edited by hand**: `downloadables.dlc` names a GUID's flags `Flags` and, on some, `flags `;
  separators are a tab, a space or both; lines end in stray tabs; and `inventory_auto_pickup.gsub`
  ends its lines with `# comments`. Names are matched without case, any whitespace separates,
  and a `#` outside quotes ends a line.
- What they hold: each `audio/dialogue_<language>.gsub` swaps the dialogue's `.mp3`s for that
  language's (Italian: 1,903, `dialogue/davinci/…` → `dialogue/italian/davinci/…`); the sackbots'
  (`avalon.gsub`…) give a character its own animations for Sackboy's; `inventory_auto_pickup`
  swaps four tool plans. Of the 34,985, 33,663 `From` and 33,691 `To` GUIDs are FileDB rows;
  `gmat.gsub`'s 575 pairs are none, and all 575 resolve through the PS4 GUID remap — it names
  the PS3 GUIDs. The DLC lists' 6,321 `GUIDS` are all FileDB rows, and 8,118 of their files' 8,119.

## Profiles — `RSyncedProfile`, `RAdventureCreateProfile`

`readSyncedProfile` (`src/resources/synced-profile.ts`) reads a `PRFb` — time played, the Sackboy
the player wears (a world Thing, read like a plan's), the creature avatars, the colours, the PSN
id — and `readAdventureCreateProfile` (`resources/adventure-create-profile.ts`) an `ADCb`: an
adventure's level slots, its planet as a world Thing, the links between levels, the planet's areas,
the play data it starts with, its `ADSb` and its photos. Both are cwlib's walks (ennuo/toolkit
`d6a2ef8`) and require the payload's last byte.

- ❗ **The install holds both**, found by a census of the FARCs by magic (2026-10-25): **17 `PRFb`**,
  each a crossplay `.cpv` (`…_crossplayvita_02.cpv`), and **3 `ADCb`** — the story's
  `marketing_demo1/adventure.adc`, `marketing_demo2/demo.adc` and the Popit Puzzle planet's. The
  PS3 saves under `LBP_LEVELS` add one `PRFb` (`data4/BCES00850LEVEL01CFF33A`).
- ✔ **All 21 read to their last byte** (`test/profiles.test.ts`, `test/synced-profile.test.ts`).
  A profile's Sackboy is a world of four or five Things (`YELLOWHEAD`, `CREATURE`, `COSTUME`,
  `JOINT` among their parts), its colours opaque ARGB, its id `OfflinePlayer` or `Offline_Player`.
  The story's `ADCb` (subVersion `0x1ab`) has 54 slots (`Introduction`, `Needlepoint Peaks`, …),
  114 links and 15 areas, the first four each a world with its own `LEVEL_SETTINGS`.
- ⚠️ **Every `PRFb` is on the Vita's branch** (`0x3e2`, branch revisions `0x7a`, `0x80` and `0x87`),
  and all 18 end on their last byte only with **one integer after the PSN id** that cwlib, with no
  Vita gate here, does not read (`vitaValue`). Its values repeat across levels — `2000712823` on
  three, `61378691` on two — so it is an identity of some kind rather than a time; what it is is
  *28* in [open-questions.md](open-questions.md). No profile off the branch exists here to show
  cwlib's walk without it.
- `PlayedLevelData` on the Vita's branch is not ported and refuses; the three `ADCb` are off it.
- ✔ **An `ADSb` — the shared data an `ADCb` names — is one `AdventureData`**, the struct
  `RLevel` ends with: all three (`….ads` beside each `.adc`, subVersions `0x170`, `0x1a9`, `0x1ab`)
  end on their last byte with it alone (`readAdventureSharedData`, `test/profiles.test.ts`).
  cwlib has the type, `ADVENTURE_SHARED_DATA`, and no class. The story's holds 8 items, 24 quests —
  every one a `.qst` — and 9 start points, each a level's slot and the streaming ids it starts at
  (`Manglewood Blueprint`, `Zom Zom Exterior`, …).

## Quests — `RQuest`

`readQuest` in `src/resources/quest.ts`: magic `QSTb`, FileDB paths
`gamedata/lbp3/…/quests/….qst` — the story's quests for Bunkum Lagoon, Manglewood, the Ziggurat
and the Popit Puzzle planet. ❗ **Read as the game's own loader reads it**: `v0xdbd490` in
`eboot-v128.bin` (an objective `v0xdbc520`, a descriptor `v0xbadab0`; found by the five
calls to the wide-string reader `v0xbdd2a0`, 2026-10-25), every gate a compare on the head
word. cwlib's `resources/RQuest.java` (ennuo/toolkit `d6a2ef8`) has an empty `serialize`;
the names in its comment are the game's — the eboot's reflective serialiser `v0xdbe720` names
`State`, `Prizes` … `PotentiallyCompletedObjectivesInLevels` in this order — and the five
strings have no name there. ✔ **All 25 in the four FARCs read to the last byte of their
payload**, at subVersions `0x154`, `0x167`, `0x177` (version `0x3ef`), `0x1a6` and `0x1a9`
(`0x3f9`), every compression flag set (`dev/resources-census.ts`, `test/resources.test.ts`).

```
                                                     from subVersion
wstr name, title, description                        0x9c
wstr area                                            0xeb
wstr group                                           0x112
wstr, wstr  (read and dropped)                       0x157..0x158 only
u32 State                                            0xa0
descriptor[] Prizes, descriptor[] PrizeIcons         0xb5   (u8 flag, then GUID / SHA-1)
Objectives[]                                         0x9c
  wstr text, wstr id                                 0x9c
  wstr  (dropped)                                    0x157..0x158 only
  u16 ?, u16 Required, u8 Hidden                     0x9c
  u8, u8  (read and dropped)                         0x9c..0x161
  u32 key                                            0x141
  u8                                                 0x157..0x158 only
Decals[], Decorations[]                              0xc0, 0xc2
u8 IsPrimary, u8 IsInvisible                         0x9c, 0x144
SlotID[] DeactivatedInLevels, Activated…, Completed… 0xd0, 0x10d, 0x11e
u8 StateUpdateViewed                                 0xf6
u32 Key, u32 AvailabilityDependsUponKey              0x141
NewDecorations[], NewStickers[]                      0x168
u8                                                   0x157..0x158 only
PotentiallyCompletedObjectivesInLevels[]             0x17b
```

What is measured and what is only a width:

- ✔ The five strings: a name (`ZIG_Blueprint`, `Quest ID` where unset), a title and a
  description (LAMS keys such as `ZIGGURAT_QUEST_TITLE_30`, or plain text), the area
  (`THEME_ZIGGURAT`, `Bunkum Lagoon`, `Uncategorised`) and a group, `Independent!` in all 25.
- ✔ **The prize is a costume plan**: the four non-null prize GUIDs are in the FileDB as
  `gamedata/lbp3/character/palettes/cos_….plan` (`cos_newton_low_poly`, `cos_sack_boy_1` to
  `_3`, `cos_journalist_outfit`). The icon's GUIDs are not in the FileDB, so what they name is
  open.
- ✔ **`Prizes` and `PrizeIcons` are arrays of three descriptors in every one of the 25, with
  only the middle one ever set.** The "0 and 3" read before each prize when the reading was
  ours were `State` (0 in all 25) and the array's count, and "the integer after the icon" its
  third, null, element.
- ✔ The slots are `SlotID`s of type 11, cwlib's `DEVELOPER_ADVENTURE`, in every array that has
  any; their numbers run round 22.87 M, and `pp01_bridge.qst`'s on another planet's range.
- An objective's first `u16` has no name in the eboot (`Required` and `Hidden` follow it); ⚠️
  its values — 101 on 13 of 35 objectives, 0 on 7, others as far as 13,352 and −15,317 — are no
  count, and what it is is open. `Required` is 0 on all 35, `Hidden` true on 10.
- ✔ The two bytes of an objective below `0x167` are the game's `0x9c..0x161` pair, read and
  dropped; `pp01_bridge.qst` (`0x154`) is the one quest here that has them.
- ✔ **A quest's `key` is what a level's `PQuest` names in `questKey`, and an objective's
  `key` its `objectiveKey`** (`dev/quest-keys.ts`, 2026-10-25). Of the 322 `QUEST` parts
  in the four FARCs' levels and plans (99) and the story's chunks (223) that parse — the
  7,537 that do not are mostly below the reader's bound — all of type 5:
  - 299 have a non-zero `questKey`, and 292 of them are a `QSTb`'s `key`. The other 7 name
    two quests the game has no `QSTb` for (`ZIGP04` and `ZIGP05` in the Caverns, and one key
    in `manglewood_hub_base_virtual_305.plan`).
  - 166 have a non-zero `objectiveKey`. 162 of those name a known quest, and 160 of the 162 are
    one of **that same quest's** objectives. The other 2 are a `Fickle_Mistress` objective,
    which `bunkum_relics.qst` no longer lists.
  - 23 of the 25 quests and 28 of the 35 objectives are named by some part.
  - ⚠️ **The part's strings are not the link.** `questId` is empty on 217 of the 322 parts, and
    where it is set it is mostly another quest's name (`MW-QR-Bite Sized` on a part keyed to
    `ZIG_Rocket_QR`), a copy left over when the part was. Read a part's quest by its key.
  - The keys are no 32-bit hash of the strings that was tried (FNV-1 and 1a, CRC-32, Java's
    `hashCode`, djb2); `ziggurat_blueprint.qst`'s one objective has the quest's own key.
- ✔ **What follows the key is `AvailabilityDependsUponKey` from `0x141`, `NewDecorations` and
  `NewStickers` from `0x168` and `PotentiallyCompletedObjectivesInLevels` from `0x17b`** —
  the one, three and four zero fields measured at `0x154`/`0x167`, `0x177` and `0x1a6`/`0x1a9`.
  Arrays the game has no element of here are refused when not empty. `StateUpdateViewed` is
  true in all 25.

## The game's textures — `GTF ` and `TEX `

`readTexture` in `src/resources/texture.ts`, dependency type 1. A game texture is `GTF `; a user texture is
`TEX `, and so are 2,944 of the game's own (UI icons, stickers from LBP2's levels). Neither is a
resource: no revision, no header flags, no dependency table — the magic, then for `GTF ` a 24-byte
big-endian `CellGcmTexture`, then the same chunk table a resource has. The layouts were cwlib's
(`resources/RTexture.java`, `structs/texture/CellGcmTexture.java`, `types/SerializedResource.java`,
toolkit `fee22399`) and are measured on **every texture in LBP3 PS4 1.28's four FARCs: 32,914 of
32,914 read**, each one's levels accounting for its payload to the byte (`dev/texture-census.ts`,
2026-10-19).

```
GTF                                          TEX
0x00 "GTF "                                  0x00 "TEX "
0x04 u8  format   0x81 B8, 0x85 A8R8G8B8,    0x04 chunk table -> a DDS file, little-endian as
                  0x86 DXT1, 0x88 DXT5;           DDS is: the 128-byte header, the mips back
                  | 0x20 LN: rows, not swizzled    to back, then (7 of 2,944) the bytes "BUMP"
0x05 u8  mipmap
0x06 u8  dimension  2, or 3 a volume
0x07 u8  cubemap
0x08 u32 remap      0xaae4 the identity
0x0c u16 width, height, depth
0x12 u8  location, flags
0x14 u32 pitch      the row stride, LN only
0x18 u32 offset     0
0x1c chunk table -> the pixel data
```

| magic | format | textures |
|---|---|---|
| `GTF ` | `0x88` DXT5 | 18,966 |
| `GTF ` | `0x86` DXT1 | 10,588, 6 of them cube maps |
| `GTF ` | `0x85` A8R8G8B8 | 234, 6 of them volumes |
| `GTF ` | `0x81` B8 | 178 |
| `GTF ` | `0xa5` A8R8G8B8 with `LN` | 4 |
| `TEX ` | DDS DXT5 / DXT1 / A8R8G8B8 (masks `ff0000 ff00 ff ff000000`) | 1,688 / 1,255 / 1 |

48 more `.tex` paths hold a JPEG, not a texture resource. No `DXT3`, no `GTFs`/`GTFS` (cwlib's
swizzled variants) and no DDS cube or volume is in the game: `readTexture` decodes BC2 by the book
and refuses the others.

| convention | measurement |
|---|---|
| ❗ **the PS4 data keeps the PS3's layouts**: BC blocks linear, row-major | decoded images look right; on the first level no larger than 256, texels are smoother read so than with the blocks in Morton order on 10,461 of 10,517 DXT1 and 18,220 of 18,384 DXT5 |
| `B8` and `A8R8G8B8` without `LN` are **Morton-swizzled**: x in the lowest bit, one bit of each axis in turn, the longer axis's surplus on top | `dc_comics_promo_32bit` (512 x 256) comes out as the picture it is, which another order scrambles; smoother than read linearly on 312 of 319 |
| `A8R8G8B8` bytes are A, R, G, B | the same picture's colours |
| a volume is swizzled in three dimensions, x, y, z in turn | on the four 64 x 64 x 32 colour cubes x-y-z is the smoothest of the six orders and of a linear read (11.5 against 12.8–13.7, and 54.0); a cubic volume cannot tell its axes apart |
| `LN`: rows `pitch` bytes apart, on every mip | `water_colours_32bit_linear` (16 x 1, five mips, pitch 64) is five 64-byte rows, padded |
| mips back to back; the chain padded to 128 bytes, each face's on a cube map | every `GTF ` payload is exactly that long; the cube maps 6 of 6 only with the padding per face |
| the mip offsets | the first level no wider than 64 against the next, box-filtered: under half the error of the same comparison rolled by half a width on **23,682 of 23,852** textures the roll changes (the rest are too uniform to tell) |
| `TEX`: the DDS used up exactly; `DDSD_MIPMAPCOUNT`, or one level | 2,937 of 2,944; the other 7 end in `BUMP` |
| `flags` bit 0: a normal map | set on 4,393, every one's path naming a normal or bump map; clear on 36 such paths. (`flags` 0 / 1 / 2 / 3 / 6 / 7 on 1,958 / 3,292 / 16,231 / 501 / 7,388 / 600.) |
| `flags` bit 1: **re-exported for the PS4**, not a colour space | set on 24,719 of the 24,720 `GTF ` under `gamedata_orbis/` and clear on 5,250 of the 5,251 under `gamedata/`. Crossed with the material ports a texture is wired into, neither bit 1 nor bit 2 separates colour from data: flags 2 and 6 sit on diffuse-only and specular-only textures alike, and 3 and 7 on bump-only ones. Bit 2 is on 7,988 `gamedata_orbis/` textures and nowhere else, and is not understood — *64* |
| `remap`: `0xaae4` on all but 82 `B8`s | `0xa9ff` (79, the `_sdf` icons) reads B into R, G and B with alpha one, and the icons come out grey and opaque; `0x02ff` (3) reads it into alpha alone. A reading of the RSX's remap register that the images agree with, not a measurement of its bits |

- The levels come ready for WebGPU: `bc1`/`bc2`/`bc3` are the raw blocks for
  `texture-compression-bc`, `rgba8` is unswizzled and expanded through the remap. `decodeLevel` is
  the pure-TypeScript decode to RGBA8 for a browser without the feature. Whether to sample as sRGB
  is not in the file beyond `bump` — *64*.
- ⚠️ **A texture's zlib streams are `78 da` as often as `68 de`**: the game wrote both windows,
  and the platform inflaters take either (*47* in [answered-questions.md](answered-questions.md)).
- ✔ **A user's `TEX ` is the same format.** The 103 levels of `fixtures/archive` name 621 hashed
  type-1 dependencies; `dev/fetch-textures.ts` fetched 619 (2 are not in the archive), each
  matching its SHA-1, into `fixtures/textures`, and **619 of 619 read**: every one `TEX `, one level
  with no mips, DXT1 on 590 and DXT5 on 29, and 617 not a power of two — photographs and stickers
  at 320 x 180 and 320 x 240 mostly. Their chunks start `68` on 599 and `78` on 20.
- `out/textures/`, written by `node dev/texture-census.ts out/textures` and gitignored, holds
  decoded samples: a BC1 diffuse map, a BC3 normal map, a cube map's faces, a volume's slices
  stacked, a `B8` icon, three `TEX`, the A8R8G8B8 promo, and a small mip of each.

## The game's materials — `RGfxMaterial`

`readMaterial` in `src/resources/material.ts`: magic `GMTb`, dependency type 7, FileDB paths
`gamedata_orbis/gmat/….gmat`, named by 12,344 of the game's 12,403 mesh primitives — **by an old
GUID, through the remap, on 11,667 of them**. The field list is cwlib's
`resources/RGfxMaterial.java` and `structs/gmat/` (toolkit `fee22399`), measured on **every `GMTb`
in the four FARCs: 11,011, revisions `0x3ef`–`0x3f9`, subVersions `0x177`–`0x1ab`, all 11,011 read
to exactly the last byte of their payload** (`dev/material-census.ts`, 2026-10-19). `readMaterial`
throws when one does not, and refuses the revisions, branches and subVersions below `0x16b` that
cwlib lays out differently and the game does not ship.

```
i32 flags   f32 alphaTestLevel   u8 alphaLayer, alphaMode, shadowCastMode
f32 bumpLevel, cosinePower, reflectionBlur, refractiveIndex
f32 x 4     refractive fresnel                            subVersion >= 0x13a
u8          fuzzLengthAndRefractiveFlag                   >= 0x16b
u8 x 6      translucency, fuzz swirl x 2, fuzz lighting x 2, iridescence   >= 0x17c: absent on the three 0x177
i32 x 10    each shader's end in the code blob            non-Vita, from 0x393
bytearray   the code: ten PS4 shaders ("Shdr"), then 20 bytes (11,011 of 11,011)
resource x 8   the texture slots                          by GUID, never by SHA-1
u8[] wrapS, u8[] wrapT                                    8 each
Box[]       i32 type, i32 8, u32 x 8 params, f32 x, y, w, h, i32 subType, ParamAnim x 2
Wire[]      s32 boxFrom, s32 boxTo, u8 portFrom, u8 portTo, char[5] swizzle
i32         soundEnum
ParamAnim[] f32 x 4 base, f32[] values, i32 n + n chars of name, u8 componentsAnimated
```

- ⚠️ A box's parameters are 32-bit words — floats for most boxes, integers for a texture sample's
  channel and slot — and varints under `COMPRESSED_INTEGERS`: read them as `u32` and reinterpret,
  or a float loses its bits.
- ⚠️ A parameter animation's name length is a plain `i32`, not the zigzagged `s32` of a string.
- A box's two `ParamAnim`s animate its parameters 0–3 and 4–7, one key per row of `keys`. On the
  effects (2026-10-21, `../lbprender/dev/gcnslice.ts` and a dump of their boxes): the god rays'
  texture boxes hold 1,000 keys whose U offset climbs 0 → 1.998 and 0 → 0.999, the aurora's 1,024,
  the scrolling stars' 256 — loops, the last key one step short of the first plus a whole tile.
  At how many keys a second the game plays them is not in the file.
- The swizzle is ASCII, NUL-padded: of 53,278 wires `""` on 52,834, `"a"` 404, `"r"` 20, `"b"` 11,
  `"g"` 8, `"rgb"` 1.

| over the 11,011 | count |
|---|---|
| output boxes (type 0) | exactly **one per material** |
| box types | 1 texture sample 30,112 · 10 multiply 8,232 · 3 colour 8,166 · 12 mix 2,521 · 2 Thing colour 1,109 · 16 blend 201 · 4, 5, 7 constants 117 · 11 add 59 · 9, 13, 15, 17, 18, 19: 23 |
| what feeds port 0 | a sample 6,317 · multiply 3,586 · colour 712 · blend 141 · mix 120 · Thing colour 90 · add 19 · constant 11 · nothing 15 |
| texture slots | 29,915 named; 29,902 land on texture bytes (4,934 through the FileDB, 24,968 through the remap), 2 on a row with no bytes, 11 nowhere |

**How the game wires two of the boxes**, counted over the 11,011 (lbprender's `dev/boxes.ts`):

- **Mix (12)**: 2,327 of 2,521 take a colour box on port 0 and a texture sample on port 1, and their
  param 0 is a factor — 0.5 on 374, 0.3 on 281, 0.1 on 269, from 0.02 to 0.8 in all; port 2 is wired
  on 42. So the factor is param 0, not a fixed half, where port 2 is not wired.
- **Blend (16)**: 196 of 201 have **three** inputs, port 2 a texture sample — a mask, swizzled to one
  channel on 6 — and params a low–high pair, `(0, 1)` on 196 and `p0 < p1` on every one. Read as
  input 0 into input 1 by the mask remapped from `[p0, p1]`; the gingham materials put the Thing's
  colour on port 1 and come out as the red-and-white check they are named for.

**The ports, checked against what is wired to them** — cwlib's `BrdfPort` names measured rather
than read: a sample wired straight into **port 3 (BUMP)** is a `GTF ` with `flags` bit 0 set on
**6,577 of 6,649**, its path naming a normal or bump map on 6,578; one wired straight into **port
0 (DIFFUSE)** has the bit clear on **6,306 of 6,310**, its path naming a normal map on 7. Into
port 2 (SPECULAR) the bit is clear on 3,634 of 3,651.

### `materialSummary` — which parts are measured and which are a reading

`materialSummary(m)` follows ports 0, 1 and 3 upstream, depth-first with inputs in port order, and
names the shape it finds:

| field | status |
|---|---|
| `diffuse` is port 0, `bump` port 3 | ✔ measured: the textures wired to them, above |
| `alphaClip` is port 1 | cwlib's name; a sample feeds it with swizzle `"a"` on 360 materials and none on 307. Not measured further |
| `sample.uvChannel` = `params[4]` | ✔ measured: below the channel count of the mesh on **33,473 of 33,473** samples, over every mesh primitive naming the material |
| `sample.slot` = `params[5]`, an index into `textures` | ✔ the slot is filled on 30,110 of 30,112 samples, and per port the textures are the right kind, above |
| `sample.uvTransform`: scale `params[0,1]` and offset `[2,3]`, or with `subType` 1 a 2x3 matrix of params 0, 1, 2, 3, 6, 7 | ❗ **a reading**, cwlib's. Identity on 8,526 diffuse samples, scale and offset on 1,574, rotated on 60. `dev/uv-census.ts transform` cannot tell it from no transform: of 46 cut-out primitives that qualify, 39 tie — *64* |
| **V runs from the texture's first row**: `v = 0` is row 0 as the file stores it, no flip | ✔ measured, `dev/uv-census.ts`: on 405 alpha-clipped primitives with a sparse cut-out diffuse texture and no transform, triangle centroids land on opaque texels **58.8% as stored, 41.6% with V flipped** — and 37.6% with U flipped, the control. Of the primitives that one reading wins by a tenth of their triangles, as stored wins 70, V flipped 7, U flipped 7, both 5 |
| `shape`: `texture` 6,303 · `texture*colour` 352 · `colour` 712 · `thing` 548 · `graph` 3,081 · none 15 | a reading of the graph, counted. ⚠️ On a `graph` the sample is only the first found: `badge_zip_entrance_cloth` multiplies its base by slot 1 sampled at two scales |
| `colour`: a colour box's params 0–3 as RGBA | a reading; within [0, 1] on 1,329 of 1,333 |
| `twoSided` (flags `0x1`), `alphaClipEnabled` (`0x800`) with `alphaTestLevel` | cwlib's names, not measured |
| `alphaMode`, `alphaLayer` | **raw, not understood.** Against the names: mode 2 layer 128 is `_alpha` on 342 of 343, mode 4 layer 128 `_glassy` on 132 of 132, mode 1 layer 192 `_refract` on 48 of 49; mode 0 layer 0 is 10,318 of the others. A correlation — *64* |

## The corpora

Every corpus is somebody's own data and **none of it may be committed**; `.gitignore` covers
`fixtures/`, and the SHA1-named resources in the toolkit checkout are referenced by path.

| corpus | where | what it is |
|---|---|---|
| the toolkit checkout | the `data*/` folders of its `tools/sequencerdump`, which `LBP_LEVELS` names | 18 loose LBP2/LBP3 level resources, revisions `0x3b8`–`0x3f9`, one on branch `0x0213`; plus two PS3 save folders (`BCES00850…`, `BCES01663…`). ⚠️ The sibling `out*\` folders are that tool's MIDI output — ignore them |
| the cwlib dump | `fixtures/levels/sequencers.jsonl` | 129,696 rows over **19 files** (22 levels walked), produced by cwlib through the deleted `RawDump.java`; the golden fixture, unregenerable, and still holding 23,911 duplicate rows — [lbp-modding-toolchain.md](lbp-modding-toolchain.md) |
| the ten-level subset | the ten files of the above that `verify-levels.ts` matches | **149 music sequencers, 62,158 placements, 953,791 notes, 1,448,224 records** — the numbers every MIDI and pool measurement quotes |
| six PS3 saves | the two in the checkout, plus downloaded backups | 663 resources, 224 plans, 172 + 19 sequencers |
| the archive sample | `fixtures/archive/` | 103 root levels spread over LBP1, LBP2 and LBP3 slots |
| the archived chunks | fetched through the dependency walk | 32 `CHKb`, 5,832 Things — the only `cf0` corpus |
| the archive's user textures | `fixtures/textures/`, by `dev/fetch-textures.ts` | 619 `TEX ` named by the archive sample's levels |
| the game's archives | an LBP3 PS4 install (`LBP_GAME`) | 4 FARCs, 74,169 entries: 17,624 plans, 522 levels, 5,941 meshes, 32,914 textures and 11,011 materials; the FileDB and its GUID remap beside them. Sony's, read in place, never copied |

`test/resource.test.ts` and its siblings read `LBP_LEVELS` and **skip** when it is
absent, so the suite passes on a machine without the game.

## The reader's version bound — `LBP3_MIN_VERSION = 0x3b7`

`src/io/serializer.ts` refuses anything older. Two measurements put it at `0x3b7`
rather than the corpus's own `0x3b8`: cwlib has exactly one gate at `0x3b8` in its whole tree
(`PPhysicsTweak`'s `version > 0x3b8 && configuration == 0xd`, which `readPhysicsTweak` has), and
all four `0x3b7` levels in the archive sample parse the moment the bound allows them.

What the 103-level sweep finds (2026-09-05):

| version | branch | parses |
|---|---|---|
| `0x3b7` | `0/0` | **4 of 4** |
| `0x3b8`–`0x3f9` | `0/0` | **78 of 78** |
| `0x272` | `4c44` (LEERDAMMER) | 0 of 19 at the bound; **19 of 19 identical to cwlib, Thing for Thing**, with it lowered by hand |
| `0x26e` | — | 0 of 1, refused by the bound; its container opens since the header gates (2026-10-19) |
| `0x237` | — | 0 of 1, `0-aaaffe`, the same. It was put down to a truncated file; it was the header |

**82 of 103, with no failure anywhere in the range the reader claims.** Below it, twelve part
readers were wrong for LBP1 files and are fixed (`fillThing`, `readPos`, `Polygon`, `readShape`,
`readRef`, `readGroup`, `readMetadata`, `readRenderMesh`, `readTrigger`, `readJoint`,
`readSwitch`, `readCreature` — the gates are in *28* in
[answered-questions.md](answered-questions.md)), and all nineteen files read identically to
cwlib. ❗ **The bound has not been lowered anyway**: LBP1 has no Music Sequencer, and the range
between `0x272` and `0x3b7` has **zero coverage** — no file in the sample sits there, and 2 of 19 at
the start of that work is what "reading an older layout with newer rules and producing plausible
nonsense" looks like from the outside. Whether to admit an *allowed set* (`0x272` plus
`0x3b7..0x3ff`, refusing the untested span between) is a decision, in *28* in
[open-questions.md](open-questions.md), with the other leftovers of the sweep.

### How a reader bug is found, the technique

1. `tools/CwlibTrace.java spans` for cwlib's part boundaries with offsets, and
   `dev/trace-level.ts` for ours; the first part whose span disagrees names the
   reader and therefore the cwlib file to open. ❗ Reach for this before a hex dump.
2. Wrap every `Serializer` method to log each read as `(name, start, end, value)` — **values, not
   just widths**; widths align at any offset, values do not. The tail of a part that reads
   plausibly (`radius 250`, `angleRange 180`) says that part is aligned and the next field is not.
3. List every top-level Thing with its span and look for the one whose **size** breaks the pattern:
   nineteen Things of 575–588 bytes and then one of 64 says exactly where to look, with no
   byte-level reading at all. `0xaa` followed by a plausible uid varint locates the true next Thing,
   which turns "how far off are we" into a number.
4. Then, and only then, the raw bytes at the disagreement.

❗ **A field that is empty or zero everywhere in the corpus is untested, whatever it is declared
as.** Two of the four bugs in `8b904be1`, `69318581`, `7c0f1a1d` and `5576f758` were exactly that
shape, found on the same day.
