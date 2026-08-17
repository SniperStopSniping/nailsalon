/**
 * Usage & Billing modal — §10.2 presentation proofs: one primary number
 * first, plain-language breakdown, blocked-credits notice with the email
 * reassurance, and history rendered exactly as the API masked it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageBillingModal } from './UsageBillingModal';

const fetchMock = vi.hoisted(() => vi.fn());

describe('UsageBillingModal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: {
        usage: {
          availableCredits: 277,
          monthlyCredits: 277,
          starterCredits: 73,
          purchasedCredits: 250,
          bonusCredits: 0,
          monthlyAllowance: 400,
          resetsAt: '2026-09-01T00:00:00.000Z',
          blockedMessages: 2,
          plan: {
            displayName: 'Pro',
            cadence: 'monthly',
            status: 'active',
            paidThrough: '2026-09-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
          },
        },
        history: [{
          id: 'ci_1',
          channel: 'sms',
          eventType: 'appointment_reminder',
          recipient: '•••• 0199',
          status: 'blocked_no_credit',
          scheduledFor: '2026-08-30T13:00:00.000Z',
          sentAt: null,
          creditsUsed: 0,
          failureReason: 'SMS credits were unavailable.',
        }],
        nextCursor: null,
      },
    }), { status: 200 }));
  });

  it('leads with the primary total and speaks the owner vocabulary (§10.2)', async () => {
    render(<UsageBillingModal salonSlug="salon-a" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/277/)).toBeInTheDocument();
    });

    expect(screen.getByText(/SMS credits remaining/)).toBeInTheDocument();
    expect(screen.getByText(/123 of 400 monthly credits used/)).toBeInTheDocument();
    expect(screen.getByText(/73 starter credits \(do not renew\)/)).toBeInTheDocument();
    expect(screen.getByText(/250 purchased credits \(never expire\)/)).toBeInTheDocument();
    expect(screen.getByText(/Email confirmations and reminders are always included/)).toBeInTheDocument();
    // Blocked notice carries the email reassurance.
    expect(screen.getByText(/2\s+texts are\s+waiting for credits/)).toBeInTheDocument();
    // History is masked and friendly — no raw phone anywhere.
    expect(screen.getByText('•••• 0199')).toBeInTheDocument();
    expect(screen.getByText('SMS credits were unavailable.')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('4165550199');
    // No internal ledger vocabulary leaks.
    expect(document.body.innerHTML).not.toMatch(/lot|reservation|ledger|debit/i);
  });
});
