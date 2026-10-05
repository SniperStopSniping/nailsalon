import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deriveQuickBookPresentation, type QuickBookPresentationProfile } from './presentation-view';
import { QuickBookPresentation } from './QuickBookPresentation';

function profile(): QuickBookPresentationProfile {
  const base = {
    identity: { salonName: 'Isla Nail Studio', logoUrl: null, technicianName: 'Daniela', technicianPhotoUrl: null },
    location: { name: null, addressLine: null, localityLine: 'Toronto, ON', directionsUrl: null, instructionLines: [] },
    hours: { statusLabel: 'Open now', todayLabel: 'Until 6 PM', weekly: [] },
    contact: null,
    policies: [{ label: 'Cancellation', text: 'Saved cancellation policy.' }],
    reviews: null,
    instagram: null,
    bio: 'A short saved introduction.',
    fullBio: 'The complete saved biography remains available to customers.',
  };
  return { ...base, presentation: { ...deriveQuickBookPresentation(base, 'side_portrait'), bookingMethod: 'Appointment only', newClients: 'Accepting new clients' } };
}

describe('Quick Book shared refinement', () => {
  it('keeps practical facts visible and places the booking action before secondary content', () => {
    const source = profile();
    render(<QuickBookPresentation bookingHref="#services" headingId="business" profile={source} />);
    const book = screen.getByRole('link', { name: 'Book an appointment' });
    const secondary = screen.getByTestId('quick-book-profile-actions');

    expect(book).toHaveAttribute('href', '#services');
    expect(book.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(secondary).not.toHaveAttribute('open');
    expect(screen.getByText('Appointment only')).not.toBeVisible();
    expect(screen.getByText('Accepting new clients')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Toronto/u })).not.toBeInTheDocument();

    fireEvent.click(secondary.querySelector('summary')!);

    expect(screen.getByText('Appointment only')).toBeVisible();
    expect(screen.getByText(source.fullBio!)).toBeVisible();
    expect(screen.getByText('Saved cancellation policy.')).toBeVisible();
  });

  it('deduplicates the cover from Gallery Header while preserving the remaining image order', () => {
    const source = profile();
    source.presentation = { ...source.presentation, layoutId: 'gallery_header', cover: { kind: 'custom', url: '/cover.jpg', focal: null }, gallery: [
      { id: 'cover', url: '/cover.jpg', alt: 'Cover', width: null, height: null },
      { id: 'first', url: '/first.jpg', alt: 'First nail photo', width: null, height: null },
      { id: 'second', url: '/second.jpg', alt: 'Second nail photo', width: null, height: null },
    ] };
    const original = structuredClone(source);
    render(<QuickBookPresentation bookingHref="#services" headingId="business" profile={source} />);
    const images = screen.getByTestId('quick-book-gallery').querySelectorAll('img');

    expect([...images].map(image => image.getAttribute('src'))).toEqual(['/first.jpg', '/second.jpg']);
    expect(source).toEqual(original);

    fireEvent.error(images[0]!);

    expect(screen.getByRole('img', { name: 'First nail photo unavailable' })).toBeVisible();
    expect(screen.queryByRole('img', { name: 'First nail photo' })).not.toBeInTheDocument();
  });
});
