import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

const sourcePathspecs = ['*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs'];
const ignoredPrefixes = ['docs/', 'public/', 'migrations/', 'tests/e2e/'];
const testFilePattern = /\.test\.(?:[cm]?js|jsx|tsx?)$/;
const sourceFilePattern = /\.(?:[cm]?js|jsx|tsx?)$/;
const zeroSha = /^0+$/;

function writeLine(message) {
  process.stdout.write(`${message}\n`);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readGithubRange() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (process.env.GITHUB_ACTIONS !== 'true' || !eventPath) {
    return null;
  }

  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const pullRequest = event.pull_request;

    if (pullRequest?.base?.sha && pullRequest?.head?.sha) {
      return {
        base: pullRequest.base.sha,
        head: pullRequest.head.sha,
      };
    }

    if (typeof event.before === 'string' && typeof event.after === 'string' && !zeroSha.test(event.before)) {
      return {
        base: event.before,
        head: event.after,
      };
    }
  } catch (error) {
    process.stderr.write(`Could not read GitHub event payload: ${getErrorMessage(error)}\n`);
  }

  return null;
}

function hasCommit(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getFallbackRange() {
  if (hasCommit('HEAD~1')) {
    return {
      base: 'HEAD~1',
      head: 'HEAD',
    };
  }

  return null;
}

function isCandidate(file) {
  return sourceFilePattern.test(file) && !ignoredPrefixes.some(prefix => file.startsWith(prefix));
}

function getChangedFiles(range) {
  const args = range
    ? ['diff', '--name-only', '--diff-filter=ACMR', range.base, range.head, '--', ...sourcePathspecs]
    : ['ls-files', '--', ...sourcePathspecs];

  const output = execFileSync('git', args, { encoding: 'utf8' });

  return output
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)
    .filter(isCandidate);
}

function getPossibleSiblingTests(file) {
  const extension = extname(file);
  const withoutExtension = file.slice(0, -extension.length);
  const folder = dirname(file);
  const baseName = withoutExtension.split('/').at(-1);

  return [
    `${withoutExtension}.test${extension}`,
    join(folder, `${baseName}.test.ts`),
    join(folder, `${baseName}.test.tsx`),
    join(folder, `${baseName}.test.js`),
    join(folder, `${baseName}.test.jsx`),
  ];
}

function getTestFiles(changedFiles) {
  const testFiles = new Set();

  for (const file of changedFiles) {
    if (testFilePattern.test(file)) {
      testFiles.add(file);
      continue;
    }

    for (const possibleTest of getPossibleSiblingTests(file)) {
      if (existsSync(possibleTest)) {
        testFiles.add(possibleTest);
      }
    }
  }

  return [...testFiles].sort();
}

function runVitest(testFiles) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const vitestArgs = ['vitest', 'run', ...process.argv.slice(2), ...testFiles];
  const result = spawnSync(npx, vitestArgs, { stdio: 'inherit' });

  if (result.error) {
    process.stderr.write(`Could not run vitest: ${getErrorMessage(result.error)}\n`);
    return 1;
  }

  return result.status ?? 1;
}

const range = readGithubRange() ?? getFallbackRange();
const changedFiles = getChangedFiles(range);
const testFiles = getTestFiles(changedFiles);

if (testFiles.length === 0) {
  writeLine('No changed unit tests to run.');
} else {
  writeLine('Running changed unit tests:');
  testFiles.forEach(file => writeLine(` - ${file}`));
  process.exitCode = runVitest(testFiles);
}
