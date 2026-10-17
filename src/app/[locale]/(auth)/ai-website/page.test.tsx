import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import AiWebsitePage from './page';

const state = vi.hoisted(() => ({ enabled: vi.fn(), auth: vi.fn(), open: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: state.auth }));
vi.mock('next/navigation', () => ({ notFound: () => {
  throw new Error('NOT_FOUND');
} }));
vi.mock('@/features/business-setup/access.server', () => ({ businessSetupSelfServeEnabled: state.enabled }));
vi.mock('@/features/business-setup/OpenAiBuilder', () => ({ OpenAiBuilder: () => <button type="button">Continue to my AI builder</button> }));
vi.mock('@/components/auth/OwnerSignInCard', () => ({ OwnerSignInCard: (props: { mode: string }) => <div>{props.mode === 'sign-in' ? 'Sign in to your account' : 'Create your account'}</div> }));

beforeEach(() => {
  state.enabled.mockReturnValue(true);
  state.auth.mockResolvedValue({ userId: null });
});

afterEach(cleanup);

const page = (account?: string) => AiWebsitePage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ account }) });

it('explains the included design and business work before signup or purchase', async () => {
  render(await page());

  expect(screen.getByRole('link', { name: 'Build with AI · from $10 CAD' })).toHaveAttribute('href', '/en/ai-website?account=sign-up');
  expect(screen.getByText(/Ordinary bookings and manual editing do not use AI credits/)).toBeVisible();
  expect(screen.queryByText('Create your account')).not.toBeInTheDocument();
});

it('keeps signup, returning owners and feature-disabled access separate', async () => {
  render(await page('sign-up'));

  expect(screen.getByText('Create your account')).toBeInTheDocument();

  cleanup();
  state.auth.mockResolvedValue({ userId: 'verified-user' });
  render(await page());

  expect(screen.getByRole('button', { name: 'Continue to my AI builder' })).toBeVisible();

  state.enabled.mockReturnValue(false);

  await expect(page()).rejects.toThrow('NOT_FOUND');
});
