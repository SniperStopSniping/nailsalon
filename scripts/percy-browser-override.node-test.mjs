import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'percy-browser-override-'));
const browserPath = process.env.PERCY_TEST_NODE_MODULES
  ? path.join(process.env.PERCY_TEST_NODE_MODULES, '@percy', 'core', 'dist', 'browser.js')
  : path.join(path.dirname(require.resolve('@percy/core')), 'browser.js');
const loaderPath = path.join(fixtureRoot, 'loader.mjs');
const installerPath = path.join(fixtureRoot, 'installer.mjs');
const networkGuardPath = path.join(fixtureRoot, 'network-guard.mjs');
const executablePath = path.join(fixtureRoot, 'playwright-chromium');

writeFileSync(installerPath, 'export default { chromium() { throw new Error("PERCY_INSTALLER_CALLED"); } };\n');
writeFileSync(loaderPath, `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './install.js' && context.parentURL === ${JSON.stringify(pathToFileURL(browserPath).href)}) {
    return { url: ${JSON.stringify(pathToFileURL(installerPath).href)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`);
writeFileSync(networkGuardPath, `
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const deny = () => { throw new Error('PERCY_TEST_NETWORK_DENIED'); };
net.Socket.prototype.connect = deny;
globalThis.fetch = deny;
net.connect = deny;
net.createConnection = deny;
tls.connect = deny;
http.get = deny;
http.request = deny;
https.get = deny;
https.request = deny;
`);
writeFileSync(executablePath, '#!/bin/sh\nexit 0\n');
chmodSync(executablePath, 0o755);

const childPath = path.join(fixtureRoot, 'exercise-browser.mjs');
writeFileSync(childPath, `
import fs from 'node:fs';

const { default: Browser } = await import(process.env.PERCY_TEST_BROWSER_URL);
const browser = new Browser({ config: { discovery: { launchOptions: {} } } });
browser.spawn = async function() {
  if (this.executable !== process.env.PERCY_BROWSER_EXECUTABLE) throw new Error('PERCY_OVERRIDE_NOT_SELECTED');
  throw new Error('PERCY_LOCAL_SPAWN_REACHED');
};
try {
  await browser.launch();
  throw new Error('PERCY_LAUNCH_UNEXPECTEDLY_SUCCEEDED');
} catch (error) {
  if (browser.profile) fs.rmSync(browser.profile, { recursive: true, force: true });
  if (error.message === 'PERCY_LOCAL_SPAWN_REACHED') {
    process.stdout.write(JSON.stringify({ executable: browser.executable }) + '\\n');
    process.exit(0);
  }
  process.stderr.write(String(error.message) + '\\n');
  process.exit(1);
}
`);

function run(executable) {
  return spawnSync(process.execPath, ['--no-warnings', '--import', networkGuardPath, '--experimental-loader', loaderPath, childPath], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      PERCY_BROWSER_EXECUTABLE: executable,
      PERCY_TEST_BROWSER_URL: pathToFileURL(browserPath).href,
    },
    timeout: 5_000,
  });
}

test('Percy Core selects an existing PERCY_BROWSER_EXECUTABLE before its Chromium downloader', () => {
  const result = run(executablePath);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}\n${result.signal ?? ''}`);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { executable: executablePath });
  assert.doesNotMatch(result.stderr, /PERCY_INSTALLER_CALLED/);
});

test('Percy Core reaches the installer for a missing override path', () => {
  const result = run(path.join(fixtureRoot, 'missing-browser'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PERCY_INSTALLER_CALLED/);
});

test('Percy Core reaches the installer without an override path', () => {
  const result = run('');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PERCY_INSTALLER_CALLED/);
});

test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
