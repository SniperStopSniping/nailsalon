import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    events = new Map<string, ((data?: unknown) => void)[]>();
    send = vi.fn();
    constructor() {
      sockets.push(this);
    }

    on(name: string, handler: (data?: unknown) => void) {
      this.events.set(name, [...(this.events.get(name) ?? []), handler]);
    }

    emit(name: string, data?: unknown) {
      for (const handler of this.events.get(name) ?? []) {
        handler(data);
      }
    }

    close() {
      this.emit('close');
    }

    terminate() {
      this.close();
    }
  }
  return { Socket, sockets, claim: vi.fn(), get: vi.fn(), save: vi.fn(), release: vi.fn(), review: vi.fn(), consult: vi.fn(), checkpoint: vi.fn(), readOperation: vi.fn(), status: vi.fn(), live: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('ws', () => ({ default: mocks.Socket }));
vi.mock('@/libs/queries', () => ({ getSalonById: vi.fn(async () => ({ id: 'salon-a', name: 'Synthetic Isla', slug: 'synthetic-isla' })) }));
vi.mock('@/libs/customerAssistant/publicFacts.server', () => ({ loadCustomerPublicFacts: vi.fn(async () => ({ salon: { name: 'Synthetic Isla' } })) }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({ readCustomerBookingOperation: mocks.readOperation }));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
vi.mock('./authority.server', () => ({ createVoiceDraft: vi.fn(), prepareVoiceReview: mocks.review, runVoiceConsultation: mocks.consult, chooseVoiceSlot: vi.fn() }));
vi.mock('./checkpoint.server', () => ({ requestVoiceCheckpoint: mocks.checkpoint }));
vi.mock('./live.server', () => ({ liveSessionPath: (id: string) => `/${id}`, voiceLiveRequest: mocks.live }));
vi.mock('./storage.server', () => ({ claimVoiceLease: mocks.claim, renewVoiceLease: mocks.claim, getVoiceCall: mocks.get, saveVoiceCall: mocks.save, releaseVoiceLease: mocks.release, getVoiceSettings: vi.fn(async () => ({ enabled: true, bookingEnabled: true, language: 'auto', callbackEnabled: true })) }));
const { coordinateVoiceCall } = await import('./coordinator.server');

const review = { status: 'READY', services: [{ name: 'Gel-X' }], addOns: [], date: '2030-01-01', time: '4:00 PM', durationMinutes: 60, location: null, technician: { kind: 'any_artist' }, financial: { subtotalCents: 6500, taxAmountCents: 845, totalDueCents: 7345, currency: 'CAD', discountAmountCents: 0 }, deposit: { status: 'not_required' }, bookingPolicy: { required: false }, reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true } };

const config = { apiKey: 'synthetic', signingSecret: 's'.repeat(32), projectId: 'proj_synthetic', origin: 'https://voice.example.test', twilioAccountSid: 'ACsynthetic', twilioAuthToken: 'synthetic', webhookSecret: 'synthetic' };
function callState() {
  return { booking: { conversation: { salonId: 'salon-a', sessionId: 'call-a', messages: [], dialogue: [] }, review: null, operation: null, lastResult: null, lastOperationRevision: 0, lastOperationCapability: null }, contact: { step: 'sms', name: 'Synthetic Caller', email: 'caller@example.test', phone: '4165550100' }, consentHash: null, callbackPending: false, bookingStatus: null };
}
function event(value: object) {
  mocks.sockets[0]!.emit('message', JSON.stringify(value));
}
function input(delta: string, start = 100, end = 400) {
  event({ type: 'session.input_transcript.delta', delta, start_ms: start, end_ms: end });
}
function delegate(id = 'delegation-a') {
  event({ type: 'session.delegation.created', delegation: { id, target: 'client' } });
}
async function open() {
  await vi.advanceTimersByTimeAsync(0);
  mocks.sockets[0]!.emit('open');
  await vi.advanceTimersByTimeAsync(0);
}
function close() {
  event({ type: 'session.closed', usage: { seconds: 6 } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.sockets.length = 0;
  mocks.claim.mockResolvedValue({ id: 'call-a', salonId: 'salon-a', provider: 'twilio', providerCallId: 'CAparent', createdAt: new Date(), liveSessionId: 'live-a', draft: callState(), voiceSeconds: 0 });
  mocks.get.mockResolvedValue(null);
  mocks.save.mockResolvedValue({ id: 'call-a' });
  mocks.release.mockResolvedValue(null);
  mocks.checkpoint.mockResolvedValue(undefined);
  mocks.live.mockResolvedValue(new Response(null));
  mocks.consult.mockImplementation(async ({ draft }) => ({ draft, result: { kind: 'answer', topic: 'conversation', message: '', options: [] }, modelCalls: 0 }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('voice sideband consultation and interruption', () => {
  it('hands a prepared phone review to the signed checkpoint and never books from Live transcript consent', async () => {
    const state = callState();
    const operation = { capability: 'operation-a', fingerprint: 'f'.repeat(64), revision: 1, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    mocks.review.mockResolvedValue({ draft: { ...state.booking, operation, review, lastOperationRevision: 1, lastOperationCapability: 'operation-a' }, review });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('yes');
    delegate();
    await vi.advanceTimersByTimeAsync(700);
    await run;

    expect(mocks.checkpoint).toHaveBeenCalledOnce();
    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ booking: expect.objectContaining({ operation }) }) }));
  });

  it('invalidates an in-flight review when the caller interrupts with a material correction', async () => {
    let finishReview!: (value: unknown) => void;
    mocks.review.mockReturnValue(new Promise((resolve) => {
      finishReview = resolve;
    }));
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('yes');
    delegate();
    await vi.advanceTimersByTimeAsync(700);
    input(' actually make them short', 450, 900);
    delegate('delegation-b');
    const state = callState();
    finishReview({ draft: { ...state.booking, lastOperationRevision: 2, lastOperationCapability: 'operation-b' }, review });
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.consult).toHaveBeenCalledWith(expect.objectContaining({ message: 'yes actually make them short' }));

    close();
    await run;
  });

  it('adds a new Live session usage to prior session seconds instead of taking a maximum', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, voiceSeconds: 12, metrics: { liveSessionId: 'previous-live', baseVoiceSeconds: 0 } });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    close();
    await run;

    expect(mocks.save).toHaveBeenLastCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ voiceSeconds: 18, metrics: expect.objectContaining({ baseVoiceSeconds: 12, finalUsageConfirmed: true }) }));
  });
});
