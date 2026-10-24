/**
 * Bytes as lower-case hex, two digits a byte -- how this library spells every
 * SHA-1 it hands out (FARC rows, FileDB rows, save archives, chunk hashes).
 *
 * ⚠️ **It runs once per table row**, tens of thousands of times when the game's
 * archives open, so it is a lookup and a loop rather than the
 * `[...bytes].map(...).join('')` it replaced, which built two arrays and twenty
 * strings for every SHA-1.
 */

const DIGITS: readonly string[] = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += DIGITS[bytes[i]];
  return out;
}
