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

  it('labels price and duration clearly on mobile-sized forms', async () => {
    render(<LusterSetupWizard inviteToken="invite-token" locale="en" />);

    expect(await screen.findByLabelText('Price (CAD dollars)')).toHaveValue(65);
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(90);
    expect(screen.getByText('Duration (minutes)')).toBeInTheDocument();
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
