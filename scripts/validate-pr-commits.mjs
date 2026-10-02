import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const commitlintCli = fileURLToPath(new URL('../node_modules/@commitlint/cli/cli.js', import.meta.url));
const commitlintConfig = fileURLToPath(new URL('../commitlint.config.ts', import.meta.url));

function run(command, args, { cwd, stdio = 'pipe' } = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio,
  });
}

function assertBranchName(branch) {
  if (!/^\w[\w./-]*$/.test(branch) || branch.includes('..')) {
    throw new Error(`Refusing to fetch an invalid base branch name: ${branch}`);
  }
}

export function resolvePrOwnedCommitRange({ baseBranch, head = 'HEAD', cwd = process.cwd() }) {
  assertBranchName(baseBranch);

  const remoteBase = `refs/remotes/origin/${baseBranch}`;
  run('git', [
    'fetch',
    '--no-tags',
    'origin',
    `+refs/heads/${baseBranch}:${remoteBase}`,
  ], { cwd });

  const base = run('git', ['merge-base', head, remoteBase], { cwd }).trim();
  if (!base) {
    throw new Error(`Could not find a common ancestor for ${head} and origin/${baseBranch}.`);
  }

  const resolvedHead = run('git', ['rev-parse', '--verify', head], { cwd }).trim();
  return { base, head: resolvedHead };
}

export function validatePrOwnedCommits({ baseBranch, head = 'HEAD', cwd = process.cwd() }) {
  const range = resolvePrOwnedCommitRange({ baseBranch, head, cwd });
  process.stdout.write(`Validating commits introduced by this PR: ${range.base}..${range.head}\n`);
  run(process.execPath, [
    commitlintCli,
    '--config',
    commitlintConfig,
    '--from',
    range.base,
    '--to',
    range.head,
    '--verbose',
  ], { cwd, stdio: 'inherit' });
  return range;
}

function readArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--base-branch', '--head'].includes(name) || !value) {
      throw new Error('Usage: validate-pr-commits.mjs --base-branch <branch> [--head <sha>]');
    }
    values.set(name, value);
  }
  const baseBranch = values.get('--base-branch');
  if (!baseBranch) {
    throw new Error('Usage: validate-pr-commits.mjs --base-branch <branch> [--head <sha>]');
  }
  return { baseBranch, head: values.get('--head') ?? 'HEAD' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { baseBranch, head } = readArguments(process.argv.slice(2));
  validatePrOwnedCommits({ baseBranch, head });
}
