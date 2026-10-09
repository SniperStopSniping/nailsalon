import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

test('Node 24 bundled Cloudinary preserves image API contracts without legacy URL parsing', async (t) => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Run this check with Node 24 or newer');
  const sdkRoot = path.dirname(require.resolve('cloudinary/package.json'));
  const restore = [];
  for (const [object, key] of [
    [require('node:net'), 'connect'],
    [require('node:net'), 'createConnection'],
    [require('node:net').Socket.prototype, 'connect'],
    [require('node:tls'), 'connect'],
    [globalThis, 'fetch'],
    [require('node:http'), 'get'],
    [require('node:https'), 'get'],
    [require('node:http'), 'request'],
    [require('node:https'), 'request'],
  ]) {
    const original = object[key];
    restore.push(() => {
      object[key] = original;
    });
  }
  const originalCloudinaryUrl = process.env.CLOUDINARY_URL;
  delete process.env.CLOUDINARY_URL;
  t.after(() => {
    for (const undo of restore.reverse()) {
      undo();
    }
    if (originalCloudinaryUrl === undefined) {
      delete process.env.CLOUDINARY_URL;
    } else {
      process.env.CLOUDINARY_URL = originalCloudinaryUrl;
    }
  });

  // Every API request below ends at an in-memory transport. No live upload,
  // deletion or provider call is permitted. Load the exact installed request
  // source at an application-bundle path because Node excludes node_modules
  // callers from this deprecation, while Next bundles that source in production.
  const warnings = [];
  let networkAttempts = 0;
  let captured;
  let responseCase;
  const networkForbidden = () => {
    networkAttempts++;
    throw new Error('NETWORK_FORBIDDEN');
  };
  require('node:net').connect = networkForbidden;
  require('node:net').createConnection = networkForbidden;
  require('node:net').Socket.prototype.connect = networkForbidden;
  require('node:tls').connect = networkForbidden;
  globalThis.fetch = networkForbidden;
  for (const scheme of ['http', 'https']) {
    const http = require(`node:${scheme}`);
    http.get = networkForbidden;
    http.request = (options, callback) => {
      captured = { options, body: '', timeout: null, ended: false };
      const snapshot = captured;
      const requestedResponse = responseCase;
      const req = new EventEmitter();
      req.write = (value) => {
        snapshot.body += value;
        return true;
      };
      req.setTimeout = (value) => {
        snapshot.timeout = value;
        return req;
      };
      req.end = () => {
        snapshot.ended = true;
        queueMicrotask(() => {
          if (requestedResponse.networkError) {
            req.emit('error', new Error('synthetic transport failure'));
            return;
          }
          const res = new EventEmitter();
          res.statusCode = requestedResponse.status || 200;
          res.headers = requestedResponse.headers || {};
          callback(res);
          if (!requestedResponse.noBody) {
            res.emit('data', requestedResponse.body ?? '{"resources":[]}');
            res.emit('end');
          }
        });
      };
      return req;
    };
  }
  const recordWarning = warning => warnings.push(warning.code);
  process.on('warning', recordWarning);
  t.after(() => process.off('warning', recordWarning));
  const reqFromSdk = Module.createRequire(path.join(sdkRoot, 'package.json'));
  const executePath = path.join(sdkRoot, 'lib/api_client/execute_request.js');
  const bundled = new Module(fileURLToPath(new URL('./cloudinary-regression.bundle.cjs', import.meta.url)));
  bundled.filename = bundled.id;
  bundled.require = Module.createRequire(executePath);
  bundled._compile(fs.readFileSync(executePath, 'utf8'), bundled.filename);
  const originalExecuteModule = require.cache[executePath];
  require.cache[executePath] = bundled;
  t.after(() => {
    if (originalExecuteModule) {
      require.cache[executePath] = originalExecuteModule;
    } else {
      delete require.cache[executePath];
    }
  });
  const cloudinary = reqFromSdk('./').v2;
  cloudinary.config({ cloud_name: 'synthetic-fixture', api_key: 'synthetic-key', api_secret: 'synthetic-secret', upload_prefix: 'https://cloudinary.invalid', hide_sensitive: true });
  async function check(name, response, run) {
    await t.test(name, async () => {
      responseCase = response;
      captured = undefined;
      await run();
      assert.equal(networkAttempts, 0);
    });
  }
  await check('tag pagination and transport options', { body: '{"resources":[],"next_cursor":"next-page"}' }, async () => {
    const result = await cloudinary.api.resources_by_tag('pending/synthetic', { resource_type: 'image', max_results: 100, next_cursor: 'cursor+= value', timeout: 1200 });
    assert.equal(result.next_cursor, 'next-page');
    assert.equal(captured.options.hostname, 'cloudinary.invalid');
    assert.equal(captured.options.method, 'GET');
    assert.match(captured.options.path, /pending%2Fsynthetic/);
    const url = new URL(captured.options.path, 'https://cloudinary.invalid');
    assert.equal(url.searchParams.get('next_cursor'), 'cursor+= value');
    assert.equal(url.searchParams.get('max_results'), '100');
    assert.equal(captured.timeout, 1200);
    assert.equal(captured.ended, true);
  });
  await check('asset identity lookup', {}, async () => {
    const value = await cloudinary.api.resources_by_asset_ids(['asset-fixture'], { context: true, tags: true });
    assert.deepEqual(value.resources, []);
    assert.match(captured.options.path, /asset_ids/);
    assert.match(captured.options.path, /asset-fixture/);
  });
  await check('public identity lookup', {}, async () => {
    await cloudinary.api.resources_by_ids(['folder/fixture'], { context: true });
    assert.match(captured.options.path, /folder%2Ffixture/);
  });
  await check('delete request construction only', { body: '{"deleted":{"asset-fixture":"deleted"}}' }, async () => {
    const result = await cloudinary.api.delete_resources_by_asset_ids(['asset-fixture'], { resource_type: 'image' });
    assert.equal(result.deleted['asset-fixture'], 'deleted');
    assert.equal(captured.options.method, 'DELETE');
    assert.match(captured.body, /asset-fixture/);
    assert.equal(captured.options.headers['Content-Length'], Buffer.byteLength(captured.body));
  });
  await check('callback called once with resolved value', {}, async () => {
    let calls = 0;
    const value = await cloudinary.api.resources_by_tag('fixture', {}, (error, result) => {
      calls++;
      assert.equal(error, undefined);
      assert.deepEqual(result.resources, []);
    });
    assert.deepEqual(value.resources, []);
    assert.equal(calls, 1);
  });
  await check('rate-limit metadata retained', { headers: { 'x-featureratelimit-limit': '500', 'x-featureratelimit-remaining': '499', 'x-featureratelimit-reset': '2026-10-09T04:00:00Z' } }, async () => {
    const value = await cloudinary.api.resources_by_tag('fixture');
    assert.equal(value.rate_limit_allowed, 500);
    assert.equal(value.rate_limit_remaining, 499);
    assert.equal(value.rate_limit_reset_at.toISOString(), '2026-10-09T04:00:00.000Z');
  });
  for (const status of [400, 401, 403, 404, 420, 500]) {
    await check(`reject ${status} and hide credentials`, { status, body: '{"error":{"message":"synthetic error"}}' }, async () => {
      await assert.rejects(Promise.resolve(cloudinary.api.resources_by_tag('fixture')), (error) => {
        assert.equal(error.error.http_code, status);
        assert.equal(JSON.stringify(error).includes('synthetic-secret'), false);
        assert.equal(JSON.stringify(error).includes('synthetic-key'), false);
        return true;
      });
    });
  }
  await check('unexpected status rejects', { status: 502, noBody: true }, async () => {
    await assert.rejects(Promise.resolve(cloudinary.api.resources_by_tag('fixture')), error => error.http_code === 502);
  });
  await check('malformed response rejects', { body: 'not json' }, async () => {
    await assert.rejects(Promise.resolve(cloudinary.api.resources_by_tag('fixture')), error => error.error.http_code === 200);
  });
  await check('transport failure rejects', { networkError: true }, async () => {
    await assert.rejects(Promise.resolve(cloudinary.api.resources_by_tag('fixture')), /synthetic transport failure/);
  });
  await check('explicit port retained', { body: '{"ok":true}' }, async () => {
    await bundled.exports('GET', { key: 'value' }, { key: 'synthetic-key', secret: 'synthetic-secret' }, 'https://cloudinary.invalid:9443/v1_1/synthetic-fixture/resources', undefined, {});
    assert.equal(captured.options.port, '9443');
    assert.equal(captured.options.path, '/v1_1/synthetic-fixture/resources?key=value');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(networkAttempts, 0);
  assert.ok(!warnings.includes('DEP0169'), 'The bundled Cloudinary SDK still invokes deprecated URL parsing');
});
