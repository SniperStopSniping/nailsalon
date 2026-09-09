import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BookingExperienceEntitlementInspection,
  BookingExperienceEntitlementOverrideServerState,
} from '@/types/salonPolicy';

import { SalonDetailPanel } from './SalonDetailPanel';

const { fetchMock, useParamsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  useParamsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
}));

vi.mock('./AuditLogTable', () => ({
  AuditLogTable: () => null,
}));

vi.mock('./BookingExperienceEntitlementOverrideControl', () => ({
  BookingExperienceEntitlementOverrideControl: ({
    salonId,
    inspection,
    onServerStateChange,
  }: {
    salonId: string;
    inspection: BookingExperienceEntitlementInspection;
    onServerStateChange: (
      state: BookingExperienceEntitlementOverrideServerState,
    ) => void;
  }) => (
    <div data-testid="mock-booking-entitlement-control">
      <span>
        {salonId}
        :
        {inspection.overrideState}
      </span>
      <button
        type="button"
        onClick={() => onServerStateChange({
          features: {
            booking: {
              customization: false,
              customizationOverrideAuditId: 'audit_new',
            },
          },
          bookingExperienceEntitlement: {
            ...inspection,
            entitled: false,
            source: 'override',
            lockedReason: 'upgrade_required',
            overrideState: 'force_disabled',
            overrideAuditId: 'audit_new',
            reason: 'Support hold',
            actor: { id: 'admin_1', email: 'admin@example.com' },
            updatedAt: '2026-07-27T15:00:00.000Z',
            provenanceRecorded: true,
          },
        })}
      >
        Apply mock override
      </button>
    </div>
  ),
}));

vi.mock('./SalonFeatureAccessManager', () => ({
  SalonFeatureAccessManager: ({
    features,
  }: {
    features: {
      booking?: {
        customization?: boolean;
        customizationOverrideAuditId?: string;
      };
    };
  }) => (
    <div data-testid="mock-feature-manager">
      {String(features.booking?.customization)}
      :
      {features.booking?.customizationOverrideAuditId ?? 'none'}
    </div>
  ),
}));

vi.mock('./ChangeSalonSlugModal', () => ({
  ChangeSalonSlugModal: () => null,
}));

vi.mock('./DeleteSalonModal', () => ({
  DeleteSalonModal: () => null,
}));

vi.mock('./LocationForm', () => ({
  LocationForm: () => null,
}));

vi.mock('./ResetDataModal', () => ({
  ResetDataModal: () => null,
}));

vi.mock('./UserSearchModal', () => ({
  UserSearchModal: () => null,
}));

const organizationResponse = {
  testToolsEnabled: false,
  canonicalUrls: null,
  integrationHealth: null,
  salon: {
    id: 'salon_1',
    name: 'Isla Nail Studio',
    slug: 'isla-nail-studio',
    customDomain: null,
    plan: 'single_salon',
    status: 'active',
    maxLocations: 1,
    isMultiLocationEnabled: false,
    features: {
      booking: {
        customizationOverrideAuditId: 'audit_1',
      },
    },
    bookingExperienceEntitlement: {
      featureKey: 'booking_experience_customization',
      entitled: true,
      source: 'plan',
      planKey: 'tier_1',
      storedPlan: 'single_salon',
      lockedReason: null,
      planDefault: true,
      overrideState: 'default',
      overrideAuditId: 'audit_1',
      reason: null,
      actor: { id: 'admin_0', email: 'previous@example.com' },
      updatedAt: '2026-07-27T14:00:00.000Z',
      provenanceRecorded: true,
    },
    onlineBookingEnabled: true,
    smsRemindersEnabled: true,
    rewardsEnabled: true,
    profilePageEnabled: true,
    bookingFlowCustomizationEnabled: false,
    bookingFlow: null,
    ownerEmail: null,
    ownerClerkUserId: null,
    internalNotes: null,
    deletedAt: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-27T14:00:00.000Z',
  },
  metrics: {
    locationsCount: 1,
    techsCount: 2,
    clientsCount: 3,
    appointmentsLast30d: 4,
  },
  owner: null,
  pendingOwnerInvite: null,
  admins: [],
};

describe('SalonDetailPanel Booking Experience entitlement wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useParamsMock.mockReturnValue({ locale: 'en' });
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/super-admin/organizations/salon_1') {
        return Promise.resolve(new Response(
          JSON.stringify(organizationResponse),
          { status: 200 },
        ));
      }
      if (url === '/api/super-admin/salons/salon_1/settings') {
        return Promise.resolve(new Response(JSON.stringify({
          settings: {
            reviewsEnabled: true,
            rewardsEnabled: true,
            billingMode: 'NONE',
          },
        }), { status: 200 }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes authoritative inspection state to the focused control and adopts its returned feature state', async () => {
    const user = userEvent.setup();
    render(
      <SalonDetailPanel
        salonId="salon_1"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('salon_1:default'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('mock-feature-manager')).toHaveTextContent('undefined:audit_1');

    await user.click(screen.getByRole('button', { name: 'Apply mock override' }));

    await waitFor(() => {
      expect(screen.getByText('salon_1:force_disabled')).toBeInTheDocument();
      expect(screen.getByTestId('mock-feature-manager')).toHaveTextContent('false:audit_new');
    });
  });

  it('replaces the legacy SMS switch with included access and preserves SMS values on an unrelated save', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const user = userEvent.setup();
    const legacyResponse = {
      ...organizationResponse,
      salon: {
        ...organizationResponse.salon,
        plan: 'free',
        features: {
          ...organizationResponse.salon.features,
          smsReminders: false,
          marketing: { smsReminders: false },
        },
        smsRemindersEnabled: false,
      },
    };
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/super-admin/organizations/salon_1') {
        return Promise.resolve(new Response(JSON.stringify(legacyResponse), { status: 200 }));
      }
      return fallback(input, init);
    });
    render(<SalonDetailPanel salonId="salon_1" onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Legacy feature settings' }));

    expect(screen.getByText('Luster SMS')).toBeInTheDocument();
    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.getByText('Texts use SMS credits. The owner manages texting and reminders in communication preferences.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /sms/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await user.type(screen.getByLabelText('Salon Name'), ' Updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('button', { name: 'Saved' });

    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');

    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe('/api/super-admin/organizations/salon_1');
    expect(JSON.parse(writes[0]?.[1]?.body as string)).toMatchObject({
      name: 'Isla Nail Studio Updated',
      features: { smsReminders: false, marketing: { smsReminders: false } },
      smsRemindersEnabled: false,
    });
  });
});
