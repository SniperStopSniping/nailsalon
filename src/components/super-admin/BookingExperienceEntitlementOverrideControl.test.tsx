import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BookingExperienceEntitlementInspection,
  BookingExperienceEntitlementOverrideServerState,
} from '@/types/salonPolicy';

import { BookingExperienceEntitlementOverrideControl } from './BookingExperienceEntitlementOverrideControl';

const fetchMock = vi.fn();

function inspection(
  overrides: Partial<BookingExperienceEntitlementInspection> = {},
): BookingExperienceEntitlementInspection {
  return {
    featureKey: 'booking_experience_customization',
    entitled: true,
    source: 'plan',
    planKey: 'tier_1',
    storedPlan: 'single_salon',
    lockedReason: null,
    planDefault: true,
    overrideState: 'default',
    overrideAuditId: null,
    reason: null,
    actor: null,
    updatedAt: null,
    provenanceRecorded: false,
    ...overrides,
  };
}

function serverState(
  currentInspection: BookingExperienceEntitlementInspection,
): BookingExperienceEntitlementOverrideServerState {
  const booking = {
    customizationOverrideAuditId:
      currentInspection.overrideAuditId ?? undefined,
    ...(currentInspection.overrideState === 'force_enabled'
      ? { customization: true }
      : currentInspection.overrideState === 'force_disabled'
        ? { customization: false }
        : {}),
  };

  return {
    features: { booking },
    bookingExperienceEntitlement: currentInspection,
  };
}

function renderControl(
  currentInspection = inspection(),
) {
  const onServerStateChange = vi.fn();

  function Harness() {
    const [authoritativeInspection, setAuthoritativeInspection]
      = useState(currentInspection);

    return (
      <BookingExperienceEntitlementOverrideControl
        salonId="salon_1"
        inspection={authoritativeInspection}
        onServerStateChange={(state) => {
          setAuthoritativeInspection(
            state.bookingExperienceEntitlement,
          );
          onServerStateChange(state);
        }}
      />
    );
  }

  render(
    <Harness />,
  );
  return { onServerStateChange };
}

describe('BookingExperienceEntitlementOverrideControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the complete inspection and exactly three override choices', () => {
    renderControl(inspection({
      source: 'override',
      overrideState: 'force_enabled',
      overrideAuditId: 'audit_1',
      reason: 'Temporary launch access',
      actor: { id: 'admin_1', email: 'admin@example.com' },
      updatedAt: '2026-07-27T14:30:00.000Z',
      provenanceRecorded: true,
    }));

    const control = screen.getByTestId('booking-experience-entitlement-control');

    expect(within(control).getAllByRole('radio')).toHaveLength(3);
    expect(within(control).getByRole('radio', { name: /Default from plan/ })).toBeInTheDocument();
    expect(within(control).getByRole('radio', { name: /Force enabled/ })).toBeChecked();
    expect(within(control).getByRole('radio', { name: /Force disabled/ })).toBeInTheDocument();

    expect(screen.getByText('Stored plan').parentElement).toHaveTextContent('single_salon');
    expect(screen.getByText('Internal plan key').parentElement).toHaveTextContent('tier_1');
    expect(screen.getByText('Plan default').parentElement).toHaveTextContent('Enabled');
    expect(screen.getByText('Override state').parentElement).toHaveTextContent('Force enabled');
    expect(screen.getByText('Resolved access').parentElement).toHaveTextContent('Enabled');
    expect(screen.getByText('Source').parentElement).toHaveTextContent('Override');
    expect(screen.getByText('Reason').parentElement).toHaveTextContent('Temporary launch access');
    expect(screen.getByText('Actor').parentElement).toHaveTextContent('admin@example.com (admin_1)');
    expect(screen.getByText('Updated time').parentElement).not.toHaveTextContent('Not recorded');
  });

  it('requires a trimmed force reason, submits only trusted mutation fields, and disables controls while pending', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    }));
    const { onServerStateChange } = renderControl();

    await user.click(screen.getByRole('radio', { name: /Force enabled/ }));
    const reasonInput = screen.getByLabelText('Reason for override');
    const save = screen.getByRole('button', { name: 'Save entitlement override' });

    expect(save).toBeDisabled();

    await user.type(reasonInput, '   Temporary support access   ');

    expect(save).toBeEnabled();

    await user.click(save);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/super-admin/organizations/salon_1/entitlements/booking-experience-customization',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overrideState: 'force_enabled',
          reason: 'Temporary support access',
          expectedOverrideState: 'default',
          expectedOverrideAuditId: null,
        }),
      },
    );
    expect(screen.getByRole('button', { name: 'Saving override…' })).toBeDisabled();

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }

    const next = serverState(inspection({
      source: 'override',
      overrideState: 'force_enabled',
      overrideAuditId: 'audit_1',
      reason: 'Temporary support access',
      actor: { id: 'admin_1', email: 'admin@example.com' },
      updatedAt: '2026-07-27T14:30:00.000Z',
      provenanceRecorded: true,
    }));
    resolveRequest?.(new Response(JSON.stringify({
      changed: true,
      ...next,
    }), { status: 200 }));

    expect(await screen.findByRole('status')).toHaveTextContent('override saved');
    expect(onServerStateChange).toHaveBeenCalledWith(next);
  });

  it('treats the same normalized force reason as a no-op and a new reason as a real update', () => {
    renderControl(inspection({
      source: 'override',
      overrideState: 'force_disabled',
      entitled: false,
      lockedReason: 'upgrade_required',
      overrideAuditId: 'audit_1',
      reason: 'Support hold',
      actor: { id: 'admin_1', email: null },
      updatedAt: '2026-07-27T14:30:00.000Z',
      provenanceRecorded: true,
    }));

    const reasonInput = screen.getByLabelText('Reason for override');
    const save = screen.getByRole('button', { name: 'Save entitlement override' });

    expect(save).toBeDisabled();

    fireEvent.change(reasonInput, { target: { value: '   Support hold   ' } });

    expect(save).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(reasonInput, { target: { value: 'New support reason' } });

    expect(save).toBeEnabled();
  });

  it('enforces the normalized 500-character force-reason limit', () => {
    renderControl();
    fireEvent.click(screen.getByRole('radio', { name: /Force disabled/ }));

    const reasonInput = screen.getByLabelText('Reason for override');
    fireEvent.change(reasonInput, { target: { value: 'x'.repeat(501) } });

    expect(screen.getByText('Reason must be 500 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save entitlement override' })).toBeDisabled();
  });

  it('removes the reason field and omits reason when returning to plan default', async () => {
    const user = userEvent.setup();
    const next = serverState(inspection({
      overrideAuditId: 'audit_2',
      actor: { id: 'admin_1', email: 'admin@example.com' },
      updatedAt: '2026-07-27T15:00:00.000Z',
      provenanceRecorded: true,
    }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      ...next,
    }), { status: 200 }));
    renderControl(inspection({
      source: 'override',
      overrideState: 'force_enabled',
      overrideAuditId: 'audit_1',
      reason: 'Temporary access',
      actor: { id: 'admin_1', email: 'admin@example.com' },
      updatedAt: '2026-07-27T14:30:00.000Z',
      provenanceRecorded: true,
    }));

    await user.click(screen.getByRole('radio', { name: /Default from plan/ }));

    expect(screen.queryByLabelText('Reason for override')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save entitlement override' }));

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(request.body as string)).toEqual({
      overrideState: 'default',
      expectedOverrideState: 'force_enabled',
      expectedOverrideAuditId: 'audit_1',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('override saved');
  });

  it('retains the operator draft after an ordinary server failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'Audit storage unavailable',
    }), { status: 500 }));
    renderControl();

    await user.click(screen.getByRole('radio', { name: /Force enabled/ }));
    await user.type(screen.getByLabelText('Reason for override'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Save entitlement override' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Audit storage unavailable');
    expect(screen.getByLabelText('Reason for override')).toHaveValue('Keep this draft');
    expect(screen.getByRole('radio', { name: /Force enabled/ })).toBeChecked();
  });

  it('adopts a typed conflict without retrying and requires a fresh intentional edit', async () => {
    const user = userEvent.setup();
    const authoritative = serverState(inspection({
      source: 'override',
      entitled: false,
      lockedReason: 'upgrade_required',
      overrideState: 'force_disabled',
      overrideAuditId: 'audit_newer',
      reason: 'Newer support decision',
      actor: { id: 'admin_2', email: 'newer@example.com' },
      updatedAt: '2026-07-27T15:00:00.000Z',
      provenanceRecorded: true,
    }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'Booking Experience entitlement changed since it was loaded',
      code: 'ENTITLEMENT_OVERRIDE_CONFLICT',
      current: authoritative,
    }), { status: 409 }));
    const { onServerStateChange } = renderControl();

    await user.click(screen.getByRole('radio', { name: /Force enabled/ }));
    await user.type(screen.getByLabelText('Reason for override'), 'My stale decision');
    await user.click(screen.getByRole('button', { name: 'Save entitlement override' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Review the current state');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onServerStateChange).toHaveBeenCalledWith(authoritative);
    expect(screen.getByRole('radio', { name: /Force disabled/ })).toBeChecked();
    expect(screen.getByLabelText('Reason for override')).toHaveValue('Newer support decision');
    expect(screen.getByRole('button', { name: 'Save entitlement override' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Force enabled/ }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Save entitlement override' })).toBeDisabled();
  });

  it('does not fabricate provenance for a legacy forced override', () => {
    renderControl(inspection({
      source: 'override',
      overrideState: 'force_enabled',
      overrideAuditId: null,
      reason: null,
      actor: null,
      updatedAt: null,
      provenanceRecorded: false,
    }));

    expect(screen.getByText('Reason').parentElement).toHaveTextContent('Not recorded (pre-audit)');
    expect(screen.getByText('Actor').parentElement).toHaveTextContent('Not recorded (pre-audit)');
    expect(screen.getByText('Updated time').parentElement).toHaveTextContent('Not recorded (pre-audit)');
  });
});
