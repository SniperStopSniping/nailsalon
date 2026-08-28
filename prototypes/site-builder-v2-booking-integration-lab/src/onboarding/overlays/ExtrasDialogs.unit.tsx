import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import type { OnboardingLabState } from '../model/types';
import { ExtrasScreen, type OnboardingStateUpdater } from '../screens/DesignScreens';
import { CanvaDialog, GalleryDialog } from './ExtrasDialogs';

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
  beforeEach(installMatchMedia);

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
    await user.click(within(dialog).getByRole('button', { name: 'Add Gallery preview' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Choose portfolio images/i);
    await user.click(within(dialog).getByRole('button', { name: /Use mock Luster portfolio/ }));
    await user.click(within(dialog).getByRole('radio', { name: 'editorial' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Gallery preview' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Gallery' })).not.toBeInTheDocument());
    expect(latestState.gallery).toMatchObject({ layout: 'editorial', source: 'mock_luster' });
    expect(latestState.gallery.images).toHaveLength(4);
    expect(latestState.recipe.galleryEnabled).toBe(true);
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
});
