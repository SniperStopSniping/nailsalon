import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const twilioRequire = createRequire(require.resolve('twilio/package.json'));
const cloudinaryRequire = createRequire(require.resolve('cloudinary/package.json'));
const twilio = require('twilio');
const RequestClient = require('twilio/lib/base/RequestClient');

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('runtime dependencies resolve to the reviewed, patched lockfile versions', () => {
  for (const [loader, name, entry, minimum] of [
    [twilioRequire, 'axios', 'node_modules/twilio/node_modules/axios', [1, 20, 0]],
    [cloudinaryRequire, 'lodash', 'node_modules/cloudinary/node_modules/lodash', [4, 18, 1]],
    [require, 'form-data', 'node_modules/form-data', [4, 0, 6]],
    [require, 'nanoid', 'node_modules/nanoid', [3, 3, 18]],
    [require, 'shell-quote', 'node_modules/shell-quote', [1, 8, 5]],
    [twilioRequire, 'qs', 'node_modules/qs', [6, 16, 1]],
    [twilioRequire, 'follow-redirects', 'node_modules/follow-redirects', [1, 16, 1]],
  ]) {
    const version = loader(`${name}/package.json`).version;
    assert.equal(version, lock.packages[entry].version, `${name}: installed version must match the lock`);
    const parts = version.split('.').map(Number);
    const comparison = parts.findIndex((part, index) => part !== minimum[index]);
    assert.ok(comparison === -1 || parts[comparison] > minimum[comparison], `${name} must be patched`);
  }
});

test('qs handles object values in comma arrays without losing ordinary serialization', () => {
  const qs = twilioRequire('qs');
  for (const encodeValuesOnly of [false, true]) {
    for (const value of [{ toString: 'fixture' }, Object.assign(Object.create(null), { label: 'fixture' })]) {
      const input = { values: [value] };
      const result = qs.stringify(input, { arrayFormat: 'comma', encodeValuesOnly });
      assert.equal(decodeURIComponent(result), 'values=[object Object]');
      assert.equal(input.values[0], value);
    }
    assert.equal(decodeURIComponent(qs.stringify({ values: ['first', 'second'] }, { arrayFormat: 'comma', encodeValuesOnly })), 'values=first,second');
  }
  assert.equal(qs.stringify({ values: ['first', 'second'] }, { arrayFormat: 'repeat' }), 'values=first&values=second');
});

// Real installed SDK + Axios HTTP adapter, pointed only at a loopback server.
// Synthetic credentials never reach Twilio; no SMS is sent by these checks.
async function fixture(t, respond, timeout = 5000) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (value) => {
      body += value;
    });
    request.on('end', () => {
      requests.push({ headers: request.headers, body, method: request.method, url: request.url });
      respond(response);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const oldProxy = process.env.HTTP_PROXY;
  const oldCa = process.env.TWILIO_CA_BUNDLE;
  delete process.env.HTTP_PROXY;
  delete process.env.TWILIO_CA_BUNDLE;
  let transport;
  try {
    transport = new RequestClient({ timeout, autoRetry: false, keepAlive: false });
  } finally {
    if (oldProxy === undefined) {
      delete process.env.HTTP_PROXY;
    } else {
      process.env.HTTP_PROXY = oldProxy;
    }
    if (oldCa === undefined) {
      delete process.env.TWILIO_CA_BUNDLE;
    } else {
      process.env.TWILIO_CA_BUNDLE = oldCa;
    }
  }
  t.after(() => transport.axios.defaults.httpsAgent.destroy());
  const accountSid = `AC${'0'.repeat(32)}`;
  transport.axios.interceptors.request.use((config) => {
    const original = new URL(config.url);
    assert.equal(original.origin, 'https://api.twilio.com');
    assert.equal(original.pathname, `/2010-04-01/Accounts/${accountSid}/Messages.json`);
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.proxy, false);
    config.url = `http://127.0.0.1:${server.address().port}${original.pathname}`;
    return config;
  });
  const client = twilio(accountSid, 'synthetic-test-token', { httpClient: transport });
  return {
    requests,
    send: () => client.messages.create({
      to: '+15005550006',
      messagingServiceSid: `MG${'0'.repeat(32)}`,
      body: 'Appointment & reminder + café',
      statusCallback: 'https://callback.invalid/status?deliveryId=fixture&source=test',
    }),
  };
}

test('Twilio preserves SMS encoding, credentials, callback and accepted response', async (t) => {
  const f = await fixture(t, (res) => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sid: `SM${'0'.repeat(32)}`, status: 'queued' }));
  });
  const result = await f.send();
  assert.equal(result.sid, `SM${'0'.repeat(32)}`);
  assert.equal(result.status, 'queued');
  assert.equal(f.requests.length, 1);
  const sent = f.requests[0];
  assert.equal(sent.method, 'POST');
  assert.match(sent.headers['content-type'], /application\/x-www-form-urlencoded/);
  assert.equal(sent.headers.authorization, `Basic ${Buffer.from(`AC${'0'.repeat(32)}:synthetic-test-token`).toString('base64')}`);
  const params = new URLSearchParams(sent.body);
  assert.equal(params.get('To'), '+15005550006');
  assert.equal(params.get('MessagingServiceSid'), `MG${'0'.repeat(32)}`);
  assert.equal(params.get('Body'), 'Appointment & reminder + café');
  assert.equal(params.get('StatusCallback'), 'https://callback.invalid/status?deliveryId=fixture&source=test');
});

test('Twilio preserves coded rejection and makes only one request', async (t) => {
  const f = await fixture(t, (res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 21610, message: 'Synthetic rejection' }));
  });
  await assert.rejects(f.send(), error => error.status === 400 && error.code === 21610);
  assert.equal(f.requests.length, 1);
});

test('Twilio does not automatically retry a rate-limited send', async (t) => {
  const f = await fixture(t, (res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 20429, message: 'Synthetic rate limit' }));
  });
  await assert.rejects(f.send(), error => error.status === 429 && error.code === 20429);
  assert.equal(f.requests.length, 1);
});

test('Twilio rejects redirects instead of forwarding credentials or repeating a send', async (t) => {
  const f = await fixture(t, (res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:1/must-not-follow' });
    res.end('{}');
  });
  await assert.rejects(f.send(), error => error.status === 302);
  assert.equal(f.requests.length, 1);
});

test('Twilio preserves ambiguous timeout errors without automatically retrying', async (t) => {
  const f = await fixture(t, () => {}, 1000);
  await assert.rejects(f.send(), error => ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code));
  assert.equal(f.requests.length, 1);
});

test('multipart encoding escapes CRLF in field and file names', () => {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('field\r\nX-Injected: yes', 'fixture', { filename: 'image\r\nX-File: yes.jpg' });
  const body = form.getBuffer().toString();
  assert.ok(body.includes('field%0D%0AX-Injected: yes'));
  assert.ok(body.includes('image%0D%0AX-File: yes.jpg'));
  assert.ok(!body.includes('\r\nX-Injected:'));
  assert.ok(!body.includes('\r\nX-File:'));
});

test('Cloudinary lodash keeps normal helpers and blocks prototype traversal', () => {
  const lodash = cloudinaryRequire('lodash');
  assert.deepEqual(lodash.omit({ name: 'fixture', hidden: true }, ['hidden']), { name: 'fixture' });
  const value = Object.create({ marker: 'preserve' });
  lodash.unset(value, ['__proto__', 'marker']);
  assert.equal(value.marker, 'preserve');
  assert.deepEqual(lodash.fromPairs([['name', 'fixture']]), { name: 'fixture' });
});

test('nanoid preserves the positive fixed lengths used by application IDs', () => {
  const { nanoid } = require('nanoid');
  for (const size of [6, 16, 21]) {
    const values = Array.from({ length: 100 }, () => nanoid(size));
    assert.equal(new Set(values).size, 100);
    assert.ok(values.every(value => value.length === size && /^[\w-]+$/.test(value)));
  }
});

test('shell parsing preserves editor arguments and rejects newline operator tokens', () => {
  const shell = require('shell-quote');
  assert.deepEqual(shell.parse('code --wait "file with spaces.ts"'), ['code', '--wait', 'file with spaces.ts']);
  const args = ['file with spaces.ts', 'quote"fixture'];
  assert.deepEqual(shell.parse(shell.quote(args)), args);
  assert.throws(() => shell.quote([{ op: ';\nfixture' }]), /invalid.*op/);
});
