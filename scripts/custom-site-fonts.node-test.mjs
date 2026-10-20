import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { trustedFontCss } from '../tools/custom-site-renderer/font-pack.mjs';
import handler from '../tools/custom-site-renderer/handler.mjs';

const root = new URL('../tools/custom-site-renderer/fonts/v1/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

test('frozen font assets retain verified sizes, checksums, official sources and licenses', async () => {
  assert(manifest.fonts.reduce((size, font) => size + font.bytes, 0) < 300_000);
  for (const font of manifest.fonts) {
    const bytes = await readFile(new URL(font.file, root));
    assert.equal(bytes.length, font.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256);
    assert.equal(new URL(font.source).origin, 'https://fonts.gstatic.com');
    assert(manifest.licenses.some(license => license.family === font.family));
  }
  for (const license of manifest.licenses) {
    const bytes = await readFile(new URL(license.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), license.sha256);
    assert.match(bytes.toString(), /SIL OPEN FONT LICENSE Version 1\.1/u);
    assert.match(bytes.toString(), /Copyright/u);
  }
});

test('generation guidance names all bundled families without sending their binary bytes', async () => {
  const prompt = await readFile(new URL('../src/features/custom-sites/prompt.ts', import.meta.url), 'utf8');
  for (const family of new Set(manifest.fonts.map(font => font.family))) {
    assert(prompt.includes(family));
  }
  assert(!prompt.includes('data:font/'));
});

test('fonts are embedded in the hashed trusted boot, with no remote font or network capability', () => {
  let headers;
  let html;
  handler({ method: 'GET', url: '/renderer' }, {
    writeHead: (status, value) => {
      assert.equal(status, 200);
      headers = value;
    },
    end: value => html = value,
  });
  const boot = html.match(/<script>([\s\S]+)<\/script>/u)[1];
  const digest = createHash('sha256').update(boot).digest('base64');
  assert(headers['Content-Security-Policy'].includes(`script-src 'sha256-${digest}';`));
  assert(headers['Content-Security-Policy'].includes('worker-src data:;'));
  assert(!headers['Content-Security-Policy'].includes('blob:'));
  assert(!headers['Content-Security-Policy'].includes('unsafe-eval'));
  assert(headers['Content-Security-Policy'].includes('font-src data:;'));
  for (const capability of ['connect-src', 'frame-src', 'object-src', 'form-action', 'base-uri']) {
    assert(headers['Content-Security-Policy'].includes(`${capability} 'none'`));
  }
  assert.match(headers['Content-Security-Policy'], /sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox$/u);
  assert(!headers['Content-Security-Policy'].includes('allow-same-origin'));
  assert(!html.includes('https://fonts.'));
  assert.equal([...trustedFontCss.matchAll(/url\(/gu)].length, manifest.fonts.length);
  assert.equal([...trustedFontCss.matchAll(/url\(data:font\/woff2;base64,/gu)].length, manifest.fonts.length);
  assert(boot.includes(JSON.stringify(trustedFontCss)));
});
