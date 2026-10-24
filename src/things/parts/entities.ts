/** The `&amp;`-style entities the game writes in names, decoded and encoded. */



/**
 * The five XML entities the editor escapes with, and nothing else.
 *
 * ⚠️ Deliberately not the HTML set. The game escapes for XML, so `&nbsp;` and
 * the other 250-odd HTML names would be a guess; anything not listed here is
 * left exactly as it was found, which is the safe way to be wrong.
 */
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
  ['lt', '<'],
  ['gt', '>'],
]);

/**
 * Undo the editor's XML escaping in a creator-authored name.
 *
 * **Measured over the 22-level dump**: `&apos;` appears 46 times across the
 * sequencer names and 416 times across the instrument names, `&amp;` 7 times,
 * and nothing else does. Nineteen sequencers are titled entirely in quotes --
 * `&apos;Sands of the Cosmos&apos;` -- so without this the quotes are the first
 * thing a user sees on the sequencer they came to hear.
 *
 * ⚠️ **One pass, not five.** Replacing `&amp;` and then `&apos;` would turn a
 * literal `&amp;apos;` into an apostrophe -- the classic double-unescape. A
 * single regex sees each `&…;` once, so `&amp;apos;` correctly comes out as the
 * text `&apos;`.
 *
 * ⚠️ **This is a decode at read time, so a writer has to re-escape** --
 * `escapeEntities` below, or every save-and-reload strips another layer.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (whole, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES.get(body) ?? whole;
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    // A lone surrogate or an out-of-range code point would throw, and an
    // unreadable escape is better left visible than turned into a replacement
    // character.
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    if (code >= 0xd800 && code <= 0xdfff) return whole;
    return String.fromCodePoint(code);
  });
}

/**
 * Put the editor's XML escaping back, for a name on its way into a file.
 *
 * The exact inverse of `decodeEntities` over the five names it knows, and
 * nothing more: numeric escapes are decoded on the way in and are **not**
 * re-encoded on the way out, because the corpus only ever shows the named form
 * and inventing `&#233;` for an accented character would be a guess about the
 * editor rather than a reading of it.
 *
 * ⚠️ **`&` first, and once.** `escape(decode(x)) === x` holds for every name in
 * the 22-level dump; what it does not do is survive a name a user typed with a
 * literal `&amp;` in it, which comes back as `&amp;amp;`. That is the correct
 * direction to be wrong in -- the alternative loses the user's text.
 */
export function escapeEntities(text: string): string {
  return text.replace(/[&'"<>]/g, (c) =>
    c === '&' ? '&amp;'
      : c === "'" ? '&apos;'
        : c === '"' ? '&quot;'
          : c === '<' ? '&lt;' : '&gt;');
}
