/**
 * Integrations modal — the Payments/Connect block cannot take down the page
 * (charter test 28).
 *
 * D2 adds a Connect surface to a modal that already owns Google Calendar and
 * Twilio. The failure this guards is a shared-fate one: if the Connect data
 * source is fetched without a guard — say as a third entry in the existing
 * `Promise.all` (`IntegrationsModal.tsx:218-223`) — then one 500 from a brand-new,
 * pilot-only endpoint blanks Google Calendar and Twilio for every salon,
 * including the overwhelming majority that have no deposits at all.
 *
 * So: the Connect source errors, and the Google Calendar card must still render
 * its REAL status, with no global error banner.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsModal } from './IntegrationsModal';

function healthPayload(stripeConnect: unknown) {
  return {
    data: {
      availability: { google: true, twilio: true, email: true, photos: true },
      google: {
        // A REAL, specific status. `reconnect_required` is chosen because its
        // label ("Reconnect required") is unique in the modal — "Ready" also
        // appears on the texting card, so it could pass by accident.
        status: 'connected',
        readiness: 'reconnect_required',
        email: 'owner@example.com',
        lastError: null,
        inboundSyncEnabled: false,
        inboundSyncedAt: null,
        inboundSyncError: null,
        blockingCalendarCount: 0,
      },
      twilio: { status: 'disconnected', phoneNumber: null, lastError: null },
      latestSmsDeliveryError: null,
      stripeConnect,
    },
  };
}

const fetchMock = vi.fn();

function mockEndpoints(stripeConnect: unknown) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/integrations/health')) {
      return new Response(JSON.stringify(healthPayload(stripeConnect)), { status: 200 });
    }
    if (url.startsWith('/api/admin/settings/modules')) {
      return new Response(
        JSON.stringify({ data: { moduleReasons: { smsReminders: 'ENABLED' } } }),
        { status: 200 },
      );
    }
    // Every Connect endpoint is hard down. If any of them is ever fetched
    // without a guard on the modal's load path, this is what breaks it.
    if (url.includes('stripe-connect')) {
      return new Response('upstream failure', { status: 500 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('test 28 — the Connect block is isolated from the rest of the modal', () => {
  it('a missing stripeConnect block leaves Google Calendar rendering its real status', async () => {
    // The overwhelmingly common case: a salon outside the deposits pilot, whose
    // health payload carries no Connect block at all.
    mockEndpoints(undefined);

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    expect(await screen.findByText('Google Calendar')).toBeInTheDocument();

    await waitFor(() => {
      // The real status reached the card. If the Connect failure had blanked
      // the load, `health` would still be null and this would read 'Loading…'.
      expect(screen.getByText('Reconnect required')).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('a malformed stripeConnect block still leaves Google Calendar intact', async () => {
    // Wrong types throughout: if the Connect block reads any of these without
    // guarding, it throws during render and takes the whole modal with it.
    mockEndpoints({
      status: 42,
      chargeReady: 'yes',
      binding: 'not-an-object',
      requirements: { currentlyDue: 'not-an-array' },
    });

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    expect(await screen.findByText('Google Calendar')).toBeInTheDocument();

    await waitFor(() => {
      // The real status reached the card. If the Connect failure had blanked
      // the load, `health` would still be null and this would read 'Loading…'.
      expect(screen.getByText('Reconnect required')).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('a null stripeConnect block renders no global error banner', async () => {
    mockEndpoints(null);

    render(<IntegrationsModal onClose={vi.fn()} salonSlug="salon-a" />);

    await screen.findByText('Google Calendar');

    // The modal has a single message surface; a Connect problem must not claim
    // it, because that banner is how Google/Twilio failures reach the owner.
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
  });
});
