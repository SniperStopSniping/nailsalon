import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const nextWebpack = require('next/dist/compiled/webpack/webpack');
const { getNextPublicEnvironmentVariables } = require('next/dist/lib/static-env');
const ts = require('typescript');

nextWebpack.init();
const { webpack } = nextWebpack;

afterEach(() => vi.unstubAllEnvs());

async function compileClientEntry() {
  const folder = await mkdtemp(join(tmpdir(), 'luster-sentry-client-'));
  try {
    // Compile the real entry and privacy helper, using Next's own public env
    // definitions and webpack. Node-only imports cannot catch this regression.
    for (const file of ['sentry.client.config.ts', 'src/libs/sentry/runtime.ts']) {
      const target = join(folder, file.replace(/\.ts$/, '.js'));
      await mkdir(dirname(target), { recursive: true });
      const source = await readFile(resolve(file), 'utf8');
      await writeFile(target, ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      }).outputText);
    }
    const definitions = Object.fromEntries(
      Object.entries(getNextPublicEnvironmentVariables()).map(([key, value]) => [key, JSON.stringify(value)]),
    );
    const compiler = webpack({
      mode: 'production',
      target: 'web',
      optimization: { minimize: false },
      entry: join(folder, 'sentry.client.config.js'),
      output: { path: folder, filename: 'browser.js' },
      plugins: [new webpack.DefinePlugin(definitions)],
      // No SDK/network calls: only observe how the compiled entry configures it.
      externals: { '@sentry/nextjs': 'var __SENTRY_TEST_SDK__' },
    });
    await new Promise((resolveBuild, rejectBuild) => {
      compiler.run((error, stats) => {
        compiler.close((closeError) => {
          if (error || closeError || !stats || stats.hasErrors()) {
            rejectBuild(error || closeError || new Error(stats?.toString({ all: false, errors: true })));
          } else {
            resolveBuild();
          }
        });
      });
    });
    return await readFile(join(folder, 'browser.js'), 'utf8');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe('compiled browser Sentry startup', () => {
  it.each([
    ['configured', ' https://public@example.invalid/123 ', 'release-client-test', 'preview', true],
    ['DSN only', 'https://public@example.invalid/123', undefined, undefined, true],
    ['unconfigured', undefined, 'release-client-test', 'preview', false],
    ['blank DSN', '  ', 'release-client-test', 'preview', false],
  ])('handles %s with an empty browser process environment', async (_name, dsn, release, environment, enabled) => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn);
    vi.stubEnv('NEXT_PUBLIC_SENTRY_RELEASE', release);
    vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', environment);
    vi.stubEnv('SENTRY_AUTH_TOKEN', 'synthetic-private-build-token');

    const code = await compileClientEntry();
    const init = vi.fn();
    const replayIntegration = vi.fn(() => ({ name: 'SyntheticReplay' }));
    const browserProcess = { env: {} };
    runInNewContext(code, {
      process: browserProcess,
      __SENTRY_TEST_SDK__: { init, replayIntegration },
    }, { timeout: 5000 });

    expect(browserProcess.env).toEqual({});
    expect(code).not.toContain('synthetic-private-build-token');

    if (!enabled) {
      expect(init).not.toHaveBeenCalled();
      expect(replayIntegration).not.toHaveBeenCalled();

      return;
    }

    expect(init).toHaveBeenCalledTimes(1);
    expect(replayIntegration).toHaveBeenCalledTimes(1);
    expect(replayIntegration).toHaveBeenCalledWith({ maskAllText: true, blockAllMedia: true });

    const config = init.mock.calls[0][0];

    expect(config).toMatchObject({
      enabled: true,
      dsn: dsn.trim(),
      release,
      environment,
      tracesSampleRate: 1,
      debug: false,
      replaysOnErrorSampleRate: 1,
      replaysSessionSampleRate: 0.1,
      integrations: [{ name: 'SyntheticReplay' }],
    });

    for (const hook of [config.beforeSend, config.beforeSendTransaction]) {
      const event = hook({
        request: {
          url: 'https://example.invalid/api/public/customer-booking/submit?token=private',
          query_string: 'token=private',
          data: { message: 'private' },
          cookies: { session: 'private' },
          headers: { Authorization: 'private' },
        },
      });

      expect(event.request).toEqual({ url: 'https://example.invalid/api/public/customer-booking/submit' });
    }

    expect(config.beforeSendSpan({ data: { 'db.user': 'private', 'http.status_code': 200 } }))
      .toEqual({ data: { 'http.status_code': 200 } });
  }, 30000);
});
