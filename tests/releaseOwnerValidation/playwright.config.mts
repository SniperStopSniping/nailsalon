import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
const workspace = process.env.GITHUB_WORKSPACE;
const candidateRoot = process.env.OWNER_PHASE_CANDIDATE;
if (!workspace || !candidateRoot || candidateRoot !== resolve(workspace, 'application') || !isAbsolute(candidateRoot)
  || !existsSync(`${candidateRoot}/package.json`) || lstatSync(candidateRoot).isSymbolicLink()) {
  throw new Error('OWNER_PHASE_CANDIDATE must be the physical application checkout.');
}
const { defineConfig, devices } = createRequire(`${candidateRoot}/package.json`)('@playwright/test');
const harnessDir = dirname(fileURLToPath(import.meta.url));
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp || !isAbsolute(runnerTemp)) {
  throw new Error('RUNNER_TEMP must be an absolute runner-owned directory.');
}
const evidenceRoot = resolve(runnerTemp, 'release-owner-validation-safe');
const results = process.env.FRESH_OWNER_RESULTS_PATH;
const output = process.env.FRESH_OWNER_OUTPUT_DIR;
function assertPrivateOwnedDirectory(value: string, label: string) {
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(value) !== value
    || typeof process.getuid !== 'function' || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error(`${label} must be a physical current-UID mode-0700 directory.`);
  }
}
assertPrivateOwnedDirectory(evidenceRoot, 'Safe output root');
function ownedPath(value: string | undefined) {
  if (!value || !isAbsolute(value)) {
    throw new Error('Absolute owned output path required.');
  }
  const result = resolve(value);
  const part = relative(evidenceRoot, result);
  if (!part || part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) {
    throw new Error('Output escaped designated private directory.');
  }
  // Results/output must be siblings inside one controller-created run directory.
  const runDirectory = dirname(result);
  if (dirname(runDirectory) !== evidenceRoot || !/^ci-\d{8}-[a-f0-9]{8}$/u.test(runDirectory.slice(runDirectory.lastIndexOf(sep) + 1))) {
    throw new Error('Output must be inside a controller-created CI run directory.');
  }
  assertPrivateOwnedDirectory(runDirectory, 'Run output directory');
  return result;
}
const resultsPath = ownedPath(results);
const outputPath = ownedPath(output);
const isWorker = /^\d+$/u.test(process.env.TEST_WORKER_INDEX ?? '');
if (dirname(resultsPath) !== dirname(outputPath) || !resultsPath.endsWith('/browser-results.json') || !outputPath.endsWith('/browser-output')
  || existsSync(resultsPath) || (!isWorker && existsSync(outputPath))) {
  throw new Error('Fresh result and browser output paths required.');
}
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL || !/^http:\/\/localhost:\d{2,5}$/u.test(baseURL)) {
  throw new Error('Explicit owned E2E_BASE_URL required.');
}
export default defineConfig({
  testDir: harnessDir,
  testMatch: ['fresh-owner.acceptance.ts'],
  testIgnore: ['**/history/**'],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [[resolve(harnessDir, 'safe-reporter.mts'), { outputFile: resultsPath }]],
  outputDir: outputPath,
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
    { name: 'iphone-13-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL, screenshot: 'off', trace: 'off', video: 'off', acceptDownloads: false, serviceWorkers: 'block', ignoreHTTPSErrors: false },
  // Error context includes DOM text (invited email / URLs). Never retain it.
  // The reporter also discards free-text Playwright errors and stdio.
  preserveOutput: 'never',
  captureGitInfo: { commit: false, diff: false },
});
