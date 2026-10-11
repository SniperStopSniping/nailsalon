import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import sharp from './safeSharp.server';

vi.mock('server-only', () => ({}));

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="pink"/></svg>');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function expectPatchedVersion(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);

  // GHSA-wq5f-xc86-pv6w is fixed in sharp 0.35.5 and newer.
  expect(major > 0 || minor > 35 || (minor === 35 && patch >= 5)).toBe(true);
}

describe('native upload decoder safeguards', () => {
  it.each([
    ['SVG', SVG],
    ['GIF', GIF],
  ])('refuses %s before reading native image metadata', async (_format, input) => {
    await expect(sharp(input).metadata()).rejects.toThrow();
  });

  it('refuses TIFF metadata even when the bytes are a valid image', async () => {
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f0d8dd' } }).tiff().toBuffer();

    await expect(sharp(input).metadata()).rejects.toThrow();
  });

  it.each(['jpeg', 'png', 'webp'] as const)('preserves supported %s photo decoding and conversion', async (format) => {
    const input = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#f0d8dd' } }).toFormat(format).toBuffer();

    expect(await sharp(input).metadata()).toMatchObject({ format, width: 16, height: 8 });

    const output = await sharp(input).resize({ width: 8 }).webp().toBuffer();

    expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width: 8, height: 4 });
  });

  it('runs patched native decoders for both application uploads and Next images', () => {
    const require = createRequire(import.meta.url);
    const requireFromNext = createRequire(require.resolve('next/package.json'));
    const nextSharp = requireFromNext('sharp') as typeof sharp;

    expectPatchedVersion(sharp.versions.sharp!);
    expectPatchedVersion(nextSharp.versions.sharp!);
  });

  it('locks only patched production sharp versions for deployment on every platform', () => {
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
      packages: Record<string, { version?: string; dev?: boolean }>;
    };
    // Storybook 8 embeds old Sharp JS and needs its matching, dev-only native
    // dependency. Forcing its version breaks AVIF previews. It is not shipped.
    const decoders = Object.entries(lock.packages).filter(([name, dependency]) => name.endsWith('/sharp') && !dependency.dev);

    expect(decoders.length).toBeGreaterThan(0);

    for (const [, dependency] of decoders) {
      expectPatchedVersion(dependency.version!);
    }
  });

  it('preserves Storybook AVIF image loading with its isolated development dependency', async () => {
    const input = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#f0d8dd' } }).avif().toBuffer();
    // Separate processes mirror the app and Storybook builds, avoiding two
    // native libvips versions in one process on macOS.
    const output = execFileSync(process.execPath, ['-e', `
      const path = require('node:path');
      const root = path.dirname(require.resolve('@storybook/nextjs/package.json'));
      const loader = require(path.join(root, 'dist/next-image-loader-stub.js'));
      loader.call({
        getOptions: () => ({ filename: '[name][ext]', nextConfig: { images: {} } }),
        rootContext: process.cwd(),
        resourcePath: '/fixture.avif',
        emitFile() {},
      }, Buffer.from(process.argv[1], 'base64')).then(output => {
        process.stdout.write(output);
      }).catch(error => {
        process.stderr.write(error.message);
        process.exitCode = 1;
      });
    `, input.toString('base64')], { encoding: 'utf8', timeout: 10_000 });

    expect(output).toContain('"width":16');
    expect(output).toContain('"height":8');
  });
});
