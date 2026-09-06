import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingPageHub } from './BookingPageHub';

const props = { locale: 'en', salonName: 'Another Nail Studio', salonSlug: 'another-studio', published: true, hasDraftChanges: false, setupUrl: null };

describe('Booking Page hub', () => {
  it('uses the canonical public URL including a configured custom domain', () => {
    render(<BookingPageHub {...props} publicUrl="https://another-studio.example/" />);

    expect(screen.getByText('https://another-studio.example/')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open live site' })).toHaveAttribute('href', 'https://another-studio.example/');
  });

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

  // AG-security-tenancy-02: publishing locks the public address for good, so a
  // collaborator is told rather than walked into a 403.
  it('replaces the publish CTA with an owner-only note for a collaborator', () => {
    render(<BookingPageHub {...props} canPublish={false} published={false} />);

    expect(screen.queryByRole('link', { name: 'Publish website' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review & publish changes' })).not.toBeInTheDocument();
    expect(screen.getByText('Publishing is owner only')).toBeVisible();
    // Everything else the collaborator legitimately uses stays put.
    expect(screen.getByRole('link', { name: 'Preview draft' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Booking Page editors' }).querySelectorAll('a')).toHaveLength(6);
  });

  it('keeps the publish CTA for the owner', () => {
    render(<BookingPageHub {...props} canPublish published={false} />);

    expect(screen.getByRole('link', { name: 'Publish website' })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=publish');
    expect(screen.queryByText('Publishing is owner only')).not.toBeInTheDocument();
  });

  /*
   * Updated deliberately: this used to assert "Review current setup" for a
   * PUBLISHED salon, which is exactly the state the saved setup flow can never
   * run in (`WebsiteHubPage` only fetches the handoff while publicationStatus
   * is 'draft'). The label and the explanation now say so rather than leaving
   * the owner to guess why the saved flow is missing.
   */
  it('distinguishes unpublished edits and does not fabricate guided review availability', () => {
    render(<BookingPageHub {...props} hasDraftChanges />);

    expect(screen.getByText('Live · Draft changes not published')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review saved setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review setup in the editors' })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=information&guided=1');
    expect(screen.getByRole('link', { name: 'Services & Add-ons' })).toHaveAttribute('href', '/en/admin?salon=another-studio&app=services');
  });

  // Owner-product repair: a published salon is told why the saved setup flow
  // is gone and handed the editors that hold the same choices.
  it('explains the missing setup flow on a published salon and points at the editors', () => {
    render(<BookingPageHub {...props} published setupUrl={null} />);

    const note = screen.getByTestId('hub-setup-published-note');

    expect(note).toHaveTextContent('Your site is live, so the setup flow that builds a new site is closed.');
    expect(note).toHaveTextContent('nothing is reset');
    expect(screen.getByRole('link', { name: 'Review setup in the editors' })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=information&guided=1');
    expect(screen.queryByRole('link', { name: 'Review saved setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review current setup' })).not.toBeInTheDocument();
  });

  // An unpublished salon with no saved onboarding site keeps the plain
  // wording — there is nothing to explain there.
  it('keeps the plain guided-review wording before publication', () => {
    render(<BookingPageHub {...props} published={false} setupUrl={null} />);

    expect(screen.queryByTestId('hub-setup-published-note')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review current setup' })).toBeVisible();
  });

  // AG-hub-publish-08: returning from the draft preview puts focus back on the
  // control the owner left from.
  it('focuses the preview control when the draft preview sends the owner back', () => {
    window.location.hash = '#preview-draft';
    try {
      render(<BookingPageHub {...props} />);

      expect(screen.getByRole('link', { name: 'Preview draft' })).toHaveFocus();
    } finally {
      window.location.hash = '';
    }
  });
});
