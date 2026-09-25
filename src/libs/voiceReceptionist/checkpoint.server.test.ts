import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceCheckpointToken } from './checkpoint';
import { handleVoiceCheckpoint, requestVoiceCheckpoint } from './checkpoint.server';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  claimVoiceLease: vi.fn(),
  getVoiceCall: vi.fn(),
  releaseVoiceLease: vi.fn(),
  saveVoiceCall: vi.fn(),
  verifyVoiceTwilio: vi.fn(),
  readVoiceBody: vi.fn(),
  commitVoiceBooking: vi.fn(),
  runVoiceConsultation: vi.fn(),
  getSalonById: vi.fn(),
  reconcileVoiceCallBooking: vi.fn(),
  twilioUpdate: vi.fn(),
  dbWhere: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('./storage.server', () => ({
  claimVoiceLease: mocks.claimVoiceLease,
  getVoiceCall: mocks.getVoiceCall,
  redactVoiceDraft: (value: unknown) => value,
  releaseVoiceLease: mocks.releaseVoiceLease,
  renewVoiceLease: vi.fn(),
  saveVoiceCall: mocks.saveVoiceCall,
}));
vi.mock('./security.server', () => ({
  readVoiceBody: mocks.readVoiceBody,
  verifyVoiceTwilio: mocks.verifyVoiceTwilio,
  voiceRouteToken: () => 'route-token',
  voiceTokenHash: () => 'route-token-hash',
}));
vi.mock('./authority.server', () => ({ commitVoiceBooking: mocks.commitVoiceBooking, runVoiceConsultation: mocks.runVoiceConsultation }));
vi.mock('./depositDelivery.server', () => ({ sendVoiceDepositLink: vi.fn() }));
vi.mock('./recovery.server', () => ({ reconcileVoiceCallBooking: mocks.reconcileVoiceCallBooking }));
vi.mock('./config.server', () => ({
  getVoiceRuntimeConfig: () => ({ apiKey: 'voice-key', origin: 'https://voice.example.test', signingSecret: 'ssssssssssssssssssssssssssssssss', twilioAccountSid: 'AC1', twilioAuthToken: 'token' }),
  VOICE_CALL_LIMIT_SECONDS: 600,
}));
vi.mock('@/libs/queries', () => ({ getSalonById: mocks.getSalonById }));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: vi.fn() }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({ readCustomerBookingOperation: vi.fn() }));
vi.mock('@/libs/DB', () => ({
  db: { update: () => ({ set: () => ({ where: mocks.dbWhere }) }) },
}));
vi.mock('./transport.server', () => ({ voiceDialTwiml: () => '<Response><Say>dial</Say></Response>' }));
vi.mock('twilio', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('twilio') }>();
  const client = vi.fn(() => ({ calls: () => ({ update: mocks.twilioUpdate }) }));
  return { __esModule: true, ...actual, default: Object.assign(client, { twiml: actual.default.twiml }) };
});

const secret = 's'.repeat(32);
const config = { apiKey: 'voice-key', origin: 'https://voice.example.test', signingSecret: secret, twilioAccountSid: 'AC1', twilioAuthToken: 'token' };
const callId = 'b883cdd1-f08e-41c4-a9f0-90fa5c946630';

function state(stage: 'pending' | 'committing' | 'resuming' | 'resumed' = 'pending') {
  return {
    booking: {
      conversation: { sessionId: callId, context: {} },
      lastResult: null,
      contact: { name: 'Taylor', email: 'taylor@example.test', phone: '+14165550100', step: 'complete' },
      operation: { capability: 'capability', revision: 2, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' },
      review: {
        services: [],
        addOns: [],
        date: '2030-01-01',
        time: '4:00 PM',
        timeZone: 'America/Toronto',
        durationMinutes: 60,
        location: null,
        technician: { kind: 'any_artist' },
        financial: { subtotalCents: 0, taxAmountCents: 0, totalDueCents: 0, currency: 'CAD', discountAmountCents: 0, discountLabel: null },
        deposit: { status: 'not_required', reason: 'none' },
        confirmationMode: 'instant',
        bookingPolicy: { required: false },
      },
      lastOperationRevision: 2,
      lastOperationCapability: 'capability',
    },
    contact: { name: 'Taylor', email: 'taylor@example.test', phone: '+14165550100', step: 'complete' },
    callbackPending: false,
    consentHash: null,
    bookingStatus: null,
    confirmation: { id: 'checkpoint-1', revision: 2, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z', language: 'en' as const, stage },
  };
}

function call(draft = state(), overrides: Record<string, unknown> = {}) {
  return {
    id: callId,
    salonId: 'salon-a',
    provider: 'twilio',
    providerAccountSid: 'AC1',
    providerCallId: 'CA1',
    status: 'awaiting_confirmation',
    createdAt: new Date(),
    endedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    draft,
    metrics: null,
    ...overrides,
  };
}

function requestFor(draft: ReturnType<typeof state>, phase: 'confirm' | 'review-interrupted' | 'booking-status', body: string, overrides: Record<string, string> = {}) {
  const current = call(draft, overrides);
  const token = voiceCheckpointToken(current, draft.confirmation!, phase, secret);
  return new Request(`https://voice.example.test/api/voice/twilio/${phase}?call=${callId}&token=${token}`, { method: 'POST', body });
}

describe('handleVoiceCheckpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=yes%2C+book+it&Confidence=0.99');
    mocks.verifyVoiceTwilio.mockReturnValue(true);
    mocks.saveVoiceCall.mockResolvedValue(true);
    mocks.releaseVoiceLease.mockResolvedValue(undefined);
    mocks.claimVoiceLease.mockImplementation(async () => call(state(), { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));
    mocks.getVoiceCall.mockImplementation(async () => call());
    mocks.after.mockImplementation(() => undefined);
    mocks.dbWhere.mockResolvedValue([]);
  });

  afterEach(() => vi.useRealTimers());

  it('returns a fast status redirect and registers the commit after-response job', async () => {
    const draft = state();
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(state(), { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/booking-status?call=');
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });

  it('commits a signed final yes once without resuming the SIP conversation', async () => {
    const draft = state();
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=yeah&Confidence=0.99');
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(state(), { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));
    mocks.getSalonById.mockResolvedValue({ id: 'salon-a' });
    mocks.commitVoiceBooking.mockResolvedValue({ status: 'confirmed', appointment: { id: 'appt-1' } });

    const response = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');

    expect(response.status).toBe(200);
    expect(mocks.saveVoiceCall).toHaveBeenCalledWith(callId, 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ confirmation: expect.objectContaining({ stage: 'committing' }) }) }));
    expect(mocks.after).toHaveBeenCalledTimes(1);

    const job = mocks.after.mock.calls[0]?.[0];

    expect(job).toBeTypeOf('function');

    await job();

    expect(mocks.commitVoiceBooking).toHaveBeenCalledTimes(1);
    expect(mocks.runVoiceConsultation).not.toHaveBeenCalled();
    expect(mocks.saveVoiceCall).toHaveBeenCalledWith(callId, 'salon-a', expect.any(String), expect.objectContaining({ status: 'completed', appointmentId: 'appt-1', outcome: 'booked' }));
  });

  it('routes a changed final answer back for review without committing', async () => {
    const draft = state();
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=yes%2C+but+change+it+to+Friday&Confidence=0.99');
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(state(), { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');

    expect(response.status).toBe(200);
    expect(mocks.saveVoiceCall).toHaveBeenCalledWith(callId, 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ confirmation: expect.objectContaining({ stage: 'resuming' }) }) }));
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });

  it('repeats only the final question once for uncertain assent, without re-dialing or booking', async () => {
    const draft = state();
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=yes&Confidence=0.60');
    mocks.getVoiceCall.mockResolvedValue(call(draft));

    const first = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');
    const firstXml = await first.text();

    expect(firstXml).toContain('I did not catch a clear confirmation');
    expect(firstXml).toContain('retry=1');
    expect(firstXml).not.toContain('<Dial');
    expect(mocks.claimVoiceLease).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();

    const retryRequest = requestFor(draft, 'confirm', '');
    const second = await handleVoiceCheckpoint(new Request(`${retryRequest.url}&retry=1`, { method: 'POST' }), 'confirm');

    expect(await second.text()).toContain('No appointment was made');
    expect(mocks.claimVoiceLease).not.toHaveBeenCalled();
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });

  it('treats review interruptions as corrections even when the words contain consent', async () => {
    const draft = state();
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=yes&Confidence=0.99');
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(state(), { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'review-interrupted', ''), 'review-interrupted');

    expect(response.status).toBe(200);
    expect(mocks.saveVoiceCall).toHaveBeenCalledWith(callId, 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ confirmation: expect.objectContaining({ stage: 'resuming' }) }) }));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });

  it('resumes Live with complete contact after an early yes while keeping the old status token valid', async () => {
    const draft = state();
    const leased = state();
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=yes&Confidence=0.99');
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(leased, { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));
    mocks.getSalonById.mockResolvedValue({ id: 'salon-a' });
    mocks.dbWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) });

    const response = await handleVoiceCheckpoint(requestFor(draft, 'review-interrupted', ''), 'review-interrupted');
    const job = mocks.after.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(job).toBeTypeOf('function');

    await job();

    expect(mocks.runVoiceConsultation).not.toHaveBeenCalled();
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
    expect(mocks.twilioUpdate).not.toHaveBeenCalled();
    expect(leased.contact.step).toBe('complete');
    expect(leased.confirmation.stage).toBe('resumed');
    expect(mocks.dbWhere).toHaveBeenCalledOnce();

    mocks.getVoiceCall.mockResolvedValue(call(leased, { status: 'created' }));
    const poll = await handleVoiceCheckpoint(requestFor(draft, 'booking-status', ''), 'booking-status');

    expect(poll.status).toBe(200);
    expect(await poll.text()).toBe('<Response><Say>dial</Say></Response>');
  });

  it('records an exact finalized SMS correction as a review invalidation, never a booking', async () => {
    const draft = state();
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(state(), { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));
    mocks.readVoiceBody.mockResolvedValue('AccountSid=AC1&CallSid=CA1&SpeechResult=no+texts&Confidence=0.99');

    const response = await handleVoiceCheckpoint(requestFor(draft, 'review-interrupted', ''), 'review-interrupted');

    expect(response.status).toBe(200);
    expect(mocks.saveVoiceCall).toHaveBeenCalledWith(callId, 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ contact: expect.objectContaining({ smsConsent: expect.objectContaining({ granted: false, selection: 'explicit_off' }) }), booking: expect.objectContaining({ review: null }), confirmation: expect.objectContaining({ stage: 'resuming' }) }) }));
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });

  it('does not enqueue from a claimed row whose checkpoint revision changed', async () => {
    const draft = state();
    const stale = state();
    stale.confirmation!.revision = 3;
    mocks.getVoiceCall.mockResolvedValue(call(draft));
    mocks.claimVoiceLease.mockResolvedValue(call(stale, { leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 90_000) }));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.saveVoiceCall).not.toHaveBeenCalled();
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });

  it('rejects callbacks whose Twilio account is not the call account', async () => {
    const draft = state();
    mocks.getVoiceCall.mockResolvedValue(call(draft, { providerAccountSid: 'AC-other' }));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');

    expect(response.status).toBe(403);
    expect(mocks.claimVoiceLease).not.toHaveBeenCalled();
  });

  it('does not enqueue duplicate callbacks while a valid commit lease is active', async () => {
    const draft = state('committing');
    mocks.getVoiceCall.mockResolvedValue(call(draft, { leaseExpiresAt: new Date(Date.now() + 90_000) }));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'confirm', ''), 'confirm');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/booking-status?call=');
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.claimVoiceLease).not.toHaveBeenCalled();
  });

  it('never lets the booking-status poll enqueue booking work', async () => {
    const draft = state();
    mocks.getVoiceCall.mockResolvedValue(call(draft));

    const response = await handleVoiceCheckpoint(requestFor(draft, 'booking-status', ''), 'booking-status');

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.claimVoiceLease).not.toHaveBeenCalled();
    expect(mocks.commitVoiceBooking).not.toHaveBeenCalled();
  });
});

describe('requestVoiceCheckpoint handoff failure', () => {
  it('uses the total parent-call limit after six minutes rather than a remaining duration', async () => {
    const draft = state();
    const parent = call(draft, { createdAt: new Date(Date.now() - 360_000), leaseToken: 'live-lease' });
    mocks.saveVoiceCall.mockResolvedValue(true);
    mocks.releaseVoiceLease.mockResolvedValue(undefined);
    mocks.twilioUpdate.mockResolvedValue(undefined);

    await requestVoiceCheckpoint({ call: parent as never, state: draft as never, config: config as never, leaseToken: 'live-lease', language: 'en' });

    expect(mocks.twilioUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ timeLimit: 600 }));
  });

  it('revokes the durable checkpoint and terminates the parent call when Twilio handoff fails', async () => {
    vi.clearAllMocks();
    const draft = state();
    const parent = call(draft, { leaseToken: 'live-lease' });
    mocks.saveVoiceCall.mockResolvedValue(true);
    mocks.releaseVoiceLease.mockResolvedValue(undefined);
    mocks.twilioUpdate.mockRejectedValueOnce(new Error('handoff unavailable')).mockResolvedValueOnce(undefined);

    await expect(requestVoiceCheckpoint({ call: parent as never, state: draft as never, config: config as never, leaseToken: 'live-lease', language: 'en' })).rejects.toThrow('VOICE_CHECKPOINT_HANDOFF_FAILED');

    expect(mocks.releaseVoiceLease).toHaveBeenCalledWith(callId, 'salon-a', 'live-lease');
    expect(mocks.dbWhere).toHaveBeenCalledTimes(1);
    expect(mocks.twilioUpdate).toHaveBeenLastCalledWith({ status: 'completed' });
  });
});
