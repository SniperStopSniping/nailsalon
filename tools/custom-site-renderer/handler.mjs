import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { trustedFontCss } from './font-pack.mjs';

const rawParent = process.env.CUSTOM_SITE_PARENT_ORIGIN;
if (!rawParent && process.env.VERCEL) {
  throw new Error('Explicit parent required');
}
const parent = new URL(rawParent || 'http://localhost:3197');
if (parent.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parent.hostname)) {
  throw new Error('HTTPS parent required');
}
const runtime = await readFile(new URL('./runtime.js', import.meta.url), 'utf8');
const boot = `const PARENT_ORIGIN=${JSON.stringify(parent.origin)};\nconst TRUSTED_FONT_CSS=${JSON.stringify(trustedFontCss)};\n${runtime}`;
const hash = createHash('sha256').update(boot).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${hash}' blob:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${parent.origin}; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Custom salon website</title></head><body><div id="site-root"></div><script>${boot}</script></body></html>`;
export default (req, res) => {
  if (!['/renderer', '/api/renderer'].includes(req.url) || req.method !== 'GET') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.end(html);
};
