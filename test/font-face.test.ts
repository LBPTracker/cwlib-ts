import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { nodeInflate } from '../src/platform/node.ts';
import { findGlyph, glyphBitmap, readFontFace } from '../src/resources/font-face.ts';

/**
 * `RFontFace` over the install's loose fonts; skips without `LBP_GAME`.
 * steering/level-files.md, *Fonts*.
 */
const GAME = process.env.LBP_GAME ?? '';
const FONTS = path.join(GAME, 'gamedata', 'fonts');
const NO_GAME = GAME ? `no fonts under ${GAME}` : 'LBP_GAME is not set';

test('every font in the install reads, and its bitmaps tile its data block', async (t) => {
  if (GAME === '' || !existsSync(FONTS)) return t.skip(NO_GAME);
  const files = (await readdir(FONTS)).filter((f) => f.endsWith('.fnt'));
  assert.equal(files.length, 11);
  for (const file of files) {
    const font = readFontFace(new Uint8Array(await readFile(path.join(FONTS, file))));
    // The glyphs' bitmaps follow one another to the file's last byte.
    let end = 0;
    for (const glyph of font.glyphs) {
      const size = font.compressed
        ? (font.data[glyph.offset] << 8) | font.data[glyph.offset + 1]
        : glyph.width * glyph.height * 2;
      end = Math.max(end, glyph.offset + size);
      assert.equal(findGlyph(font, glyph.character), glyph, `${file}: 0x${glyph.character.toString(16)}`);
    }
    assert.equal(end, font.data.length, file);
  }
});

test('a glyph inflates to its box, and the lookup finds it', async (t) => {
  if (GAME === '' || !existsSync(FONTS)) return t.skip(NO_GAME);
  const font = readFontFace(new Uint8Array(await readFile(path.join(FONTS, 'tall.fnt'))));
  assert.deepEqual([font.revision.version, font.revision.subVersion, font.compressed], [0x3ef, 0x161, true]);
  assert.equal(font.glyphs.length, 21637);
  const a = findGlyph(font, 0x41)!;
  assert.deepEqual([a.width, a.height, a.advance], [17, 28, 564]);
  assert.equal((await glyphBitmap(font, a, nodeInflate)).length, 17 * 28);
  assert.equal(findGlyph(font, 0xffff), undefined);
});
