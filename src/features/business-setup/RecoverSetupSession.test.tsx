import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RecoverSetupSession } from './RecoverSetupSession';

const state = vi.hoisted(() => ({ auth: { isLoaded: true, isSignedIn: true, userId: 'browser-owner', getToken: vi.fn() }, router: { refresh: vi.fn() } }));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => state.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));

beforeEach(() => {
  Object.assign(state.auth, { isLoaded: true, isSignedIn: true, userId: 'browser-owner' });
  state.auth.getToken.mockReset().mockResolvedValue('synthetic-session-token');
  state.router.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('waits for the genuine SDK token before repeating the server ownership check', async () => {
  let finish!: (value: string) => void;
  state.auth.getToken.mockReturnValue(new Promise<string>((resolve) => {
    finish = resolve;
  }));
  render(<RecoverSetupSession locale="en" />);
  await act(async () => {});

  expect(state.router.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Finishing your sign-in');

  await act(async () => finish('synthetic-session-token'));

  expect(state.router.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Finishing your sign-in');
});

it('shows sign-in without requesting any workspace or refresh for an anonymous visitor', () => {
  state.auth.isSignedIn = false;
  state.auth.userId = '';
  render(<RecoverSetupSession locale="en" />);

  expect(screen.getByRole('link', { name: 'Sign in to Luster' })).toHaveAttribute('href', '/en/owner-sign-in');
  expect(state.router.refresh).not.toHaveBeenCalled();
  expect(state.auth.getToken).not.toHaveBeenCalled();
});

it('does not repeatedly refresh when server authentication remains unavailable', async () => {
  vi.useFakeTimers();
  render(<RecoverSetupSession locale="en" />);
  await act(async () => {});

  expect(state.router.refresh).toHaveBeenCalledTimes(1);

  await act(async () => vi.advanceTimersByTime(60_000));

  expect(screen.getByRole('alert')).toHaveTextContent('Your saved work is safe');
  expect(state.router.refresh).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

  expect(state.router.refresh).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('Finishing your sign-in');
});

it('does not repeat a server check if the browser token refresh fails', async () => {
  state.auth.getToken.mockRejectedValue(new Error('Private provider message'));
  render(<RecoverSetupSession locale="en" />);

  expect(await screen.findByRole('alert')).not.toHaveTextContent('Private provider message');
  expect(state.router.refresh).not.toHaveBeenCalled();
});
