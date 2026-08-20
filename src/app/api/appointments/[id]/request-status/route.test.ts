/**
 * Luster L1 PR5 — D. Authoritative (effective) request-approval status.
 *
 * `resolveEffectiveRequestApprovalStatus` is pure and unit-tested directly;
 * the GET handler is exercised through `requireAppointmentAccess` mocked to
 * a fixed access snapshot, mirroring the other lightweight route tests in
 * this directory.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ access: null as unknown }));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess: vi.fn(async () => holder.access),
}));

/* eslint-disable import/first */
import { resolveEffectiveRequestApprovalStatus } from '@/libs/requestApprovalStatus';

import { GET } from './route';
/* eslint-enable import/first */

describe('resolveEffectiveRequestApprovalStatus (pure)', () => {
  const now = new Date('2099-01-01T12:00:00Z');

  it('a legacy pending row (NULL requestExpiresAt) reports pending', () => {
    expect(resolveEffectiveRequestApprovalStatus({ status: 'pending', cancelReason: null, requestExpiresAt: null }, now))
      .toBe('pending');
  });

  it('an unexpired explicit pending row reports pending', () => {
    expect(resolveEffectiveRequestApprovalStatus(
      { status: 'pending', cancelReason: null, requestExpiresAt: new Date('2099-01-01T13:00:00Z') },
      now,
    )).toBe('pending');
  });

  it('an explicit pending row past its deadline reports expired, BEFORE the sweep ever runs — never ordinary pending', () => {
    expect(resolveEffectiveRequestApprovalStatus(
      { status: 'pending', cancelReason: null, requestExpiresAt: new Date('2099-01-01T11:00:00Z') },
      now,
    )).toBe('expired');
  });

  it('AT exactly the deadline instant reports expired (matches appointmentBlocking.ts\'s strict cutoff)', () => {
    expect(resolveEffectiveRequestApprovalStatus(
      { status: 'pending', cancelReason: null, requestExpiresAt: now },
      now,
    )).toBe('expired');
  });

  it('reports expired identically AFTER the sweep has finalized the row (cancelled/request_expired) — same value pre- and post-sweep', () => {
    expect(resolveEffectiveRequestApprovalStatus(
      { status: 'cancelled', cancelReason: 'request_expired', requestExpiresAt: new Date('2099-01-01T11:00:00Z') },
      now,
    )).toBe('expired');
  });

  it('a declined row reports declined, distinct from an ordinary cancellation', () => {
    expect(resolveEffectiveRequestApprovalStatus(
      { status: 'cancelled', cancelReason: 'declined_by_salon', requestExpiresAt: new Date('2099-01-01T13:00:00Z') },
      now,
    )).toBe('declined');
  });

  it('an ordinary client cancellation reports cancelled', () => {
    expect(resolveEffectiveRequestApprovalStatus(
      { status: 'cancelled', cancelReason: 'client_request', requestExpiresAt: null },
      now,
    )).toBe('cancelled');
  });

  it.each(['confirmed', 'in_progress', 'awaiting_payment', 'completed', 'no_show'] as const)(
    '%s passes through unchanged',
    (status) => {
      expect(resolveEffectiveRequestApprovalStatus({ status, cancelReason: null, requestExpiresAt: null }, now))
        .toBe(status);
    },
  );
});

describe('GET /api/appointments/:id/request-status', () => {
  function request() {
    return new Request('http://localhost/api/appointments/appt_1/request-status');
  }

  it('returns the effective status, never the raw pending status, for an expired-but-not-yet-swept request', async () => {
    holder.access = {
      ok: true,
      actorRole: 'client',
      appointment: {
        id: 'appt_1',
        status: 'pending',
        cancelReason: null,
        requestExpiresAt: new Date(Date.now() - 60_000),
        confirmationModeSnapshot: 'request_approval',
      },
    };

    const response = await GET(request(), { params: { id: 'appt_1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      appointmentId: 'appt_1',
      status: 'expired',
      isRequestApproval: true,
      requestExpiresAt: (holder.access as { appointment: { requestExpiresAt: Date } }).appointment.requestExpiresAt.toISOString(),
    });
  });

  it('propagates an access-guard failure unchanged (no privacy regression: same authorization as the mutation endpoints)', async () => {
    const denied = Response.json({ error: { code: 'FORBIDDEN', message: 'nope' } }, { status: 403 });
    holder.access = { ok: false, response: denied };

    const response = await GET(request(), { params: { id: 'appt_1' } });

    expect(response.status).toBe(403);
  });

  it('never leaks more than the small status summary — no full appointment record', async () => {
    holder.access = {
      ok: true,
      actorRole: 'staff',
      appointment: {
        id: 'appt_1',
        status: 'confirmed',
        cancelReason: null,
        requestExpiresAt: null,
        confirmationModeSnapshot: null,
        clientPhone: '4165550000',
        clientName: 'Should Not Leak',
        notes: 'private tech notes',
      },
    };

    const response = await GET(request(), { params: { id: 'appt_1' } });
    const body = await response.json();

    expect(Object.keys(body.data).sort()).toEqual(
      ['appointmentId', 'isRequestApproval', 'requestExpiresAt', 'status'].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('Should Not Leak');
    expect(JSON.stringify(body)).not.toContain('private tech notes');
  });
});
