/** Trusted application/static-renderer processes for the loopback HTTPS check. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { developmentClerkConfig } from './ai-trial-auth.mjs';
import { aiTrialOrigins } from './ai-trial-origins.mjs';
import { createAiTrialProxy } from './ai-trial-proxy.mjs';

assert.equal(process.env.LUSTER_ISOLATED_HTTPS_CHECK, 'true');
const directory = process.env.LUSTER_ISOLATED_HTTPS_DIRECTORY;
assert.match(directory ?? '', /^\/tmp\/luster-ai-https-check-[a-zA-Z0-9-]+$/u);
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json')));
const profile = aiTrialOrigins(true);
const mode = process.argv[2];
assert(['app', 'renderer', 'proxy'].includes(mode));
const realClerk = metadata.authProfile === 'clerk-development';
const clerkFrontendApi = process.env.LUSTER_HTTPS_CLERK_FRONTEND_API;
if (mode !== 'renderer' && realClerk) {
  assert.equal(clerkFrontendApi, metadata.clerkFrontendApi);
  assert.match(clerkFrontendApi, /^[a-z0-9-]+\.clerk\.accounts\.dev$/u);
} else {
  assert.equal(clerkFrontendApi, undefined);
}
const origin = new URL(mode === 'app' ? profile.origin : mode === 'renderer' ? profile.rendererOrigin : profile.proxyServer);
let handler;
let app;
if (mode === 'app') {
  assert.equal(process.env.APP_ENV, 'development');
  assert.equal(process.env.BILLING_PLAN_ENV, 'dev');
  assert.equal(process.env.BUSINESS_SETUP_AI_ENABLED, 'false');
  assert.equal(process.env.AI_CREDITS_ENABLED, 'false');
  assert.equal(process.env.AI_CREDIT_PURCHASES_ENABLED, 'false');
  assert.equal(process.env.OPENAI_API_KEY_CUSTOM_SITES, undefined);
  if (realClerk) {
    assert.equal(developmentClerkConfig().frontendApi, clerkFrontendApi);
  } else {
    assert(process.env.CLERK_SECRET_KEY?.endsWith('ci-placeholder-not-a-secret'));
  }
  assert(process.env.STRIPE_SECRET_KEY?.endsWith('ci-placeholder-not-a-secret'));
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/luster_ai_setup_development');
  process.chdir(metadata.root);
  const require = createRequire(path.join(metadata.root, 'package.json'));
  app = require('next')({ dev: false, dir: metadata.root, hostname: origin.hostname, port: Number(origin.port) });
  await app.prepare();
  handler = app.getRequestHandler();
} else {
  for (const key of ['DATABASE_URL', 'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'OPENAI_API_KEY_CUSTOM_SITES', 'RESEND_API_KEY', 'TWILIO_AUTH_TOKEN']) {
    assert.equal(process.env[key], undefined, 'The static renderer cannot inherit application credentials.');
  }
  if (mode === 'renderer') {
    handler = (await import(pathToFileURL(path.join(metadata.root, 'tools/custom-site-renderer/handler.mjs')).href)).default;
  }
}
const server = mode === 'proxy'
  ? createAiTrialProxy(profile, clerkFrontendApi)
  : https.createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) }, (request, response) => {
    if (request.headers.host !== origin.host) {
      response.writeHead(421);
      response.end();
      return;
    }
    // The listener is HTTPS-only on loopback. Next's request URL must retain the
    // same external origin used by the browser's authenticated POST requests.
    request.headers['x-forwarded-proto'] = 'https';
    request.headers['x-forwarded-host'] = origin.host;
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
  });
server.listen(Number(origin.port), '127.0.0.1', () => process.stdout.write(`${mode} ready on ${origin.origin}\n`));
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(async () => {
    await app?.close();
    process.exit(0);
  });
});
