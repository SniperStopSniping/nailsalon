import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LocaleChangeAppointmentPage from '../[locale]/(unauth)/change-appointment/page';
import TenantChangeAppointmentPage from '../[locale]/[slug]/change-appointment/page';
import BookingDisabledPage from './booking-disabled/page';
import ChangeAppointmentPage from './change-appointment/page';
import RewardsDisabledPage from './rewards-disabled/page';

const {
  changeAppointmentContentRender,
  getPublicPageContext,
  getServicesByIds,
  getTechnicianById,
  notFound,
  publicFetch,
  redirect,
} = vi.hoisted(() => ({
  changeAppointmentContentRender: vi.fn(),
  getPublicPageContext: vi.fn(),
  getServicesByIds: vi.fn(),
  getTechnicianById: vi.fn(),
  notFound: vi.fn(),
  publicFetch: vi.fn(),
  redirect: vi.fn(),
}));

const NOT_FOUND_SENTINEL = new Error('retired-customer-entry-point:not-found');

vi.mock('next/navigation', () => ({
  notFound,
  redirect,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/libs/queries', () => ({
  getServicesByIds,
  getTechnicianById,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

vi.mock('./change-appointment/ChangeAppointmentContent', () => ({
  default: () => {
    changeAppointmentContentRender();
    return <div>Retired change appointment content</div>;
  },
}));

function readSource(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('retired customer entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', publicFetch);
    notFound.mockImplementation(() => {
      throw NOT_FOUND_SENTINEL;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['root', ChangeAppointmentPage],
    ['locale', LocaleChangeAppointmentPage],
    ['locale and salon slug', TenantChangeAppointmentPage],
  ])('retires the %s change-appointment route before loading or rendering', (_route, Page) => {
    expect(Page).toBe(ChangeAppointmentPage);
    expect(() => Page()).toThrow(NOT_FOUND_SENTINEL);

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(getPublicPageContext).not.toHaveBeenCalled();
    expect(getServicesByIds).not.toHaveBeenCalled();
    expect(getTechnicianById).not.toHaveBeenCalled();
    expect(changeAppointmentContentRender).not.toHaveBeenCalled();
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('keeps booking-disabled as a neutral status page without an account action', () => {
    render(<>{BookingDisabledPage()}</>);

    expect(screen.getByRole('heading', { name: 'Online Booking Unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/log in|sign in|customer account/i)).not.toBeInTheDocument();
  });

  it('keeps the valid rewards-disabled booking action without an account action', () => {
    render(
      <RewardsDisabledPage
        searchParams={{}}
        params={{ locale: 'en', slug: 'isla-nail-studio' }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Rewards Program Unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book an Appointment' })).toHaveAttribute(
      'href',
      '/en/isla-nail-studio/book',
    );
    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/log in|sign in|customer account/i)).not.toBeInTheDocument();
  });

  it('has no active booking fallback or legacy account navigation callback', () => {
    const confirmationSource = readSource(
      'src/app/(unauth)/book/confirm/BookConfirmClient.tsx',
    );

    expect(
      confirmationSource,
      'BookConfirmClient must not construct or link to the retired change-appointment route',
    ).not.toMatch(/buildChangeAppointmentUrl|\/change-appointment/);

    for (const retiredCallback of ['onViewRewards=', 'onManagePayment=', 'onGoToProfile=']) {
      expect(
        confirmationSource,
        `BookConfirmClient must not wire the retired ${retiredCallback.slice(0, -1)} callback`,
      ).not.toContain(retiredCallback);
    }
  });

  it('has no runtime floating-dock import or spacer in technician booking', () => {
    const techSource = readSource('src/app/(unauth)/book/tech/BookTechClient.tsx');

    expect(
      techSource,
      'BookTechClient must not import or render the retired account dock',
    ).not.toContain('@/components/booking/BookingFloatingDock');
    expect(
      techSource,
      'BookTechClient must not retain layout compensation for the retired dock',
    ).not.toMatch(/className=["'][^"']*\bh-16\b/);
  });
});
