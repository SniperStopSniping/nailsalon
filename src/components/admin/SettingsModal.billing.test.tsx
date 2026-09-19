/**
 * Settings → Account & Plan billing surface — P7 wiring proofs.
 *
 * D5 ratified deleting `ComparePlansModal`/`BILLING_PLAN_CARDS` in favour of
 * `ChoosePlanPanel`, which reads the catalogue live from the usage/billing-
 * status response instead of carrying a client-side price mirror. This file
 * proves the old dead-end surface is fully gone and that the relabelled
 * "Plans" button opens the new panel; ChoosePlanPanel's own behaviour
 * (cards, checkout, confirmation, portal hand-off) is covered by
 * ChoosePlanPanel.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
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
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
  };
});

vi.mock('./PageThemesSettings', () => ({ PageThemesSettings: () => <div /> }));
vi.mock('./BookingFlowEditor', () => ({ BookingFlowEditor: () => <div /> }));
vi.mock('./ChoosePlanPanel', () => ({
  ChoosePlanPanel: ({ salonSlug, onClose }: { salonSlug: string; onClose: () => void }) => (
    <div data-testid="choose-plan-panel-stub">
      <span>
        panel for
        {' '}
        {salonSlug}
      </span>
      <button type="button" onClick={onClose}>Close stub</button>
    </div>
  ),
}));

function mockEndpoints(options: {
  billingMode?: 'NONE' | 'STRIPE';
  subscriptionStatus?: string | null;
  billingSource?: 'billing_subscription' | 'legacy';
} = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/admin/location?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          salon: { id: 'salon_1', slug: 'salon-a', name: 'Salon A', locationCount: 1 },
          location: { id: 'loc_1', name: 'Main Studio', address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5H 2M9', isPrimary: true },
          isPrimaryFallback: false,
        },
      }), { status: 200 }));
    }
    if (url.includes('/api/admin/retention/settings?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { settings: { parkingInstructions: 'Free parking behind the salon.' } },
      }), { status: 200 }));
    }
    if (url.includes('/api/admin/settings/booking-flow?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { bookingFlowCustomizationEnabled: false, bookingFlow: null },
      }), { status: 200 }));
    }
    if (url.includes('/api/admin/settings/visibility?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { visibility: { staff: {} }, entitled: true },
      }), { status: 200 }));
    }
    if (url.includes('/api/admin/settings/modules?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          modules: { smsReminders: true, referrals: true, rewards: true, scheduleOverrides: true, staffEarnings: true, clientFlags: true, clientBlocking: true, analyticsDashboard: true, utilization: true },
          entitledModules: { smsReminders: true, referrals: true, rewards: true, scheduleOverrides: true, staffEarnings: true, clientFlags: true, clientBlocking: true, analyticsDashboard: true, utilization: true },
        },
      }), { status: 200 }));
    }
    if (url.includes('/api/admin/salon/settings?salonSlug=salon-a')) {
      return Promise.resolve(new Response(JSON.stringify({
        reviewsEnabled: true,
        rewardsEnabled: true,
        billingMode: options.billingMode ?? 'NONE',
        subscriptionStatus: options.subscriptionStatus !== undefined
          ? options.subscriptionStatus
          : (options.billingMode === 'STRIPE' ? 'active' : null),
        // D19c companion: the settings route now says which side answered.
        billingSource: options.billingSource ?? 'legacy',
        bookingConfig: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: '',
          firstVisitDiscountEnabled: false,
          clientChangeCutoffHours: 24,
        },
        merchandising: { featureLusterManicure: true },
        bookingNotifications: {},
        ownerPhonePresent: true,
        ownerEmailPresent: true,
        smsChannelAvailable: true,
        emailChannelAvailable: true,
        bookingExperience: null,
        bookingExperienceEntitlement: {
          featureKey: 'booking_experience_customization',
          entitled: true,
          source: 'plan',
          planKey: 'tier_1',
          storedPlan: 'single_salon',
          lockedReason: null,
        },
      }), { status: 200 }));
    }
    if (url === '/api/admin/profile' && init?.method !== 'POST') {
      return Promise.resolve(new Response(JSON.stringify({
        user: { id: 'admin_1', name: 'Daniela', email: 'daniela@example.com', emailEditable: false },
      }), { status: 200 }));
    }
    if (url === '/api/billing/portal' && init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ url: 'https://billing.stripe.com/session/test' }), { status: 200 }));
    }

    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mockEndpoints();
});

describe('Account & Plan — Choose plan wiring (P7)', () => {
  it('keeps billing actions unavailable after a failed read and restores them only after Retry succeeds', async () => {
    mockEndpoints({ billingMode: 'STRIPE', billingSource: 'billing_subscription' });
    const successfulFetch = fetchMock.getMockImplementation()!;
    let failBillingRead = true;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/admin/salon/settings?') && failBillingRead) {
        return Promise.resolve(new Response('{}', { status: 503 }));
      }
      return successfulFetch(input, init);
    });
    const { SettingsModal } = await import('./SettingsModal');
    render(<SettingsModal initialView="plan-billing" leafOnly onClose={vi.fn()} salonSlug="salon-a" salonId="salon_1" userName="Daniela" />);

    expect(await screen.findByTestId('plan-billing-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-billing-button')).not.toBeInTheDocument();
    expect(screen.queryByText('Cash / Offline billing enabled')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plans' })).not.toBeInTheDocument();

    failBillingRead = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('manage-billing-button')).toBeInTheDocument();
    expect(screen.getByText('Stripe Billing (active)')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/billing/portal'))).toBe(false);
  });

  it('the old Compare Plans dead end is gone from the source', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync('src/components/admin/SettingsModal.tsx', 'utf-8'));

    expect(source).not.toContain('ComparePlansModal');
    expect(source).not.toContain('BILLING_PLAN_CARDS');
    expect(source).not.toContain('showComparePlans');
    expect(source).not.toContain('PLAN_FEATURES');
    expect(source).not.toContain('Most Popular');
  });

  it('renders a "Plans" button (not "Compare Plans") that opens ChoosePlanPanel for the current salon', async () => {
    const { SettingsModal } = await import('./SettingsModal');
    render(<SettingsModal initialView="plan-billing" leafOnly onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    expect(screen.queryByText('Compare Plans')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choose-plan-panel-stub')).not.toBeInTheDocument();

    const plansButton = await screen.findByText('Plans');
    fireEvent.click(plansButton);

    const panel = await screen.findByTestId('choose-plan-panel-stub');

    expect(panel).toHaveTextContent('panel for salon-a');
  });

  // D19c companion (LG-4): the component needs NO logic change — it renders
  // from `data.billingMode` — but that is exactly why it has to be pinned. The
  // settings route now derives that field from a live `billing_subscription`
  // row, so a new-track subscriber whose LEGACY column still reads `NONE` must
  // still get the Manage-billing button and the plan status, not "Cash /
  // Offline billing enabled".
  it('renders manage-billing-button for a derived billing_subscription salon', async () => {
    mockEndpoints({
      billingMode: 'STRIPE',
      subscriptionStatus: 'active',
      billingSource: 'billing_subscription',
    });
    const { SettingsModal } = await import('./SettingsModal');
    render(<SettingsModal initialView="plan-billing" leafOnly onClose={vi.fn()} salonSlug="salon-a" salonId="salon_1" userName="Daniela" />);

    expect(await screen.findByTestId('manage-billing-button')).toBeInTheDocument();
    expect(screen.getByText('Stripe Billing (active)')).toBeInTheDocument();
    expect(screen.queryByText('Cash / Offline billing enabled')).not.toBeInTheDocument();
  });

  it('still shows the cash/offline state when the display resolves to legacy NONE', async () => {
    mockEndpoints({ billingMode: 'NONE', billingSource: 'legacy' });
    const { SettingsModal } = await import('./SettingsModal');
    render(<SettingsModal initialView="plan-billing" leafOnly onClose={vi.fn()} salonSlug="salon-a" salonId="salon_1" userName="Daniela" />);

    expect(await screen.findByText('Cash / Offline billing enabled')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-billing-button')).not.toBeInTheDocument();
  });

  it('does not render the Plans button for free-solo salons', async () => {
    const { SettingsModal } = await import('./SettingsModal');
    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        userName="Daniela"
        isFreeSolo
        initialView="plan-billing"
        leafOnly
      />,
    );

    expect(screen.queryByText('Plans')).not.toBeInTheDocument();
  });
});
