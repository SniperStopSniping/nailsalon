import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const lintPathspecs = ['*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs'];
const ignoredPrefixes = ['docs/', 'public/', 'migrations/', 'tests/e2e/'];
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

function isLintable(file) {
  return !ignoredPrefixes.some(prefix => file.startsWith(prefix));
}

function getCandidateFiles(range) {
  const args = range
    ? ['diff', '--name-only', '--diff-filter=ACMR', range.base, range.head, '--', ...lintPathspecs]
    : ['ls-files', '--', ...lintPathspecs];

  const output = execFileSync('git', args, { encoding: 'utf8' });

  return output
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)
    .filter(isLintable);
}

function lint(files) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['eslint', ...files], { stdio: 'inherit' });

  if (result.error) {
    process.stderr.write(`Could not run eslint: ${getErrorMessage(result.error)}\n`);
    return 1;
  }

  return result.status ?? 1;
}

const range = readGithubRange() ?? getFallbackRange();
const files = getCandidateFiles(range);

if (files.length === 0) {
  writeLine('No changed source files to lint.');
} else {
  writeLine('Linting changed source files:');
  files.forEach(file => writeLine(` - ${file}`));
  process.exitCode = lint(files);
}
