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

function mockEndpoints(options: { billingMode?: 'NONE' | 'STRIPE' } = {}) {
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
        subscriptionStatus: options.billingMode === 'STRIPE' ? 'active' : null,
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
    render(<SettingsModal onClose={vi.fn()} salonSlug="salon-a" userName="Daniela" />);

    fireEvent.click(await screen.findByText('Account & Plan'));

    expect(screen.queryByText('Compare Plans')).not.toBeInTheDocument();
    expect(screen.queryByTestId('choose-plan-panel-stub')).not.toBeInTheDocument();

    const plansButton = await screen.findByText('Plans');
    fireEvent.click(plansButton);

    const panel = await screen.findByTestId('choose-plan-panel-stub');

    expect(panel).toHaveTextContent('panel for salon-a');
  });

  it('does not render the Plans button for free-solo salons', async () => {
    const { SettingsModal } = await import('./SettingsModal');
    render(
      <SettingsModal
        onClose={vi.fn()}
        salonSlug="salon-a"
        userName="Daniela"
        isFreeSolo
      />,
    );

    fireEvent.click(await screen.findByText('Account & Plan'));

    expect(screen.queryByText('Plans')).not.toBeInTheDocument();
  });
});
