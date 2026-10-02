import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolvePrOwnedCommitRange, validatePrOwnedCommits } from './validate-pr-commits.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd, subject, body) {
  const args = ['commit', '--allow-empty', '-m', subject];
  if (body) {
    args.push('-m', body);
  }
  git(cwd, ...args);
}

function configureAuthor(cwd) {
  git(cwd, 'config', 'user.name', 'CI range test');
  git(cwd, 'config', 'user.email', 'ci-range-test@example.invalid');
}

test('validates only commits introduced by the PR against the current main branch', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'luster-commitlint-range-'));
  try {
    const remote = join(temporaryDirectory, 'remote.git');
    const maintainer = join(temporaryDirectory, 'maintainer');
    const feature = join(temporaryDirectory, 'feature');
    const overlongReleaseLine = `* ${'release note '.repeat(12)}`;

    git(temporaryDirectory, 'init', '--bare', '--initial-branch=main', remote);
    git(temporaryDirectory, 'clone', remote, maintainer);
    configureAuthor(maintainer);
    commit(maintainer, 'feat: establish main');
    git(maintainer, 'push', 'origin', 'main');
    const originalMain = git(maintainer, 'rev-parse', 'HEAD');

    commit(maintainer, 'chore(release): 9.9.9 [skip ci]', overlongReleaseLine);
    git(maintainer, 'push', 'origin', 'main');
    const currentMain = git(maintainer, 'rev-parse', 'HEAD');

    git(temporaryDirectory, 'clone', remote, feature);
    configureAuthor(feature);
    git(feature, 'checkout', '-b', 'feature', originalMain);
    commit(feature, 'fix: keep the feature commit valid');
    git(feature, 'fetch', 'origin', 'main');
    git(feature, 'merge', '--no-ff', '--no-commit', 'origin/main');
    commit(feature, 'chore: synchronize current main');

    const range = resolvePrOwnedCommitRange({ baseBranch: 'main', cwd: feature });
    assert.equal(range.base, currentMain);
    assert.doesNotThrow(() => validatePrOwnedCommits({ baseBranch: 'main', cwd: feature }));

    commit(feature, 'fix: reject an invalid feature commit', overlongReleaseLine);
    assert.throws(
      () => validatePrOwnedCommits({ baseBranch: 'main', cwd: feature }),
      error => error.status === 1,
      'an invalid commit introduced by the feature branch must still fail commitlint',
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
