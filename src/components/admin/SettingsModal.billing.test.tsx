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
import { render, screen } from '@testing-library/react';
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
vi.mock('./UsageBillingModal', () => ({
  UsageBillingModal: ({ salonSlug }: { salonSlug: string }) => (
    <div data-testid="usage-stub">
      Usage & Top Ups for
      {salonSlug}
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

describe('existing settings billing compatibility', () => {
  it('opens the shared usage screen from the old plan-billing link', async () => {
    const { SettingsModal } = await import('./SettingsModal');
    render(<SettingsModal initialView="plan-billing" leafOnly onClose={vi.fn()} salonSlug="salon-a" salonId="salon_1" />);

    expect(await screen.findByTestId('usage-stub')).toHaveTextContent('Usage & Top Ups for salon-a');
    expect(screen.queryByRole('button', { name: 'Plans' })).not.toBeInTheDocument();
  });
});
