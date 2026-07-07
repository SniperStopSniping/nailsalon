/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, isSmsEnabled, twilio } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ sid: 'SM_referral' })),
  isSmsEnabled: vi.fn(),
  twilio: vi.fn(() => ({
    messages: {
      create: vi.fn(async () => ({ sid: 'SM_referral' })),
    },
  })),
}));

vi.mock('twilio', () => ({
  default: twilio,
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    TWILIO_ACCOUNT_SID: 'twilio_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
  },
}));

vi.mock('@/libs/salonStatus', () => ({
  isSmsEnabled,
}));

import {
  sendBookingConfirmationToClient,
  sendInternalBookingNotificationSms,
  sendReferralInvite,
} from './SMS';

describe('SMS templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSmsEnabled.mockResolvedValue(true);
    twilio.mockReturnValue({
      messages: {
        create,
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('sends clean internal booking summaries without emoji-heavy copy', async () => {
    const sent = await sendInternalBookingNotificationSms('salon_1', {
      phone: '4373705050',
      salonName: 'Isla Nail Studio',
      clientName: 'Bob',
      clientPhone: '4373705050',
      services: ['Gel Manicure'],
      startTime: '2026-06-10T17:45:00.000Z',
      totalDurationMinutes: 60,
      totalPrice: 4000,
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
    });

    expect(sent).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: [
        'New booking at Isla Nail Studio',
        '',
        'Gel Manicure with Daniela',
        'Wed, Jun 10, 1:45 PM-2:45 PM',
        '',
        'Client: Bob',
        'Phone: 4373705050',
        'Duration: 60 min',
        'Total: $40',
      ].join('\n'),
      to: '+14373705050',
    }));
  });

  it('sends clean customer booking confirmations', async () => {
    await sendBookingConfirmationToClient('salon_1', {
      phone: '4373705050',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      services: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: '2026-06-10T17:45:00.000Z',
      totalPrice: 4000,
      timeZone: 'America/Toronto',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: [
        'Isla Nail Studio',
        'Appointment confirmed',
        '',
        'Hi Bob,',
        '',
        'Gel Manicure with Daniela',
        'Wed, Jun 10, 1:45 PM',
        'Total: $40',
        '',
        'Reply to this text if you need help.',
      ].join('\n'),
      to: '+14373705050',
    }));
  });

  it('sends referral invite links on the salon custom domain', async () => {
    const sent = await sendReferralInvite('salon_1', {
      refereePhone: '2223334444',
      referrerName: 'Ava',
      salonName: 'Isla Nail Studio',
      salonCustomDomain: 'islanailsalon.com',
      referralId: 'ref_123',
    });

    expect(sent).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('https://islanailsalon.com/referral/ref_123'),
      to: '+12223334444',
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('Ava sent you $10 off your first appointment at Isla Nail Studio.'),
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.not.stringContaining('localhost'),
    }));
  });
});
