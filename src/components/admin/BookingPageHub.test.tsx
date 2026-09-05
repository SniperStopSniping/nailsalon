import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingPageHub } from './BookingPageHub';

const props = { locale: 'en', salonName: 'Another Nail Studio', salonSlug: 'another-studio', published: true, hasDraftChanges: false, setupUrl: null };

describe('Booking Page hub', () => {
  it('shows six focused editors, the actual owner and an authenticated draft preview', () => {
    render(<BookingPageHub {...props} />);

    expect(screen.getByText(props.salonName)).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Booking Page editors' }).querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Preview draft' })).toHaveAttribute('href', '/en/admin/booking-page/preview/another-studio');
    expect(screen.getByRole('link', { name: /Layouts Site layout/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=layouts');
    expect(screen.getByRole('link', { name: /Photos & Gallery/ })).toHaveAttribute('href', '/en/admin?salon=another-studio&app=portfolio');
    expect(screen.getByText('Live · All changes published')).toBeVisible();
    expect(screen.queryByText(/Daniela|Isla/)).not.toBeInTheDocument();
  });

  it('does not offer a public link or reset path before publication', () => {
    render(<BookingPageHub {...props} published={false} setupUrl="/en/onboarding-v1?resume=review&site=existing&revision=4" />);

    expect(screen.getByText('Not published yet')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open live site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review saved setup' })).toHaveAttribute('href', expect.stringContaining('site=existing&revision=4'));
  });

  it('distinguishes unpublished edits and does not fabricate guided review availability', () => {
    render(<BookingPageHub {...props} hasDraftChanges />);

    expect(screen.getByText('Live · Draft changes not published')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review saved setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review current setup' })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=information&guided=1');
    expect(screen.getByRole('link', { name: 'Services & Add-ons' })).toHaveAttribute('href', '/en/admin?salon=another-studio&app=services');
  });
});
