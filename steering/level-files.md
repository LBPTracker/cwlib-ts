# Level files — containers, saves, archives and the corpora

Read before writing a parser for any LBP resource, save or archive. Everything below is the
*carrier*: the formats a sequencer arrives in. What the sequencer's own data looks like once the
Thing graph is open is in [sequencer-data-model.md](sequencer-data-model.md); the implementation
is this repository's `src/`, and lbptracker's `tools/lbpres.py` is the Python reference for the container.

Everything here is read by `src/resource.ts` and written back by
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
  and to a truncated file. Below `0x189` cwlib lays the header out differently again;
  `loadResource` refuses those rather than guess.
- ⚠️ **A chunk whose two sizes are equal is stored, not deflated**, with no zlib header at all —
  cwlib's `Compressor.decompressData`. 8 chunks of the game's meshes are so, one of them the fourth
  of `spawn_point_start_chrome.mol`, which otherwise failed to inflate.
- ❗ **An uncompressed resource has no chunk table.** The payload starts straight after the flag
  and runs to `depsOffset`. `CHKb` chunks are stored that way, and a reader that ignored the flag
  took "96 chunks" out of the payload's own first bytes.
- ❗ **A resource is told from everything else by its first four bytes, never by its name.** A
  backup is full of `ICON0.PNG`, `PARAM.SFO`, costumes and photographs, and every resource is
  named after its SHA-1. `looksLikeLevel` in `src/backup.ts` accepts `LVLb`,
  `PLNb` and `CHKb`.

### The dependency table

Measured 2026-09-05. It sits **after** the payload, at `depsOffset`: `u32 count`, then per entry
`u8 kind` — 1 for a 20-byte SHA-1, 2 for a `u32` GUID — followed by a `u32` resource type. ✔ On
"Music Gallery #3" the walk of 160 variable-length entries ended at exactly the last byte of the
file (`0x52d02` of `0x52d02`), which is the check that the reading is right. `readDependencies` in
`src/resource.ts`.

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
before it. That is why `partReaders()` in `src/parts.ts` has **50** readers rather
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
  the outermost may throw `StopParse`; `WORLD` was once installed on a *copy* of the reader map.
- ⚠️ **Nine of the fifteen LBP1 divergences were a version gate that existed in the reader's own
  comment and not in its code.** Parts were ported with their gates documented and then written
  for the LBP3 branch only; a grep for "at or below", "above 0x" and "regenerated" in `parts.ts`
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
somebody's popit. `readPlan` in `src/level.ts` opens one and `readLevelProject`
dispatches on the magic. `RPlan` is four fields and only the third matters:

```
bool  isUsedForStreaming   subVersion >= 0xcc          (Revisions.STREAMING_PLAN)
i32   revision             the plan's own, IGNORED -- the resource's revision wins
i32   length               \  thingData
byte  data[length]         /  a Thing[] as a reference array: i32 count, then each
...   inventoryData        head >= 0x197 and not streaming -- never read here
```

⚠️ **The Things are in a nested stream with a fresh reference table.** Reference ids inside
`thingData` mean nothing outside it, so the blob gets its own `Serializer` with the same revision
and compression flags. Reading it in place works by accident on a plan holding one Thing. Two
proofs the wrapper offsets are right: the Thing array **fills `thingData` exactly** — 0 bytes left
on 220 of 220, asserted — and every one of 83,188 Things carries the `0xAA` marker.

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
`src/savearchive.ts` verifies every resource against the SHA-1 in the table,
which turns that unmeasured boundary into a loud failure rather than a corrupt level.

✔ Measured 2026-09-04 on `BCES00850LEVEL01EE7CEE/0` (472,960 bytes): 28 resources, **28 of 28
SHA-1s matching their bytes**, one 275 KB `LVLb` holding **11 music sequencers**, in 102 ms. A wrong
key does not produce 28 matching SHA-1s. Two independent implementations agree on the key and the
table — ennuo's `cwlib/util/Crypto.java` + `SaveArchive.java`, and Zaprit's
[lbp_archive_dl](https://github.com/Zaprit/lbp_archive_dl) `save_archive.rs`, which **writes** one:
a site can serve the same level as a backup zip and as loose resources because it holds the
plaintext and *builds* the save on the way out. The encryption is something a download acquires.

- ❗ `PARAM.SFO` is not encrypted either: `src/psf.ts` reads `SUB_TITLE`, which is
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
and a FARC. `src/mod.ts` reads and writes it; the page opens one like a zip and
the Import/Export view writes one around the `.plan` ([export-to-game.md](export-to-game.md)).

| entry | what |
|---|---|
| `config.json` | `ModInfo`: `ID`, `type` ("pack"), `title`, `version`, `author`, `description` |
| `data.map` | a FileDB, revision `0x01480100` — LBP3 rows: `i16` path length, path, `u32` date, `u32` size, SHA-1, `u32` GUID; ascending GUID |
| `data.farc` | the rows' bytes as a `FAR4`: sorted by SHA-1 hex, padded to 4, a 0x84-byte save key holding only the revision (head `0x021803f9`, branch `0x4d5a`/`0xc` — the toolkit's own "Mizuki"), the table, a **zeroed** hashinate |
| `icon.png`, `patches.json` | optional; neither read nor written here |

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

### The FileDB — `readFileDB` in `src/filedb.ts`

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

### FARC — `openFarc` in `src/farc.ts`

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

### The GUID remap — `readGuidRemap` in `src/filedb.ts`

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

### What of the game's own Things opens

Every `PLNb` and `LVLb` in the four archives through `readThings` (2026-10-19): **10,368 of 17,624
plans and 147 of 522 levels parse.** 7,068 plans and 262 levels are refused by the version bound
— most at `0x397`, the LBP2-era assets LBP3 still ships — and **188 plans and 113 levels fail on
something else**. Before the container's header gates, 567 of those plans and 116 of those levels
died in the container instead of at the bound, and the count was 755 and 229. That makes the game's own archives the largest corpus this reader has met, and
the first with anything in the span below the bound: *28* in [open-questions.md](open-questions.md).

## The game's meshes — `RMesh`

`readMesh` in `src/mesh.ts`: magic `MSHb`, dependency type 2, FileDB paths ending `.mol`. The field
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
- Morphs (on 558 meshes, up to 29) are one 16-byte-a-vertex stream each, skipped by length; only
  their names are returned.

### `PRenderMesh` — what draws a Thing

`readRenderMesh` in `src/parts.ts` returns `RenderMeshPart`: the mesh reference, the bone Things,
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

## The game's textures — `GTF ` and `TEX `

`readTexture` in `src/texture.ts`, dependency type 1. A game texture is `GTF `; a user texture is
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
| `flags` bit 0: a normal map | set on 4,393, every one's path naming a normal or bump map; clear on 36 such paths. Bits 1 and 2 (`flags` 0 / 1 / 2 / 3 / 6 / 7 on 1,958 / 3,292 / 16,231 / 501 / 7,388 / 600) are not understood — *64* |
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

`readMaterial` in `src/material.ts`: magic `GMTb`, dependency type 7, FileDB paths
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
- The swizzle is ASCII, NUL-padded: of 53,278 wires `""` on 52,834, `"a"` 404, `"r"` 20, `"b"` 11,
  `"g"` 8, `"rgb"` 1.

| over the 11,011 | count |
|---|---|
| output boxes (type 0) | exactly **one per material** |
| box types | 1 texture sample 30,112 · 10 multiply 8,232 · 3 colour 8,166 · 12 mix 2,521 · 2 Thing colour 1,109 · 16 blend 201 · 4, 5, 7 constants 117 · 11 add 59 · 9, 13, 15, 17, 18, 19: 23 |
| what feeds port 0 | a sample 6,317 · multiply 3,586 · colour 712 · blend 141 · mix 120 · Thing colour 90 · add 19 · constant 11 · nothing 15 |
| texture slots | 29,915 named; 29,902 land on texture bytes (4,934 through the FileDB, 24,968 through the remap), 2 on a row with no bytes, 11 nowhere |

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
| `sample.uvTransform`: scale `params[0,1]` and offset `[2,3]`, or with `subType` 1 a 2x3 matrix of params 0, 1, 2, 3, 6, 7 | ❗ **a reading**, cwlib's, and nothing here has rendered it. Identity on 8,526 diffuse samples, scale and offset on 1,574, rotated on 60. Which way V runs against a texture's first row is not measured either — *64* |
| `shape`: `texture` 6,303 · `texture*colour` 352 · `colour` 712 · `thing` 548 · `graph` 3,081 · none 15 | a reading of the graph, counted. ⚠️ On a `graph` the sample is only the first found: `badge_zip_entrance_cloth` multiplies its base by slot 1 sampled at two scales |
| `colour`: a colour box's params 0–3 as RGBA | a reading; within [0, 1] on 1,329 of 1,333 |
| `twoSided` (flags `0x1`), `alphaClipEnabled` (`0x800`) with `alphaTestLevel` | cwlib's names, not measured |
| `alphaMode`, `alphaLayer` | **raw, not understood.** Against the names: mode 2 layer 128 is `_alpha` on 342 of 343, mode 4 layer 128 `_glassy` on 132 of 132, mode 1 layer 192 `_refract` on 48 of 49; mode 0 layer 0 is 10,318 of the others. A correlation — *64* |

## The corpora

Every corpus is somebody's own data and **none of it may be committed**; `.gitignore` covers
`fixtures/`, and the SHA1-named resources in the toolkit checkout are referenced by path.

| corpus | where | what it is |
|---|---|---|
| the toolkit checkout | `C:\Users\sgdc3\Desktop\LBP\toolkit\` `data*\` (`LBP_LEVELS`) | 18 loose LBP2/LBP3 level resources, revisions `0x3b8`–`0x3f9`, one on branch `0x0213`; plus two PS3 save folders (`BCES00850…`, `BCES01663…`). ⚠️ The sibling `out*\` folders are that tool's MIDI output — ignore them |
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

`src/serializer.ts` refuses anything older. Two measurements put it at `0x3b7`
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
