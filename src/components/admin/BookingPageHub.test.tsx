import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookingPageHub } from './BookingPageHub';

vi.mock('./ownerAssistant/OwnerAssistantLauncher', () => ({
  default: ({ salonSlug }: { salonSlug: string }) => <div data-testid="hub-owner-assistant" data-salon-slug={salonSlug} />,
}));

afterEach(() => vi.unstubAllGlobals());

const props = { locale: 'en', salonName: 'Another Nail Studio', salonSlug: 'another-studio', published: true, hasDraftChanges: false, setupUrl: null };

describe('Booking Page hub', () => {
  it('uses the canonical public URL including a configured custom domain', () => {
    render(<BookingPageHub {...props} publicUrl="https://another-studio.example/" />);

    expect(screen.getByText('https://another-studio.example/')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open live site' })).toHaveAttribute('href', 'https://another-studio.example/');
  });

  it('shows the focused editors, the actual owner and an authenticated draft preview', () => {
    render(<BookingPageHub {...props} />);

    expect(screen.getByText(props.salonName)).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Booking Page editors' }).querySelectorAll('a')).toHaveLength(10);
    expect(screen.getByRole('link', { name: 'Preview draft' })).toHaveAttribute('href', '/en/admin/booking-page/preview/another-studio');
    expect(screen.getByRole('link', { name: /Business Information/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=business');
    expect(screen.getByRole('link', { name: /Layout & Menu/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=layouts');
    expect(screen.getByRole('link', { name: /Photos & Gallery/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=gallery');
    expect(screen.getByRole('link', { name: /Booking Messages & Social Links/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=experience');
    expect(screen.getByRole('link', { name: /Booking Flow/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=flow');
    expect(screen.getByText('Live · All changes published')).toBeVisible();
    expect(screen.queryByText(/Daniela|Isla/)).not.toBeInTheDocument();
    expect(screen.getByTestId('hub-owner-assistant')).toHaveAttribute('data-salon-slug', 'another-studio');
  });

  it('keeps the team-only Flow editor out of the Free Solo hub while retaining Booking Messages & Social Links', () => {
    render(<BookingPageHub {...props} isFreeSolo />);

    const editors = screen.getByRole('navigation', { name: 'Booking Page editors' });

    expect(editors.querySelectorAll('a')).toHaveLength(9);
    expect(screen.getByRole('link', { name: /Booking Messages & Social Links/ })).toHaveAttribute('href', '/en/admin/booking-page?salon=another-studio&panel=experience');
    expect(screen.queryByRole('link', { name: /Booking Flow/ })).not.toBeInTheDocument();
  });

  it('does not offer a public link or reset path before publication', () => {
    render(<BookingPageHub {...props} published={false} setupUrl="/en/onboarding-v1?resume=review&site=existing&revision=4" />);

    expect(screen.getByText('Not published yet')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open live site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit website'));

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
    expect(screen.getByRole('navigation', { name: 'Booking Page editors' }).querySelectorAll('a')).toHaveLength(10);
  });

  it('keeps the publish CTA for the owner', () => {
    render(<BookingPageHub {...props} canPublish published={false} />);

    expect(screen.getByRole('button', { name: 'Publish website' })).toBeVisible();
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

    fireEvent.click(screen.getByText('Edit website'));

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

describe('simple website launch', () => {
  it('confirms the permanent link, publishes once, and exposes the live sharing actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { publicationStatus: 'published' } })));
    vi.stubGlobal('fetch', fetchMock);
    render(<BookingPageHub {...props} published={false} hasDraftChanges setupUrl="/en/onboarding-v1?resume=review&site=saved&revision=4" />);

    expect(screen.getByRole('navigation', { name: 'Booking Page editors' }).closest('details')).not.toHaveAttribute('open');

    fireEvent.click(screen.getByRole('button', { name: 'Publish website' }));
    const dialog = screen.getByRole('alertdialog');

    expect(dialog).toHaveTextContent('/en/another-studio');
    expect(dialog).toHaveTextContent('This address becomes permanent');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish website' }));
    await screen.findByRole('button', { name: 'Copy link' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/salon/publish?salonSlug=another-studio', { method: 'POST' });
    expect(screen.getByRole('link', { name: 'Open live site' })).toBeVisible();
    expect(screen.getByText('Live · All changes published')).toBeVisible();

    fireEvent.click(screen.getByText('Edit website'));

    expect(screen.queryByRole('link', { name: 'Review saved setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review setup in the editors' })).toBeVisible();
  });

  it('keeps the draft recoverable when publishing fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    render(<BookingPageHub {...props} published={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish website' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish website' }));
    await screen.findByRole('alert');

    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish website' })).toBeEnabled();
  });

  it('does not publish when the owner keeps their draft', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<BookingPageHub {...props} published={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not leak completed publication across a salon switch', async () => {
    let finish: (value: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      finish = resolve;
    })));
    const { rerender } = render(<BookingPageHub {...props} published={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish website' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish website' }));
    rerender(<BookingPageHub {...props} salonSlug="other" published={false} />);
    finish(new Response(JSON.stringify({ data: { publicationStatus: 'published' } })));
    await waitFor(() => expect(screen.getByText('Not published yet')).toBeVisible());

    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });
});

it('shows remaining draft changes when another session already published', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { publicationStatus: 'published', hasDraftChanges: true } }))));
  render(<BookingPageHub {...props} published={false} hasDraftChanges={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Publish website' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish website' }));

  expect(await screen.findByText('Live · Draft changes not published')).toBeVisible();
});
