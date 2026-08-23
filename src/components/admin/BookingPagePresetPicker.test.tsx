import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOOKING_PAGE_PRESET_RECIPES,
  type BookingPagePresetId,
  type BookingPagePresetPresentationState,
  getBookingPagePresentationSignature,
} from '@/libs/bookingPagePresetRecipes';

import { BookingPagePresetPicker } from './BookingPagePresetPicker';

function presentation(presetId: BookingPagePresetId): BookingPagePresetPresentationState {
  const recipe = BOOKING_PAGE_PRESET_RECIPES[presetId];

  return {
    layout: recipe.layout,
    sectionOrder: recipe.sectionOrder,
    hiddenSections: recipe.hiddenSections,
    sectionVariants: recipe.sectionVariants,
    presetBase: recipe.presetBase,
  };
}

function renderPicker({
  draft = presentation('quick_book'),
  pending = false,
  disabled = false,
  status = 'idle' as const,
  previewBaseUrl = null,
  onOperation = vi.fn(),
}: Partial<React.ComponentProps<typeof BookingPagePresetPicker>> = {}) {
  const view = render(
    <BookingPagePresetPicker
      draft={draft}
      pending={pending}
      disabled={disabled}
      status={status}
      previewBaseUrl={previewBaseUrl}
      onOperation={onOperation}
    />,
  );

  return { ...view, onOperation };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookingPagePresetPicker', () => {
  it('renders the closed four-card set and derives an exact current preset', () => {
    renderPicker({ draft: presentation('signature') });

    const list = screen.getByTestId('booking-page-preset-list');

    expect(within(list).getAllByRole('button')).toHaveLength(4);
    expect(within(list).getByText('Quick Book')).toBeInTheDocument();
    expect(within(list).getByText('Signature')).toBeInTheDocument();
    expect(within(list).getByText('Menu')).toBeInTheDocument();
    expect(within(list).getByText('Collective')).toBeInTheDocument();
    expect(screen.getByTestId('booking-page-preset-state')).toHaveTextContent('Signature');
    expect(screen.getByRole('button', { name: 'Signature starting design, current' }))
      .toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /Custom/i })).not.toBeInTheDocument();
  });

  it('opens a guarded confirmation without changing the draft', async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    renderPicker({ onOperation });

    await user.click(screen.getByRole('button', { name: 'Menu starting design' }));

    expect(onOperation).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog', { name: 'Switch to Menu?' });

    expect(dialog).toHaveTextContent(
      'Only the draft’s layout, section order, section visibility, and section presentations will change.',
    );
    expect(dialog).toHaveTextContent('Starting design: Quick Book v1 → Menu v1');
    expect(dialog).toHaveTextContent('Page layout: Quick Book → Editorial');
    expect(dialog).toHaveTextContent('Services presentation: List → Grouped categories');
    expect(dialog).toHaveTextContent(
      'Your salon details, services, prices, policy text, style pack, and custom color settings stay unchanged.',
    );
    expect(dialog).toHaveTextContent('Your live booking page will not change until you publish.');
    expect(within(dialog).queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-page-preset-dialog-overlay')).toHaveClass('items-stretch');
    expect(screen.getByTestId('dialog-shell-container')).toHaveClass('flex', 'items-center');
    expect(screen.getByTestId('booking-page-preset-dialog-content')).toHaveClass(
      'max-h-full',
      'w-full',
      'overflow-y-auto',
    );
  });

  it('focuses Cancel first and returns focus to the card when cancelled', async () => {
    const user = userEvent.setup();
    renderPicker();

    const opener = screen.getByRole('button', { name: 'Collective starting design' });
    await user.click(opener);
    const cancel = await screen.findByRole('button', { name: 'Cancel' });

    await waitFor(() => expect(cancel).toHaveFocus());
    await user.click(cancel);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('moves focus to a stable heading when confirming immediately disables the opener', async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    const viewRef: { current: ReturnType<typeof render> | null } = { current: null };
    viewRef.current = render(
      <BookingPagePresetPicker
        draft={presentation('quick_book')}
        pending={false}
        onOperation={(operation) => {
          onOperation(operation);
          viewRef.current?.rerender(
            <BookingPagePresetPicker
              draft={presentation('quick_book')}
              pending
              onOperation={onOperation}
            />,
          );
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collective starting design' }));
    await user.click(await screen.findByRole('button', { name: 'Use Collective' }));

    expect(onOperation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Starting design' }))
      .toHaveFocus());

    expect(document.body).not.toHaveFocus();
  });

  it('shows a non-mutating real-renderer target preview before confirmation', async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    renderPicker({
      previewBaseUrl: '/en/salon-a/book/service?builderPreview=8',
      onOperation,
    });

    await user.click(screen.getByRole('button', { name: 'Menu starting design' }));

    const preview = await screen.findByTitle('Menu design preview');

    expect(preview).toHaveAttribute(
      'src',
      'http://localhost:3000/en/salon-a/book/service?builderPreview=8&presetPreview=menu&presetPreviewVersion=1',
    );
    expect(preview).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview).toHaveAttribute('tabindex', '-1');
    expect(preview).toHaveClass('pointer-events-none');
    expect(onOperation).not.toHaveBeenCalled();
  });

  it('emits one semantic apply operation with the signature that was confirmed and never fetches or publishes', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    const onOperation = vi.fn();
    const draft = presentation('quick_book');
    vi.stubGlobal('fetch', fetchMock);
    renderPicker({ draft, onOperation });

    await user.click(screen.getByRole('button', { name: 'Menu starting design' }));
    await user.click(await screen.findByRole('button', { name: 'Use Menu' }));

    expect(onOperation).toHaveBeenCalledTimes(1);
    expect(onOperation).toHaveBeenCalledWith({
      type: 'apply_preset',
      presetId: 'menu',
      presetVersion: 1,
      expectedPresentationSignature: getBookingPagePresentationSignature(draft),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('keeps the opened confirmation bound to the presentation the owner reviewed', async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    const originalDraft = presentation('quick_book');
    const { rerender } = renderPicker({ draft: originalDraft, onOperation });

    await user.click(screen.getByRole('button', { name: 'Collective starting design' }));
    const changedDraft: BookingPagePresetPresentationState = {
      ...originalDraft,
      hiddenSections: ['policies'],
    };
    rerender(
      <BookingPagePresetPicker
        draft={changedDraft}
        pending={false}
        onOperation={onOperation}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use Collective' }));

    expect(onOperation).toHaveBeenCalledWith(expect.objectContaining({
      expectedPresentationSignature: getBookingPagePresentationSignature(originalDraft),
    }));
    expect(onOperation).not.toHaveBeenCalledWith(expect.objectContaining({
      expectedPresentationSignature: getBookingPagePresentationSignature(changedDraft),
    }));
  });

  it('derives both Custom labels from structure and provenance without offering a Custom action', () => {
    const quickBook = presentation('quick_book');
    const customizedFromPreset: BookingPagePresetPresentationState = {
      ...quickBook,
      hiddenSections: ['policies'],
    };
    const { rerender } = renderPicker({ draft: customizedFromPreset });

    expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Custom · based on Quick Book');
    expect(screen.queryByRole('button', { name: /Custom/i })).not.toBeInTheDocument();

    rerender(
      <BookingPagePresetPicker
        draft={{ ...customizedFromPreset, presetBase: null }}
        pending={false}
        onOperation={vi.fn()}
      />,
    );

    expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Custom · existing design');
    expect(screen.queryByRole('button', { name: /Custom/i })).not.toBeInTheDocument();
  });

  it('recognizes an unchanged preset when its section presentations are inherited', () => {
    const signature = presentation('signature');
    renderPicker({
      draft: {
        ...signature,
        sectionVariants: {},
      },
    });

    expect(screen.getByTestId('booking-page-preset-state')).toHaveTextContent('Signature');
    expect(screen.getByRole('button', { name: 'Signature starting design, current' }))
      .toBeDisabled();
  });

  it('warns before replacing custom presentation choices', async () => {
    const user = userEvent.setup();
    const quickBook = presentation('quick_book');
    renderPicker({
      draft: {
        ...quickBook,
        sectionVariants: { ...quickBook.sectionVariants, serviceMenu: 'grouped_categories' },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Signature starting design' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'You have custom presentation changes. Switching will replace them in the draft.',
    );
  });

  it('locks an open confirmation while its semantic operation is pending', async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    const { rerender } = renderPicker({ onOperation });

    await user.click(screen.getByRole('button', { name: 'Menu starting design' }));
    await screen.findByRole('alertdialog');
    rerender(
      <BookingPagePresetPicker
        draft={presentation('quick_book')}
        pending
        onOperation={onOperation}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Switching…' })).toBeDisabled();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onOperation).not.toHaveBeenCalled();
  });

  it('disables every action while pending and presents stale and success outcomes accessibly', () => {
    const { rerender } = renderPicker({ pending: true });

    for (const button of within(screen.getByTestId('booking-page-preset-list')).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }

    expect(screen.getByRole('status')).toHaveTextContent('Saving draft…');

    rerender(
      <BookingPagePresetPicker
        draft={presentation('quick_book')}
        pending={false}
        status="stale"
        onOperation={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Your draft changed since you opened the confirmation.',
    );

    rerender(
      <BookingPagePresetPicker
        draft={presentation('menu')}
        pending={false}
        status="success"
        onOperation={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Starting design applied to your draft.',
    );
  });
});
