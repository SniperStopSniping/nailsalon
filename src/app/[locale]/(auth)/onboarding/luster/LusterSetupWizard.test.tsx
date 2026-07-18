/* eslint-disable import/first */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { attemptVerification, prepareVerification, reload, useUser } = vi.hoisted(() => ({
  attemptVerification: vi.fn(),
  prepareVerification: vi.fn(),
  reload: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({ useUser }));

import { LusterSetupWizard } from './LusterSetupWizard';

describe('LusterSetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUser.mockReturnValue({
      isLoaded: true,
      user: {
        reload,
        primaryEmailAddress: {
          emailAddress: 'owner@example.com',
          verification: { status: 'unverified' },
          prepareVerification,
          attemptVerification,
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { intent: 'create_salon' },
    }), { status: 200 })));
  });

  it('pre-fills the recommended starter menu with editable prices, durations, and offer toggles', async () => {
    render(<LusterSetupWizard inviteToken="invite-token" locale="en" />);

    // Luster Manicure leads the review with its spec defaults.
    expect(await screen.findByLabelText('Price for Luster Manicure')).toHaveValue(45);
    expect(screen.getByLabelText('Duration for Luster Manicure')).toHaveValue(60);
    expect(screen.getByLabelText('Offer Luster Manicure')).toBeChecked();

    // The 14 starter services are all present; acrylic is not.
    expect(screen.getByTestId('starter-review-gel_manicure')).toBeInTheDocument();
    expect(screen.getByTestId('starter-review-classic_pedicure')).toBeInTheDocument();
    expect(screen.getByTestId('starter-review-gel_mani_gel_pedi_combo')).toBeInTheDocument();
    expect(screen.queryByText(/acrylic/i)).not.toBeInTheDocument();

    // Rows are editable and can be turned off without disappearing.
    fireEvent.change(screen.getByLabelText('Price for Luster Manicure'), { target: { value: '55' } });

    expect(screen.getByLabelText('Price for Luster Manicure')).toHaveValue(55);

    fireEvent.click(screen.getByLabelText('Offer Gel-X Extensions'));

    expect(screen.getByLabelText('Offer Gel-X Extensions')).not.toBeChecked();
    expect(screen.getByTestId('starter-review-gel_x_extensions')).toBeInTheDocument();
  });

  it('lets an unverified owner request and enter an email code', async () => {
    prepareVerification.mockResolvedValue(undefined);
    attemptVerification.mockResolvedValue({ verification: { status: 'verified' } });
    reload.mockResolvedValue(undefined);
    render(<LusterSetupWizard inviteToken="invite-token" locale="en" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send verification code' }));
    await waitFor(() => expect(prepareVerification).toHaveBeenCalledWith({ strategy: 'email_code' }));

    fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() => expect(attemptVerification).toHaveBeenCalledWith({ code: '123456' }));

    expect(await screen.findByText('Email verified. You can publish your booking page now.')).toBeInTheDocument();
  });
});
