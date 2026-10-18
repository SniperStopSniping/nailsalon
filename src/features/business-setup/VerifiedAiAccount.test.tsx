import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { VerifiedAiAccount } from './VerifiedAiAccount';

const state = vi.hoisted(() => ({ isLoaded: true, user: null as null | { id: string; primaryEmailAddress: null | { id: string; emailAddress: string; verification: { status: string }; prepareVerification: ReturnType<typeof vi.fn>; attemptVerification: ReturnType<typeof vi.fn> }; reload: ReturnType<typeof vi.fn> }, profile: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useUser: () => state, useClerk: () => ({ openUserProfile: state.profile }) }));
vi.mock('./OpenAiBuilder', () => ({ OpenAiBuilder: () => <button type="button">Continue to my AI builder</button> }));

beforeEach(() => {
  state.isLoaded = true;
  state.profile.mockReset();
  state.user = { id: 'synthetic-user', primaryEmailAddress: { id: 'synthetic-email', emailAddress: 'owner+clerk_test@example.com', verification: { status: 'unverified' }, prepareVerification: vi.fn().mockResolvedValue({}), attemptVerification: vi.fn().mockResolvedValue({ verification: { status: 'verified' } }) }, reload: vi.fn().mockResolvedValue({}) };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('waits for account loading and never starts a verification or business entry early', () => {
  state.isLoaded = false;
  render(<VerifiedAiAccount locale="en" />);

  expect(screen.getByRole('status')).toHaveTextContent('Opening your account');
  expect(state.user!.primaryEmailAddress!.prepareVerification).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Continue to my AI builder' })).not.toBeInTheDocument();
});

it('lets already verified owners continue without sending another code', () => {
  state.user!.primaryEmailAddress!.verification.status = 'verified';
  render(<VerifiedAiAccount locale="en" />);

  expect(screen.getByRole('button', { name: 'Continue to my AI builder' })).toBeVisible();
  expect(state.user!.primaryEmailAddress!.prepareVerification).not.toHaveBeenCalled();
});

it('provides a sign-in path for an expired account session', () => {
  state.user = null;
  render(<VerifiedAiAccount locale="fr" />);

  expect(screen.getByRole('link', { name: 'Sign in to Luster' })).toHaveAttribute('href', '/fr/ai-website?account=sign-in#account');
});

it('helps a phone-only owner add an email through the existing account controls', () => {
  state.user!.primaryEmailAddress = null;
  render(<VerifiedAiAccount locale="en" />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage my account' }));

  expect(state.profile).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Continue to my AI builder' })).not.toBeInTheDocument();
});

it('prepares only one code under StrictMode, focuses its input and bounds repeat sends', async () => {
  render(<StrictMode><VerifiedAiAccount locale="en" /></StrictMode>);
  await waitFor(() => expect(screen.getByRole('button', { name: /Send a new code in/u })).toBeDisabled());

  expect(state.user!.primaryEmailAddress!.prepareVerification).toHaveBeenCalledOnce();
  expect(state.user!.primaryEmailAddress!.prepareVerification).toHaveBeenCalledWith({ strategy: 'email_code' });
  expect(screen.getByLabelText('Verification code')).toHaveFocus();
});

it('maps failed code delivery to useful copy and lets the owner resend', async () => {
  state.user!.primaryEmailAddress!.prepareVerification.mockRejectedValueOnce(new Error('Private provider detail'));
  render(<VerifiedAiAccount locale="en" />);

  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t send a verification code');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Private provider detail');

  fireEvent.click(screen.getByRole('button', { name: /^Send a new code$/u }));
  await waitFor(() => expect(state.user!.primaryEmailAddress!.prepareVerification).toHaveBeenCalledTimes(2));
});

it('keeps wrong and still-unverified codes outside the builder', async () => {
  state.user!.primaryEmailAddress!.attemptVerification.mockRejectedValueOnce({ errors: [{ code: 'form_code_incorrect', message: 'Private provider detail' }] }).mockResolvedValueOnce({ verification: { status: 'unverified' } });
  render(<VerifiedAiAccount locale="en" />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '111111' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('That code doesn’t match');

  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That code didn’t finish verification'));

  expect(state.user!.reload).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Continue to my AI builder' })).not.toBeInTheDocument();
});

it('reloads the real account after verification and does not unlock a stale client resource', async () => {
  render(<VerifiedAiAccount locale="en" />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '424242' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  await waitFor(() => expect(state.user!.reload).toHaveBeenCalledOnce());

  expect(screen.queryByRole('button', { name: 'Continue to my AI builder' })).not.toBeInTheDocument();
});

it('opens the normal builder after the provider reload confirms the email', async () => {
  state.user!.reload.mockImplementation(async () => {
    state.user!.primaryEmailAddress!.verification.status = 'verified';
  });
  render(<VerifiedAiAccount locale="en" />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '42 42 42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

  expect(await screen.findByRole('button', { name: 'Continue to my AI builder' })).toBeVisible();
  expect(state.user!.primaryEmailAddress!.attemptVerification).toHaveBeenCalledWith({ code: '424242' });
});

it('resends only after the cooldown', async () => {
  vi.useFakeTimers();
  render(<VerifiedAiAccount locale="en" />);
  await act(async () => {});
  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  fireEvent.click(screen.getByRole('button', { name: /^Send a new code$/u }));
  await act(async () => {});

  expect(state.user!.primaryEmailAddress!.prepareVerification).toHaveBeenCalledTimes(2);
});
