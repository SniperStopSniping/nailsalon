/** Explicit local-only optimized build/HTTPS fixture. Never deploys or calls a model. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { aiTrialOrigins } from './lib/ai-trial-origins.mjs';

assert.equal(process.env.LUSTER_ISOLATED_HTTPS_CHECK, 'true', 'Explicit isolated HTTPS verification opt-in is required.');
const [mode, requestedDirectory] = process.argv.slice(2);
assert(['build', 'serve'].includes(mode));
const source = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const profile = aiTrialOrigins(true);
const inherited = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const placeholder = 'ci-placeholder-not-a-secret';
const testKey = kind => [kind, 'test', placeholder].join('_');
function databaseUrl(name) {
  assert(['luster_ai_setup_development', 'luster_e2e_ci_disposable'].includes(name));
  const url = new URL(`postgresql://127.0.0.1:55432/${name}`);
  url.username = 'luster_e2e_ci';
  url.password = ['luster', 'e2e', 'ci', 'only', 'password'].join('-');
  url.searchParams.set('application_name', 'luster-e2e-ci-disposable');
  return url.href;
}
async function attestDevelopment() {
  const client = new pg.Client({ connectionString: databaseUrl('luster_ai_setup_development') });
  await client.connect();
  try {
    assert.deepEqual((await client.query('SELECT environment FROM luster_environment LIMIT 2')).rows, [{ environment: 'development' }]);
    assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'luster_ai_setup_development');
  } finally {
    await client.end();
  }
}
const wait = child => new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
if (mode === 'build') {
  // The archive is the committed application. Uncommitted test-harness work is
  // permitted, but a dirty application/configuration cannot enter this build.
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'tools', 'prototypes', 'migrations', 'next.config.mjs', 'package.json', 'package-lock.json'], { cwd: source, stdio: 'pipe' });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  const directory = fs.mkdtempSync('/tmp/luster-ai-https-check-');
  fs.chmodSync(directory, 0o700);
  const root = path.join(directory, 'source');
  fs.mkdirSync(root, { mode: 0o700 });
  const archive = path.join(directory, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sha], { cwd: source });
  execFileSync('tar', ['-xf', archive, '-C', root]);
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const config = '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Luster isolated HTTPS check\n[ext]\nsubjectAltName=DNS:luster-builder.test,DNS:luster-render.test,IP:127.0.0.1\n';
  const configFile = path.join(directory, 'certificate.cnf');
  fs.writeFileSync(configFile, config, { mode: 0o600 });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '2', '-config', configFile], { stdio: 'pipe' });
  fs.chmodSync(path.join(directory, 'key.pem'), 0o600);
  fs.chmodSync(path.join(directory, 'cert.pem'), 0o600);
  const guard = path.join(directory, 'outbound-guard.mjs');
  fs.writeFileSync(guard, `import http from 'node:http';\nimport https from 'node:https';\nconst allowed=new Set(['localhost','127.0.0.1','::1',...(process.env.LUSTER_HTTPS_PUBLIC_FONTS==='true'?['fonts.googleapis.com','fonts.gstatic.com']:[])]);\nfunction check(input,options){let host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input?.hostname??input?.host??options?.hostname??options?.host??'localhost';host=String(host).replace(/^\\[|\\]$/g,'').replace(/:\\d+$/,'');if(!allowed.has(host))throw new Error('Isolated HTTPS check blocked outbound host');}\nconst original=globalThis.fetch;globalThis.fetch=(input,init)=>{check(input instanceof Request?input.url:input);return original(input,init);};\nfor(const m of[http,https])for(const key of['request','get']){const original=m[key];m[key]=function(input,...rest){check(input,rest[0]);return original.call(this,input,...rest);};}\n`, { mode: 0o600 });
  const canary = `ci-server-canary-${randomBytes(20).toString('hex')}`;
  fs.writeFileSync(path.join(directory, 'server-canary.txt'), canary, { mode: 0o600 });
  const metadata = { sha, source, root, gitDir: execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: source, encoding: 'utf8' }).trim(), appOrigin: profile.origin, rendererOrigin: profile.rendererOrigin, startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  const env = { ...inherited, CI: 'true', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', BILLING_PLAN_ENV: 'test', CLERK_SECRET_KEY: placeholder, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2kubHVzdGVyLmludmFsaWQk', NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in', STRIPE_SECRET_KEY: placeholder, STRIPE_WEBHOOK_SECRET: placeholder, STRIPE_CONNECT_WEBHOOK_SECRET: placeholder, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: placeholder, NEXT_PUBLIC_APP_URL: profile.origin, CUSTOM_SITE_RENDER_ORIGIN: profile.rendererOrigin, CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED: 'true', DATABASE_URL: databaseUrl('luster_e2e_ci_disposable'), LUSTER_DISPOSABLE_DATABASE: 'true', DATABASE_POOL_MAX: '2', OPENAI_API_KEY_CUSTOM_SITES: canary, LUSTER_HTTPS_PUBLIC_FONTS: 'true', NODE_OPTIONS: `--max-old-space-size=4096 --import ${guard}` };
  const log = fs.openSync(path.join(directory, 'build.log'), 'w', 0o600);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], { cwd: root, env, stdio: ['ignore', log, log] });
  process.stdout.write(`${JSON.stringify({ directory, sha, pid: child.pid, status: 'building' })}\n`);
  const result = await wait(child);
  fs.closeSync(log);
  fs.writeFileSync(path.join(directory, 'build-result.json'), JSON.stringify({ ...result, completedAt: new Date().toISOString() }), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ directory, ...result })}\n`);
  process.exitCode = result.code === 0 ? 0 : 1;
} else {
  assert.match(requestedDirectory ?? '', /^\/tmp\/luster-ai-https-check-[a-zA-Z0-9-]+$/u);
  const directory = requestedDirectory;
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'build-result.json'))).code, 0);
  assert.equal(metadata.appOrigin, profile.origin);
  assert.equal(metadata.rendererOrigin, profile.rendererOrigin);
  await attestDevelopment();
  const common = { ...inherited, NODE_ENV: 'production', LUSTER_ISOLATED_HTTPS_CHECK: 'true', LUSTER_ISOLATED_HTTPS_DIRECTORY: directory, NODE_OPTIONS: `--max-old-space-size=4096 --import ${path.join(directory, 'outbound-guard.mjs')}` };
  const appEnv = { ...common, APP_ENV: 'development', BILLING_PLAN_ENV: 'dev', DATABASE_URL: databaseUrl('luster_ai_setup_development'), DATABASE_POOL_MAX: '2', LUSTER_NONPROD_DB_HOSTS: '127.0.0.1', NEXT_PUBLIC_APP_URL: profile.origin, NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in', CLERK_SECRET_KEY: testKey('sk'), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2kubHVzdGVyLmludmFsaWQk', STRIPE_SECRET_KEY: testKey('sk'), NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: testKey('pk'), STRIPE_WEBHOOK_SECRET: ['whsec', placeholder].join('_'), STRIPE_CONNECT_WEBHOOK_SECRET: ['whsec', 'connect', placeholder].join('_'), CUSTOM_SITE_RENDER_ORIGIN: profile.rendererOrigin, CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED: 'true', CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES: 'true', BUSINESS_SETUP_AI_ENABLED: 'false', BUSINESS_SETUP_PUBLISH_ENABLED: 'true', AI_CREDITS_ENABLED: 'false', AI_CREDIT_METERING_ENABLED: 'false', AI_CREDIT_PURCHASES_ENABLED: 'false', BUSINESS_SETUP_SELF_SERVE_ENABLED: 'false', BILLING_SUBSCRIPTIONS_ENABLED: 'false', BILLING_TOPUPS_ENABLED: 'false', COMMUNICATIONS_SMS_ENABLED: 'false', SMS_PILOT_ENABLED: 'false', LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED: 'true' };
  const rendererEnv = { ...common, CUSTOM_SITE_PARENT_ORIGIN: profile.origin };
  const worker = path.join(source, 'scripts/lib/ai-https-worker.mjs');
  const logs = ['app', 'renderer', 'proxy'].map(name => fs.openSync(path.join(directory, `${name}.log`), 'a', 0o600));
  logs.forEach(log => fs.writeSync(log, `\nHTTPS check attempt ${new Date().toISOString()}\n`));
  const children = [spawn(process.execPath, [worker, 'app'], { env: appEnv, stdio: ['ignore', logs[0], logs[0]] }), spawn(process.execPath, [worker, 'renderer'], { env: rendererEnv, stdio: ['ignore', logs[1], logs[1]] }), spawn(process.execPath, [worker, 'proxy'], { env: common, stdio: ['ignore', logs[2], logs[2]] })];
  process.stdout.write(`${JSON.stringify({ directory, sha: metadata.sha, pids: children.map(child => child.pid), appOrigin: profile.origin, rendererOrigin: profile.rendererOrigin, status: 'starting', aiEnabled: false, purchasesEnabled: false })}\n`);
  const stop = () => children.forEach(child => child.kill('SIGTERM'));
  for (const child of children) {
    child.once('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM') {
        process.exitCode = 1;
      }
      stop();
    });
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const results = await Promise.all(children.map(wait));
  logs.forEach(log => fs.closeSync(log));
  process.stdout.write(`${JSON.stringify({ status: 'stopped', results })}\n`);
}
