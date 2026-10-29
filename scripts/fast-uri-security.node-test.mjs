import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const uri = require('fast-uri');

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('the installed URI parser matches the patched compatible lock entry', () => {
  assert.equal(lock.packages['node_modules/fast-uri'].version, '3.1.9');
  assert.equal(require('fast-uri/package.json').version, '3.1.9');
  assert.equal(uri.normalize('https://Example.COM/a/../booking'), 'https://example.com/booking');
  assert.equal(uri.resolve('https://example.invalid/base/', '../booking'), 'https://example.invalid/booking');
});

test('encoded URI schemes cannot become live schemes during normalization', () => {
  for (const input of ['j%61vascript:alert(1)', 'ht%74ps://example.invalid/']) {
    assert.equal(uri.parse(input).error, 'URI scheme is malformed.');
    assert.equal(uri.normalize(input), input);
    assert.throws(() => uri.resolve('https://example.invalid/base/', input), /URI scheme is malformed/);
  }
  assert.equal(uri.parse('w%73://example.invalid/path').resourceName, undefined);
});

test('ambiguous domain hosts fail closed while valid hosts retain their meaning', () => {
  for (const input of ['https://a@b@evil.invalid/path', 'https://ev\til.invalid/path']) {
    assert.equal(uri.parse(input).error, 'URI host is malformed.');
    assert.equal(uri.normalize(input), input);
    assert.throws(() => uri.resolve('https://example.invalid/', input), /URI host is malformed/);
  }
  assert.equal(uri.normalize('https://bücher.de/'), 'https://xn--bcher-kva.de/');
});

test('relative normalization preserves the target and does not introduce an authority', () => {
  assert.equal(uri.normalize('a/../b'), 'b');
  assert.equal(uri.normalize('a/..//x'), './/x');
  assert.equal(uri.parse(uri.normalize('a/..//x')).host, undefined);
  assert.equal(uri.normalize('./a:b'), './a:b');
  assert.equal(uri.parse(uri.normalize('./a:b')).scheme, undefined);
  assert.equal(uri.resolve('https://example.invalid/base/', uri.normalize('../booking')), uri.resolve('https://example.invalid/base/', '../booking'));
});

test('suffix references escape a leading colon without changing ordinary paths', () => {
  const options = { reference: 'suffix', scheme: 'x' };
  assert.equal(uri.normalize('javascript:alert(1)', options), 'javascript%3Aalert(1)');
  assert.equal(uri.normalize('path/to/booking', options), 'path/to/booking');
  assert.equal(uri.normalize('a/b:c', options), 'a/b:c');
});

test('the installed Ajv consumer still resolves relative schema references locally', () => {
  const Ajv = require('ajv');
  const ajv = new Ajv();
  ajv.addSchema({
    $id: 'https://schemas.example.invalid/definitions/contact.json',
    definitions: { clientId: { type: 'string', pattern: '^fixture-' } },
  });
  const validate = ajv.compile({
    $id: 'https://schemas.example.invalid/schemas/booking.json',
    type: 'object',
    properties: { clientId: { $ref: '../definitions/contact.json#/definitions/clientId' } },
    required: ['clientId'],
    additionalProperties: false,
  });
  assert.equal(validate({ clientId: 'fixture-client' }), true);
  assert.equal(validate({ clientId: 3 }), false);
  assert.equal(validate({ clientId: 'wrong-prefix' }), false);
});

test('the installed schema-utils consumer keeps valid and invalid option checks', () => {
  const { validate } = require('schema-utils');
  const schema = {
    type: 'object',
    properties: { bookingUrl: { type: 'string', minLength: 1 } },
    required: ['bookingUrl'],
    additionalProperties: false,
  };
  assert.doesNotThrow(() => validate(schema, { bookingUrl: '/booking' }));
  assert.throws(() => validate(schema, { bookingUrl: 3 }), /configuration/);
});
