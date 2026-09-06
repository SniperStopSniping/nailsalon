import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsModal } from './SettingsModal';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: null }),
}));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    motion: new Proxy({}, { get: (_, tag: string) => makeMotionTag(tag) }),
  };
});

vi.mock('./PageThemesSettings', () => ({
  PageThemesSettings: () => <div data-testid="page-themes-settings" />,
}));

vi.mock('./BookingFlowEditor', () => ({
  BookingFlowEditor: () => <div data-testid="booking-flow-editor" />,
}));

const ALL_MODULE_KEYS = [
  'smsReminders',
  'referrals',
  'rewards',
  'scheduleOverrides',
  'staffEarnings',
  'clientFlags',
  'clientBlocking',
  'analyticsDashboard',
  'utilization',
] as const;

/**
 * Salon B in the audit: `salon.features` is NULL, so only scheduleOverrides is
 * entitled and every other module comes back UPGRADE_REQUIRED.
 */
function mockEndpoints(entitled: Partial<Record<string, boolean>>) {
  const entitledModules = Object.fromEntries(
    ALL_MODULE_KEYS.map(key => [key, entitled[key] ?? false]),
  );
  const moduleReasons = Object.fromEntries(
    ALL_MODULE_KEYS.map(key => [
      key,
      entitledModules[key] ? 'ENABLED' : 'UPGRADE_REQUIRED',
    ]),
  );

  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/admin/settings/modules')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          modules: Object.fromEntries(ALL_MODULE_KEYS.map(key => [key, true])),
          entitledModules,
          moduleReasons,
        },
      }), { status: 200 }));
    }

    if (url.includes('/api/admin/settings/visibility')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { visibility: { staff: {} }, entitled: false },
      }), { status: 200 }));
    }

    // Everything else the modal loads on mount is irrelevant here.
    return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  });
}

async function openFeaturesView() {
  const user = userEvent.setup();
  render(<SettingsModal onClose={vi.fn()} salonSlug="salon-b" userName="Daniela" />);

  const row = await screen.findByText('Features & plan');
  await user.click(row);

  return screen.findByText('Modules');
}

describe('SettingsModal — Features view entitlement states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  // AG-more-settings-01 / AG-w2-settings-integrations-05: the view used to drop
  // every non-entitled module, leaving MARKETING, CONTROLS and ANALYTICS as
  // headings with nothing under them and no mention of a plan.
  it('renders a locked row for every module the plan excludes', async () => {
    mockEndpoints({ scheduleOverrides: true });
    await openFeaturesView();

    await waitFor(() => {
      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
    });

    for (const label of [
      'SMS Reminders',
      'Referrals',
      'Rewards',
      'Staff Earnings',
      'Client Flags',
      'Client Blocking',
      'Analytics Dashboard',
      'Utilization Reports',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(
      screen.getAllByText('Not included in your plan yet'),
    ).toHaveLength(8);

    // The one entitled module stays a working toggle, not a locked row.
    expect(
      screen.getByRole('button', { name: 'Toggle Schedule Overrides' }),
    ).toBeEnabled();
    expect(
      screen.queryByTestId('locked-feature-schedule-overrides'),
    ).not.toBeInTheDocument();
  });

  it('never renders a category heading with nothing under it', async () => {
    mockEndpoints({ scheduleOverrides: true });
    await openFeaturesView();

    await waitFor(() => {
      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
    });

    for (const heading of ['Marketing', 'Staff', 'Controls', 'Analytics']) {
      const headingNode = screen.getByText(heading);
      const group = headingNode.closest('div')?.parentElement;

      expect(group).not.toBeNull();
      // The heading block plus at least one module row — a toggle when the
      // salon is entitled, a locked row when it is not.
      expect(group!.children.length).toBeGreaterThan(1);
      expect(
        group!.querySelectorAll(
          '[data-testid^="locked-feature-"], button[aria-label^="Toggle "]',
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it('tells the owner that locked features are a plan matter', async () => {
    mockEndpoints({ scheduleOverrides: true });
    await openFeaturesView();

    await waitFor(() => {
      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Locked features are not included in your current plan yet/i),
    ).toBeInTheDocument();
  });
});
