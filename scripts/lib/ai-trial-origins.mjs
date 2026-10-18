import assert from 'node:assert/strict';

/** Fixed local targets only. Never point this account-bearing harness at a hosted site. */
export function aiTrialOrigins(https = false) {
  return https
    ? { https: true, origin: 'https://luster-builder.test:3443', rendererOrigin: 'https://luster-render.test:3444', cookieDomain: 'luster-builder.test', proxyServer: 'http://127.0.0.1:3445' }
    : { https: false, origin: 'http://localhost:3197', rendererOrigin: 'http://127.0.0.1:3198', cookieDomain: 'localhost' };
}

export function trialLoopbackRequest(url, profile) {
  const parsed = new URL(url);
  if (parsed.protocol === 'blob:') {
    return { kind: 'continue' };
  }
  if (!profile.https) {
    return ['localhost', '127.0.0.1'].includes(parsed.hostname) ? { kind: 'continue' } : { kind: 'blocked' };
  }
  if (![profile.origin, profile.rendererOrigin].includes(parsed.origin) || parsed.username || parsed.password) {
    return { kind: 'blocked' };
  }
  const host = parsed.host;
  parsed.hostname = '127.0.0.1';
  return { kind: 'loopback', url: parsed.href, host };
}

export async function restrictAiTrialNetwork(context, profile) {
  await context.route('**/*', async (route) => {
    const destination = trialLoopbackRequest(route.request().url(), profile);
    if (destination.kind === 'blocked') {
      return route.abort();
    }
    if (destination.kind === 'continue') {
      return route.continue();
    }
    // The fixed CONNECT proxy resolves these two hosts to loopback. Let the
    // browser send requests normally, including its own SameSite/HttpOnly
    // cookie handling. route.fetch() with a rewritten URL loses WebKit cookies.
    return route.continue();
  });
}

export function assertHttpsTrialStep(step) {
  assert(['preview', 'public-preview', 'canva-upload', 'start-editing', 'service-price', 'contact-details', 'canva-review', 'manual-wording', 'restore', 'publish', 'book', 'connection-recovery'].includes(step), 'The optimized HTTPS check uses saved real-model output and manual controls. It cannot make a new paid model request.');
}

export function trialApiTarget(path, profile) {
  const url = new URL(path, profile.origin);
  assert.equal(url.origin, profile.origin, 'A server probe must target this isolated application.');
  assert(!url.username && !url.password, 'A server probe must not carry URL credentials.');
  // BrowserContext.request and route.fetch inherit the fixed CONNECT proxy.
  // Preserve the original URL so cookies/TLS origins are resolved normally;
  // requests to a substituted IP are deliberately refused by that proxy.
  return { url: url.href, headers: {} };
}
