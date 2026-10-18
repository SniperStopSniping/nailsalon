import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ clerkUserId: null as string | null, denied: false }));
vi.mock('next/navigation', () => ({ notFound: () => {
  throw new Error('NOT_FOUND');
} }));
vi.mock('@/features/ai-credits/config.server', () => ({ aiCreditsEnabled: () => false }));
vi.mock('@/features/business-setup/access.server', () => ({ requireSetupOwner: async () => state.denied ? { response: new Response(null, { status: 401 }) } : { salon: { id: 'synthetic-salon', slug: 'synthetic', publicationStatus: 'published' }, aiEnabled: false, clerkUserId: state.clerkUserId } }));
vi.mock('@/features/business-setup/SetupEditor', () => ({ SetupEditor: () => <div>Saved editor</div> }));
vi.mock('@/features/business-setup/ClerkSetupSession', () => ({ ClerkSetupSession: ({ children, userId }: { children: ReactNode; userId: string }) => <section aria-label={`Clerk readiness for ${userId}`}>{children}</section> }));

beforeEach(() => {
  state.clerkUserId = null;
  state.denied = false;
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

it('keeps the existing server authorization rejection before client readiness', async () => {
  state.denied = true;

  await expect(page()).rejects.toThrow('NOT_FOUND');
});
