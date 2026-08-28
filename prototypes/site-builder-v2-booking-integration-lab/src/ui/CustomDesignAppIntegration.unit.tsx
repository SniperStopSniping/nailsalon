import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';

import {
  createEmptyBookingSession,
  createMenuFixture,
} from '../booking/helpers';
import type { AssetRepository } from '../custom-design/assets';
import type {
  ProcessImageBatchOptions,
  ProcessImageBatchResult,
} from '../custom-design/assets/image-processing';
import { CustomDesignAssetProvider } from '../custom-design/integration/CustomDesignAssetProvider';
import {
  createDefaultCustomDesignSettings,
  type CustomDesignImageItem,
} from '../custom-design/model';
import {
  SITE_BUILDER_STORAGE_KEY,
  exportSiteBuilderBackup,
  initializeStarter,
  removeSection,
  type CustomDesignSectionInstance,
  type SiteBuilderDocument,
} from '../model';
import { App } from './App';
import { Preview } from './Preview';

const imageProcessingMocks = vi.hoisted(() => ({
  processImageBatch: vi.fn(),
}));

vi.mock('../custom-design/assets/image-processing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../custom-design/assets/image-processing')>();
  return {
    ...actual,
    processImageBatch: imageProcessingMocks.processImageBatch,
  };
});

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalScrollIntoView = Element.prototype.scrollIntoView;

function installViewport(viewport: 'desktop' | 'mobile' = 'desktop'): void {
  const desktop = viewport === 'desktop';
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches: query.includes('min-width: 900px')
      ? desktop
      : !desktop && (
        query.includes('max-width: 899px')
        || query.includes('max-width: 700px')
      ),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: desktop ? 1440 : 375,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: desktop ? 900 : 600,
  });
  Object.defineProperty(document.body, 'clientWidth', {
    configurable: true,
    value: desktop ? 1440 : 375,
  });
}

function installObjectUrlStubs() {
  let sequence = 0;
  const createObjectURL = vi.fn(() => `blob:https://luster.test/custom-${++sequence}`);
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  return { createObjectURL, revokeObjectURL };
}

async function chooseQuickBook(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Quick Book/ }));
  await screen.findByTestId('final-hybrid-editor');
  await waitFor(() => {
    expect(window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY)).not.toBeNull();
  });
}

async function addCustomDesign(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', {
    name: 'Add section at bottom of Home',
  }));
  const library = await screen.findByRole('dialog', { name: 'Add section' });
  const search = within(library).getByRole('searchbox', { name: 'Search sections' });
  await user.type(search, 'Canva');
  expect(within(library).getByText(
    'Upload a Canva design, flyer, policy page, or branded image.',
  )).toBeVisible();
  expect(within(library).getByText('Best for designs you already made.')).toBeVisible();
  await user.click(within(library).getByRole('button', { name: 'Add Custom Design' }));
  return screen.findByRole('listitem', { name: 'Section 4: Custom Design' });
}

function readStoredDocument(): SiteBuilderDocument {
  const stored = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY);
  if (!stored) throw new Error('The Lab document was not stored.');
  return JSON.parse(stored) as SiteBuilderDocument;
}

function getStoredCustomDesign(document: SiteBuilderDocument): CustomDesignSectionInstance {
  const section = document.pages.flatMap(page => page.sections).find(
    (candidate): candidate is CustomDesignSectionInstance =>
      candidate.sectionType === 'custom_design',
  );
  if (!section) throw new Error('The stored Custom Design section is missing.');
  return section;
}

const createRepository = (
  originals: Readonly<Record<string, Blob | null>>,
): AssetRepository => ({
  clear: vi.fn().mockResolvedValue(0),
  close: vi.fn(),
  commit: vi.fn(),
  commitBatch: vi.fn(),
  delete: vi.fn(),
  deleteDatabase: vi.fn(),
  discard: vi.fn(),
  get: vi.fn(),
  getMetadata: vi.fn(),
  getOriginal: vi.fn(async assetId => originals[assetId] ?? null),
  getThumbnail: vi.fn().mockResolvedValue(null),
  has: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  stage: vi.fn(),
});

const makeImage = (
  assetId = 'custom_design_asset_preview',
): CustomDesignImageItem => ({
  id: 'custom_design_image_preview',
  altText: 'A booking flyer',
  aspectRatio: 0.5,
  assetId,
  decorative: false,
  fileName: 'booking-flyer.png',
  fileSize: 18,
  height: 2_000,
  interactiveAreas: [{
    id: 'custom_design_area_booking',
    accessibleLabel: 'Book from design',
    action: { type: 'start_booking' },
    geometry: { height: 12, width: 36, x: 32, y: 76 },
    labelConfirmed: true,
    reviewStatus: 'approved',
    semanticOrder: 0,
    validationStatus: 'valid',
  }],
  mimeType: 'image/png',
  width: 1_000,
});

function documentWithCustomDesign(
  image: CustomDesignImageItem | null,
): SiteBuilderDocument {
  const document = initializeStarter('quick_book', { siteName: 'Isla Nail Studio' });
  const home = document.pages[0];
  if (!home) throw new Error('Quick Book did not create Home.');
  const customDesign: CustomDesignSectionInstance = {
    id: 'section_custom_design_preview',
    label: 'Custom Design',
    order: 0,
    sectionType: 'custom_design',
    settings: {
      ...createDefaultCustomDesignSettings(),
      images: image ? [image] : [],
    },
    visible: true,
  };
  return {
    ...document,
    pages: [{
      ...home,
      sections: [
        customDesign,
        ...home.sections.map((section, index) => ({ ...section, order: index + 1 })),
      ],
    }],
  };
}

function storedDocumentWithTwoCustomDesignPages(): {
  document: SiteBuilderDocument;
  imageIds: [string, string];
  sectionId: string;
} {
  const first = {
    ...makeImage('custom_design_asset_first'),
    id: 'custom_design_image_first',
    fileName: 'first-page.png',
    interactiveAreas: [],
  };
  const second = {
    ...makeImage('custom_design_asset_second'),
    id: 'custom_design_image_second',
    fileName: 'second-page.png',
    interactiveAreas: [],
  };
  const document = documentWithCustomDesign(first);
  const section = getStoredCustomDesign(document);
  const next = {
    ...document,
    pages: document.pages.map(page => ({
      ...page,
      sections: page.sections.map(candidate => candidate.id === section.id
        ? {
            ...candidate,
            settings: {
              ...section.settings,
              images: [first, second],
            },
          }
        : candidate),
    })),
  } as SiteBuilderDocument;
  window.localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(next));
  return {
    document: next,
    imageIds: [first.id, second.id],
    sectionId: section.id,
  };
}

async function openStoredCustomDesignSettings(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  const card = await screen.findByRole('listitem', { name: /Custom Design/ });
  const select = within(card).getByRole('button', { name: /Custom Design/ });
  await user.click(select);
  await new Promise(resolve => window.setTimeout(resolve, 0));
  if (card.getAttribute('data-selected') !== 'true') await user.click(select);
  await waitFor(() => expect(card).toHaveAttribute('data-selected', 'true'));
  const toolbar = await screen.findByTestId('selected-section-toolbar');
  await user.click(within(toolbar).getByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: /Custom Design(?: settings)?$/ });
}

function renderPreview(
  document: SiteBuilderDocument,
  repository: AssetRepository,
) {
  const activePage = document.pages[0];
  if (!activePage) throw new Error('Preview requires an active page.');
  return render(
    <CustomDesignAssetProvider
      getReachableAssetIds={() => new Set(
        activePage.sections.flatMap(section => section.sectionType === 'custom_design'
          ? section.settings.images.map(image => image.assetId)
          : []),
      )}
      repository={repository}
    >
      <Preview
        activePage={activePage}
        bookingFixture={createMenuFixture()}
        bookingSession={createEmptyBookingSession()}
        document={document}
        onBookingSessionChange={vi.fn()}
        onNavigate={vi.fn()}
        tokenPreset="warm"
        viewport="mobile"
      />
    </CustomDesignAssetProvider>,
  );
}

beforeEach(() => {
  installViewport();
  installObjectUrlStubs();
  imageProcessingMocks.processImageBatch.mockImplementation(async (
    files: readonly File[],
    options: ProcessImageBatchOptions,
  ): Promise<ProcessImageBatchResult> => {
    const accepted = files.map((file, index) => {
      // fake-indexeddb's structured clone support is backed by Node Blob.
      // The browser-facing input remains a real File; only the already-decoded
      // test result uses the same Blob implementation as the repository tests.
      const blob = new NodeBlob([`stored:${file.name}`], {
        type: 'image/png',
      }) as unknown as Blob;
      return {
        blob,
        metadata: {
          aspectRatio: 0.5,
          byteSize: blob.size,
          createdAt: '2026-08-27T12:00:00.000Z',
          fileName: file.name,
          height: 2_000,
          id: options.createAssetId(file, index),
          mimeType: 'image/png' as const,
          orientation: 1 as const,
          width: 1_000,
        },
      };
    });
    return { accepted, rejected: [] };
  });
});

afterEach(async () => {
  document.body.style.removeProperty('overflow');
  document.documentElement.style.removeProperty('overflow');
  // The provider intentionally disposes URL registries one task after unmount
  // so React StrictMode's setup/cleanup probe can reuse them. Let that task
  // finish before restoring jsdom's otherwise-missing URL methods.
  await new Promise(resolve => window.setTimeout(resolve, 0));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  // Keep no-op URL methods installed through Testing Library's later global
  // cleanup; the provider's disposal is deliberately one task deferred.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});

afterAll(async () => {
  await new Promise(resolve => window.setTimeout(resolve, 0));
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
});

describe('Custom Design universal App integration', () => {
  it('searches, adds once, selects the empty section, omits it from Preview, and undoes in one step', async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);

    const customDesign = await addCustomDesign(user);
    expect(customDesign).toHaveAttribute('data-section-type', 'custom_design');
    const settings = await screen.findByRole('dialog', { name: 'Custom Design settings' });
    expect(within(settings).getByRole('heading', { name: 'Upload your design' })).toBeVisible();
    const drawerHeading = within(settings).getByRole('heading', { name: 'Custom Design' });
    await waitFor(() => expect(drawerHeading).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    await user.click(within(settings).getByRole('button', {
      name: 'Close Custom Design settings',
    }));
    await waitFor(() => {
      expect(customDesign).toHaveAttribute('data-selected', 'true');
      expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
        behavior: 'auto',
        block: 'start',
      });
      const activeElement = document.activeElement;
      expect(
        activeElement === customDesign.querySelector('.section-card__select-surface')
        || activeElement?.getAttribute('data-custom-design-settings-trigger-for')
          === customDesign.getAttribute('data-section-instance-id'),
      ).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByTestId('preview-stage')).toBeVisible();
    expect(screen.queryByTestId('custom-design-customer-renderer')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Custom Design section' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('listitem', { name: /Custom Design/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('uses universal visible for Hide/Show and persists bounded display settings without hidden', async () => {
    installViewport('mobile');
    const user = userEvent.setup();
    render(<App />);
    await chooseQuickBook(user);
    const customDesign = await addCustomDesign(user);
    const settings = await screen.findByRole('dialog', { name: 'Custom Design' });

    await user.click(within(settings).getByRole('radio', { name: /Contained/ }));
    await user.click(within(settings).getByRole('button', { name: 'Close Custom Design' }));
    const actions = await screen.findByRole('group', { name: 'Custom Design actions' });
    await user.click(within(actions).getByRole('button', { name: 'Hide' }));
    expect(customDesign).toHaveClass('is-hidden');
    expect(within(customDesign).getByText('Hidden')).toBeVisible();
    await user.click(within(actions).getByRole('button', { name: 'Show' }));
    expect(customDesign).not.toHaveClass('is-hidden');

    await waitFor(() => {
      const section = getStoredCustomDesign(readStoredDocument());
      expect(section.settings.displayMode).toBe('contained');
      expect(section.visible).toBe(true);
      expect(section).not.toHaveProperty('hidden');
      expect(section.settings).not.toHaveProperty('hidden');
    });
  });

  it('stages one upload outside the document, survives same-browser remount, and exports a truthful manifest', async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await chooseQuickBook(user);
    const customDesign = await addCustomDesign(user);
    const settings = await screen.findByRole('dialog', { name: 'Custom Design settings' });
    const picker = settings.querySelector<HTMLInputElement>('input[type="file"]');
    if (!picker) throw new Error('Custom Design image picker was not rendered.');
    const bytes = 'NOT_PORTABLE_IMAGE_BYTES';
    const file = new File([bytes], 'original-poster.png', { type: 'image/png' });

    await user.upload(picker, file);
    expect(await within(settings).findByText('1 image was added.')).toBeVisible();
    await waitFor(() => {
      const updated = screen.getByRole('listitem', { name: 'Section 4: Custom Design' });
      expect(updated.querySelector<HTMLImageElement>('img')?.src)
        .toMatch(/^blob:https:\/\/luster\.test\/custom-/u);
    });

    let storedJson = '';
    await waitFor(() => {
      storedJson = window.localStorage.getItem(SITE_BUILDER_STORAGE_KEY) ?? '';
      expect(getStoredCustomDesign(readStoredDocument()).settings.images).toHaveLength(1);
    });
    const storedDocument = readStoredDocument();
    const storedSection = getStoredCustomDesign(storedDocument);
    expect(storedSection.settings.images[0]).toMatchObject({
      fileName: 'original-poster.png',
      height: 2_000,
      mimeType: 'image/png',
      width: 1_000,
    });
    expect(storedJson).not.toContain(bytes);
    expect(storedJson).not.toContain('data:image');
    expect(storedJson).not.toContain('blob:');

    const backup = JSON.parse(exportSiteBuilderBackup(storedDocument)) as {
      customDesignAssets: {
        assets: Array<{ assetId: string }>;
        assetsIncluded: boolean;
        warning: string;
      };
    };
    expect(backup.customDesignAssets).toMatchObject({
      assetsIncluded: false,
      warning: expect.stringContaining('aren’t included'),
    });
    expect(backup.customDesignAssets.assets).toHaveLength(1);
    expect(backup.customDesignAssets.assets[0]).toMatchObject({
      assetId: storedSection.settings.images[0]?.assetId,
    });
    expect(JSON.stringify(backup)).not.toContain(bytes);
    expect(JSON.stringify(backup)).not.toContain('blob:');

    view.unmount();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    render(<App />);
    expect(await screen.findByTestId('final-hybrid-editor')).toBeVisible();
    const reloaded = await screen.findByRole('listitem', { name: 'Section 4: Custom Design' });
    await waitFor(() => {
      expect(reloaded.querySelector<HTMLImageElement>('img')?.src)
        .toMatch(/^blob:https:\/\/luster\.test\/custom-/u);
    });
    expect(within(reloaded).queryByText(/isn’t available in this browser/)).not.toBeInTheDocument();
  });

  it('warns for a dirty desktop page order and supports Keep, Discard, Save, Undo, and Redo', async () => {
    const { imageIds } = storedDocumentWithTwoCustomDesignPages();
    const user = userEvent.setup();
    render(<App />);
    let settings = await openStoredCustomDesignSettings(user);
    await user.click(within(settings).getByRole('radio', { name: /Contained/ }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).settings.displayMode)
        .toBe('contained');
    });

    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    within(settings).getByRole('button', { name: 'Save order' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    let warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));
    settings = screen.getByRole('dialog', { name: 'Custom Design settings' });
    await user.click(within(settings).getByRole('button', {
      name: 'Close Custom Design settings',
    }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    expect(within(warning).getByText('UNSAVED IMAGE ORDER')).toBeVisible();
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));
    settings = screen.getByRole('dialog', { name: 'Custom Design settings' });
    expect(settings.querySelectorAll('[data-image-item-id]')[0])
      .toHaveAttribute('data-image-item-id', imageIds[1]);

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    expect(screen.queryByRole('button', { name: 'Back to editor' })).not.toBeInTheDocument();
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));
    settings = screen.getByRole('dialog', { name: 'Custom Design settings' });
    expect(settings.querySelectorAll('[data-image-item-id]')[0])
      .toHaveAttribute('data-image-item-id', imageIds[1]);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
      .toEqual(imageIds);
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));
    settings = screen.getByRole('dialog', { name: 'Custom Design settings' });

    await user.click(within(settings).getByRole('button', {
      name: 'Close Custom Design settings',
    }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog', { name: 'Custom Design settings' }))
      .not.toBeInTheDocument();
    expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
      .toEqual(imageIds);

    settings = await openStoredCustomDesignSettings(user);
    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    await user.click(within(settings).getByRole('button', {
      name: 'Close Custom Design settings',
    }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.dblClick(within(warning).getByRole('button', { name: 'Save order' }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
        .toEqual([imageIds[1], imageIds[0]]);
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
        .toEqual(imageIds);
    });
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
        .toEqual([imageIds[1], imageIds[0]]);
    });
  });

  it('uses the dirty warning for mobile Escape and backdrop, but not after returning to baseline', async () => {
    installViewport('mobile');
    storedDocumentWithTwoCustomDesignPages();
    const user = userEvent.setup();
    render(<App />);
    let settings = await openStoredCustomDesignSettings(user);

    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    let warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));
    settings = screen.getByRole('dialog', { name: /^Custom Design$/ });
    const settingsBackdrop = settings.parentElement;
    if (!settingsBackdrop) throw new Error('The mobile settings backdrop is unavailable.');
    fireEvent.mouseDown(settingsBackdrop);
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Keep editing' }));

    settings = screen.getByRole('dialog', { name: /^Custom Design$/ });
    await user.click(within(settings).getByRole('button', { name: 'Close Custom Design' }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Discard changes' }));

    settings = await openStoredCustomDesignSettings(user);
    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    await user.click(within(settings).getByRole('button', { name: 'Close Custom Design' }));
    warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Save order' }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
        .toEqual(['custom_design_image_second', 'custom_design_image_first']);
    });

    settings = await openStoredCustomDesignSettings(user);
    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    await user.click(within(settings).getByRole('button', { name: 'Move page 2 up' }));
    await user.click(within(settings).getByRole('button', { name: 'Close Custom Design' }));
    expect(screen.queryByRole('dialog', { name: 'Save this page order?' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^Custom Design$/ }))
      .not.toBeInTheDocument();
  });

  it('reloads the committed baseline before Save and the saved order after Save', async () => {
    const { imageIds } = storedDocumentWithTwoCustomDesignPages();
    const user = userEvent.setup();
    const firstView = render(<App />);
    let settings = await openStoredCustomDesignSettings(user);
    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
      .toEqual(imageIds);

    firstView.unmount();
    const reloadedBeforeSave = render(<App />);
    settings = await openStoredCustomDesignSettings(user);
    expect(settings.querySelectorAll('[data-image-item-id]')[0])
      .toHaveAttribute('data-image-item-id', imageIds[0]);
    await user.click(within(settings).getByRole('button', { name: 'Move page 1 down' }));
    await user.click(within(settings).getByRole('button', {
      name: 'Close Custom Design settings',
    }));
    const warning = await screen.findByRole('dialog', { name: 'Save this page order?' });
    await user.click(within(warning).getByRole('button', { name: 'Save order' }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).settings.images.map(image => image.id))
        .toEqual([imageIds[1], imageIds[0]]);
    });

    reloadedBeforeSave.unmount();
    render(<App />);
    settings = await openStoredCustomDesignSettings(user);
    expect(settings.querySelectorAll('[data-image-item-id]')[0])
      .toHaveAttribute('data-image-item-id', imageIds[1]);
  });

  it('restores an exact removed Custom Design from the section library without creating another', async () => {
    const { document, sectionId } = storedDocumentWithTwoCustomDesignPages();
    const removed = removeSection(document, sectionId);
    const original = removed.unusedSections.find(section => section.id === sectionId);
    if (original?.sectionType !== 'custom_design') {
      throw new Error('The removed Custom Design fixture is unavailable.');
    }
    window.localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(removed));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('final-hybrid-editor');
    await user.click(screen.getByRole('button', { name: 'Add section at bottom of Home' }));
    const library = await screen.findByRole('dialog', { name: 'Add section' });
    expect(within(library).getByRole('button', { name: 'Restore removed Custom Design' }))
      .toBeVisible();
    expect(within(library).getByRole('button', { name: 'Add another Custom Design' }))
      .toBeVisible();
    await user.click(within(library).getByRole('button', {
      name: 'Restore removed Custom Design',
    }));

    const restored = await screen.findByRole('listitem', { name: /Custom Design/ });
    expect(restored).toHaveAttribute('data-section-instance-id', sectionId);
    await waitFor(() => {
      const stored = getStoredCustomDesign(readStoredDocument());
      expect({ ...stored, order: original.order }).toEqual(original);
      expect(readStoredDocument().unusedSections).toHaveLength(0);
    });
  });

  it('lists multiple removed Custom Designs and restores the chosen stable ID with Undo/Redo', async () => {
    const { document: firstDocument, sectionId: firstSectionId } =
      storedDocumentWithTwoCustomDesignPages();
    const home = firstDocument.pages[0];
    if (!home) throw new Error('The Home fixture is unavailable.');
    const secondImage = {
      ...makeImage('custom_design_asset_removed_second'),
      id: 'custom_design_image_removed_second',
      fileName: 'second-removed-policy.png',
    };
    const secondSection: CustomDesignSectionInstance = {
      id: 'section_custom_design_removed_second',
      label: 'Custom Design',
      order: home.sections.length,
      sectionType: 'custom_design',
      settings: {
        ...createDefaultCustomDesignSettings(),
        background: { mode: 'custom', color: '#F4E6F0' },
        cta: {
          type: 'custom',
          label: 'Email the studio',
          action: {
            type: 'email',
            destination: { email: 'owner@example.com' },
          },
          placement: { type: 'after_image', imageItemId: secondImage.id },
        },
        images: [secondImage],
      },
      visible: false,
    };
    const withTwo = {
      ...firstDocument,
      pages: [{
        ...home,
        sections: [
          ...home.sections,
          secondSection,
        ].map((section, order) => ({ ...section, order })),
      }],
    } as SiteBuilderDocument;
    const bothRemoved = removeSection(
      removeSection(withTwo, firstSectionId),
      secondSection.id,
    );
    window.localStorage.setItem(SITE_BUILDER_STORAGE_KEY, JSON.stringify(bothRemoved));
    const exactRemoved = bothRemoved.unusedSections.find(
      section => section.id === secondSection.id,
    );
    if (exactRemoved?.sectionType !== 'custom_design') {
      throw new Error('The second removed Custom Design is unavailable.');
    }

    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('final-hybrid-editor');
    await user.click(screen.getByRole('button', { name: 'Add section at bottom of Home' }));
    const library = await screen.findByRole('dialog', { name: 'Add section' });
    expect(within(library).getAllByRole('button', {
      name: /Restore removed Custom Design \d of 2/,
    })).toHaveLength(2);
    await user.click(within(library).getByRole('button', {
      name: 'Restore removed Custom Design 2 of 2, 1 image',
    }));
    await waitFor(() => {
      const stored = readStoredDocument();
      expect(getStoredCustomDesign(stored).id).toBe(secondSection.id);
      expect(stored.unusedSections.map(section => section.id)).toEqual([firstSectionId]);
    });
    expect(getStoredCustomDesign(readStoredDocument())).toEqual({
      ...exactRemoved,
      order: 3,
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      const stored = readStoredDocument();
      expect(stored.pages.flatMap(page => page.sections).some(
        section => section.id === secondSection.id,
      )).toBe(false);
      expect(stored.unusedSections.map(section => section.id)).toEqual([
        firstSectionId,
        secondSection.id,
      ]);
    });
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => {
      expect(getStoredCustomDesign(readStoredDocument()).id).toBe(secondSection.id);
    });
  });
});

describe('Custom Design customer Preview integration', () => {
  it('resolves a same-browser asset and dispatches Start booking to the canonical Booking section', async () => {
    const image = makeImage();
    const siteDocument = documentWithCustomDesign(image);
    const repository = createRepository({
      [image.assetId]: new Blob(['ready'], { type: 'image/png' }),
    });
    renderPreview(siteDocument, repository);

    const renderedImage = await screen.findByRole('img', { name: 'A booking flyer' });
    fireEvent.load(renderedImage);
    const action = await screen.findByRole('button', { name: 'Book from design' });
    expect(action).toHaveAttribute('data-testid', 'custom-design-area-custom_design_area_booking');
    expect(screen.getByRole('searchbox', { name: 'Search services' })).toBeVisible();

    fireEvent.click(action);
    const booking = siteDocument.pages[0]?.sections.find(
      section => section.sectionType === 'booking',
    );
    const bookingElement = booking
      ? document.querySelector<HTMLElement>(`[data-section-id="${booking.id}"]`)
      : null;
    expect(bookingElement).not.toBeNull();
    expect(bookingElement?.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('omits an empty section and suppresses images and semantic actions when bytes are missing', async () => {
    const emptyDocument = documentWithCustomDesign(null);
    const emptyView = renderPreview(emptyDocument, createRepository({}));
    expect(screen.queryByTestId('custom-design-customer-renderer')).not.toBeInTheDocument();
    emptyView.unmount();

    const missingImage = makeImage('custom_design_asset_missing');
    const missingRepository = createRepository({ [missingImage.assetId]: null });
    renderPreview(documentWithCustomDesign(missingImage), missingRepository);
    await waitFor(() => {
      expect(missingRepository.getOriginal).toHaveBeenCalledWith(missingImage.assetId);
    });
    expect(screen.queryByRole('img', { name: 'A booking flyer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book from design' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('custom-design-area-custom_design_area_booking'))
      .not.toBeInTheDocument();
  });
});
