import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { isBookingPagePanel } from './bookingPageEditorSections';
import { BookingPageEditorLayout, BookingPageNavigation } from './BookingPageNavigation';

const props = { editorHref: '/fr/admin/booking-page?salon=salon%20a', includeFlow: false };

describe('Booking Page navigation', () => {
  it('organizes each existing destination once and retains locale and salon context', () => {
    render(<BookingPageNavigation {...props} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map(item => item.textContent)).toEqual([
      'Business profile & content',
      'Design',
      'Visibility & booking',
      'Preview & publish',
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: /Style, Colours & Fonts/ })).toHaveAttribute('href', `${props.editorHref}&panel=appearance`);
    expect(screen.queryByRole('link', { name: /Booking Flow/ })).not.toBeInTheDocument();
    expect(isBookingPagePanel('constructor')).toBe(false);
    expect(isBookingPagePanel('appearance')).toBe(true);
  });

  it('uses the host save guard, marks the current page and blocks navigation while saving', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<BookingPageNavigation {...props} currentPanel="text" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'Style, Colours & Fonts' }));

    expect(onNavigate).toHaveBeenCalledWith(`${props.editorHref}&panel=appearance`);
    expect(screen.getByRole('link', { name: 'About & Website Text' })).toHaveAttribute('aria-current', 'page');

    onNavigate.mockClear();
    rerender(<BookingPageNavigation {...props} currentPanel="text" disabled onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'Style, Colours & Fonts' }));

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('closes the mobile section picker and focuses the destination heading after a panel change', () => {
    const { rerender } = render(<BookingPageEditorLayout {...props} panel="text"><h1>About & Website Text</h1></BookingPageEditorLayout>);
    const sections = screen.getByRole('complementary', { name: 'Booking Page sections' });
    fireEvent.click(within(sections).getByRole('button'));

    expect(within(sections).getByRole('button')).toHaveAttribute('aria-expanded', 'true');

    rerender(<BookingPageEditorLayout {...props} panel="appearance"><h1>Style, Colours & Fonts</h1></BookingPageEditorLayout>);

    expect(within(sections).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('focuses a newly mounted hosted editor without taking focus back during editing', () => {
    const { rerender } = render(
      <BookingPageEditorLayout {...props} panel="experience">
        <h1>Booking Messages &amp; Social Links</h1>
        <textarea aria-label="Booking message" defaultValue="" />
      </BookingPageEditorLayout>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();

    const message = screen.getByRole('textbox', { name: 'Booking message' });
    message.focus();
    fireEvent.change(message, { target: { value: 'My draft' } });
    rerender(
      <BookingPageEditorLayout {...props} panel="experience">
        <h1>Booking Messages &amp; Social Links</h1>
        <textarea aria-label="Booking message" defaultValue="" />
        <p>Draft updated</p>
      </BookingPageEditorLayout>,
    );

    expect(message).toHaveFocus();
    expect(message).toHaveValue('My draft');
  });
});
