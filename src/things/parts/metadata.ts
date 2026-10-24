/** `METADATA`: its part reader. The conventions every part follows are in `../parts.ts`. */

import { Serializer, SerializerError } from '../../io/serializer.ts';

/**
 * `PMetadata`: what an inventory item calls itself.
 *
 * ❗ **Only reachable below LBP3**: the walk refuses at `LBP3_MIN_VERSION`
 * long before a file carrying one is opened. It has a reader because it is
 * what nine of the archive's LBP1 levels stop on once the Thing header is read
 * correctly -- see question 28.
 *
 * ⚠️ **The LAMS branch is the only one implemented.** cwlib takes translation
 * *tags* -- four strings -- when the file predates `LD_LAMS_KEYS` (LEERDAMMER
 * revision 8) and 0x2ba; every LBP1 level in the sample is LEERDAMMER 0x17, so
 * the four `u32` keys are what they carry and the tag branch has never been run
 * against a file. It refuses rather than guessing.
 */
export function readMetadata(s: Serializer): void {
  const { version, branchId, branchRevision } = s.revision;
  const leerdammer = branchId === 0x4c44;
  // cwlib `hasDepreciatedValue`: a `CValue` struct that LEERDAMMER dropped at
  // its revision 2 and everyone else at 0x297.
  const deprecatedValue = leerdammer
    ? branchRevision < 0x2
    : version < 0x297;
  if (deprecatedValue) {
    throw new SerializerError('PMetadata with the deprecated CValue has no reader');
  }
  if ((leerdammer && branchRevision >= 0x8) || version > 0x2ba) {
    s.u32(); // titleKey
    s.u32(); // descriptionKey
    s.u32(); // location
    s.u32(); // category
  } else {
    // ❗ The older files carry LAMS **tags** — strings — rather than the four
    // hashed keys. `descTranslationTag` is only stored below 0x159; above it
    // cwlib derives it as `name + "_DESC"` and reads nothing.
    s.str(); // nameTranslationTag
    if (version < 0x159) s.str(); // descTranslationTag
    s.str(); // locationTag
    s.str(); // categoryTag
  }
  if (version >= 0x195) s.i32(); // primaryIndex
  s.i32(); // fluffCost
  s.i32(); // type, a flags word
  s.i32(); // subType
  s.u32(); // creationDate
  s.resource(); // icon
  // ⚠️ Never seen non-null on a level: a `PhotoMetadata` belongs to a photo, and
  // the reference costs one byte when it is null. It refuses if one turns up
  // rather than reading a struct nothing here has checked.
  s.reference(() => {
    throw new SerializerError('PMetadata carries a PhotoMetadata, which has no reader');
  });
  if (version >= 0x15f) s.bool(); // referencable
  if (version >= 0x205) s.bool(); // allowEmit
}
