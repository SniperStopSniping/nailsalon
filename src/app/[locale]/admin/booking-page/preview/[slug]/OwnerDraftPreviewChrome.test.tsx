import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OwnerDraftPreviewChrome } from './OwnerDraftPreviewChrome';

const props = {
  editorUrl: '/en/admin/website?salon=salon-a#preview-draft',
  frameSrc: '/admin/booking-page/preview/salon-a?ownerChrome=0',
};

function renderChrome() {
  return render(
    <OwnerDraftPreviewChrome {...props}>
      <p>Book a service</p>
    </OwnerDraftPreviewChrome>,
  );
}

describe('owner draft preview chrome', () => {
  // AG-hub-publish-08: the only exit used to be the browser's own Back.
  it('offers a signposted way back into the editor', () => {
    renderChrome();

    expect(screen.getByTestId('owner-draft-preview-back'))
      .toHaveAttribute('href', '/en/admin/website?salon=salon-a#preview-draft');
    expect(screen.getByTestId('owner-draft-preview-bar')).toHaveTextContent('Draft preview');
  });

  it('renders the customer page directly at the width the owner is already on', () => {
    renderChrome();

    // jsdom reports 1024px wide, so "Tablet" is the matching width.
    expect(screen.getByTestId('owner-draft-preview-device-tablet')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Book a service')).toBeVisible();
    expect(screen.queryByTestId('owner-draft-preview-frame')).not.toBeInTheDocument();
  });

  it('mounts a chrome-free frame of the same route for a width the window cannot show', () => {
    renderChrome();

    fireEvent.click(screen.getByTestId('owner-draft-preview-device-phone'));

    const frame = screen.getByTestId('owner-draft-preview-frame');

    expect(frame).toHaveAttribute('src', '/admin/booking-page/preview/salon-a?ownerChrome=0');
    expect(frame).toHaveStyle({ width: '390px' });
    // The booking page server-renders a Suspense shell: without allow-scripts
    // the width frame is a spinner on a blank page.
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin allow-scripts');
    expect(screen.getByTestId('owner-draft-preview-device-phone')).toHaveAttribute('aria-pressed', 'true');
    // The direct render is hidden rather than rewritten, so the customer
    // markup is never duplicated into the accessibility tree.
    expect(screen.getByTestId('owner-draft-preview-content')).not.toBeVisible();
    expect(screen.getByTestId('owner-draft-preview-content')).toHaveTextContent('Book a service');
  });

  it('returns to the direct render when the matching width is chosen again', () => {
    renderChrome();

    fireEvent.click(screen.getByTestId('owner-draft-preview-device-desktop'));

    expect(screen.getByTestId('owner-draft-preview-frame')).toHaveStyle({ width: '1280px' });

    fireEvent.click(screen.getByTestId('owner-draft-preview-device-tablet'));

    expect(screen.queryByTestId('owner-draft-preview-frame')).not.toBeInTheDocument();
    expect(screen.getByText('Book a service')).toBeVisible();
  });
});
