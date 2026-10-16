/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { readFile, writeFile } from 'node:fs/promises';

import { chromium, webkit } from 'playwright';

const root = 'docs/tutorials';
const m = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const rows = [];
for (const [name, engine, viewport] of [['desktop-chrome', chromium, {
  width: 1440,
  height: 1000,
}], ['mobile-chrome', chromium, {
  width: 390,
  height: 844,
}], ['mobile-webkit', webkit, {
  width: 390,
  height: 844,
}]]) {
  const b = await engine.launch({
    headless: true,
    ...(name.endsWith('chrome')
      ? {
          channel: 'chrome',
        }
      : {}),
  });
  try {
    const p = await b.newPage({
      viewport,
    });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto('http://127.0.0.1:3150', {
      waitUntil: 'networkidle',
    });
    if ((await p.locator('article.card').count()) !== m.tutorials.length) {
      throw new Error('Gallery missing videos');
    }
    if (!(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
      throw new Error('Horizontal overflow');
    }
    await p.screenshot({
      path: `${root}/verification/gallery-${name}.png`,
      fullPage: false,
    });
    await p.getByRole('searchbox', {
      name: 'Search tutorials',
    }).fill('no-show');
    if ((await p.locator('.card:not(.hidden)').count()) < 4) {
      throw new Error('Search failed');
    }
    await p.getByRole('searchbox', {
      name: 'Search tutorials',
    }).fill('');
    await p.getByRole('combobox', {
      name: 'Choose tutorial group',
    }).selectOption('essential');
    if ((await p.locator('.card:not(.hidden)').count()) !== 20) {
      throw new Error('Priority filter failed');
    }
    await p.getByRole('combobox', {
      name: 'Choose tutorial group',
    }).selectOption('all');
    const media = await p.evaluate(async (files) => {
      const v = document.createElement('video');
      v.id = 'media-verification';
      v.style = 'position:fixed;top:10px;left:10px;width:240px;z-index:10000';
      v.muted = true;
      v.playsInline = true;
      document.body.append(v);
      const all = [];
      for (const file of files) {
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({
            file,
            error: 'metadata timeout',
            ready: v.readyState,
            network: v.networkState,
          }), 10000);
          v.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve({
              file,
              duration: v.duration,
              width: v.videoWidth,
              height: v.videoHeight,
            });
          };
          v.onerror = () => {
            clearTimeout(timer);
            resolve({
              file,
              error: v.error?.message || 'media decode error',
            });
          };
          v.src = file;
          v.load();
        });
        all.push(result);
        if (result.error) {
          break;
        }
      }
      return all;
    }, m.tutorials.map(x => x.video));
    if (media.length !== m.tutorials.length || media.some(x => x.error || x.width !== 1080 || x.height !== 1920)) {
      throw new Error(`${name} media failed: ${JSON.stringify(media.filter(x => x.error))}`);
    }
    const played = await p.locator('#media-verification').evaluate(async (v) => {
      v.muted = true;
      await v.play();
      await new Promise(r => setTimeout(r, 800));
      const t = v.currentTime;
      v.pause();
      return t;
    });
    if (played <= 0) {
      throw new Error('Playback did not advance');
    }
    if (errors.length) {
      throw new Error('Gallery browser errors');
    }
    rows.push({
      browser: name,
      viewport,
      videoCount: media.length,
      allMetadata: 'passed',
      playback: 'passed',
      search: 'passed',
      priorityFilter: 'passed',
      horizontalOverflow: false,
    });
  } finally {
    await b.close();
  }
}
await writeFile(`${root}/verification/gallery-checks.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows));
