import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ClerkSetupSession } from './ClerkSetupSession';

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true, userId: 'owner-one', getToken: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
const editor = <button type="button">Saved website editor</button>;
const view = () => <ClerkSetupSession userId="owner-one" locale="en">{editor}</ClerkSetupSession>;

beforeEach(() => {
  Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: 'owner-one' });
  auth.getToken.mockReset().mockResolvedValue('synthetic-session-token');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('does not mount API-calling children while Clerk is loading', () => {
  auth.isLoaded = false;
  render(view());

  expect(screen.getByRole('status')).toHaveTextContent('Finishing your sign-in');
  expect(screen.queryByRole('button', { name: 'Saved website editor' })).not.toBeInTheDocument();
  expect(auth.getToken).not.toHaveBeenCalled();
});

it('waits for the SDK token refresh before opening the saved editor', async () => {
  let finish!: (value: string) => void;
  auth.getToken.mockReturnValue(new Promise<string>((resolve) => {
    finish = resolve;
  }));
  render(view());
  await waitFor(() => expect(auth.getToken).toHaveBeenCalledWith({ skipCache: true }));

  expect(screen.queryByRole('button', { name: 'Saved website editor' })).not.toBeInTheDocument();

  await act(async () => finish('synthetic-session-token'));

  expect(screen.getByRole('button', { name: 'Saved website editor' })).toBeVisible();
});

it('keeps signed-out or different accounts away from the previous saved editor', async () => {
  const result = render(view());
  await screen.findByRole('button', { name: 'Saved website editor' });
  auth.userId = 'other-owner';
  result.rerender(view());

  expect(screen.getByRole('alert')).toHaveTextContent('Your sign-in changed');
  expect(screen.queryByRole('button', { name: 'Saved website editor' })).not.toBeInTheDocument();

  auth.isSignedIn = false;
  result.rerender(view());

  expect(screen.getByRole('link', { name: 'Sign in to Luster' })).toHaveAttribute('href', '/en/owner-sign-in');
});

it('allows a deliberate retry without leaking provider error text', async () => {
  auth.getToken.mockRejectedValueOnce(new Error('Private provider details'));
  render(view());

  expect(await screen.findByRole('alert')).toHaveTextContent('Your saved work is safe');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Private provider details');

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByRole('button', { name: 'Saved website editor' })).toBeVisible();
  expect(auth.getToken).toHaveBeenCalledTimes(2);
});

it('does not mount the editor when the SDK returns no active token', async () => {
  auth.getToken.mockResolvedValue(null);
  render(view());
  await screen.findByRole('alert');

  expect(screen.queryByRole('button', { name: 'Saved website editor' })).not.toBeInTheDocument();
});

it('bounds a stalled SDK refresh and ignores a late response after timeout', async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  auth.getToken.mockReturnValue(new Promise<string>((resolve) => {
    finish = resolve;
  }));
  render(view());
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(20_000));

  expect(screen.getByRole('alert')).toHaveTextContent('Please try again');

  await act(async () => finish('late-synthetic-token'));

  expect(screen.queryByRole('button', { name: 'Saved website editor' })).not.toBeInTheDocument();
});
