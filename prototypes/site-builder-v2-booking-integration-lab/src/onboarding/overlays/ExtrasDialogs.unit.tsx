import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import { initializeStarter } from '../../model';
import type { CustomDesignSectionInstance } from '../../model/types';
import { createDanielaFixtureState } from '../fixtures';
import type { CanvaIntegrationController } from '../extras/useCanvaIntegration';
import type { OnboardingLabState } from '../model/types';
import { ExtrasScreen, type OnboardingStateUpdater } from '../screens/DesignScreens';
import { parseOnboardingState } from '../storage/storage';
import { CanvaDialog, GalleryDialog } from './ExtrasDialogs';

const mocks = vi.hoisted(() => ({
  decodeOnboardingLocalImage: vi.fn(),
  useCustomDesignAssetMap: vi.fn(),
}));

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: mocks.useCustomDesignAssetMap,
}));

vi.mock('../model/local-images', async (importOriginal) => ({
  ...await importOriginal<typeof import('../model/local-images')>(),
  decodeOnboardingLocalImage: mocks.decodeOnboardingLocalImage,
}));

const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  'createObjectURL',
);
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  'revokeObjectURL',
);

const restoreUrlMethod = (
  name: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined,
) => {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
  } else {
    Reflect.deleteProperty(URL, name);
  }
};

const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

describe('optional Gallery and Canva surfaces', () => {
  beforeEach(() => {
    installMatchMedia();
    mocks.decodeOnboardingLocalImage.mockReset();
    mocks.decodeOnboardingLocalImage.mockResolvedValue({ height: 1_200, width: 900 });
    mocks.useCustomDesignAssetMap.mockReset();
    mocks.useCustomDesignAssetMap.mockReturnValue(new Map());
  });

  afterEach(() => {
    restoreUrlMethod('createObjectURL', createObjectUrlDescriptor);
    restoreUrlMethod('revokeObjectURL', revokeObjectUrlDescriptor);
  });

  it('adds no empty section when skipped and allows both extras to remain selected', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.galleryEnabled = false;
    state.recipe.canvaEnabled = false;
    const onSkip = vi.fn();
    const view = render(
      <ExtrasScreen
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onOpenCanva={vi.fn()}
        onOpenGallery={vi.fn()}
        onSkip={onSkip}
        state={state}
      />,
    );
    expect(screen.getByText('Upload portfolio photos or start with the Luster sample portfolio.')).toBeVisible();
    expect(screen.getByText(/add them as a Custom Design section/u)).toBeVisible();
    expect(screen.queryByText(/real Custom Design section/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Added:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip extras' }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(state.recipe).toMatchObject({ canvaEnabled: false, galleryEnabled: false });

    const both = structuredClone(state);
    both.recipe.galleryEnabled = true;
    both.recipe.canvaEnabled = true;
    view.rerender(
      <ExtrasScreen
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onOpenCanva={vi.fn()}
        onOpenGallery={vi.fn()}
        onSkip={onSkip}
        state={both}
      />,
    );
    expect(screen.getByText('Added: Gallery and Canva')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Gallery' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Canva design' })).toBeVisible();
  });

  it('creates only a preview Gallery draft after explicit portfolio confirmation', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.recipe.galleryEnabled = false;
    initial.gallery.images = [];
    initial.gallery.source = null;
    let latestState: OnboardingLabState = initial;

    function Harness() {
      const [state, setState] = useState(initial);
      const [open, setOpen] = useState(true);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      return <GalleryDialog onClose={() => setOpen(false)} onUpdate={update} open={open} state={state} />;
    }

    render(<Harness />);
    let dialog = screen.getByRole('dialog', { name: 'Add Gallery' });
    await user.click(within(dialog).getByRole('button', { name: 'Add Gallery' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Choose portfolio images/i);
    await user.click(within(dialog).getByRole('button', { name: /Use Luster sample portfolio/ }));
    await user.click(within(dialog).getByRole('radio', { name: 'editorial' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Gallery' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Gallery' })).not.toBeInTheDocument());
    expect(latestState.gallery).toMatchObject({ layout: 'editorial', source: 'mock_luster' });
    expect(latestState.gallery.images).toHaveLength(4);
    expect(latestState.recipe.galleryEnabled).toBe(true);
  });

  it('keeps only valid Gallery uploads and reports partial success truthfully', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.recipe.galleryEnabled = false;
    initial.gallery.images = [];
    initial.gallery.source = null;
    let latestState = initial;
    mocks.decodeOnboardingLocalImage.mockImplementation(async (file: File) => {
      if (file.name === 'corrupt.png') {
        throw new Error('This image couldn’t be opened.');
      }
      return { height: 1_200, width: 900 };
    });

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      return <GalleryDialog onClose={vi.fn()} onUpdate={update} open state={state} />;
    }

    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Add Gallery' });
    const valid = new File(['valid'], 'valid.png', { type: 'image/png' });
    const corrupt = new File(['corrupt'], 'corrupt.png', { type: 'image/png' });
    await user.upload(
      within(dialog).getByLabelText(/Upload portfolio photos/u),
      [valid, corrupt],
    );

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('1 image was added and 1 was skipped.');
    expect(alert).toHaveTextContent('corrupt.png: This image couldn’t be opened.');
    expect(latestState.gallery.source).toBe('uploads');
    expect(latestState.gallery.images).toEqual([
      expect.objectContaining({
        fileName: 'valid.png',
        height: 1_200,
        mimeType: 'image/png',
        width: 900,
      }),
    ]);
    expect(latestState.recipe.galleryEnabled).toBe(false);
    expect(within(dialog).getAllByRole('img')).toHaveLength(1);
  });

  it('uses one hidden Gallery picker and names every file skipped by capacity', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.recipe.galleryEnabled = false;
    initial.gallery.images = [];
    initial.gallery.source = null;
    let latestState = initial;

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      return <GalleryDialog onClose={vi.fn()} onUpdate={update} open state={state} />;
    }

    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Add Gallery' });
    const input = within(dialog).getByLabelText(/Upload portfolio photos/u);
    expect(input).toHaveClass('visually-hidden');
    const files = Array.from({ length: 10 }, (_, index) => new File(
      [`gallery-${index + 1}`],
      `gallery-${index + 1}.png`,
      { type: 'image/png' },
    ));
    await user.upload(input, files);

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('8 images were added and 2 were skipped.');
    expect(alert).toHaveTextContent(
      'gallery-9.png: Skipped because a Gallery can contain up to 8 images.',
    );
    expect(alert).toHaveTextContent(
      'gallery-10.png: Skipped because a Gallery can contain up to 8 images.',
    );
    expect(latestState.gallery.images).toHaveLength(8);
  });

  it('preserves the prior Gallery selection when every replacement file is invalid', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    const preservedImage = {
      altText: 'Preserved nail work',
      fileName: 'preserved.webp',
      id: 'preserved-gallery-image',
      mimeType: 'image/webp',
      previewUrl: '/manicure-french.webp',
      source: 'fixture' as const,
    };
    initial.gallery.images = [preservedImage];
    initial.gallery.source = 'uploads';
    const preservedGallery = structuredClone(initial.gallery);
    let latestState = initial;
    mocks.decodeOnboardingLocalImage.mockRejectedValue(
      new Error('This image couldn’t be opened.'),
    );

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      return <GalleryDialog onClose={vi.fn()} onUpdate={update} open state={state} />;
    }

    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Add Gallery' });
    await user.upload(
      within(dialog).getByLabelText(/Upload portfolio photos/u),
      new File(['invalid'], 'replacement.webp', { type: 'image/webp' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No images were added. 1 image was skipped.',
    );
    expect(latestState.gallery).toEqual(preservedGallery);
    expect(within(dialog).getByRole('img', { name: 'Preserved nail work' }))
      .toHaveAttribute('src', '/manicure-french.webp');
  });

  it('does not create an uploads source or empty Gallery draft when every file is rejected', async () => {
    const user = userEvent.setup();
    const initial = createDanielaFixtureState();
    initial.gallery.images = [];
    initial.gallery.source = null;
    initial.recipe.galleryEnabled = false;
    let latestState = initial;
    mocks.decodeOnboardingLocalImage.mockRejectedValue(
      new Error('This image couldn’t be opened.'),
    );

    function Harness() {
      const [state, setState] = useState(initial);
      const update: OnboardingStateUpdater = (transform) => setState((current) => {
        const next = transform(current);
        latestState = next;
        return next;
      });
      return <GalleryDialog onClose={vi.fn()} onUpdate={update} open state={state} />;
    }

    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Add Gallery' });
    await user.upload(
      within(dialog).getByLabelText(/Upload portfolio photos/u),
      new File(['invalid'], 'corrupt.jpg', { type: 'image/jpeg' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No images were added. 1 image was skipped.',
    );
    expect(latestState.gallery).toMatchObject({ images: [], source: null });
    expect(latestState.recipe.galleryEnabled).toBe(false);
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
  });

  it('passes confirmed Canva files, display, and placement through the real integration seam', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.wantsCanvaFromWelcome = true;
    const onAdd = vi.fn(async () => ({
      addedCount: 1,
      addedImages: [{
        assetId: 'asset-canva',
        fileName: 'isla-canva.png',
        id: 'image-canva',
        mimeType: 'image/png' as const,
      }],
      failures: [],
      sectionId: 'section-canva',
      status: 'committed' as const,
    }));
    const onClose = vi.fn();
    render(
      <CanvaDialog
        available
        onAdd={onAdd}
        onClose={onClose}
        open
        state={state}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Upload a Canva design' });
    expect(within(dialog).getByText('Recommended from your welcome choice')).toBeVisible();
    const file = new File(['page'], 'isla-canva.png', { type: 'image/png' });
    expect(within(dialog).getByLabelText(/Choose Canva pages/)).toHaveClass('visually-hidden');
    await user.upload(within(dialog).getByLabelText(/Choose Canva pages/), file);
    const fullWidth = within(dialog).getByRole('radio', { name: 'Full width' });
    const beforeBooking = within(dialog).getByRole('radio', { name: 'Before Booking' });
    expect(fullWidth).toHaveAttribute('value', 'full_width');
    expect(beforeBooking).toHaveAttribute('value', 'before_booking');
    await user.click(fullWidth);
    await user.click(beforeBooking);
    await user.click(within(dialog).getByRole('button', { name: 'Add Canva design' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(onAdd).toHaveBeenCalledWith([file], 'full_width', 'before_booking');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps a partial Canva result visible with exact filenames and one capacity summary', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.canva.images = [];
    const onAdd = vi.fn(async () => ({
      addedCount: 1,
      addedImages: [{
        assetId: 'asset-page-10',
        fileName: 'page-10.png',
        id: 'image-page-10',
        mimeType: 'image/png' as const,
      }],
      failures: [{
        code: 'too_many_images',
        fileName: 'page-11.png',
        index: 1,
        message: 'This section can contain up to 10 images.',
      }],
      sectionId: 'section-canva',
      status: 'partial' as const,
    }));
    let latest = state;
    const onUpdate: OnboardingStateUpdater = (transform) => {
      latest = transform(latest);
    };
    render(
      <CanvaDialog
        available
        onAdd={onAdd}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        open
        state={state}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Upload a Canva design' });
    await user.upload(
      within(dialog).getByLabelText(/Choose Canva pages/),
      [
        new File(['ten'], 'page-10.png', { type: 'image/png' }),
        new File(['eleven'], 'page-11.png', { type: 'image/png' }),
      ],
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add Canva design' }));

    expect(await within(dialog).findByText(/up to 10 images/u)).toBeVisible();
    expect(within(dialog).getByText('page-11.png:')).toBeVisible();
    expect(latest.canva.uploadResult).toMatchObject({
      addedCount: 1,
      failures: [{ fileName: 'page-11.png' }],
    });
  });

  it('keeps other failed rows and duplicate filenames while one Canva file is retried', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.canva.images = [];
    const onAdd = vi.fn()
      .mockResolvedValueOnce({
        addedCount: 1,
        addedImages: [{
          assetId: 'asset-good',
          fileName: 'good.png',
          id: 'image-good',
          mimeType: 'image/png' as const,
        }],
        failures: [
          { fileName: 'duplicate.png', index: 0, message: 'Could not decode first copy.' },
          { fileName: 'duplicate.png', index: 1, message: 'Could not decode second copy.' },
        ],
        sectionId: 'section-canva',
        status: 'partial' as const,
      })
      .mockResolvedValueOnce({
        addedCount: 1,
        addedImages: [{
          assetId: 'asset-retry',
          fileName: 'duplicate.png',
          id: 'image-retry',
          mimeType: 'image/png' as const,
        }],
        failures: [],
        sectionId: 'section-canva',
        status: 'committed' as const,
      });
    let latest = state;
    const onUpdate: OnboardingStateUpdater = (transform) => {
      latest = transform(latest);
    };
    render(
      <CanvaDialog
        available
        onAdd={onAdd}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        open
        state={state}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Upload a Canva design' });
    await user.upload(within(dialog).getByLabelText(/Choose Canva pages/u), [
      new File(['first'], 'duplicate.png', { type: 'image/png' }),
      new File(['second'], 'duplicate.png', { type: 'image/png' }),
      new File(['good'], 'good.png', { type: 'image/png' }),
    ]);
    await user.click(within(dialog).getByRole('button', { name: 'Add Canva design' }));

    expect(await within(dialog).findAllByText('duplicate.png:')).toHaveLength(2);
    const retryButtons = within(dialog).getAllByRole('button', { name: 'Try again' });
    expect(retryButtons).toHaveLength(2);
    await user.click(retryButtons[0]!);

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(within(dialog).getAllByText('duplicate.png:')).toHaveLength(1);
    expect(within(dialog).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    expect(latest.canva.uploadResult).toMatchObject({
      addedCount: 2,
      failures: [{
        fileName: 'duplicate.png',
        message: 'Could not decode second copy.',
      }],
    });
  });

  it('reconciles saved Canva pages through the existing thumbnail asset URLs', () => {
    const state = createDanielaFixtureState();
    state.canva.images = [
      {
        fileName: 'thumbnail-page.png',
        id: 'image-thumbnail',
        mimeType: 'image/png',
        source: 'indexed_db',
        storageId: 'asset-thumbnail',
      },
      {
        fileName: 'original-fallback.jpg',
        id: 'image-original',
        mimeType: 'image/jpeg',
        source: 'indexed_db',
        storageId: 'asset-original',
      },
    ];
    mocks.useCustomDesignAssetMap.mockReturnValue(new Map([
      ['asset-thumbnail', {
        original: {
          assetId: 'asset-thumbnail',
          kind: 'original',
          status: 'loading',
        },
        thumbnail: {
          assetId: 'asset-thumbnail',
          kind: 'thumbnail',
          status: 'ready',
          url: 'blob:luster/thumbnail-page',
        },
      }],
      ['asset-original', {
        original: {
          assetId: 'asset-original',
          kind: 'original',
          status: 'ready',
          url: 'blob:luster/original-page',
        },
        thumbnail: {
          assetId: 'asset-original',
          kind: 'thumbnail',
          status: 'missing',
        },
      }],
    ]));

    render(
      <CanvaDialog
        available
        onAdd={vi.fn()}
        onClose={vi.fn()}
        open
        state={state}
      />,
    );

    expect(mocks.useCustomDesignAssetMap).toHaveBeenCalledWith([
      'asset-thumbnail',
      'asset-original',
    ]);
    const list = screen.getByRole('list', { name: 'Saved Canva pages' });
    expect(list).toHaveClass('onboarding-file-list--visual');
    expect(within(list).getByText('thumbnail-page.png')).toBeVisible();
    expect(within(list).getByText('original-fallback.jpg')).toBeVisible();
    expect([...list.querySelectorAll('img')].map((image) => image.getAttribute('src')))
      .toEqual([
        'blob:luster/thumbnail-page',
        'blob:luster/original-page',
      ]);
  });

  it('reopens the shared image manager and permits a settings-only save', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const section: CustomDesignSectionInstance = {
      id: 'section-canva-manager',
      label: 'Canva design',
      order: 10,
      sectionType: 'custom_design',
      settings: {
        ...createDefaultCustomDesignSettings(),
        displayMode: 'contained',
        images: [{
          altText: '',
          aspectRatio: 0.75,
          assetId: 'asset-manager',
          decorative: false,
          fileName: 'saved-page.png',
          fileSize: 100,
          height: 1_600,
          id: 'image-manager',
          interactiveAreas: [],
          mimeType: 'image/png',
          width: 1_200,
        }],
      },
      visible: true,
    };
    page.sections.push(section);
    state.canva.customDesignSectionId = section.id;
    state.canva.images = [{
      fileName: 'saved-page.png',
      id: 'image-manager',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'asset-manager',
    }];
    mocks.useCustomDesignAssetMap.mockReturnValue(new Map([
      ['asset-manager', {
        original: { assetId: 'asset-manager', kind: 'original', status: 'ready', url: 'blob:saved' },
        thumbnail: { assetId: 'asset-manager', kind: 'thumbnail', status: 'ready', url: 'blob:saved-thumb' },
      }],
    ]));
    const saveSettings = vi.fn(() => ({ section: {
      ...section,
      settings: { ...section.settings, displayMode: 'full_width' as const },
    }, success: true }));
    const replaceImage = vi.fn(async (_sectionId: string, _imageId: string, file: File) => ({
      section: {
        ...section,
        settings: {
          ...section.settings,
          images: section.settings.images.map((image) => ({
            ...image,
            fileName: file.name,
          })),
        },
      },
      success: true as const,
    }));
    const controller = {
      addCanvaDesign: vi.fn(),
      available: true,
      removeDesign: vi.fn(),
      removeImage: vi.fn(),
      reorderImages: vi.fn(),
      replaceImage,
      saveSettings,
      storageError: null,
    } as unknown as CanvaIntegrationController;
    const onClose = vi.fn();
    render(
      <CanvaDialog
        available
        controller={controller}
        document={document}
        onAdd={vi.fn()}
        onClose={onClose}
        onUpdate={vi.fn()}
        open
        state={state}
      />,
    );

    expect(screen.getByText('saved-page.png')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible();
    expect(screen.getByLabelText('Replace')).toHaveClass('visually-hidden');
    await user.upload(
      screen.getByLabelText('Replace'),
      new File(['replacement'], 'replacement.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(replaceImage).toHaveBeenCalledWith(
      section.id,
      'image-manager',
      expect.objectContaining({ name: 'replacement.png' }),
    ));
    await waitFor(() => expect(screen.queryByText('Checking and saving images…'))
      .not.toBeInTheDocument());
    expect(screen.getByLabelText('Choose more images')).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: 'Full width' }));
    await user.click(screen.getByRole('button', { name: 'Save Canva design' }));
    expect(saveSettings).toHaveBeenCalledWith({
      displayMode: 'full_width',
      placement: state.canva.placement,
      sectionId: section.id,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('warns about a dirty page order and does not persist unsaved display settings', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.canva.displayMode = 'contained';
    state.canva.placement = 'after_booking';
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const settings = createDefaultCustomDesignSettings();
    const images = ['first', 'second'].map((name, index) => ({
      altText: '',
      aspectRatio: 0.75,
      assetId: `asset-${name}`,
      decorative: false,
      fileName: `${name}.png`,
      fileSize: 100,
      height: 1_600,
      id: `image-${name}`,
      interactiveAreas: [],
      mimeType: 'image/png' as const,
      width: 1_200,
    }));
    const section: CustomDesignSectionInstance = {
      id: 'section-canva-order',
      label: 'Canva design',
      order: 10,
      sectionType: 'custom_design',
      settings: { ...settings, displayMode: 'contained', images },
      visible: true,
    };
    page.sections.push(section);
    state.canva.customDesignSectionId = section.id;
    state.canva.images = images.map((image) => ({
      fileName: image.fileName,
      id: image.id,
      mimeType: image.mimeType,
      source: 'indexed_db' as const,
      storageId: image.assetId,
    }));
    mocks.useCustomDesignAssetMap.mockReturnValue(new Map());
    const reorderedSection = {
      ...section,
      settings: { ...section.settings, images: [...images].reverse() },
    };
    const reorderImages = vi.fn(() => ({ section: reorderedSection, success: true }));
    const controller = {
      addCanvaDesign: vi.fn(),
      available: true,
      removeDesign: vi.fn(),
      removeImage: vi.fn(),
      reorderImages,
      replaceImage: vi.fn(),
      saveSettings: vi.fn(),
      storageError: null,
    } as unknown as CanvaIntegrationController;
    const onClose = vi.fn();
    let latest = state;
    const onUpdate: OnboardingStateUpdater = (transform) => {
      latest = transform(latest);
    };

    render(
      <CanvaDialog
        available
        controller={controller}
        document={document}
        onAdd={vi.fn()}
        onClose={onClose}
        onUpdate={onUpdate}
        open
        state={state}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Full width' }));
    await user.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const warning = screen.getByRole('dialog', { name: 'Save this page order?' });
    expect(within(warning).getByRole('button', { name: 'Keep editing' })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(warning).getByRole('button', { name: 'Save order' }));

    expect(reorderImages).toHaveBeenCalledWith(section.id, [
      'image-second',
      'image-first',
    ]);
    expect(latest.canva.displayMode).toBe('contained');
    expect(latest.canva.placement).toBe('after_booking');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps a dirty relative order while newly uploaded pages join the shared manager', async () => {
    const user = userEvent.setup();
    const initialState = createDanielaFixtureState();
    const initialDocument = initializeStarter('quick_book');
    const page = initialDocument.pages[0]!;
    const makeImage = (name: string) => ({
      altText: '',
      aspectRatio: 0.75,
      assetId: `asset-${name}`,
      decorative: false,
      fileName: `${name}.png`,
      fileSize: 100,
      height: 1_600,
      id: `image-${name}`,
      interactiveAreas: [],
      mimeType: 'image/png' as const,
      width: 1_200,
    });
    let currentSection: CustomDesignSectionInstance = {
      id: 'section-canva-add-more',
      label: 'Canva design',
      order: 10,
      sectionType: 'custom_design',
      settings: {
        ...createDefaultCustomDesignSettings(),
        images: [makeImage('first'), makeImage('second')],
      },
      visible: true,
    };
    page.sections.push(currentSection);
    initialState.canva.customDesignSectionId = currentSection.id;
    initialState.canva.images = currentSection.settings.images.map((image) => ({
      fileName: image.fileName,
      id: image.id,
      mimeType: image.mimeType,
      source: 'indexed_db' as const,
      storageId: image.assetId,
    }));
    const reorderImages = vi.fn((_: string, ids: readonly string[]) => {
      const byId = new Map(currentSection.settings.images.map((image) => [image.id, image]));
      currentSection = {
        ...currentSection,
        settings: {
          ...currentSection.settings,
          images: ids.flatMap((id) => {
            const image = byId.get(id);
            return image ? [image] : [];
          }),
        },
      };
      return { section: currentSection, success: true };
    });

    function Harness() {
      const [document, setDocument] = useState(initialDocument);
      const [state, setState] = useState(initialState);
      const controller = {
        addCanvaDesign: vi.fn(),
        available: true,
        removeDesign: vi.fn(),
        removeImage: vi.fn(),
        reorderImages,
        replaceImage: vi.fn(),
        saveSettings: vi.fn(),
        storageError: null,
      } as unknown as CanvaIntegrationController;
      const add = async (files: readonly File[]): Promise<Awaited<ReturnType<CanvaIntegrationController['addCanvaDesign']>>> => {
        const added = makeImage('third');
        currentSection = {
          ...currentSection,
          settings: {
            ...currentSection.settings,
            images: [...currentSection.settings.images, added],
          },
        };
        setDocument((current) => ({
          ...current,
          pages: current.pages.map((candidate) => candidate.id === page.id
            ? {
                ...candidate,
                sections: candidate.sections.map((section) => section.id === currentSection.id
                  ? currentSection
                  : section),
              }
            : candidate),
        }));
        return {
          addedCount: 1,
          addedImages: [{
            assetId: added.assetId,
            fileName: files[0]?.name ?? added.fileName,
            id: added.id,
            mimeType: added.mimeType,
          }],
          failures: [],
          sectionId: currentSection.id,
          status: 'committed',
        };
      };
      return (
        <CanvaDialog
          available
          controller={controller}
          document={document}
          onAdd={add}
          onClose={vi.fn()}
          onUpdate={(transform) => setState((current) => transform(current))}
          open
          state={state}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    await user.upload(
      screen.getByLabelText('Choose more images'),
      new File(['third'], 'third.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('third.png')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save order' }));

    expect(reorderImages).toHaveBeenCalledWith(currentSection.id, [
      'image-second',
      'image-first',
      'image-third',
    ]);
  });

  it('keeps a removed page in the onboarding ownership ledger for later scoped Reset cleanup', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const makeImage = (name: string) => ({
      altText: '',
      aspectRatio: 0.75,
      assetId: `asset-${name}`,
      decorative: false,
      fileName: `${name}.png`,
      fileSize: 100,
      height: 1_600,
      id: `image-${name}`,
      interactiveAreas: [],
      mimeType: 'image/png' as const,
      width: 1_200,
    });
    const first = makeImage('first');
    const second = makeImage('second');
    const section: CustomDesignSectionInstance = {
      id: 'section-canva-removal-ledger',
      label: 'Canva design',
      order: 10,
      sectionType: 'custom_design',
      settings: {
        ...createDefaultCustomDesignSettings(),
        images: [first, second],
      },
      visible: true,
    };
    page.sections.push(section);
    state.canva.customDesignSectionId = section.id;
    state.canva.images = [first, second].map((image) => ({
      fileName: image.fileName,
      id: image.id,
      mimeType: image.mimeType,
      source: 'indexed_db' as const,
      storageId: image.assetId,
    }));
    state.canva.ownedAssetIds = [first.assetId, second.assetId];
    const sectionAfterRemoval: CustomDesignSectionInstance = {
      ...section,
      settings: { ...section.settings, images: [second] },
    };
    const removeImage = vi.fn(async () => ({
      section: sectionAfterRemoval,
      success: true as const,
    }));
    const controller = {
      addCanvaDesign: vi.fn(),
      available: true,
      removeDesign: vi.fn(),
      removeImage,
      reorderImages: vi.fn(),
      replaceImage: vi.fn(),
      saveSettings: vi.fn(),
      storageError: null,
    } as unknown as CanvaIntegrationController;
    let latest = state;

    render(
      <CanvaDialog
        available
        controller={controller}
        document={document}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        onUpdate={(transform) => { latest = transform(latest); }}
        open
        state={state}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);

    await waitFor(() => expect(removeImage).toHaveBeenCalledWith(section.id, first.id));
    expect(latest.canva.images).toEqual([
      expect.objectContaining({ storageId: second.assetId }),
    ]);
    expect(latest.canva.ownedAssetIds).toEqual([first.assetId, second.assetId]);
    expect(parseOnboardingState(JSON.stringify(latest)).state.canva.ownedAssetIds)
      .toEqual([first.assetId, second.assetId]);
  });

  it('releases temporary Canva preview URLs when pages are removed or the dialog closes', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.canva.images = [];
    const createObjectURL = vi.fn((blob: Blob) =>
      `blob:luster/${blob instanceof File ? blob.name : 'preview'}`);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const onAdd = vi.fn();
    const onClose = vi.fn();

    const view = render(
      <CanvaDialog
        available
        onAdd={onAdd}
        onClose={onClose}
        open
        state={state}
      />,
    );
    const input = screen.getByLabelText(/Choose Canva pages/u);
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    await user.upload(input, first);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(first));
    expect(screen.getByRole('list', { name: 'Selected Canva pages' }))
      .toHaveClass('onboarding-file-list--visual');

    await user.click(screen.getByRole('button', { name: 'Remove first.png' }));
    await waitFor(() => expect(revokeObjectURL)
      .toHaveBeenCalledWith('blob:luster/first.png'));

    const second = new File(['second'], 'second.webp', { type: 'image/webp' });
    await user.upload(input, second);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(second));
    view.rerender(
      <CanvaDialog
        available
        onAdd={onAdd}
        onClose={onClose}
        open={false}
        state={state}
      />,
    );
    await waitFor(() => expect(revokeObjectURL)
      .toHaveBeenCalledWith('blob:luster/second.webp'));
  });
});
