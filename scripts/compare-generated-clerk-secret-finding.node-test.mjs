import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { genericAssignmentFingerprints } from './check-secret-leaks.mjs';
import { collectClerkAssignmentProvenance } from './compare-generated-clerk-secret-finding.mjs';

const publicValue = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_AaBbCcDd';
const changedValue = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_DdCcBbAa';

function makeRoot(t, generated, sdkValue = publicValue) {
  const root = mkdtempSync(join(tmpdir(), 'clerk-provenance-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const sdk = join(root, 'node_modules/@clerk/react');
  mkdirSync(join(root, '.next/static'), { recursive: true });
  mkdirSync(sdk, { recursive: true });
  writeFileSync(join(root, '.next/static/chunk.js'), generated);
  const publicSource = `export const catalog = { secretKey: '${sdkValue}' };`;
  writeFileSync(join(sdk, 'public.js'), publicSource);
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@clerk/react', version: '6.18.0' }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    'node_modules/@clerk/react': { integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`, resolved: 'https://registry.npmjs.org/@clerk/react/-/react-6.18.0.tgz', version: '6.18.0' },
  } }));
  return { root, publicHash: createHash('sha256').update(publicSource).digest('hex'), sdk };
}

test('generic fingerprints are opaque and require the same key and value', () => {
  const same = genericAssignmentFingerprints('generated.js', Buffer.from(`secretKey:'${publicValue}'`), 'generated-client');
  const keyChanged = genericAssignmentFingerprints('sdk.js', Buffer.from(`otherKey:'${publicValue}'`), 'public-sdk');
  const valueChanged = genericAssignmentFingerprints('sdk.js', Buffer.from(`secretKey:'${changedValue}'`), 'public-sdk');
  assert.ok(same.length > 0);
  assert.notDeepEqual(same, keyChanged);
  assert.notDeepEqual(same, valueChanged);
  assert.equal(JSON.stringify(same).includes(publicValue), false);
});

test('provenance retains one public match and one unmatched generated identity', (t) => {
  const { root, publicHash } = makeRoot(t, `export const catalog = { secretKey: '${publicValue}', apiKey: '${changedValue}' };`);
  const result = collectClerkAssignmentProvenance(root);
  assert.equal(result.status, 'UNMATCHED_CANDIDATES');
  assert.equal(result.matchedCandidates, 1);
  assert.equal(result.unmatchedCandidates, 1);
  assert.equal(result.publicMatches[0].fileSha256, publicHash);
  assert.equal(JSON.stringify(result).includes(publicValue), false);
  assert.equal(JSON.stringify(result).includes(changedValue), false);
});

test('all public identities match without changing the scanner result', (t) => {
  const { root } = makeRoot(t, `export const catalog = { secretKey: '${publicValue}' };`);
  const result = collectClerkAssignmentProvenance(root);
  assert.equal(result.status, 'UNVERIFIED_PUBLIC_SEMANTIC_MATCH');
  assert.equal(result.generatedCandidates, 1);
  assert.equal(result.matchedCandidates, 1);
  assert.equal(result.unmatchedCandidates, 0);
  assert.match(result.qualification, /original scanner still blocks/);
});

test('lock mismatch, byte cap, and symlink inputs refuse', (t) => {
  const fixture = makeRoot(t, `secretKey:'${publicValue}'`);
  writeFileSync(join(fixture.sdk, 'package.json'), JSON.stringify({ name: '@clerk/react', version: '0.0.1' }));
  assert.throws(() => collectClerkAssignmentProvenance(fixture.root), /SDK_PACKAGE_LOCK_MISMATCH/);
  const bounded = makeRoot(t, `secretKey:'${publicValue}'`);
  assert.throws(() => collectClerkAssignmentProvenance(bounded.root, { limits: { generatedBytes: 1 } }), /INPUT_BOUND/);
  assert.throws(() => collectClerkAssignmentProvenance(bounded.root, { limits: { sdkBytes: 1 } }), /INPUT_BOUND/);
  const linked = makeRoot(t, `secretKey:'${publicValue}'`);
  symlinkSync(join(linked.root, '.next/static/chunk.js'), join(linked.root, '.next/static/link.js'));
  assert.throws(() => collectClerkAssignmentProvenance(linked.root), /SYMLINK_REFUSED/);
});

function addPackage(root, lockPath, name, version, source) {
  const directory = join(root, lockPath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }));
  writeFileSync(join(directory, 'public.js'), source);
  const lockPathname = join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPathname, 'utf8'));
  lock.packages[lockPath] = {
    version,
    integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
    resolved: `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${version}.tgz`,
  };
  writeFileSync(lockPathname, JSON.stringify(lock));
  return directory;
}

test('all exact nested Clerk lock paths are inspected and output is never attributable', (t) => {
  const { root } = makeRoot(t, `const catalog = { secretKey: '${changedValue}' };`);
  addPackage(root, 'node_modules/@clerk/react/node_modules/@clerk/shared', '@clerk/shared', '4.41.0', `export const catalog = { secretKey: '${changedValue}' };`);
  const result = collectClerkAssignmentProvenance(root);
  assert.equal(result.status, 'UNVERIFIED_PUBLIC_SEMANTIC_MATCH');
  assert.equal(result.attributable, false);
  assert.equal(result.publicSdkPackages, 2);
  assert.equal(result.publicMatches[0].package, '@clerk/shared');
  assert.equal(result.publicMatches[0].version, '4.41.0');
  assert.equal(result.publicMatches[0].line, 1);
  assert.match(result.qualification, /canonical registry tar integrity/);
});

test('static literal decoding binds raw scanner candidates to equivalent public strings', (t) => {
  for (const escape of ['plain', 'hex', 'unicode']) {
    const value = publicValue;
    const slash = String.fromCharCode(92);
    const raw = escape === 'plain'
      ? value
      : [...value].map((character, index) => index % 2
          ? character
          : slash + (escape === 'hex' ? 'x' : 'u')
            + character.charCodeAt(0).toString(16).toUpperCase().padStart(escape === 'hex' ? 2 : 4, '0')).join('');
    const generated = `export const catalog = { secretKey: '${raw}' };`;
    const { root } = makeRoot(t, generated);
    const result = collectClerkAssignmentProvenance(root);
    assert.equal(result.generatedCandidates, 1, escape);
    assert.equal(result.matchedCandidates, 1, escape);
    assert.equal(result.attributable, false);
  }
});

test('escaped quotes and backslashes in declarations decode without evaluating code', (t) => {
  for (const value of [`${publicValue}'quoted`, `${publicValue}\\suffix`]) {
    const generated = `const secretKey = ${JSON.stringify(value)};`;
    const fixture = makeRoot(t, generated);
    writeFileSync(join(fixture.sdk, 'public.js'), `export const secretKey = ${JSON.stringify(value)};`);
    const result = collectClerkAssignmentProvenance(fixture.root);
    assert.equal(result.generatedCandidates, 1);
    assert.equal(result.matchedCandidates, 1);
  }
});

test('public localization strings are considered before entropy filtering', (t) => {
  const value = 'password should contain unique characters';
  const slash = String.fromCharCode(92);
  const raw = [...value].map((character, index) => index % 2
    ? character
    : `${slash}u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join('');
  const fixture = makeRoot(t, `const password = '${raw}';`);
  writeFileSync(join(fixture.sdk, 'public.js'), `export const password = ${JSON.stringify(value)};`);
  assert.equal(genericAssignmentFingerprints('public.js', readFileSync(join(fixture.sdk, 'public.js')), 'public-sdk').length, 0);
  const result = collectClerkAssignmentProvenance(fixture.root);
  assert.equal(result.generatedCandidates, 1);
  assert.equal(result.matchedCandidates, 1);
});

test('different decoded key or value never attributes an original finding', (t) => {
  for (const source of [`export const token = '${publicValue}';`, `export const secretKey = '${changedValue}';`]) {
    const fixture = makeRoot(t, `const secretKey = '${publicValue}';`);
    writeFileSync(join(fixture.sdk, 'public.js'), source);
    const result = collectClerkAssignmentProvenance(fixture.root);
    assert.equal(result.matchedCandidates, 0);
    assert.equal(result.unmatchedCandidates, 1);
  }
});

test('templates expressions comments and string lookalikes retain unresolved scanner identities', (t) => {
  for (const generated of [
    `const secretKey = \`${publicValue}\`;`,
    `const secretKey = '${publicValue}' + suffix;`,
    `// const secretKey = '${publicValue}';`,
    `const example = "{secretKey: '${publicValue}'}";`,
  ]) {
    const fixture = makeRoot(t, generated);
    const result = collectClerkAssignmentProvenance(fixture.root);
    assert.ok(result.generatedCandidates > 0);
    assert.equal(result.matchedCandidates, 0);
    assert.equal(result.unmatchedCandidates, result.generatedCandidates);
    assert.equal(result.attributable, false);
  }
});

test('malformed generated or public JavaScript reports incomplete without parser text', (t) => {
  for (const target of ['generated', 'public']) {
    const fixture = makeRoot(t, `const secretKey = '${publicValue}';`);
    writeFileSync(target === 'generated' ? join(fixture.root, '.next/static/chunk.js') : join(fixture.sdk, 'public.js'), `const secretKey = '${publicValue}'; !!!`);
    const result = collectClerkAssignmentProvenance(fixture.root);
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.parseFailures, 1);
    assert.equal(result.matchedCandidates, 0);
    assert.equal(JSON.stringify(result).includes(publicValue), false);
  }
});

test('nested metadata mismatches and ancestor symlinks refuse without following them', (t) => {
  const fixture = makeRoot(t, `const secretKey = '${publicValue}';`);
  const nested = addPackage(fixture.root, 'node_modules/@clerk/react/node_modules/@clerk/shared', '@clerk/shared', '4.41.0', `const secretKey = '${publicValue}';`);
  writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: '@clerk/shared', version: '0.0.1' }));
  assert.throws(() => collectClerkAssignmentProvenance(fixture.root), /SDK_PACKAGE_LOCK_MISMATCH/);
  const linked = makeRoot(t, `const secretKey = '${publicValue}';`);
  addPackage(linked.root, 'node_modules/@clerk/react/node_modules/@clerk/shared', '@clerk/shared', '4.41.0', 'export {};');
  const ancestor = join(linked.sdk, 'node_modules');
  renameSync(ancestor, `${ancestor}-real`);
  symlinkSync(`${ancestor}-real`, ancestor, 'dir');
  assert.throws(() => collectClerkAssignmentProvenance(linked.root), /SYMLINK_REFUSED/);
});

test('canonical registry URL integrity output and parser bounds fail closed', (t) => {
  const fixture = makeRoot(t, `const secretKey = '${publicValue}';`);
  for (const limits of [{ astNodes: 1 }, { packages: 0 }, { outputBytes: 1 }, { identities: 0 }, { elapsedMs: -1 }]) {
    assert.throws(() => collectClerkAssignmentProvenance(fixture.root, { limits }), /BOUND|DEADLINE/);
  }
  const lock = JSON.parse(readFileSync(join(fixture.root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/@clerk/react'].resolved = 'https://example.invalid/react.tgz';
  writeFileSync(join(fixture.root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => collectClerkAssignmentProvenance(fixture.root), /SDK_PACKAGE_LOCK_MISMATCH/);
});

test('safe output excludes candidate keys values and opaque scanner identities', (t) => {
  const generated = `const secretKey = '${publicValue}';`;
  const fixture = makeRoot(t, generated);
  const result = collectClerkAssignmentProvenance(fixture.root);
  const output = JSON.stringify(result);
  for (const forbidden of [publicValue, 'secretKey', ...genericAssignmentFingerprints('.next/static/chunk.js', Buffer.from(generated), 'generated-client')]) {
    assert.equal(output.includes(forbidden), false);
  }
  assert.equal(result.attributable, false);
  assert.equal(genericAssignmentFingerprints('.next/static/chunk.js', Buffer.from(generated), 'generated-client').length, 1);
});

test('every matching public occurrence retains its own exact source line', (t) => {
  const generated = `const catalog = { secretKey: '${publicValue}', apiKey: '${changedValue}' };`;
  const fixture = makeRoot(t, generated);
  writeFileSync(join(fixture.sdk, 'public.js'), `// é
export const secretKey = '${publicValue}';
export const apiKey = '${changedValue}';`);
  const result = collectClerkAssignmentProvenance(fixture.root);
  assert.equal(result.matchedCandidates, 2);
  assert.deepEqual(result.publicMatches.map(match => match.line).sort(), [2, 3]);
});
