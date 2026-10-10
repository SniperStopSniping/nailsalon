import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PrivacyPage from '@/app/[locale]/(unauth)/privacy/page';
import TermsPage from '@/app/[locale]/(unauth)/terms/page';

describe('public Calendar disclosures', () => {
  it('describes selected event details and the actual scope of Google permission', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: 'Google Calendar data' })).toBeVisible();
    expect(screen.getByText(/event title, date and time, description, location, status, and attendee or client contact details/)).toBeVisible();
    expect(screen.getByText(/Google’s event permission covers calendars accessible to the connected account/)).toBeVisible();
    expect(screen.getByText(/Luster does not request Google’s full Calendar scope for this OAuth connection/)).toBeVisible();
  });

  it('distinguishes disconnecting access from deleting synchronized records', () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/Disconnecting asks Google to revoke Luster’s access/)).toBeVisible();
    expect(screen.getByText(/Calendar event information already synchronized into the salon workspace is not automatically removed/)).toBeVisible();
    expect(screen.getByText(/To request deletion of a Luster workspace/)).toBeVisible();
    expect(screen.queryByText(/Disconnecting revokes Luster’s access/)).not.toBeInTheDocument();
  });

  it('keeps optional integration and record-retention language consistent in Terms', () => {
    render(<TermsPage />);

    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    expect(screen.getByText(/Google Calendar is optional/)).toBeVisible();
    expect(screen.getByText(/event information already synchronized into the salon workspace is not automatically removed on disconnect/)).toBeVisible();
    expect(screen.getByText(/the Luster appointment record remains the source of truth/)).toBeVisible();
  });

  it.each([PrivacyPage, TermsPage])('retains public navigation, support and the review date', (Page) => {
    render(<Page />);

    expect(screen.getByRole('link', { name: 'Luster' })).toHaveAttribute('href', '/');
    expect(screen.getByText('October 10, 2026')).toBeVisible();
    expect(screen.getByText(/Questions, data access requests, and deletion requests/)).toHaveTextContent('support@lustergel.app');
  });
});
