import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import type { OnboardingLabState } from '../model/types';
import { ExtrasScreen, type OnboardingStateUpdater } from '../screens/DesignScreens';
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

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '1 image was added and 1 was skipped.',
    );
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
    await user.upload(within(dialog).getByLabelText(/Choose Canva pages/), file);
    await user.click(within(dialog).getByRole('radio', { name: 'Full width' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Before Booking' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Canva design' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(onAdd).toHaveBeenCalledWith([file], 'full_width', 'before_booking');
    expect(onClose).toHaveBeenCalledOnce();
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
