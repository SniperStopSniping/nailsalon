// Kept outside *.test.* so the repository's Vitest-only changed-test selector
// does not claim this explicitly invoked Node test suite.
/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCANNER = fileURLToPath(new URL('./check-secret-leaks.mjs', import.meta.url));
const REPOSITORY_ROOT = resolve(dirname(SCANNER), '..');
const SECRET_BODY = ['Ab3Cd5Ef7Gh9Jk2L', 'm4Np6Qr8St0Uv1Wx'].join('');

function git(repository, args) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(repository, path, contents) {
  const destination = join(repository, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), 'luster-secret-scan-'));
  try {
    git(repository, ['init', '--quiet', '--initial-branch=main']);
    mkdirSync(join(repository, '.git', 'no-hooks'), { recursive: true });
    git(repository, ['config', 'core.hooksPath', '.git/no-hooks']);
    git(repository, ['config', 'commit.gpgsign', 'false']);
    git(repository, ['config', 'tag.gpgsign', 'false']);
    git(repository, ['config', 'user.name', 'Scanner Test']);
    git(repository, ['config', 'user.email', 'scanner@example.invalid']);
    write(repository, 'README.md', 'scanner test repository\n');
    git(repository, ['add', 'README.md']);
    git(repository, ['commit', '--quiet', '-m', 'test: initialize scanner fixture']);
    return repository;
  } catch (error) {
    rmSync(repository, { force: true, recursive: true });
    throw error;
  }
}

function commit(repository, message = 'test: update scanner fixture') {
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
}

function scannerEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    'SUPER_ADMIN_TEST_PHONE',
    'SUPER_ADMIN_TEST_PASSWORD',
    'E2E_SUPER_ADMIN_PHONE',
    'E2E_SUPER_ADMIN_PASSWORD',
  ]) {
    delete environment[name];
  }
  return environment;
}

function scan(repository, args = ['--tree']) {
  git(repository, ['add', '--all']);
  return spawnSync(process.execPath, [SCANNER, ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: scannerEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
  });
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function expectPass(result) {
  assert.equal(result.status, 0);
  assert.ok(
    /Secret leak scan passed/.test(output(result)),
    'scanner did not emit its sanitized success summary',
  );
}

function expectFinding(result, rule, secrets) {
  const combined = output(result);
  for (const secret of [secrets].flat()) {
    assert.equal(
      combined.includes(secret),
      false,
      'scanner output exposed forbidden fixture material',
    );
  }
  assert.equal(result.status, 1);
  assert.ok(
    new RegExp(`\\[${rule}\\]`).test(combined),
    `scanner did not emit the expected sanitized ${rule} classification`,
  );
}

function withRepository(callback) {
  const repository = createRepository();
  try {
    callback(repository);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
}

function providerSecret(prefix) {
  return `${prefix}${SECRET_BODY}`;
}

function credentialUrl(scheme, username, password, host, path = '/luster') {
  return [scheme, '://', username, ':', password, '@', host, path].join('');
}

test('detects PostgreSQL and Neon URLs with embedded credentials', () => {
  withRepository((repository) => {
    const password = `Db${SECRET_BODY}`;
    const postgres = credentialUrl('postgresql', 'app', password, 'db.example.invalid');
    const neon = credentialUrl('postgresql', 'app', password, 'ep-synthetic.neon.tech');
    write(repository, 'config/database.txt', `${postgres}\n${neon}\n`);
    const result = scan(repository);
    expectFinding(result, 'DATABASE_URL_CREDENTIALS', [password, postgres, neon]);
    assert.ok(
      /\[NEON_DATABASE_URL_CREDENTIALS\]/.test(output(result)),
      'scanner did not classify the Neon URL',
    );
  });
});

test('does not exempt a usable Docker-style database URL as a template', () => {
  withRepository((repository) => {
    const databaseUrl = credentialUrl(
      'postgresql',
      'postgres',
      'postgres',
      'db',
    );
    write(repository, 'config/docker.yml', `DATABASE_URL: ${databaseUrl}\n`);
    expectFinding(
      scan(repository),
      'DATABASE_URL_CREDENTIALS',
      databaseUrl,
    );
  });
});

test('detects Stripe and Clerk secret key formats contextually', () => {
  withRepository((repository) => {
    const stripe = providerSecret(['sk', 'live', ''].join('_'));
    const clerk = providerSecret(['sk', 'test', ''].join('_'));
    write(
      repository,
      'config/providers.env.example',
      `STRIPE_SECRET_KEY=${stripe}\nCLERK_SECRET_KEY=${clerk}\n`,
    );
    const result = scan(repository);
    expectFinding(result, 'STRIPE_SECRET_KEY', [stripe, clerk]);
    assert.ok(
      /\[CLERK_SECRET_KEY\]/.test(output(result)),
      'scanner did not classify the Clerk key',
    );
  });
});

test('detects Stripe webhook and generic webhook signing secrets', () => {
  withRepository((repository) => {
    const stripeWebhook = providerSecret(['whsec', ''].join('_'));
    const genericWebhook = `Sign${SECRET_BODY}`;
    write(
      repository,
      'config/webhooks.yml',
      `STRIPE_WEBHOOK_SECRET: ${stripeWebhook}\nWEBHOOK_SIGNING_SECRET: ${genericWebhook}\n`,
    );
    const result = scan(repository);
    expectFinding(
      result,
      'STRIPE_WEBHOOK_SIGNING_SECRET',
      [stripeWebhook, genericWebhook],
    );
    assert.ok(
      /\[WEBHOOK_SIGNING_SECRET\]/.test(output(result)),
      'scanner did not classify the generic webhook secret',
    );
  });
});

test('detects Resend, Twilio, and GitHub credentials', () => {
  withRepository((repository) => {
    const resend = providerSecret(['re', ''].join('_'));
    const twilio = 'a1'.repeat(16);
    const github = providerSecret(['ghp', ''].join('_'));
    write(
      repository,
      'config/integrations.yml',
      `RESEND_API_KEY: ${resend}\nTWILIO_AUTH_TOKEN: ${twilio}\nSOURCE_TOKEN: ${github}\n`,
    );
    const result = scan(repository);
    expectFinding(result, 'RESEND_API_KEY', [resend, twilio, github]);
    assert.ok(
      /\[TWILIO_AUTH_TOKEN\]/.test(output(result)),
      'scanner did not classify the Twilio token',
    );
    assert.ok(
      /\[GITHUB_TOKEN\]/.test(output(result)),
      'scanner did not classify the GitHub token',
    );
  });
});

test('detects Redis URLs with credentials', () => {
  withRepository((repository) => {
    const password = `Cache${SECRET_BODY}`;
    const redis = credentialUrl(
      'rediss',
      'default',
      password,
      'cache.example.invalid:6379',
      '/0',
    );
    write(repository, 'config/cache.ts', `export const cacheUrl = '${redis}';\n`);
    const result = scan(repository);
    expectFinding(result, 'REDIS_URL_CREDENTIALS', [password, redis]);
  });
});

test('detects private key blocks and never prints the key material', () => {
  withRepository((repository) => {
    const begin = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
    const end = ['-----END', 'PRIVATE KEY-----'].join(' ');
    const privateKey = `${begin}\n${SECRET_BODY}\n${end}`;
    write(repository, 'config/key.txt', `${privateKey}\n`);
    const result = scan(repository);
    expectFinding(result, 'PRIVATE_KEY_BLOCK', [privateKey, SECRET_BODY]);
  });
});

test('detects private-key material added inside a pre-existing block', () => {
  withRepository((repository) => {
    const begin = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
    const end = ['-----END', 'PRIVATE KEY-----'].join(' ');
    write(repository, 'config/range-key.txt', `${begin}\n${end}\n`);
    const base = commit(repository, 'test: establish key block context');
    write(
      repository,
      'config/range-key.txt',
      `${begin}\n${SECRET_BODY}\n${end}\n`,
    );
    commit(repository, 'test: add private-key body');
    rmSync(join(repository, 'config/range-key.txt'));
    const head = commit(repository, 'test: remove private-key fixture');
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(result, 'PRIVATE_KEY_BLOCK', SECRET_BODY);
    assert.ok(
      /commit-range/.test(output(result)),
      'private-key finding did not come from the commit range',
    );
  });
});

test('rejects every tracked runtime dotenv file and generic entropy', () => {
  withRepository((repository) => {
    const secret = `Runtime${SECRET_BODY}`;
    write(repository, '.env', `SESSION_VALUE=${secret}\n`);
    git(repository, ['add', '--force', '.env']);
    git(repository, ['commit', '--quiet', '-m', 'test: add forbidden dotenv']);
    const result = scan(repository);
    expectFinding(result, 'TRACKED_RUNTIME_DOTENV', secret);
    assert.ok(
      /\[GENERIC_SECRET_ASSIGNMENT\]/.test(output(result)),
      'scanner did not classify dotenv entropy',
    );
  });
});

test('detects a secret added to an ordinary source file', () => {
  withRepository((repository) => {
    const base = git(repository, ['rev-parse', 'HEAD']);
    const secret = `Source${SECRET_BODY}`;
    write(
      repository,
      'src/config.ts',
      `export const OAUTH_CLIENT_SECRET = '${secret}';\n`,
    );
    const head = commit(repository);
    write(repository, 'src/config.ts', 'export const OAUTH_CLIENT_SECRET = null;\n');
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(result, 'GENERIC_SECRET_ASSIGNMENT', secret);
    assert.ok(
      /commit-range/.test(output(result)),
      'ordinary-source finding did not come from the commit range',
    );
  });
});

test('detects a secret introduced through a renamed file', () => {
  withRepository((repository) => {
    const original = Array.from(
      { length: 20 },
      (_, index) => `export const safe${index} = ${index};`,
    ).join('\n');
    write(repository, 'src/old-name.ts', `${original}\n`);
    const base = commit(repository);
    renameSync(join(repository, 'src/old-name.ts'), join(repository, 'src/new-name.ts'));
    const secret = providerSecret(['gho', ''].join('_'));
    write(
      repository,
      'src/new-name.ts',
      `${original}\nexport const copied = '${secret}';\n`,
    );
    const head = commit(repository);
    assert.ok(
      /^R\d+\s+src\/old-name\.ts\s+src\/new-name\.ts$/.test(
        git(repository, ['diff', '--name-status', '-M', base, head]),
      ),
      'fixture commit was not recognized as a rename',
    );
    write(repository, 'src/new-name.ts', `${original}\n`);
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(result, 'GITHUB_TOKEN', secret);
    assert.ok(
      /src\/new-name\.ts.*commit-range/.test(output(result)),
      'renamed-file finding did not come from the commit range',
    );
  });
});

test('detects a secret committed and then removed from the final tree', () => {
  withRepository((repository) => {
    const base = git(repository, ['rev-parse', 'HEAD']);
    const secret = providerSecret(['whsec', ''].join('_'));
    write(repository, 'src/transient.ts', `export const value = '${secret}';\n`);
    commit(repository, 'test: introduce transient value');
    write(repository, 'src/transient.ts', 'export const value = null;\n');
    const head = commit(repository, 'test: remove transient value');
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(result, 'STRIPE_WEBHOOK_SIGNING_SECRET', secret);
  });
});

test('detects a secret in a file added and deleted inside the range', () => {
  withRepository((repository) => {
    const base = git(repository, ['rev-parse', 'HEAD']);
    const secret = providerSecret(['re', ''].join('_'));
    write(repository, 'src/temporary.ts', `export const value = '${secret}';\n`);
    commit(repository, 'test: add temporary file');
    rmSync(join(repository, 'src/temporary.ts'));
    const head = commit(repository, 'test: delete temporary file');
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(result, 'RESEND_API_KEY', secret);
  });
});

test('rejects a runtime dotenv file added and deleted inside the range', () => {
  withRepository((repository) => {
    const base = git(repository, ['rev-parse', 'HEAD']);
    write(repository, '.env.preview', 'APP_ENV=development\n');
    commit(repository, 'test: add forbidden runtime dotenv');
    rmSync(join(repository, '.env.preview'));
    const head = commit(repository, 'test: delete forbidden runtime dotenv');
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(result, 'TRACKED_RUNTIME_DOTENV', []);
    assert.ok(
      /commit-range/.test(output(result)),
      'transient dotenv finding did not come from the commit range',
    );
  });
});

test('does not blame unchanged pre-base material on an unrelated edit', () => {
  withRepository((repository) => {
    const legacy = providerSecret(['whsec', ''].join('_'));
    write(
      repository,
      'src/legacy.ts',
      `export const legacy = '${legacy}';\nexport const version = 1;\n`,
    );
    const base = commit(repository, 'test: establish pre-base fixture');
    write(
      repository,
      'src/legacy.ts',
      `export const legacy = '${legacy}';\nexport const version = 2;\n`,
    );
    commit(repository, 'test: edit unrelated line');
    write(
      repository,
      'src/legacy.ts',
      'export const legacy = null;\nexport const version = 2;\n',
    );
    const head = commit(repository, 'test: remove pre-base fixture');
    const result = scan(repository, ['--base', base, '--head', head]);
    assert.equal(output(result).includes(legacy), false);
    expectPass(result);
  });
});

test('detects multiline secret assignments', () => {
  withRepository((repository) => {
    const first = 'Ab3Cd5Ef7Gh9Jk2L';
    const second = 'm4Np6Qr8St0Uv1Wx';
    const secret = `${first}${second}`;
    write(
      repository,
      'config/multiline.env.example',
      `OAUTH_STATE_SECRET=\"\n${first}\n${second}\n\"\n`,
    );
    const result = scan(repository);
    expectFinding(result, 'MULTILINE_SECRET_ASSIGNMENT', [secret, first, second]);
  });
});

test('detects common typed, object, environment, and CommonJS assignments', () => {
  withRepository((repository) => {
    const typed = `Typed${SECRET_BODY}`;
    const object = `Object${SECRET_BODY}`;
    const environment = `Environment${SECRET_BODY}`;
    const commonJs = `Common${SECRET_BODY}`;
    write(
      repository,
      'src/typed.ts',
      `export const oauthClientSecret: string = '${typed}';\n`,
    );
    write(
      repository,
      'src/object.ts',
      `export default { apiToken: '${object}' };\n`,
    );
    write(
      repository,
      'src/environment.ts',
      `process.env['SERVICE_TOKEN'] = '${environment}';\n`,
    );
    write(
      repository,
      'src/common.cjs',
      `module.exports.authPassword = '${commonJs}';\n`,
    );

    const result = scan(repository);
    expectFinding(
      result,
      'GENERIC_SECRET_ASSIGNMENT',
      [typed, object, environment, commonJs],
    );
    for (const path of ['typed.ts', 'object.ts', 'environment.ts', 'common.cjs']) {
      assert.ok(
        output(result).includes(path),
        `scanner missed the sanitized assignment classification for ${path}`,
      );
    }
  });
});

test('detects a multiline TypeScript template-literal secret', () => {
  withRepository((repository) => {
    const first = 'Js3Cd5Ef7Gh9Jk2L';
    const second = 'm4Np6Qr8St0Uv1Zx';
    const secret = `${first}${second}`;
    write(
      repository,
      'src/multiline.ts',
      `const oauthStateSecret: string = \`\n${first}\n${second}\n\`;\n`,
    );
    const result = scan(repository);
    expectFinding(
      result,
      'MULTILINE_SECRET_ASSIGNMENT',
      [secret, first, second],
    );
  });
});

test('detects a secret line added inside a pre-existing multiline assignment', () => {
  withRepository((repository) => {
    const first = 'Range3Ef7Gh9Jk2L';
    const second = 'm4Np6Qr8St0Uv1Zx';
    write(
      repository,
      'src/range-multiline.ts',
      `const oauthStateSecret = \`\n${first}\n\`;\n`,
    );
    const base = commit(repository, 'test: establish multiline context');
    write(
      repository,
      'src/range-multiline.ts',
      `const oauthStateSecret = \`\n${first}\n${second}\n\`;\n`,
    );
    commit(repository, 'test: add multiline credential material');
    rmSync(join(repository, 'src/range-multiline.ts'));
    const head = commit(repository, 'test: remove multiline fixture');
    const result = scan(repository, ['--base', base, '--head', head]);
    expectFinding(
      result,
      'MULTILINE_SECRET_ASSIGNMENT',
      [`${first}${second}`, first, second],
    );
    assert.ok(
      /commit-range/.test(output(result)),
      'multiline finding did not come from the commit range',
    );
  });
});

test('accepts placeholders, reserved addresses, identifiers, hashes, and synthetic phones', () => {
  withRepository((repository) => {
    write(
      repository,
      '.env.example',
      [
        'DATABASE_URL=postgresql://example.invalid/luster',
        'OAUTH_STATE_SECRET=replace-with-random-secret',
        'RESEND_FROM_EMAIL=notifications@example.invalid',
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_publicidentifieronly',
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_publicidentifieronly',
        'NORMAL_UUID=123e4567-e89b-42d3-a456-426614174000',
        `SHA256_HASH=${'ab'.repeat(32)}`,
        `MIGRATION_HASH=${'cd'.repeat(32)}`,
        `GIT_COMMIT_SHA=${'ef'.repeat(20)}`,
        'SYNTHETIC_PHONE=+15550100100',
        '',
      ].join('\n'),
    );
    mkdirSync(join(repository, '.github/workflows'), { recursive: true });
    cpSync(
      join(REPOSITORY_ROOT, '.github/workflows/CI.yml'),
      join(repository, '.github/workflows/CI.yml'),
    );
    git(repository, ['add', '--all']);
    git(repository, ['commit', '--quiet', '-m', 'test: add safe examples']);
    expectPass(scan(repository));
  });
});

test('does not classify minified password-related UI copy as a credential', () => {
  withRepository((repository) => {
    write(repository, '.gitignore', '.next/\n');
    commit(repository, 'test: ignore generated client output');
    const localizationKeys = [
      'block_button_reset_password',
      'form_field_action_forgot_password',
      'form_password_length_too_short',
      'form_password_pwned',
      'form_password_pwned_sign_in',
      'primary_button_set_password',
    ];
    write(
      repository,
      '.next/static/chunks/localization.js',
      `const messages={${localizationKeys.map(
        key => `${key}:"Synthetic password guidance contains 12 safe words."`,
      ).join(',')}};`,
    );
    expectPass(scan(repository));

    const secret = `Adjacent${SECRET_BODY}`;
    write(
      repository,
      'src/localization.js',
      `const messages={${localizationKeys[0]}:"Synthetic password guidance contains 12 safe words."};`,
    );
    expectFinding(scan(repository), 'GENERIC_SECRET_ASSIGNMENT', []);
    rmSync(join(repository, 'src/localization.js'));

    write(
      repository,
      '.next/static/chunks/localization.js',
      `const messages={${localizationKeys[0]}:"Safe reset password copy.",password:"${secret}"};`,
    );
    expectFinding(scan(repository), 'GENERIC_SECRET_ASSIGNMENT', secret);

    write(
      repository,
      '.next/static/chunks/localization.js',
      `const messages={${localizationKeys[0]}:"${secret}"};`,
    );
    expectFinding(scan(repository), 'GENERIC_SECRET_ASSIGNMENT', secret);

    const secondSecret = `Separated${SECRET_BODY}`;
    write(
      repository,
      '.next/static/chunks/localization.js',
      `const messages={${localizationKeys[0]}:"${secret} ${secondSecret}"};`,
    );
    expectFinding(
      scan(repository),
      'GENERIC_SECRET_ASSIGNMENT',
      [secret, secondSecret],
    );

    const firstFragment = 'Js3Cd5Ef7Gh9Jk2L';
    const secondFragment = 'm4Np6Qr8St0Uv1Zx';
    write(
      repository,
      '.next/static/chunks/localization.js',
      `const formPasswordPwned = \`\n${firstFragment}\n${secondFragment}\n\`;\n`,
    );
    expectFinding(
      scan(repository),
      'MULTILINE_SECRET_ASSIGNMENT',
      [firstFragment, secondFragment],
    );

    const providerSecretValue = providerSecret(['whsec', ''].join('_'));
    write(
      repository,
      '.next/static/chunks/localization.js',
      `const messages={${localizationKeys[0]}:"${providerSecretValue}"};`,
    );
    expectFinding(
      scan(repository),
      'STRIPE_WEBHOOK_SIGNING_SECRET',
      providerSecretValue,
    );
  });
});

test('does not exempt sensitive hashes, UUIDs, or invalid public identifiers', () => {
  withRepository((repository) => {
    const sensitiveHash = [
      'a1B2c3D4e5F60718',
      '192a3B4c5D6e7F80',
      '81a2B3c4D5e6F708',
      '192A3b4C5d6E7f80',
    ].join('');
    const sensitiveUuid = [
      '123e4567',
      'e89b',
      '42d3',
      'a456',
      '426614174000',
    ].join('-');
    const invalidPublic = `Public${SECRET_BODY}`;
    write(
      repository,
      '.env.example',
      [
        `CLIENT_SECRET=${sensitiveHash}`,
        `PASSWORD=${sensitiveUuid}`,
        `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${invalidPublic}`,
        '',
      ].join('\n'),
    );
    const result = scan(repository);
    expectFinding(
      result,
      'GENERIC_SECRET_ASSIGNMENT',
      [sensitiveHash, sensitiveUuid, invalidPublic],
    );
  });
});

test('does not skip credential-shaped content beside safe example placeholders', () => {
  withRepository((repository) => {
    const secret = providerSecret(['whsec', ''].join('_'));
    write(
      repository,
      '.env.example',
      `OAUTH_STATE_SECRET=replace-with-random-secret\nADJACENT_VALUE=${secret}\n`,
    );
    expectFinding(
      scan(repository),
      'STRIPE_WEBHOOK_SIGNING_SECRET',
      secret,
    );
  });
});

test('does not trust NEXT_PUBLIC when a secret format is copied into it', () => {
  withRepository((repository) => {
    const secret = providerSecret(['sk', 'live', ''].join('_'));
    write(
      repository,
      'src/public.ts',
      `export const NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = '${secret}';\n`,
    );
    const result = scan(repository);
    expectFinding(result, 'PROVIDER_SECRET_KEY', secret);
  });
});

test('redacts a credential-shaped filename before reporting a finding', () => {
  withRepository((repository) => {
    const secret = providerSecret(['ghp', ''].join('_'));
    const path = `config/customerSecretsBackup-${secret}.txt`;
    write(repository, path, `${secret}\n`);
    const result = scan(repository);
    expectFinding(result, 'GITHUB_TOKEN', [secret, path]);
    assert.ok(
      output(result).includes('<sensitive-path>'),
      'scanner did not substitute the sensitive path marker',
    );
  });
});

test('fails closed when a tracked working-tree file cannot be read', () => {
  withRepository((repository) => {
    write(repository, 'config/tracked.txt', 'safe\n');
    commit(repository);
    rmSync(join(repository, 'config/tracked.txt'));
    const result = spawnSync(process.execPath, [SCANNER, '--tree'], {
      cwd: repository,
      encoding: 'utf8',
      env: scannerEnvironment(),
      maxBuffer: 4 * 1024 * 1024,
    });
    expectFinding(result, 'UNREADABLE_TRACKED_FILE', []);
  });
});

test('fixture allowlist is bound to exact path, key, and value', () => {
  withRepository((repository) => {
    const fixtureValue = `ScannerFixture${'9Qv7Lm2Np4Rx8Tk6'}`;
    const exactPath = 'scripts/fixtures/secret-scanner/allowed.txt';
    write(repository, exactPath, `SCANNER_FIXTURE_SECRET=${fixtureValue}\n`);
    expectPass(scan(repository));

    write(repository, exactPath, `SCANNER_FIXTURE_SECRET=${fixtureValue}A\n`);
    expectFinding(scan(repository), 'GENERIC_SECRET_ASSIGNMENT', fixtureValue);

    write(repository, exactPath, `MOVED_FIXTURE_SECRET=${fixtureValue}\n`);
    expectFinding(scan(repository), 'GENERIC_SECRET_ASSIGNMENT', fixtureValue);

    rmSync(join(repository, exactPath));
    write(
      repository,
      'scripts/fixtures/secret-scanner/moved.txt',
      `SCANNER_FIXTURE_SECRET=${fixtureValue}\n`,
    );
    expectFinding(scan(repository), 'GENERIC_SECRET_ASSIGNMENT', fixtureValue);

    rmSync(join(repository, 'scripts/fixtures/secret-scanner/moved.txt'));
    const adjacent = providerSecret(['whsec', ''].join('_'));
    write(
      repository,
      exactPath,
      `SCANNER_FIXTURE_SECRET=${fixtureValue}\nADJACENT_VALUE=${adjacent}\n`,
    );
    expectFinding(scan(repository), 'STRIPE_WEBHOOK_SIGNING_SECRET', adjacent);
  });
});

test('documentation URL allowlist is bound to its exact path and value', () => {
  withRepository((repository) => {
    const contents = readFileSync(
      join(REPOSITORY_ROOT, 'docs/TECHNICAL_SPEC.md'),
      'utf8',
    );
    const assignment = contents
      .split(/\r?\n/)
      .find(line => line.startsWith('DATABASE_URL='));
    assert.ok(assignment, 'documentation fixture assignment was not found');
    const value = assignment.slice('DATABASE_URL='.length);

    write(repository, 'docs/TECHNICAL_SPEC.md', contents);
    expectPass(scan(repository));

    rmSync(join(repository, 'docs/TECHNICAL_SPEC.md'));
    write(repository, 'docs/moved-technical-spec.md', contents);
    expectFinding(scan(repository), 'DATABASE_URL_CREDENTIALS', value);
  });
});

test('fails closed on malformed and unavailable revision input without echoing it', () => {
  withRepository((repository) => {
    const head = git(repository, ['rev-parse', 'HEAD']);
    const malformed = 'branch-name;unexpected';
    const malformedResult = scan(repository, ['--base', malformed, '--head', head]);
    assert.equal(output(malformedResult).includes(malformed), false);
    assert.equal(malformedResult.status, 2);

    const missing = 'a'.repeat(40);
    const missingResult = scan(repository, ['--base', missing, '--head', head]);
    assert.equal(output(missingResult).includes(missing), false);
    assert.equal(missingResult.status, 2);
    assert.ok(
      /fetch full history/i.test(output(missingResult)),
      'unavailable revision did not emit sanitized remediation',
    );
  });
});

test('uses the local parent range when no remote main reference exists', () => {
  withRepository((repository) => {
    const secret = providerSecret(['re', ''].join('_'));
    write(repository, 'src/local-range.ts', `export const value = '${secret}';\n`);
    commit(repository, 'test: add local-range credential');
    write(repository, 'src/local-range.ts', 'export const value = null;\n');
    const result = scan(repository, []);
    expectFinding(result, 'RESEND_API_KEY', secret);
    assert.ok(
      /commit-range/.test(output(result)),
      'no-argument scan did not inspect the local commit range',
    );
  });
});

test('rejects an explicit head that is not checked out', () => {
  withRepository((repository) => {
    const previousHead = git(repository, ['rev-parse', 'HEAD']);
    write(repository, 'README.md', 'new checked-out head\n');
    commit(repository);
    const result = scan(repository, [
      '--base',
      '0'.repeat(40),
      '--head',
      previousHead,
    ]);
    assert.equal(output(result).includes(previousHead), false);
    assert.equal(result.status, 2);
    assert.ok(
      /exact checked-out commit/.test(output(result)),
      'head mismatch did not fail with sanitized guidance',
    );
  });
});

test('supports an initial-commit range with an all-zero base', () => {
  const repository = mkdtempSync(join(tmpdir(), 'luster-secret-scan-root-'));
  try {
    git(repository, ['init', '--quiet', '--initial-branch=main']);
    mkdirSync(join(repository, '.git', 'no-hooks'), { recursive: true });
    git(repository, ['config', 'core.hooksPath', '.git/no-hooks']);
    git(repository, ['config', 'commit.gpgsign', 'false']);
    git(repository, ['config', 'tag.gpgsign', 'false']);
    git(repository, ['config', 'user.name', 'Scanner Test']);
    git(repository, ['config', 'user.email', 'scanner@example.invalid']);
    write(repository, 'README.md', 'safe initial tree\n');
    const head = commit(repository, 'test: initial commit');
    expectPass(scan(repository, ['--base', '0'.repeat(40), '--head', head]));
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('repository ignore policy keeps runtime dotenv files out and the example trackable', () => {
  const runtimeFiles = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.test',
    '.env.test.local',
    '.env.production',
    '.env.production.local',
    '.env.preview',
    '.env.preview.local',
    '.env.feature-alice',
    '.env-alice',
    '.env_alice',
    '.envalice',
    '.env.generated.secrets',
    'nested/.env',
    'nested/.env.example',
    'nested/.env.developer',
    '.secrets.local',
  ];
  for (const path of runtimeFiles) {
    const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', path], {
      cwd: REPOSITORY_ROOT,
    });
    assert.equal(result.status, 0);
  }
  const example = spawnSync(
    'git',
    ['check-ignore', '--quiet', '--no-index', '.env.example'],
    { cwd: REPOSITORY_ROOT },
  );
  assert.equal(example.status, 1);
});

test('repository tracks only the canonical dotenv example and no database secret reference', () => {
  const dotenvFiles = git(REPOSITORY_ROOT, ['ls-files', '-z'])
    .split('\0')
    .filter(path => basename(path).startsWith('.env'));
  assert.deepEqual(dotenvFiles, ['.env.example']);

  const workflows = git(REPOSITORY_ROOT, ['ls-files', '.github/workflows/*']);
  const forbidden = ['${{', ' secrets.DATABASE_URL', ' }}'].join('');
  for (const path of workflows.split(/\r?\n/).filter(Boolean)) {
    assert.equal(readFileSync(join(REPOSITORY_ROOT, path), 'utf8').includes(forbidden), false);
  }
});

test('current repository tree passes all narrowly documented allowlists', () => {
  const result = spawnSync(process.execPath, [SCANNER, '--tree'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    env: scannerEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
  });
  expectPass(result);
});
