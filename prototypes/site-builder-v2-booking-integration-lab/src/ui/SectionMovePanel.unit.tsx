import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, vi } from 'vitest';

import { initializeStarter } from '../model/starters';
import type { PageDocument, SectionInstance } from '../model/types';
import { ReorderList } from './ReorderList';
import { SectionMovePanel } from './SectionMovePanel';

const getQuickBookPage = (): PageDocument => {
  const page = initializeStarter('quick_book').pages[0];
  if (!page) throw new Error('Quick Book did not initialize Home.');
  return page;
};

const moveToPosition = (
  sections: SectionInstance[],
  sectionId: string,
  position: number,
): SectionInstance[] => {
  const next = [...sections];
  const currentIndex = next.findIndex((section) => section.id === sectionId);
  const [section] = next.splice(currentIndex, 1);
  if (!section) return sections;
  next.splice(position - 1, 0, section);
  return next.map((candidate, order) => ({ ...candidate, order }));
};

type ReorderHarnessProps = {
  initialSections: SectionInstance[];
  onAnnounce?: (message: string) => void;
  onMove?: (section: SectionInstance, position: number) => void;
};

function ReorderHarness({
  initialSections,
  onAnnounce = () => undefined,
  onMove = () => undefined,
}: ReorderHarnessProps) {
  const [sections, setSections] = useState(initialSections);
  const selectedSectionId = initialSections.find(
    (section) => section.sectionType === 'booking',
  )?.id ?? initialSections[0]?.id ?? '';

  const move = (section: SectionInstance, position: number) => {
    onMove(section, position);
    setSections((current) => moveToPosition(current, section.id, position));
  };

  return (
    <ReorderList
      onAnnounce={onAnnounce}
      onDragReorder={(sectionId, position) => {
        const section = sections.find((candidate) => candidate.id === sectionId);
        if (section) move(section, position);
      }}
      onMoveDown={(section) => move(section, section.order + 2)}
      onMoveToPosition={move}
      onMoveUp={(section) => move(section, section.order)}
      sections={sections}
      selectedSectionId={selectedSectionId}
    />
  );
}

const installMobileDialogEnvironment = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
  vi.stubGlobal('scrollTo', vi.fn());
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared section movement rows', () => {
  it('does not move on blur and restores the committed working position', async () => {
    const user = userEvent.setup();
    const sections = getQuickBookPage().sections;
    const onMove = vi.fn();
    render(<ReorderHarness initialSections={sections} onMove={onMove} />);

    const bookingPosition = screen.getByRole('spinbutton', {
      name: 'Position for Booking',
    });
    await user.click(bookingPosition);
    await user.clear(bookingPosition);
    await user.type(bookingPosition, '1');
    await user.tab();

    expect(onMove).not.toHaveBeenCalled();
    expect(bookingPosition).toHaveValue(3);
  });

  it('moves only on Enter and keeps focus on the moved section position field', async () => {
    const user = userEvent.setup();
    const sections = getQuickBookPage().sections;
    const onMove = vi.fn();
    render(<ReorderHarness initialSections={sections} onMove={onMove} />);

    const bookingPosition = screen.getByRole('spinbutton', {
      name: 'Position for Booking',
    });
    await user.click(bookingPosition);
    await user.clear(bookingPosition);
    await user.type(bookingPosition, '1{Enter}');

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ sectionType: 'booking' }),
      1,
    );
    await waitFor(() => {
      const movedPosition = screen.getByRole('spinbutton', {
        name: 'Position for Booking',
      });
      expect(movedPosition).toHaveValue(1);
      expect(movedPosition).toHaveFocus();
    });
  });

  it('keeps invalid input focused and exposes the dynamic range inline and by announcement', async () => {
    const user = userEvent.setup();
    const onAnnounce = vi.fn();
    const onMove = vi.fn();
    render(
      <ReorderHarness
        initialSections={getQuickBookPage().sections}
        onAnnounce={onAnnounce}
        onMove={onMove}
      />,
    );

    const bookingPosition = screen.getByRole('spinbutton', {
      name: 'Position for Booking',
    });
    await user.click(bookingPosition);
    await user.clear(bookingPosition);
    await user.type(bookingPosition, '4{Enter}');

    const error = screen.getByText('Enter a position from 1 to 3.', {
      selector: '.position-input__error',
    });
    expect(error).toHaveTextContent('Enter a position from 1 to 3.');
    expect(bookingPosition).toHaveAttribute('aria-invalid', 'true');
    expect(bookingPosition).toHaveFocus();
    expect(onMove).not.toHaveBeenCalled();
    expect(onAnnounce).toHaveBeenCalledWith('Enter a position from 1 to 3.');
  });

  it('keeps boundary arrows focusable, clearly unavailable, and inert', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<ReorderHarness initialSections={getQuickBookPage().sections} onMove={onMove} />);

    const firstUnavailable = screen.getByRole('button', {
      name: 'Move Section 01 up, unavailable — already first',
    });
    const lastUnavailable = screen.getByRole('button', {
      name: 'Move Booking down, unavailable — already last',
    });
    expect(firstUnavailable).toHaveAttribute('aria-disabled', 'true');
    expect(lastUnavailable).toHaveAttribute('aria-disabled', 'true');
    expect(firstUnavailable).not.toBeDisabled();
    expect(lastUnavailable).not.toBeDisabled();

    await user.click(firstUnavailable);
    await user.click(lastUnavailable);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('shared SectionMovePanel states', () => {
  it('shows a static one-section page without useless ordering controls and opens cross-page movement', async () => {
    installMobileDialogEnvironment();
    const document = initializeStarter('quick_book');
    const booking = document.pages[0]?.sections.find(
      (section) => section.sectionType === 'booking',
    );
    if (!booking || !document.pages[0]) throw new Error('Booking fixture unavailable.');
    const page = { ...document.pages[0], sections: [{ ...booking, order: 0 }] };
    const oneSectionDocument = {
      ...document,
      pages: [page],
    };

    render(
      <SectionMovePanel
        activeSectionId={booking.id}
        commitStatus="saving"
        dirty={false}
        document={oneSectionDocument}
        entry="section"
        onActivateSection={vi.fn()}
        onAnnounce={vi.fn()}
        onCancel={vi.fn()}
        onCreatePage={vi.fn()}
        onDone={vi.fn()}
        onDragReorder={vi.fn()}
        onMoveDown={vi.fn()}
        onMoveToPage={vi.fn()}
        onMoveToPosition={vi.fn()}
        onMoveUp={vi.fn()}
        onRequestClose={vi.fn()}
        open
        page={page}
        sections={page.sections}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Move Booking' });
    expect(within(dialog).getByText('Booking is the only section on Home.')).toBeVisible();
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Move Booking (up|down)/ }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Drag Booking/ }))
      .not.toBeInTheDocument();

    const crossPage = within(dialog).getByRole('button', {
      name: 'Move Booking to another page',
    });
    expect(crossPage).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByPlaceholderText('Page name')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Create page and move' }))
      .toBeVisible();
    expect(within(dialog).getByText('Saving…')).toHaveAttribute('data-status', 'saving');
  });

  it('shows truthful dirty-state and restoration helper copy', () => {
    installMobileDialogEnvironment();
    const document = initializeStarter('quick_book');
    const page = document.pages[0];
    const booking = page?.sections.find((section) => section.sectionType === 'booking');
    if (!booking || !page) throw new Error('Booking fixture unavailable.');

    render(
      <SectionMovePanel
        activeSectionId={booking.id}
        commitStatus="saved"
        dirty
        document={document}
        entry="section"
        onActivateSection={vi.fn()}
        onAnnounce={vi.fn()}
        onCancel={vi.fn()}
        onCreatePage={vi.fn()}
        onDone={vi.fn()}
        onDragReorder={vi.fn()}
        onMoveDown={vi.fn()}
        onMoveToPage={vi.fn()}
        onMoveToPosition={vi.fn()}
        onMoveUp={vi.fn()}
        onRequestClose={vi.fn()}
        open
        page={page}
        sections={page.sections}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Move Booking' });
    expect(within(dialog).getByText('Order not saved yet')).toHaveAttribute(
      'data-status',
      'dirty',
    );
    expect(within(dialog).getByText('Cancel puts everything back.')).toBeVisible();
  });
});
