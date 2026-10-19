import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Reviewed, versioned local assets only. This function accepts no site/model
// input and performs no network requests. Keep v1 bytes and aliases immutable.
const root = new URL('./fonts/v1/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.fonts.length, 8);
assert(manifest.fonts.reduce((size, font) => size + font.bytes, 0) < 300_000);
export const trustedFontCss = (await Promise.all(manifest.fonts.map(async (font) => {
  assert(/^Luster (?:Serif|Sans|Script) v1$/u.test(font.family));
  assert(/^[a-z-]+\.woff2$/u.test(font.file));
  assert(['normal', 'italic'].includes(font.style));
  assert(/^\d{3}(?: \d{3,4})?$/u.test(font.weight));
  assert(/^[U+\dA-F, -]+$/u.test(font.unicodeRange));
  const bytes = await readFile(new URL(font.file, root));
  assert.equal(bytes.length, font.bytes);
  assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256);
  return `@font-face{font-family:"${font.family}";font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2");unicode-range:${font.unicodeRange}}`;
}))).join('\n');
