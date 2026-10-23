import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { prepare } from './register-release-dependency-pair.mjs';
import { blobId, verifyDependencyPair } from './verify-dependency-pair.mjs';

const require = createRequire(import.meta.url);
const registryPath = 'scripts/reviewed-dependency-pairs.json';
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const lockSource = readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8');
const initialVersion = JSON.parse(packageSource).version;
const serialize = object => `${JSON.stringify(object, null, 2)}\n`;

function fixture() {
  const outer = mkdtempSync(path.join(tmpdir(), 'luster-release-pair-'));
  const cwd = path.join(outer, 'repository');
  const support = path.join(outer, 'support');
  mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  mkdirSync(support);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const file = name => path.join(cwd, name);
  const read = name => JSON.parse(readFileSync(file(name), 'utf8'));
  const write = (name, value) => writeFileSync(file(name), serialize(value));
  writeFileSync(file('package.json'), packageSource);
  writeFileSync(file('package-lock.json'), lockSource);
  writeFileSync(file('CHANGELOG.md'), '# Synthetic release fixture\n');
  writeFileSync(file('README.md'), 'Synthetic tracked fixture\n');
  for (const name of ['register-release-dependency-pair.mjs', 'verify-dependency-pair.mjs']) {
    writeFileSync(file(`scripts/${name}`), readFileSync(new URL(`./${name}`, import.meta.url)));
  }
  git('init', '-q');
  git('config', 'user.name', 'Synthetic Release Test');
  git('config', 'user.email', 'release@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  const pair = () => ({ packageJson: blobId('package.json', cwd), packageLock: blobId('package-lock.json', cwd) });
  write(registryPath, { schemaVersion: 1, pairs: [pair()] });
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'Synthetic reviewed release state');
  };
  commit();
  const bump = (version = '99.0.0') => {
    const manifest = read('package.json');
    const lock = read('package-lock.json');
    manifest.version = version;
    lock.version = version;
    lock.packages[''].version = version;
    write('package.json', manifest);
    write('package-lock.json', lock);
  };
  const register = (version = '99.0.0') => prepare({}, { cwd, nextRelease: { version } });
  return { outer, cwd, support, git, file, read, write, pair, commit, bump, register, close: () => rmSync(outer, { recursive: true, force: true }) };
}

async function withFixture(run) {
  const f = fixture();
  try {
    await run(f);
  } finally {
    f.close();
  }
}

test('registrar appends once, preserves old pairs and is repeatable before and after commit', async () => {
  await withFixture(async (f) => {
    const original = f.read(registryPath);
    f.bump();
    await f.register();
    assert.deepEqual(f.read(registryPath).pairs, [...original.pairs, f.pair()]);
    verifyDependencyPair({ cwd: f.cwd });
    const once = readFileSync(f.file(registryPath), 'utf8');
    await f.register();
    assert.equal(readFileSync(f.file(registryPath), 'utf8'), once);
    f.commit();
    await f.register();
    assert.equal(readFileSync(f.file(registryPath), 'utf8'), once);
    f.bump('99.0.1');
    await f.register('99.0.1');
    assert.equal(f.read(registryPath).pairs.length, 3);
    verifyDependencyPair({ cwd: f.cwd });
  });
});

const mutations = [
  ['dependency', (f) => {
    const p = f.read('package.json');
    p.dependencies.react = '0.0.0';
    f.write('package.json', p);
  }],
  ['script', (f) => {
    const p = f.read('package.json');
    p.scripts.build = 'false';
    f.write('package.json', p);
  }],
  ['override', (f) => {
    const p = f.read('package.json');
    p.overrides.injected = '0.0.0';
    f.write('package.json', p);
  }],
  ['lock integrity', (f) => {
    const p = f.read('package-lock.json');
    p.packages['node_modules/react'].integrity = 'sha512-synthetic';
    f.write('package-lock.json', p);
  }],
  ['lock flags', (f) => {
    const p = f.read('package-lock.json');
    p.packages['node_modules/react'].dev = true;
    f.write('package-lock.json', p);
  }],
  ['lock root version', (f) => {
    const p = f.read('package-lock.json');
    p.packages[''].version = '0.0.0';
    f.write('package-lock.json', p);
  }],
  ['registry entries', (f) => {
    const p = f.read(registryPath);
    p.pairs.push({ packageJson: 'a'.repeat(40), packageLock: 'b'.repeat(40) });
    f.write(registryPath, p);
  }],
  ['registry formatting', f => appendFileSync(f.file(registryPath), '\n')],
  ['unrelated tracked path', f => appendFileSync(f.file('README.md'), 'changed')],
  ['package file type', (f) => {
    const target = path.join(f.support, 'symlinked-package.json');
    renameSync(f.file('package.json'), target);
    symlinkSync(target, f.file('package.json'));
  }],
  ['unrelated untracked path', f => writeFileSync(f.file('unrelated.txt'), 'synthetic')],
  ['staged package', f => f.git('add', 'package.json')],
  ['registrar code', f => appendFileSync(f.file('scripts/register-release-dependency-pair.mjs'), '\n')],
  ['imported verifier code', f => appendFileSync(f.file('scripts/verify-dependency-pair.mjs'), '\n')],
];

for (const [name, mutate] of mutations) {
  test(`registrar rejects ${name} without writes or calling a downstream release step`, async () => {
    await withFixture(async (f) => {
      f.bump();
      mutate(f);
      const before = readFileSync(f.file(registryPath), 'utf8');
      let downstreamCalled = false;
      await assert.rejects(async () => {
        await f.register();
        downstreamCalled = true;
      });
      assert.equal(downstreamCalled, false);
      assert.equal(readFileSync(f.file(registryPath), 'utf8'), before);
    });
  });
}

test('registrar rejects unreviewed HEAD and inconsistent historical versions', async () => {
  for (const mutation of ['unknown pair', 'old version']) {
    await withFixture(async (f) => {
      if (mutation === 'unknown pair') {
        f.write(registryPath, { schemaVersion: 1, pairs: [{ packageJson: 'a'.repeat(40), packageLock: 'b'.repeat(40) }] });
      } else {
        const p = f.read('package-lock.json');
        p.version = '0.0.0';
        f.write('package-lock.json', p);
      }
      f.commit();
      f.bump();
      const before = readFileSync(f.file(registryPath), 'utf8');
      await assert.rejects(f.register(), /unreviewed_head|version_values/);
      assert.equal(readFileSync(f.file(registryPath), 'utf8'), before);
    });
  }
});

test('registrar requires semantic-release context as its second argument', async () => {
  await withFixture(async (f) => {
    f.bump();
    await assert.rejects(prepare({ cwd: f.cwd, nextRelease: { version: '99.0.0' } }), /next_version/);
    await f.register();
  });
});

test('real installed npm prepare produces accepted stable and prerelease version-only changes without network', async () => {
  const npmEntry = require.resolve('@semantic-release/npm');
  const moduleUrl = pathToFileURL(npmEntry).href;
  const npmBin = path.dirname(require.resolve('npm/package.json'));
  const localBin = path.resolve(npmBin, '../.bin');
  assert.equal(require('npm/package.json').version, '10.9.9');
  await withFixture(async (f) => {
    for (const version of ['99.0.0', '99.0.1-rc.1']) {
      const attempts = path.join(f.support, 'network-attempts');
      const guard = path.join(f.support, 'deny-network.cjs');
      const loaded = path.join(f.support, 'guard-loaded');
      writeFileSync(guard, `const fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(loaded)}, process.argv[1] + '\\n');\nconst deny = () => { fs.appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n'); throw Error('network forbidden'); };\nrequire('node:net').Socket.prototype.connect = deny;\nrequire('node:http').request = deny;\nrequire('node:https').request = deny;\nrequire('node:dns').lookup = deny;\nglobalThis.fetch = deny;\n`);
      const emptyConfig = path.join(f.support, 'empty.npmrc');
      writeFileSync(emptyConfig, '');
      const childScript = path.join(f.support, 'prepare-npm.mjs');
      writeFileSync(childScript, `import { PassThrough } from 'node:stream';\nimport assert from 'node:assert/strict';\nimport { prepare } from ${JSON.stringify(moduleUrl)};\nassert.equal(process.env.LUSTER_PARENT_SENTINEL, undefined);\nassert.equal(process.env.NPM_TOKEN, undefined);\nassert.equal(process.env.NODE_AUTH_TOKEN, undefined);\nassert.equal(process.env.GITHUB_TOKEN, undefined);\nconst output = new PassThrough(); output.resume();\nawait prepare({ npmPublish: false }, { cwd: ${JSON.stringify(f.cwd)}, env: process.env, stdout: output, stderr: output, nextRelease: { version: ${JSON.stringify(version)} }, logger: { log() {} } });\nprocess.stdout.write('SANITIZED_NPM_PREPARE_PASSED');\n`);
      const env = {
        PATH: `${localBin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        NODE_OPTIONS: `--require=${guard}`,
        npm_config_cache: path.join(f.support, 'cache'),
        npm_config_userconfig: emptyConfig,
        npm_config_globalconfig: emptyConfig,
        npm_config_offline: 'true',
        npm_config_update_notifier: 'false',
        npm_config_ignore_scripts: 'true',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_loglevel: 'silent',
      };
      const previousSentinel = process.env.LUSTER_PARENT_SENTINEL;
      process.env.LUSTER_PARENT_SENTINEL = 'synthetic-parent-env-must-not-reach-child';
      let child;
      try {
        child = spawnSync(process.execPath, [childScript], { cwd: f.cwd, env, encoding: 'utf8', timeout: 20_000 });
      } finally {
        if (previousSentinel === undefined) {
          delete process.env.LUSTER_PARENT_SENTINEL;
        } else {
          process.env.LUSTER_PARENT_SENTINEL = previousSentinel;
        }
      }
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout, 'SANITIZED_NPM_PREPARE_PASSED');
      assert.equal(f.read('package.json').version, version);
      assert.notEqual(version, initialVersion);
      await f.register(version);
      verifyDependencyPair({ cwd: f.cwd });
      assert.equal(existsSync(attempts), false, 'npm preparation must not attempt provider or registry access');
      assert.match(readFileSync(loaded, 'utf8'), /npm/);
      f.commit();
    }
    assert.equal(f.read(registryPath).pairs.length, 3);
  });
});
