import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    'node_modules/@clerk/react': { integrity: 'sha512-AAAA', resolved: 'https://registry.npmjs.org/@clerk/react/-/react.tgz', version: '6.18.0' },
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
  assert.equal(result.status, 'PUBLIC_ASSIGNMENT_IDENTITY_MATCH');
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
