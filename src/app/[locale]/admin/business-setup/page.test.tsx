import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ clerkUserId: null as string | null, denied: 0 }));
vi.mock('next/navigation', () => ({ notFound: () => {
  throw new Error('NOT_FOUND');
} }));
vi.mock('@/features/ai-credits/config.server', () => ({ aiCreditsEnabled: () => false }));
vi.mock('@/features/business-setup/access.server', () => ({ requireSetupOwner: async () => state.denied ? { response: new Response(null, { status: state.denied }) } : { salon: { id: 'synthetic-salon', slug: 'synthetic', publicationStatus: 'published' }, aiEnabled: false, clerkUserId: state.clerkUserId } }));
vi.mock('@/features/business-setup/SetupEditor', () => ({ SetupEditor: ({ manualMode }: { manualMode?: boolean }) => <div>{manualMode ? 'Saved manual editor' : 'Saved editor'}</div> }));
vi.mock('@/features/business-setup/ClerkSetupSession', () => ({ ClerkSetupSession: ({ children, userId }: { children: ReactNode; userId: string }) => <section aria-label={`Clerk readiness for ${userId}`}>{children}</section> }));
vi.mock('@/features/business-setup/RecoverSetupSession', () => ({ RecoverSetupSession: () => <div>Generic sign-in recovery</div> }));

beforeEach(() => {
  state.clerkUserId = null;
  state.denied = 0;
});

afterEach(cleanup);

const page = async () => (await import('./page')).default({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ salon: 'synthetic' }) });

it('keeps the authorized legacy-session editor independent from Clerk loading', async () => {
  render(await page());

  expect(screen.getByText('Saved editor')).toBeVisible();
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('waits for the actual Clerk owner client before its API-driven editor mounts', async () => {
  state.clerkUserId = 'verified-owner';
  render(await page());

  expect(screen.getByRole('region', { name: 'Clerk readiness for verified-owner' })).toContainElement(screen.getByText('Saved editor'));
});

it('provides only generic recovery when the browser cookie is not ready', async () => {
  state.denied = 401;
  render(await page());

  expect(screen.getByText('Generic sign-in recovery')).toBeVisible();
  expect(screen.queryByText('Saved editor')).not.toBeInTheDocument();
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it.each([403, 404])('keeps server authorization rejection for status %i', async (status) => {
  state.denied = status;

  await expect(page()).rejects.toThrow('NOT_FOUND');
});

it('opens the same owner-authorized editor in manual mode without requiring AI access', async () => {
  const Page = (await import('./page')).default;
  render(await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ salon: 'synthetic', mode: 'manual' }) }));

  expect(screen.getByText('Saved manual editor')).toBeVisible();
});
