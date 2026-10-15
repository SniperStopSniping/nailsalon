import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { VerifiedTrialAccess } from './VerifiedTrialAccess';

const state = vi.hoisted(() => ({ useUser: vi.fn(), prepare: vi.fn(), attempt: vi.fn(), reload: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useUser: state.useUser }));

beforeEach(() => {
  vi.clearAllMocks();
  state.useUser.mockReturnValue({ isLoaded: true, user: { reload: state.reload, primaryEmailAddress: { emailAddress: 'owner@example.invalid', verification: { status: 'unverified' }, prepareVerification: state.prepare, attemptVerification: state.attempt } } });
});

it('keeps the opening action hidden until Clerk reports a verified email', () => {
  const view = render(<VerifiedTrialAccess><button type="button">Open test</button></VerifiedTrialAccess>);

  expect(screen.queryByRole('button', { name: 'Open test' })).not.toBeInTheDocument();
  expect(state.prepare).not.toHaveBeenCalled();

  state.useUser.mockReturnValue({ isLoaded: true, user: { primaryEmailAddress: { verification: { status: 'verified' } } } });
  view.rerender(<VerifiedTrialAccess><button type="button">Open test</button></VerifiedTrialAccess>);

  expect(screen.getByRole('button', { name: 'Open test' })).toBeVisible();
});

it('requests a code only on owner action and reloads the verified account', async () => {
  state.prepare.mockResolvedValue({});
  state.attempt.mockResolvedValue({ verification: { status: 'verified' } });
  render(<VerifiedTrialAccess><button type="button">Open test</button></VerifiedTrialAccess>);
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
  await waitFor(() => expect(state.prepare).toHaveBeenCalledWith({ strategy: 'email_code' }));
  fireEvent.change(await screen.findByLabelText('Email verification code'), { target: { value: '424242' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
  await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(1));

  expect(state.attempt).toHaveBeenCalledWith({ code: '424242' });
});

it('keeps a rejected code unverified and permits retry', async () => {
  state.prepare.mockResolvedValue({});
  state.attempt.mockRejectedValue(new Error('Provider detail must not leak'));
  render(<VerifiedTrialAccess><button type="button">Open test</button></VerifiedTrialAccess>);
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
  fireEvent.change(await screen.findByLabelText('Email verification code'), { target: { value: '111111' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('That code could not be verified.');
  expect(screen.queryByRole('button', { name: 'Open test' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  expect(state.reload).not.toHaveBeenCalled();
});
