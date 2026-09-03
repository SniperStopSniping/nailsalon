import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  expect,
  type Locator,
  type Page,
  test,
  type TestInfo,
} from '@playwright/test';

import {
  chooseStarter,
  CUSTOM_DESIGN_ASSET_DB_NAME,
  documentSurfaceState,
  LAB_STORAGE_KEY,
  openFreshLab,
  readCustomDesignAssetRecordCounts,
  waitForSaved,
} from '../e2e/helpers';

const ORIGINAL_STORE = 'image-asset-originals-v1';
const SUMMARY_STORE = 'image-asset-summaries-v1';
const THUMBNAIL_STORE = 'image-asset-thumbnails-v1';

// A tiny original test swatch, used only by engines that can decode WebP but
// cannot encode it from canvas (the installed Playwright WebKit 18.0 build).
const WEBP_TEST_SWATCH_BASE64
  = 'UklGRhoCAABXRUJQVlA4WAoAAAAgAAAADwAADwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggLAAAAHABAJ0BKhAAEAAAwBIloAJ0AYhAAP7Y7pV6vMq//ID//8gP//yA//jyAAAA';

type TestArtwork = {
  buffer: Buffer;
  mimeType: string;
  name: string;
};

type BlobCapability = {
  errorMessage?: string;
  errorName?: string;
  supported: boolean;
};

type RawBinarySummary = {
  assetId: string;
  byteSize: number;
  isArrayBuffer: boolean;
  isBlob: boolean;
  kind: 'array_buffer' | 'blob' | 'unknown';
  mimeType: string;
};

type RawAssetSnapshot = {
  counts: Record<string, number>;
  originals: RawBinarySummary[];
  summaries: Array<{
    assetId: string;
    byteSize: number;
    mimeType: string;
    state: string;
    thumbnailByteSize?: number;
    thumbnailMimeType?: string;
  }>;
  thumbnails: RawBinarySummary[];
};

type UrlAudit = {
  created: number;
  live: string[];
  revoked: number;
};

type RuntimeAudit = {
  assertClean: () => Promise<void>;
  stop: () => void;
};

async function createArtwork(
  page: Page,
  options: {
    format: 'jpeg' | 'png' | 'webp';
    height: number;
    hue: number;
    name: string;
    width: number;
  },
): Promise<TestArtwork> {
  const requestedMime = options.format === 'jpeg'
    ? 'image/jpeg'
    : `image/${options.format}`;
  const encoded = await page.evaluate(async ({ height, hue, mimeType, width }) => {
    const canvas = document.createElement('canvas');
    canvas.height = height;
    canvas.width = width;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas is unavailable.');
    }
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${hue} 70% 90%)`);
    gradient.addColorStop(1, `hsl(${(hue + 45) % 360} 58% 60%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff8fc';
    context.fillRect(width * 0.1, height * 0.1, width * 0.8, height * 0.18);
    context.fillStyle = '#30232d';
    context.font = `700 ${Math.round(width * 0.08)}px system-ui`;
    context.textAlign = 'center';
    context.fillText('LUSTER', width / 2, height * 0.21);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        candidate => candidate
          ? resolve(candidate)
          : reject(new Error(`Could not encode ${mimeType}.`)),
        mimeType,
        0.88,
      );
    });
    return {
      bytes: [...new Uint8Array(await blob.arrayBuffer())],
      mimeType: blob.type,
    };
  }, {
    height: options.height,
    hue: options.hue,
    mimeType: requestedMime,
    width: options.width,
  });
  if (options.format === 'webp' && encoded.mimeType !== requestedMime) {
    return {
      buffer: Buffer.from(WEBP_TEST_SWATCH_BASE64, 'base64'),
      mimeType: requestedMime,
      name: options.name,
    };
  }

  expect(encoded.mimeType).toBe(requestedMime);

  return {
    buffer: Buffer.from(encoded.bytes),
    mimeType: requestedMime,
    name: options.name,
  };
}

async function installObjectUrlAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      created: 0,
      live: new Set<string>(),
      revoked: 0,
    };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob): string => {
      const url = create(blob);
      state.created += 1;
      state.live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      state.revoked += 1;
      state.live.delete(url);
      revoke(url);
    };
    Object.defineProperty(window, '__customDesignUrlAudit', {
      configurable: true,
      value: state,
    });
  });
}

async function readUrlAudit(page: Page): Promise<UrlAudit> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __customDesignUrlAudit: {
        created: number;
        live: Set<string>;
        revoked: number;
      };
    }).__customDesignUrlAudit;
    return {
      created: state.created,
      live: [...state.live],
      revoked: state.revoked,
    };
  });
}

function startRuntimeAudit(page: Page): RuntimeAudit {
  const issues: string[] = [];
  const notices: string[] = [];
  const onConsole = (message: { text: () => string; type: () => string }) => {
    if (message.type() !== 'error' && message.type() !== 'warning') {
      return;
    }
    const value = `console.${message.type()}: ${message.text()}`;
    if (/ResizeObserver loop/i.test(value)) {
      notices.push(value);
    } else {
      issues.push(value);
    }
  };
  const onPageError = (error: Error) => {
    const value = `pageerror: ${error.message}`;
    if (/ResizeObserver loop/i.test(value)) {
      notices.push(value);
    } else {
      issues.push(value);
    }
  };
  const onRequestFailed = (request: { failure: () => { errorText?: string } | null; method: () => string; url: () => string }) => {
    issues.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim(),
    );
  };
  const onResponse = (response: { request: () => { method: () => string }; status: () => number; url: () => string }) => {
    if (response.status() < 400) {
      return;
    }
    const currentUrl = page.url();
    if (
      currentUrl.startsWith('http')
      && new URL(response.url()).origin === new URL(currentUrl).origin
    ) {
      issues.push(
        `response.${response.status()}: ${response.request().method()} ${response.url()}`,
      );
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  return {
    assertClean: async () => {
      expect(issues, 'unexpected browser runtime issues').toEqual([]);

      await attachJson(test.info(), 'runtime-notices.json', notices);
    },
    stop: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}

async function probeBlobStorage(page: Page): Promise<BlobCapability> {
  return page.evaluate(async () => {
    const dbName = `luster-webkit-blob-probe-${Date.now()}`;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('probe', {
        keyPath: 'id',
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    let result: BlobCapability;
    try {
      result = await new Promise<BlobCapability>((resolve) => {
        const transaction = database.transaction('probe', 'readwrite');
        transaction.oncomplete = () => resolve({ supported: true });
        transaction.onabort = () => resolve({
          errorMessage: transaction.error?.message,
          errorName: transaction.error?.name,
          supported: false,
        });
        try {
          const request = transaction.objectStore('probe').add({
            id: 'blob',
            payload: new Blob([new Uint8Array(64)], { type: 'image/png' }),
          });
          request.onerror = () => resolve({
            errorMessage: request.error?.message,
            errorName: request.error?.name,
            supported: false,
          });
        } catch (error) {
          const failure = error as DOMException;
          result = {
            errorMessage: failure.message,
            errorName: failure.name,
            supported: false,
          };
          try {
            transaction.abort();
          } catch {
            // A synchronous structured-clone error can already abort the transaction.
          }
          resolve(result);
        }
      });
    } finally {
      database.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
    return result;
  });
}

async function readRawAssetSnapshot(page: Page): Promise<RawAssetSnapshot> {
  return page.evaluate(async ({ databaseName, originalStore, summaryStore, thumbnailStore }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const rows = await new Promise<Record<string, unknown>[][]>((resolve, reject) => {
        const stores = [summaryStore, originalStore, thumbnailStore];
        const transaction = database.transaction(stores, 'readonly');
        const requests = stores.map(store =>
          transaction.objectStore(store).getAll() as IDBRequest<Record<string, unknown>[]>);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => resolve(requests.map(request => request.result));
      });
      const [summaryRows = [], originalRows = [], thumbnailRows = []] = rows;
      const binary = (row: Record<string, unknown>): RawBinarySummary => {
        const blob = row.blob;
        const data = row.data;
        const isBlob = blob instanceof Blob;
        const isArrayBuffer = data instanceof ArrayBuffer;
        return {
          assetId: String(row.assetId ?? ''),
          byteSize: isBlob
            ? blob.size
            : isArrayBuffer
              ? data.byteLength
              : -1,
          isArrayBuffer,
          isBlob,
          kind: row.storageKind === 'array_buffer'
            ? 'array_buffer'
            : isBlob
              ? 'blob'
              : 'unknown',
          mimeType: isBlob ? blob.type : String(row.mimeType ?? ''),
        };
      };
      return {
        counts: {
          [summaryStore]: summaryRows.length,
          [originalStore]: originalRows.length,
          [thumbnailStore]: thumbnailRows.length,
        },
        originals: originalRows.map(binary),
        summaries: summaryRows.map((row) => {
          const metadata = row.metadata as Record<string, unknown>;
          const thumbnail = metadata.thumbnail as Record<string, unknown> | undefined;
          return {
            assetId: String(metadata.id ?? ''),
            byteSize: Number(metadata.byteSize ?? -1),
            mimeType: String(metadata.mimeType ?? ''),
            state: String(row.state ?? ''),
            ...(thumbnail
              ? {
                  thumbnailByteSize: Number(thumbnail.byteSize ?? -1),
                  thumbnailMimeType: String(thumbnail.mimeType ?? ''),
                }
              : {}),
          };
        }),
        thumbnails: thumbnailRows.map(binary),
      };
    } finally {
      database.close();
    }
  }, {
    databaseName: CUSTOM_DESIGN_ASSET_DB_NAME,
    originalStore: ORIGINAL_STORE,
    summaryStore: SUMMARY_STORE,
    thumbnailStore: THUMBNAIL_STORE,
  });
}

function assertSnapshotIntegrity(
  snapshot: RawAssetSnapshot,
  capability: BlobCapability,
  requirePreferredBlobPath: boolean,
): void {
  const summaryIds = snapshot.summaries.map(summary => summary.assetId).sort();

  expect(new Set(summaryIds).size).toBe(summaryIds.length);
  expect(snapshot.originals.map(record => record.assetId).sort()).toEqual(summaryIds);
  expect(snapshot.thumbnails.map(record => record.assetId).sort()).toEqual(summaryIds);
  expect(snapshot.summaries.every(summary => summary.state === 'committed')).toBe(true);

  for (const summary of snapshot.summaries) {
    const original = snapshot.originals.find(record => record.assetId === summary.assetId);
    const thumbnail = snapshot.thumbnails.find(record => record.assetId === summary.assetId);

    expect(original).toMatchObject({
      byteSize: summary.byteSize,
      mimeType: summary.mimeType,
    });
    expect(thumbnail).toMatchObject({
      byteSize: summary.thumbnailByteSize,
      mimeType: summary.thumbnailMimeType,
    });
  }
  const binaryRecords = [...snapshot.originals, ...snapshot.thumbnails];

  expect(
    binaryRecords.every(record =>
      record.kind === 'blob' || record.kind === 'array_buffer'),
  ).toBe(true);

  if (requirePreferredBlobPath) {
    expect(capability.supported).toBe(true);
    expect(binaryRecords.every(record => record.kind === 'blob')).toBe(true);
    expect(binaryRecords.every(record => record.isBlob)).toBe(true);
  } else if (!capability.supported) {
    expect(capability).toMatchObject({ errorName: 'DataCloneError' });
    expect(binaryRecords.every(record => record.kind === 'array_buffer')).toBe(true);
    expect(binaryRecords.every(record => record.isArrayBuffer)).toBe(true);
  }
}

function customDesignCard(page: Page): Locator {
  return page.locator('[data-section-type="custom_design"][data-section-instance-id]');
}

function customDesignSettings(page: Page): Locator {
  return page
    .getByRole('dialog', { name: 'Custom Design settings' })
    .or(page.getByRole('dialog', { name: 'Custom Design', exact: true }));
}

async function addCustomDesign(page: Page): Promise<Locator> {
  const insertion = page.locator('button.final-insertion:visible').last();
  if (await insertion.isVisible()) {
    await insertion.click();
  } else {
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
  }
  const library = page.getByRole('dialog', { name: 'Add section' });
  await library.getByRole('searchbox', { name: 'Search sections' }).fill('Canva');
  await library.getByRole('button', { name: 'Add Custom Design' }).click();
  const card = customDesignCard(page);

  await expect(card).toHaveCount(1);
  await expect(customDesignSettings(page)).toBeVisible();

  return card;
}

async function closeSettings(page: Page): Promise<void> {
  const settings = customDesignSettings(page);
  const close = settings.getByRole('button', {
    name: /Close Custom Design(?: settings)?/,
  });
  await close.click();

  await expect(settings).toHaveCount(0);
}

async function openSettings(page: Page): Promise<Locator> {
  const card = customDesignCard(page);
  if (await card.getAttribute('data-selected') !== 'true') {
    await card.locator('.section-card__select-surface').click();
  }
  const back = page.getByRole('button', { name: 'Back to Custom Design' });
  if (await back.isVisible()) {
    await back.click();
  }
  const edit = page.locator('[data-custom-design-settings-trigger-for]:visible');
  await edit.click();

  await expect(customDesignSettings(page)).toBeVisible();

  return customDesignSettings(page);
}

async function enterPreview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();

  const images = page
    .locator('[data-section-type="custom_design"]')
    .locator('.custom-design-customer-image');

  await expect(images).toHaveCount(3);

  for (let index = 0; index < 3; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();

    await expect.poll(() => image.evaluate((element) => {
      const candidate = element as HTMLImageElement;
      return candidate.complete && candidate.naturalWidth > 0 && candidate.naturalHeight > 0;
    })).toBe(true);
  }
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const body = JSON.stringify(value, null, 2);
  await testInfo.attach(name, {
    body: Buffer.from(body),
    contentType: 'application/json',
  });
  const evidenceDirectory = process.env.LUSTER_STORAGE_EVIDENCE_DIR;
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(evidenceDirectory, `${testInfo.project.name}-${name}`),
      `${body}\n`,
      'utf8',
    );
  }
}

test('keeps Blob storage preferred and falls back safely when WebKit cannot clone it', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  await installObjectUrlAudit(page);
  await page.setViewportSize({ height: 844, width: 390 });
  const runtime = startRuntimeAudit(page);

  try {
    await openFreshLab(page);
    const capability = await probeBlobStorage(page);
    const requirePreferredBlobPath = testInfo.project.name === 'chromium-storage';
    await attachJson(testInfo, 'indexeddb-blob-capability.json', capability);
    await chooseStarter(page, 'Quick Book');
    const files = await Promise.all([
      createArtwork(page, {
        format: 'png',
        height: 900,
        hue: 330,
        name: 'webkit-page.png',
        width: 600,
      }),
      createArtwork(page, {
        format: 'jpeg',
        height: 1_000,
        hue: 25,
        name: 'webkit-page.jpg',
        width: 700,
      }),
      createArtwork(page, {
        format: 'webp',
        height: 800,
        hue: 275,
        name: 'webkit-page.webp',
        width: 640,
      }),
    ]);
    const card = await addCustomDesign(page);
    await card.locator('input[type="file"][multiple]').setInputFiles(files);

    await expect(card.locator('.custom-design-image-frame')).toHaveCount(3, {
      timeout: 30_000,
    });
    await expect(card.getByText(/could not be staged/i)).toHaveCount(0);

    await waitForSaved(page);

    let snapshot = await readRawAssetSnapshot(page);
    assertSnapshotIntegrity(snapshot, capability, requirePreferredBlobPath);

    expect(snapshot.summaries).toHaveLength(3);

    await attachJson(testInfo, 'after-upload-storage.json', snapshot);
    const storedJson = await page.evaluate(key => localStorage.getItem(key), LAB_STORAGE_KEY);

    expect(storedJson).not.toMatch(/data:image|base64|blob:/i);

    await closeSettings(page);
    await page.setViewportSize({ height: 600, width: 375 });
    await page.reload();
    const replacementFrames = customDesignCard(page).locator(
      '.custom-design-image-frame',
    );

    await expect(replacementFrames).toHaveCount(3);
    await expect(replacementFrames.first()).toHaveAttribute(
      'data-image-render-state',
      'loaded',
      { timeout: 30_000 },
    );

    await enterPreview(page);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    await enterPreview(page);
    await page.getByRole('button', { name: 'Back to editor' }).click();

    await page.setViewportSize({ height: 800, width: 1_180 });
    const beforeReplace = JSON.parse(
      (await page.evaluate(key => localStorage.getItem(key), LAB_STORAGE_KEY)) ?? '{}',
    ) as { pages: Array<{ sections: Array<{ sectionType: string; settings?: { images: Array<{ assetId: string; id: string }> } }> }> };
    const beforeImage = beforeReplace.pages
      .flatMap(candidate => candidate.sections)
      .find(section => section.sectionType === 'custom_design')
      ?.settings?.images[0];
    const replacement = await createArtwork(page, {
      format: 'png',
      height: 900,
      hue: 160,
      name: 'replacement.png',
      width: 600,
    });
    const settings = await openSettings(page);
    const firstImageRow = settings.locator('[data-image-item-id]').first();
    await firstImageRow.locator('input[type="file"]')
      .setInputFiles(replacement);

    await expect(firstImageRow).toContainText('replacement.png', {
      timeout: 30_000,
    });
    await expect.poll(async () => {
      const stored = JSON.parse(
        (await page.evaluate(key => localStorage.getItem(key), LAB_STORAGE_KEY)) ?? '{}',
      ) as typeof beforeReplace;
      return stored.pages
        .flatMap(candidate => candidate.sections)
        .find(section => section.sectionType === 'custom_design')
        ?.settings?.images[0]?.assetId;
    }).not.toBe(beforeImage?.assetId);

    await waitForSaved(page);
    const afterReplacementFrames = customDesignCard(page).locator(
      '.custom-design-image-frame',
    );

    await expect(afterReplacementFrames).toHaveCount(3);
    await expect(afterReplacementFrames.first()).toHaveAttribute(
      'data-image-render-state',
      'loaded',
      { timeout: 30_000 },
    );

    const afterReplace = JSON.parse(
      (await page.evaluate(key => localStorage.getItem(key), LAB_STORAGE_KEY)) ?? '{}',
    ) as typeof beforeReplace;
    const afterImage = afterReplace.pages
      .flatMap(candidate => candidate.sections)
      .find(section => section.sectionType === 'custom_design')
      ?.settings?.images[0];

    expect(afterImage?.id).toBe(beforeImage?.id);
    expect(afterImage?.assetId).not.toBe(beforeImage?.assetId);

    snapshot = await readRawAssetSnapshot(page);
    assertSnapshotIntegrity(snapshot, capability, requirePreferredBlobPath);

    expect(snapshot.summaries.length).toBeGreaterThanOrEqual(3);

    await attachJson(testInfo, 'after-replacement-storage.json', snapshot);

    await closeSettings(page);
    const toolbar = page.getByRole('banner', { name: 'Site builder toolbar' });
    await toolbar.getByRole('button', { name: 'Undo', exact: true }).click();

    await expect.poll(async () => {
      const stored = JSON.parse(
        (await page.evaluate(key => localStorage.getItem(key), LAB_STORAGE_KEY)) ?? '{}',
      ) as typeof beforeReplace;
      return stored.pages
        .flatMap(candidate => candidate.sections)
        .find(section => section.sectionType === 'custom_design')
        ?.settings?.images[0]?.assetId;
    }).toBe(beforeImage?.assetId);
    await expect(customDesignCard(page).locator('.custom-design-image-frame').first())
      .toHaveAttribute('data-image-render-state', 'loaded', { timeout: 30_000 });

    await toolbar.getByRole('button', { name: 'Redo', exact: true }).click();

    await expect.poll(async () => {
      const stored = JSON.parse(
        (await page.evaluate(key => localStorage.getItem(key), LAB_STORAGE_KEY)) ?? '{}',
      ) as typeof beforeReplace;
      return stored.pages
        .flatMap(candidate => candidate.sections)
        .find(section => section.sectionType === 'custom_design')
        ?.settings?.images[0]?.assetId;
    }).toBe(afterImage?.assetId);
    await expect(customDesignCard(page).locator('.custom-design-image-frame').first())
      .toHaveAttribute('data-image-render-state', 'loaded', { timeout: 30_000 });

    await enterPreview(page);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    await page.getByRole('button', { name: 'More site options' }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    await more.getByRole('button', { name: 'Reset to starter kit' }).click();
    const reset = page.getByRole('dialog', { name: 'Reset to the starting point?' });
    await reset.getByRole('button', { name: 'Reset to starter' }).click();
    await waitForSaved(page);

    await expect(customDesignCard(page)).toHaveCount(0);
    await expect.poll(() => readCustomDesignAssetRecordCounts(page)).toEqual({
      [ORIGINAL_STORE]: 0,
      [SUMMARY_STORE]: 0,
      [THUMBNAIL_STORE]: 0,
    });
    await expect.poll(() => readUrlAudit(page)).toMatchObject({ live: [] });

    const urlAudit = await readUrlAudit(page);

    expect(urlAudit.created).toBe(urlAudit.revoked);

    await attachJson(testInfo, 'object-url-balance.json', urlAudit);

    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([LAB_STORAGE_KEY]);
    expect(await documentSurfaceState(page)).toMatchObject({
      body: { overflow: '', position: '' },
      editorAriaHidden: null,
      editorInert: false,
      html: { overflow: '', position: '' },
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.reload();

    await expect(customDesignCard(page)).toHaveCount(0);
    await expect(readCustomDesignAssetRecordCounts(page)).resolves.toEqual({
      [ORIGINAL_STORE]: 0,
      [SUMMARY_STORE]: 0,
      [THUMBNAIL_STORE]: 0,
    });
    await expect.poll(() => readUrlAudit(page)).toMatchObject({ live: [] });

    await runtime.assertClean();
  } finally {
    runtime.stop();
  }
});
