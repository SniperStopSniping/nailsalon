import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { listBookingPageBuilderSections } from '@/libs/bookingPageBuilder';
import type { BookingPageConfigSide, SectionId } from '@/libs/bookingPageConfig';
import { getBookingPagePresentationSignature } from '@/libs/bookingPagePresetRecipes';

import { BookingPageBuilder } from './BookingPageBuilder';

function side(overrides: Partial<BookingPageConfigSide> = {}): BookingPageConfigSide {
  return {
    layout: 'quick_book',
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: [
      'salonProfile',
      'serviceMenu',
      'featuredServices',
      'policies',
      'socialLinks',
      'bookingCta',
    ],
    sectionVariants: {},
    hiddenSections: [],
    businessMode: 'solo',
    startMode: 'services_first',
    ...overrides,
  };
}

function sectionRowIds(): string[] {
  return within(screen.getByTestId('booking-page-builder-section-list'))
    .getAllByRole('listitem')
    .map(row => row.getAttribute('data-section-id') ?? '');
}

function modelBrowserFocusLossToBody(): void {
  document.body.tabIndex = -1;
  document.body.focus();

  expect(document.body).toHaveFocus();

  document.body.removeAttribute('tabindex');
}

function reorderableSectionOrder(
  draft: BookingPageConfigSide,
  sectionOrder: readonly SectionId[] = draft.sectionOrder,
): SectionId[] {
  const reorderableIds = new Set(
    listBookingPageBuilderSections(draft.layout)
      .filter(definition => definition.reorderable)
      .map(definition => definition.id),
  );

  return sectionOrder.filter(sectionId => reorderableIds.has(sectionId));
}

describe('BookingPageBuilder', () => {
  it('keeps configured DOM order and appends every absent section exactly once', () => {
    render(
      <BookingPageBuilder
        draft={side({
          sectionOrder: ['salonProfile', 'hoursLocation', 'serviceMenu', 'bookingCta'],
        })}
        pending={false}
        onOperation={vi.fn()}
      />,
    );

    expect(sectionRowIds()).toEqual([
      'salonProfile',
      'hoursLocation',
      'serviceMenu',
      'bookingCta',
      'technicianProfile',
      'featuredServices',
      'whatsIncluded',
      'technicianList',
      'portfolio',
      'reviews',
      'policies',
      'socialLinks',
    ]);
    expect(new Set(sectionRowIds())).toHaveProperty('size', 12);
  });

  it('states protected, visible, hidden, missing-content, and unsupported states explicitly', () => {
    const previewed = new Set<SectionId>(['salonProfile', 'serviceMenu', 'featuredServices']);

    render(
      <BookingPageBuilder
        draft={side({
          sectionOrder: [
            'salonProfile',
            'serviceMenu',
            'featuredServices',
            'hoursLocation',
            'policies',
            'bookingCta',
          ],
          hiddenSections: ['policies'],
        })}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={vi.fn()}
      />,
    );

    expect(screen.getByTestId('builder-section-status-salonProfile')).toHaveTextContent('Protected');
    expect(screen.getByTestId('builder-section-bookingCta')).toHaveTextContent(
      'This section keeps the booking page complete and cannot be hidden.',
    );
    expect(screen.getByTestId('builder-section-bookingCta')).not.toHaveTextContent(
      'Add its content',
    );
    expect(screen.getByTestId('builder-section-status-featuredServices')).toHaveTextContent('Visible');
    expect(screen.getByTestId('builder-section-status-policies')).toHaveTextContent('Hidden');
    expect(screen.getByTestId('builder-section-status-hoursLocation')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('builder-section-hoursLocation')).toHaveTextContent('Add the section content');
    expect(screen.getByTestId('builder-section-status-portfolio')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('builder-section-portfolio')).toHaveTextContent('not available yet');
  });

  it('emits bounded visibility operations only for supported owner-configurable sections', () => {
    const onOperation = vi.fn();

    render(
      <BookingPageBuilder
        draft={side({ hiddenSections: ['policies'] })}
        pending={false}
        onOperation={onOperation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide Featured services' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Policies' }));

    expect(onOperation).toHaveBeenNthCalledWith(1, {
      type: 'set_visibility',
      sectionId: 'featuredServices',
      visible: false,
    });
    expect(onOperation).toHaveBeenNthCalledWith(2, {
      type: 'set_visibility',
      sectionId: 'policies',
      visible: true,
    });
    expect(screen.queryByTestId('builder-visibility-salonProfile')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-visibility-serviceMenu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-visibility-portfolio')).not.toBeInTheDocument();
  });

  it('offers native move buttons only for rendered, flow-placed, reorderable sections', () => {
    const onOperation = vi.fn();
    const draft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(draft.sectionOrder);

    render(
      <BookingPageBuilder
        draft={draft}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const featuredUp = screen.getByRole('button', { name: 'Move Featured services up' });
    const featuredDown = screen.getByRole('button', { name: 'Move Featured services down' });

    expect(featuredUp).toBeDisabled();
    expect(featuredDown).toBeEnabled();
    expect(featuredDown).toHaveClass('min-h-11');

    fireEvent.click(featuredDown);

    expect(onOperation).toHaveBeenCalledWith({
      type: 'move_section',
      sectionId: 'featuredServices',
      targetSectionId: 'technicianProfile',
      direction: 'down',
    });
    expect(screen.queryByTestId('builder-move-up-socialLinks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-move-up-serviceMenu')).not.toBeInTheDocument();
    expect(screen.getByTestId('builder-section-socialLinks')).toHaveTextContent(
      'Position is fixed with Services in this layout.',
    );
  });

  it('waits for real preview admission before exposing reorder controls', () => {
    const draft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const view = render(
      <BookingPageBuilder
        draft={draft}
        previewedSectionIds={null}
        pending={false}
        onOperation={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Move Featured services down' }))
      .not.toBeInTheDocument();

    view.rerender(
      <BookingPageBuilder
        draft={draft}
        previewedSectionIds={new Set<SectionId>(draft.sectionOrder)}
        pending={false}
        onOperation={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toBeEnabled();
  });

  it('restores focus after the pending save and announces the resulting movable position', async () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);

    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={previewed}
        pending
        onOperation={onOperation}
      />,
    );
    // Browsers move focus to BODY when a focused button becomes disabled;
    // JSDOM does not implement that behavior, so model it explicitly.
    modelBrowserFocusLossToBody();

    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    expect(sectionRowIds().slice(0, 3)).toEqual([
      'salonProfile',
      'technicianProfile',
      'featuredServices',
    ]);
    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Move Featured services up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toBeDisabled();

    // A second move cannot start from preserved-but-stale admission evidence.
    fireEvent.click(screen.getByRole('button', { name: 'Move Featured services down' }));

    expect(onOperation).toHaveBeenCalledTimes(1);

    // A changed Set from an older iframe revision must not settle the move.
    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(movedDraft.sectionOrder)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(movedDraft.sectionOrder)}
        previewedReorderableSectionOrder={reorderableSectionOrder(movedDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 4 movable sections.',
    );
    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('builder-reorder-status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('builder-reorder-status')).toHaveAttribute('aria-atomic', 'true');
  });

  it('moves focus to the stable section row when refreshed Stage 2 admission omits the moved section', async () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const initiallyPreviewed = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={initiallyPreviewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={initiallyPreviewed}
        pending
        onOperation={onOperation}
      />,
    );
    modelBrowserFocusLossToBody();
    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={initiallyPreviewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(
          movedDraft.sectionOrder.filter(sectionId => sectionId !== 'featuredServices'),
        )}
        previewedReorderableSectionOrder={reorderableSectionOrder(
          movedDraft,
          movedDraft.sectionOrder.filter(sectionId => sectionId !== 'featuredServices'),
        )}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    expect(screen.queryByRole('button', { name: 'Move Featured services down' }))
      .not.toBeInTheDocument();
    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services is no longer available to reorder in the current preview.',
    );
  });

  it('tracks a server-rebased move when the semantic order changes but its numeric position does not', async () => {
    const onOperation = vi.fn();
    const staleClientDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'policies',
        'serviceMenu',
        'socialLinks',
        'bookingCta',
      ],
    });
    const rebasedServerDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'policies',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'socialLinks',
        'bookingCta',
      ],
    });
    const initiallyPreviewed = new Set<SectionId>(staleClientDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={staleClientDraft}
        previewedSectionIds={initiallyPreviewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);

    expect(onOperation).toHaveBeenCalledWith({
      type: 'move_section',
      sectionId: 'featuredServices',
      targetSectionId: 'policies',
      direction: 'down',
    });

    view.rerender(
      <BookingPageBuilder
        draft={staleClientDraft}
        previewedSectionIds={initiallyPreviewed}
        pending
        onOperation={onOperation}
      />,
    );
    modelBrowserFocusLossToBody();
    view.rerender(
      <BookingPageBuilder
        draft={rebasedServerDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={initiallyPreviewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(
      <BookingPageBuilder
        draft={rebasedServerDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(rebasedServerDraft.sectionOrder)}
        previewedReorderableSectionOrder={reorderableSectionOrder(rebasedServerDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 3 movable sections.',
    );
    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toHaveFocus();
  });

  it('never announces the stale movable count when another tab hides an unrelated section', () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
      hiddenSections: ['policies'],
    });
    const initiallyPreviewed = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={initiallyPreviewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Featured services down' }));
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={initiallyPreviewed}
        pending
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={initiallyPreviewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(
          movedDraft.sectionOrder.filter(sectionId => sectionId !== 'policies'),
        )}
        previewedReorderableSectionOrder={reorderableSectionOrder(
          movedDraft,
          movedDraft.sectionOrder.filter(sectionId => sectionId !== 'policies'),
        )}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 3 movable sections.',
    );
  });

  it.each([
    {
      caseName: 'same membership reordered after the PATCH response',
      hiddenSections: [] as SectionId[],
      previewOrder: [
        'salonProfile',
        'technicianProfile',
        'hoursLocation',
        'featuredServices',
        'serviceMenu',
        'policies',
        'socialLinks',
        'bookingCta',
      ] as SectionId[],
      expected: 'Featured services moved to position 3 of 4 movable sections.',
    },
    {
      caseName: 'a locally hidden participant shown before the preview rendered',
      hiddenSections: ['policies'] as SectionId[],
      previewOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ] as SectionId[],
      expected: 'Featured services moved to position 2 of 4 movable sections.',
    },
  ])('announces from exact Stage 2 DOM order when $caseName', ({
    expected,
    hiddenSections,
    previewOrder,
  }) => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const returnedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
      hiddenSections,
    });
    const initialPreview = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Featured services down' }));
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={returnedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(
      <BookingPageBuilder
        draft={returnedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(previewOrder)}
        previewedReorderableSectionOrder={reorderableSectionOrder(returnedDraft, previewOrder)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(expected);
  });

  it('fails closed when a concurrent preset makes the moved section fixed before attestation', async () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const returnedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const concurrentQuickBookDraft = side({
      layout: 'quick_book',
      sectionOrder: returnedDraft.sectionOrder,
    });
    const initialPreview = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending
        onOperation={onOperation}
      />,
    );
    modelBrowserFocusLossToBody();
    view.rerender(
      <BookingPageBuilder
        draft={returnedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={returnedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(concurrentQuickBookDraft.sectionOrder)}
        previewedReorderableSectionOrder={reorderableSectionOrder(concurrentQuickBookDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services is no longer available to reorder in the current preview.',
    );
    expect(screen.getByRole('button', { name: 'Move Featured services up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toBeDisabled();
  });

  it('uses a concurrent Quick Book-to-Editorial movable order for focus and boundaries', async () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'quick_book',
      sectionOrder: [
        'salonProfile',
        'hoursLocation',
        'technicianProfile',
        'serviceMenu',
        'featuredServices',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const returnedDraft = side({
      layout: 'quick_book',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'hoursLocation',
        'serviceMenu',
        'featuredServices',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const concurrentEditorialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'hoursLocation',
        'serviceMenu',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const initialPreview = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Hours & location down' });
    moveDown.focus();
    fireEvent.click(moveDown);

    expect(onOperation).toHaveBeenCalledWith({
      type: 'move_section',
      sectionId: 'hoursLocation',
      targetSectionId: 'technicianProfile',
      direction: 'down',
    });

    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending
        onOperation={onOperation}
      />,
    );
    modelBrowserFocusLossToBody();
    view.rerender(
      <BookingPageBuilder
        draft={returnedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={initialPreview}
        previewedReorderableSectionOrder={reorderableSectionOrder(initialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={returnedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(concurrentEditorialDraft.sectionOrder)}
        previewedReorderableSectionOrder={reorderableSectionOrder(concurrentEditorialDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Hours & location down' })).toHaveFocus();
    });

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Hours & location moved to position 3 of 4 movable sections.',
    );
    expect(screen.getByRole('button', { name: 'Move Hours & location down' })).toBeEnabled();
  });

  it('completes an accepted move even when the returned order equals the stale local snapshot', () => {
    const onOperation = vi.fn();
    const staleLocalDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const currentAttestedOrder: SectionId[] = [
      'featuredServices',
      'technicianProfile',
      'hoursLocation',
      'policies',
    ];
    const returnedAttestedOrder: SectionId[] = [
      'technicianProfile',
      'featuredServices',
      'hoursLocation',
      'policies',
    ];
    const previewed = new Set<SectionId>(staleLocalDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={staleLocalDraft}
        completedMoveRevision={null}
        previewAdmissionRevision={5}
        previewRequestRevision={5}
        previewedSectionIds={previewed}
        previewedReorderableSectionOrder={currentAttestedOrder}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveUp = screen.getByRole('button', { name: 'Move Technician profile up' });
    moveUp.focus();
    fireEvent.click(moveUp);

    expect(onOperation).toHaveBeenCalledWith({
      type: 'move_section',
      sectionId: 'technicianProfile',
      targetSectionId: 'featuredServices',
      direction: 'up',
    });

    view.rerender(
      <BookingPageBuilder
        draft={staleLocalDraft}
        completedMoveRevision={null}
        previewAdmissionRevision={5}
        previewRequestRevision={5}
        previewedSectionIds={previewed}
        previewedReorderableSectionOrder={currentAttestedOrder}
        pending
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={staleLocalDraft}
        completedMoveRevision={6}
        previewAdmissionRevision={5}
        previewRequestRevision={6}
        previewedSectionIds={previewed}
        previewedReorderableSectionOrder={currentAttestedOrder}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(
      <BookingPageBuilder
        draft={staleLocalDraft}
        completedMoveRevision={6}
        previewAdmissionRevision={6}
        previewRequestRevision={6}
        previewedSectionIds={previewed}
        previewedReorderableSectionOrder={returnedAttestedOrder}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Technician profile moved to position 1 of 4 movable sections.',
    );
    expect(screen.getByRole('button', { name: 'Move Technician profile down' })).toHaveFocus();
  });

  it('cancels an accepted move before an older iframe can settle during a newer operation', () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(initialDraft.sectionOrder);
    const renderBuilder = ({
      admissionRevision,
      completedRevision,
      draft,
      pending,
      requestRevision,
      reorderableOrder,
    }: {
      admissionRevision: number;
      completedRevision: number | null;
      draft: BookingPageConfigSide;
      pending: boolean;
      requestRevision: number;
      reorderableOrder: readonly SectionId[];
    }) => (
      <>
        <button type="button">Outside builder</button>
        <BookingPageBuilder
          draft={draft}
          completedMoveRevision={completedRevision}
          previewAdmissionRevision={admissionRevision}
          previewRequestRevision={requestRevision}
          previewedSectionIds={previewed}
          previewedReorderableSectionOrder={reorderableOrder}
          pending={pending}
          onOperation={onOperation}
        />
      </>
    );
    const initialOrder = reorderableSectionOrder(initialDraft);
    const movedOrder = reorderableSectionOrder(movedDraft);
    const view = render(renderBuilder({
      admissionRevision: 0,
      completedRevision: null,
      draft: initialDraft,
      pending: false,
      requestRevision: 0,
      reorderableOrder: initialOrder,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Move Featured services down' }));
    view.rerender(renderBuilder({
      admissionRevision: 0,
      completedRevision: null,
      draft: initialDraft,
      pending: true,
      requestRevision: 0,
      reorderableOrder: initialOrder,
    }));

    const outside = screen.getByRole('button', { name: 'Outside builder' });
    outside.focus();

    // The move was accepted and revision 1 requested, but its iframe has not
    // attested yet.
    view.rerender(renderBuilder({
      admissionRevision: 0,
      completedRevision: 1,
      draft: movedDraft,
      pending: false,
      requestRevision: 1,
      reorderableOrder: initialOrder,
    }));

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
    expect(outside).toHaveFocus();

    // Starting any newer presentation operation clears the accepted token
    // before its own response can advance the preview revision.
    view.rerender(renderBuilder({
      admissionRevision: 0,
      completedRevision: null,
      draft: movedDraft,
      pending: true,
      requestRevision: 1,
      reorderableOrder: initialOrder,
    }));
    view.rerender(renderBuilder({
      admissionRevision: 1,
      completedRevision: null,
      draft: movedDraft,
      pending: true,
      requestRevision: 1,
      reorderableOrder: movedOrder,
    }));

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
    expect(outside).toHaveFocus();

    view.rerender(renderBuilder({
      admissionRevision: 2,
      completedRevision: null,
      draft: movedDraft,
      pending: false,
      requestRevision: 2,
      reorderableOrder: movedOrder,
    }));

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
    expect(outside).toHaveFocus();
  });

  it('cancels a delayed move announcement when a newer presentation refresh supersedes it', () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Featured services down' }));
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={0}
        previewedSectionIds={previewed}
        pending
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    // A reset/preset or another presentation write requests revision 2 before
    // the move's revision 1 attests. Revision 2 is authoritative for the page,
    // but it must never be described as the result of the older move.
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={2}
        previewedSectionIds={new Set<SectionId>(movedDraft.sectionOrder)}
        pending={false}
        onOperation={onOperation}
      />,
    );
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewAdmissionRevision={2}
        previewRequestRevision={2}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
  });

  it('keeps focus in the moved row when the initiating direction becomes a boundary', async () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'policies',
        'serviceMenu',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'policies',
        'featuredServices',
        'serviceMenu',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(initialDraft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);
    view.rerender(
      <BookingPageBuilder
        draft={initialDraft}
        previewedSectionIds={previewed}
        pending
        onOperation={onOperation}
      />,
    );
    modelBrowserFocusLossToBody();
    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={0}
        previewRequestRevision={1}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toBeDisabled();
    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(
      <BookingPageBuilder
        draft={movedDraft}
        previewAdmissionRevision={1}
        previewRequestRevision={1}
        previewedSectionIds={new Set<SectionId>(movedDraft.sectionOrder)}
        previewedReorderableSectionOrder={reorderableSectionOrder(movedDraft)}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 2 movable sections.',
    );
    expect(screen.getByRole('button', { name: 'Move Featured services up' })).toHaveFocus();
  });

  it('does not steal focus when the owner moves to another control during the save', () => {
    const onOperation = vi.fn();
    const initialDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const movedDraft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'technicianProfile',
        'featuredServices',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(initialDraft.sectionOrder);
    const builder = ({
      admissionRevision = 0,
      draft,
      pending,
      requestRevision = 0,
      sectionIds = previewed,
      reorderableOrder,
    }: {
      admissionRevision?: number | null;
      draft: BookingPageConfigSide;
      pending: boolean;
      requestRevision?: number;
      sectionIds?: ReadonlySet<SectionId>;
      reorderableOrder?: readonly SectionId[];
    }) => (
      <>
        <button type="button">Outside builder</button>
        <BookingPageBuilder
          draft={draft}
          previewAdmissionRevision={admissionRevision}
          previewRequestRevision={requestRevision}
          previewedSectionIds={sectionIds}
          previewedReorderableSectionOrder={
            reorderableOrder ?? reorderableSectionOrder(draft, [...sectionIds])
          }
          pending={pending}
          onOperation={onOperation}
        />
      </>
    );
    const view = render(builder({ draft: initialDraft, pending: false }));

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);
    view.rerender(builder({ draft: initialDraft, pending: true }));

    const outside = screen.getByRole('button', { name: 'Outside builder' });
    outside.focus();

    view.rerender(builder({
      draft: movedDraft,
      pending: false,
      requestRevision: 1,
    }));

    expect(outside).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    view.rerender(builder({
      admissionRevision: 1,
      draft: movedDraft,
      pending: false,
      requestRevision: 1,
      sectionIds: new Set<SectionId>(movedDraft.sectionOrder),
    }));

    expect(outside).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 4 movable sections.',
    );

    const nextMoveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    nextMoveDown.focus();
    fireEvent.click(nextMoveDown);
    view.rerender(builder({
      admissionRevision: 1,
      draft: movedDraft,
      pending: true,
      requestRevision: 1,
    }));
    outside.focus();

    // An unchanged/error-shaped completion also leaves deliberate focus
    // alone and never reports a move that did not land.
    view.rerender(builder({
      admissionRevision: 1,
      draft: movedDraft,
      pending: false,
      requestRevision: 1,
    }));

    expect(outside).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
  });

  it('restores focus without a false position announcement when the saved order is unchanged', async () => {
    const onOperation = vi.fn();
    const draft = side({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    const previewed = new Set<SectionId>(draft.sectionOrder);
    const view = render(
      <BookingPageBuilder
        draft={draft}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const moveDown = screen.getByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    fireEvent.click(moveDown);
    view.rerender(
      <BookingPageBuilder
        draft={draft}
        previewedSectionIds={previewed}
        pending
        onOperation={onOperation}
      />,
    );
    modelBrowserFocusLossToBody();
    view.rerender(
      <BookingPageBuilder
        draft={draft}
        previewedSectionIds={previewed}
        pending={false}
        onOperation={onOperation}
      />,
    );

    await waitFor(() => expect(moveDown).toHaveFocus());

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
    expect(sectionRowIds().slice(0, 3)).toEqual([
      'salonProfile',
      'featuredServices',
      'technicianProfile',
    ]);
  });

  it('does not expose movement for a configured section that Stage 2 omitted from the preview', () => {
    const onOperation = vi.fn();

    render(
      <BookingPageBuilder
        draft={side({
          layout: 'editorial',
          sectionOrder: [
            'salonProfile',
            'featuredServices',
            'technicianProfile',
            'serviceMenu',
            'hoursLocation',
            'bookingCta',
          ],
        })}
        previewedSectionIds={new Set<SectionId>(['salonProfile', 'featuredServices', 'serviceMenu', 'hoursLocation'])}
        pending={false}
        onOperation={onOperation}
      />,
    );

    expect(screen.getByTestId('builder-section-status-technicianProfile')).toHaveTextContent('Unavailable');
    expect(screen.queryByTestId('builder-move-up-technicianProfile')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-move-down-technicianProfile')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move Featured services down' }));

    expect(onOperation).toHaveBeenCalledWith({
      type: 'move_section',
      sectionId: 'featuredServices',
      targetSectionId: 'hoursLocation',
      direction: 'down',
    });
  });

  it('derives variant choices from the layout-compatible canonical contract and includes inherited state', () => {
    const onOperation = vi.fn();

    render(
      <BookingPageBuilder
        draft={side({
          layout: 'editorial',
          sectionOrder: [
            'salonProfile',
            'serviceMenu',
            'featuredServices',
            'policies',
            'socialLinks',
            'bookingCta',
          ],
        })}
        pending={false}
        onOperation={onOperation}
      />,
    );

    const profileSelect = screen.getByRole('combobox', { name: 'Salon profile presentation' });
    const menuSelect = screen.getByRole('combobox', { name: 'Services presentation' });

    expect(profileSelect).toHaveValue('');
    expect(within(profileSelect).getByRole('option', { name: 'Inherited default' })).toBeInTheDocument();
    expect(within(profileSelect).getByRole('option', { name: 'Hero image' })).toBeInTheDocument();
    expect(within(menuSelect).getByRole('option', { name: 'Grouped categories' })).toBeInTheDocument();

    fireEvent.change(menuSelect, { target: { value: 'grouped_categories' } });

    expect(onOperation).toHaveBeenCalledWith({
      type: 'set_variant',
      sectionId: 'serviceMenu',
      variant: 'grouped_categories',
    });
  });

  it('shows the inherited fallback and a reset for a saved choice unavailable in the active layout', () => {
    render(
      <BookingPageBuilder
        draft={side({ sectionVariants: { salonProfile: 'hero_image' } })}
        pending={false}
        onOperation={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Salon profile presentation' })).toHaveValue('');
    expect(screen.getByTestId('builder-section-salonProfile')).toHaveTextContent(
      'This saved presentation is not available here',
    );
    expect(screen.getByRole('button', { name: 'Reset Salon profile' })).toBeInTheDocument();
  });

  it('emits section and whole-page reset operations without deleting business content', () => {
    const onOperation = vi.fn();

    render(
      <BookingPageBuilder
        draft={side({
          hiddenSections: ['policies'],
          sectionVariants: { socialLinks: 'labeled' },
        })}
        pending={false}
        onOperation={onOperation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset Policies' }));
    fireEvent.click(screen.getByTestId('builder-reset-all'));

    expect(onOperation).toHaveBeenNthCalledWith(1, {
      type: 'reset_section',
      sectionId: 'policies',
    });
    expect(onOperation).toHaveBeenNthCalledWith(2, {
      type: 'reset_all',
      expectedPresentationSignature: getBookingPagePresentationSignature({
        ...side({
          hiddenSections: ['policies'],
          sectionVariants: { socialLinks: 'labeled' },
        }),
        presetBase: null,
      }),
    });
    expect(screen.getByText(/services, prices, and policies stay saved/i)).toBeInTheDocument();
  });

  it('disables every rendered operation while a save is pending', () => {
    const onOperation = vi.fn();

    render(
      <BookingPageBuilder
        draft={side({
          layout: 'editorial',
          hiddenSections: ['policies'],
          sectionVariants: { socialLinks: 'labeled' },
        })}
        previewedSectionIds={new Set<SectionId>([
          'salonProfile',
          'serviceMenu',
          'featuredServices',
          'socialLinks',
        ])}
        pending
        onOperation={onOperation}
      />,
    );

    for (const control of screen.getAllByRole('button')) {
      expect(control).toBeDisabled();
    }
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toBeDisabled();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Show Policies' }));

    expect(onOperation).not.toHaveBeenCalled();
  });
});
