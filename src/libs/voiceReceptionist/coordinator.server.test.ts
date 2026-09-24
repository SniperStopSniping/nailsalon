import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    events = new Map<string, ((...data: unknown[]) => void)[]>();
    send = vi.fn();
    constructor() {
      sockets.push(this);
    }

    on(name: string, handler: (...data: unknown[]) => void) {
      this.events.set(name, [...(this.events.get(name) ?? []), handler]);
    }

    emit(name: string, ...data: unknown[]) {
      for (const handler of this.events.get(name) ?? []) {
        handler(...data);
      }
    }

    close() {
      this.emit('close');
    }

    terminate() {
      this.close();
    }
  }
  return { Socket, sockets, claim: vi.fn(), get: vi.fn(), save: vi.fn(), release: vi.fn(), settings: vi.fn(), review: vi.fn(), consult: vi.fn(), checkpoint: vi.fn(), readOperation: vi.fn(), status: vi.fn(), live: vi.fn(), queueLink: vi.fn(), revokeLink: vi.fn(), recipientHash: vi.fn() };
});
vi.mock('server-only', () => ({}));
vi.mock('ws', () => ({ default: mocks.Socket }));
vi.mock('@/libs/queries', () => ({ getSalonById: vi.fn(async () => ({ id: 'salon-a', name: 'Synthetic Isla', slug: 'synthetic-isla' })) }));
vi.mock('@/libs/customerAssistant/publicFacts.server', () => ({ loadCustomerPublicFacts: vi.fn(async () => ({ salon: { name: 'Synthetic Isla' } })) }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({ readCustomerBookingOperation: mocks.readOperation }));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
vi.mock('./authority.server', () => ({ createVoiceDraft: vi.fn(), prepareVoiceReview: mocks.review, runVoiceConsultation: mocks.consult, chooseVoiceSlot: vi.fn() }));
vi.mock('./checkpoint.server', () => ({ requestVoiceCheckpoint: mocks.checkpoint }));
vi.mock('./bookingLink.server', () => ({ queueVoiceBookingLink: mocks.queueLink, revokeVoiceBookingLinkAuthority: mocks.revokeLink, voiceBookingLinkRecipientHash: mocks.recipientHash }));
vi.mock('./live.server', () => ({ liveSessionPath: (id: string) => `/${id}`, voiceLiveRequest: mocks.live }));
vi.mock('./storage.server', () => ({ claimVoiceLease: mocks.claim, renewVoiceLease: mocks.claim, getVoiceCall: mocks.get, saveVoiceCall: mocks.save, releaseVoiceLease: mocks.release, getVoiceSettings: mocks.settings }));
const { coordinateVoiceCall, voiceOutputLanguage } = await import('./coordinator.server');

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
function output(delta: string, start = 20, end = 80) {
  event({ type: 'session.output_transcript.delta', delta, start_ms: start, end_ms: end });
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
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.sockets.length = 0;
  mocks.claim.mockResolvedValue({ id: 'call-a', salonId: 'salon-a', provider: 'twilio', providerCallId: 'CAparent', createdAt: new Date(), liveSessionId: 'live-a', draft: callState(), voiceSeconds: 0 });
  mocks.get.mockResolvedValue(null);
  mocks.save.mockResolvedValue({ id: 'call-a' });
  mocks.release.mockResolvedValue(null);
  mocks.settings.mockResolvedValue({ enabled: true, bookingEnabled: true, language: 'auto', callbackEnabled: true });
  mocks.checkpoint.mockResolvedValue(undefined);
  mocks.live.mockResolvedValue(new Response(null));
  mocks.queueLink.mockResolvedValue({ intentId: 'intent-a', created: true, authority: { intentId: 'intent-a', recipientHash: 'hash-a' } });
  mocks.revokeLink.mockResolvedValue(true);
  mocks.recipientHash.mockImplementation((phone: string) => phone === '4165550100' ? 'hash-a' : 'hash-other');
  mocks.consult.mockImplementation(async ({ draft }) => ({ draft, result: { kind: 'answer', topic: 'conversation', message: '', options: [] }, modelCalls: 0 }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('voice sideband consultation and interruption', () => {
  it('handles an explicit link request and read-back confirmation even without Live delegation', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, callerNumber: '+14165550100' });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Please text me the booking link');
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).not.toHaveBeenCalled();
    expect(mocks.sockets[0]!.send).toHaveBeenCalledWith(expect.stringContaining('"type":"session.instructions.append"'));
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ bookingLinkPending: expect.objectContaining({ phone: '4165550100' }) }) }));

    output('Is 4 1 6 5 5 5 0 1 0 0 your Canadian mobile number, and may I text you the link?', 410, 480);
    input('yes', 500, 600);
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).toHaveBeenCalledOnce();
    expect(mocks.queueLink).toHaveBeenCalledWith(expect.objectContaining({ phone: '4165550100' }));

    close();
    await run;
  });

  it('answers a late delegation after directly handling the same link request', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, callerNumber: '+14165550100' });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Please text me the booking link');
    await vi.advanceTimersByTimeAsync(700);
    delegate('late-link-delegation');
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.sockets[0]!.send).toHaveBeenCalledWith(expect.stringContaining('"delegation_id":"late-link-delegation"'));
    expect(mocks.queueLink).not.toHaveBeenCalled();

    close();
    await run;
  });

  it('keeps the link request pending if yes arrives before the phone readback', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, callerNumber: '+14165550100' });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Please text me the booking link');
    await vi.advanceTimersByTimeAsync(700);
    input('yes', 500, 600);
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ bookingLinkPending: expect.objectContaining({ phone: '4165550100' }) }) }));

    output('Is 4 1 6 5 5 5 0 1 0 0 your Canadian mobile number, and may I text you the link?', 610, 690);
    input('yes', 700, 800);
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).toHaveBeenCalledOnce();

    close();
    await run;
  });

  it('keeps a link request open when a mobile number is spoken in separated fragments', async () => {
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Please text me the booking link');
    await vi.advanceTimersByTimeAsync(700);
    input('four one six', 500, 600);
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ bookingLinkPending: expect.objectContaining({ phone: '' }) }) }));
    expect(mocks.queueLink).not.toHaveBeenCalled();

    input('five five five zero one zero zero', 700, 900);
    await vi.advanceTimersByTimeAsync(700);
    output('Is 4 1 6 5 5 5 0 1 0 0 your Canadian mobile number, and may I text you the link?', 910, 990);
    input('yes', 1000, 1100);
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).toHaveBeenCalledWith(expect.objectContaining({ phone: '4165550100' }));

    close();
    await run;
  });

  it('starts the number-confirmation flow when the caller accepts a spoken offer', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, callerNumber: '+14165550100' });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    output('Would you like me to text you the booking link?', 20, 80);
    input('yes', 100, 200);
    delegate();
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ bookingLinkPending: expect.objectContaining({ phone: '4165550100' }) }) }));

    close();
    await run;
  });

  it('revokes the queued link when the caller cancels or corrects the phone', async () => {
    const state = { ...callState(), bookingLinkAuthority: { intentId: 'intent-a', recipientHash: 'hash-a' }, bookingLinkAttempted: true };
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, draft: state });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Actually my phone number is 416 555 0101');
    delegate();
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.revokeLink).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent-a' }));
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ draft: expect.objectContaining({ bookingLinkAuthority: null }) }));

    close();
    await run;
  });

  it.each(['Don\'t send that text', 'Hold on a second', 'Please use 416 555 0101'])('revokes a queued link when "%s" is followed by immediate hangup', async (speech) => {
    const state = { ...callState(), bookingLinkAuthority: { intentId: 'intent-a', recipientHash: 'hash-a' }, bookingLinkAttempted: true };
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, draft: state });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input(speech);
    close();
    await run;

    expect(mocks.revokeLink).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent-a' }));
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ status: 'completed', draft: expect.objectContaining({ bookingLinkAuthority: null }) }));
  });

  it('keeps a confirmed link when a harmless thanks is followed by immediate hangup', async () => {
    const state = { ...callState(), bookingLinkAuthority: { intentId: 'intent-a', recipientHash: 'hash-a' }, bookingLinkAttempted: true };
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, draft: state });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Thanks');
    close();
    await run;

    expect(mocks.revokeLink).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ status: 'completed', draft: expect.objectContaining({ bookingLinkAuthority: { intentId: 'intent-a', recipientHash: 'hash-a' } }) }));
  });

  it('revokes an intent if the caller interrupts while the queue transaction is finishing', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, callerNumber: '+14165550100' });
    let resolveQueue!: (value: unknown) => void;
    mocks.queueLink.mockReturnValue(new Promise((resolve) => {
      resolveQueue = resolve;
    }));
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Text me the booking link');
    delegate();
    await vi.advanceTimersByTimeAsync(700);
    output('Should I text the link to 4 1 6 5 5 5 0 1 0 0?', 410, 480);
    input('yes', 500, 600);
    delegate('delegation-b');
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).toHaveBeenCalledOnce();

    input('Actually use a different number', 700, 900);
    resolveQueue({ intentId: 'intent-a', created: true, authority: { intentId: 'intent-a', recipientHash: 'hash-a' } });
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.revokeLink).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent-a' }));

    close();
    await run;
  });

  it('requests one link only after the caller confirms the read-back mobile number', async () => {
    const call = await mocks.claim();
    mocks.claim.mockResolvedValue({ ...call, callerNumber: '+14165550100' });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    input('Can you text me the booking link?');
    delegate();
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).not.toHaveBeenCalled();

    input('No, use 416 555 0101', 500, 800);
    delegate('delegation-b');
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).not.toHaveBeenCalled();

    output('Is 4 1 6 5 5 5 0 1 0 1 your Canadian mobile number and should I text the booking link?', 810, 880);
    input('yes', 900, 1050);
    delegate('delegation-c');
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.queueLink).toHaveBeenCalledOnce();
    expect(mocks.queueLink).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon-a', callId: 'call-a', phone: '4165550101' }));

    close();
    await run;
  });

  it('records a failed attach status without logging the provider response or secrets', async () => {
    const run = coordinateVoiceCall('call-a', config);
    await vi.advanceTimersByTimeAsync(0);
    const resume = vi.fn();
    mocks.sockets[0]!.emit('unexpected-response', { headers: { Authorization: 'secret-token' } }, { statusCode: 403, resume, body: 'private caller text' });
    await run;

    expect(resume).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith('[voice-sideband]', expect.objectContaining({ connectionStage: 'connecting', connectionFailure: 'handshake', handshakeStatus: 403, attached: false }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/secret-token|private caller text/);
    expect(mocks.save).toHaveBeenCalledWith('call-a', 'salon-a', expect.any(String), expect.objectContaining({ status: 'dropped', metrics: expect.objectContaining({ handshakeStatus: 403 }) }));
  });

  it('records provider error count and socket close code without retaining their text', async () => {
    const run = coordinateVoiceCall('call-a', config);
    await open();
    event({ type: 'error', error: { message: 'private caller text' } });
    mocks.sockets[0]!.emit('close', 1008, 'secret-token');
    await run;

    expect(console.warn).toHaveBeenCalledWith('[voice-sideband]', expect.objectContaining({ connectionStage: 'ready', closeCode: 1008, providerErrors: 1, attached: true }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/secret-token|private caller text/);
  });

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

  it('uses Spanish for the checkpoint when a conversational phrase arrives across output fragments', async () => {
    const state = callState();
    const operation = { capability: 'operation-a', fingerprint: 'f'.repeat(64), revision: 1, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    mocks.review.mockResolvedValue({ draft: { ...state.booking, operation, review, lastOperationRevision: 1, lastOperationCapability: 'operation-a' }, review });
    mocks.settings.mockResolvedValue({ enabled: true, bookingEnabled: true, language: 'en', callbackEnabled: true });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    output('¿Cómo te p');
    output('uedo ayudar hoy?', 81, 160);
    input('yes');
    delegate();
    await vi.advanceTimersByTimeAsync(700);
    await run;

    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }));
  });

  it('preserves whitespace and word boundaries while scanning output phrases', () => {
    expect(voiceOutputLanguage('¿Cómo te ', 'puedo ayudar?')).toMatchObject({ buffer: '¿Cómo te puedo ayudar?', language: 'es' });
    expect(voiceOutputLanguage('¿Cómo te p', 'uedo ayudar?')).toMatchObject({ buffer: '¿Cómo te puedo ayudar?', language: 'es' });
    expect(voiceOutputLanguage('¿En qué puedo ', 'ayudarte?').language).toBe('es');
    expect(voiceOutputLanguage('¿Cuál es tu ', 'nombre?').language).toBe('es');
    expect(voiceOutputLanguage('¿Cuál es tu nombre? Now please confirm your ', 'email.').language).toBe('en');
  });

  it('switches back to English after a later clear conversational phrase', async () => {
    const state = callState();
    const operation = { capability: 'operation-a', fingerprint: 'f'.repeat(64), revision: 1, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    mocks.review.mockResolvedValue({ draft: { ...state.booking, operation, review, lastOperationRevision: 1, lastOperationCapability: 'operation-a' }, review });
    const run = coordinateVoiceCall('call-a', config);
    await open();
    output('¿Cómo te puedo ayudar?');
    output(' Let me ch');
    output('eck what time works.', 81, 160);
    input('yes');
    delegate();
    await vi.advanceTimersByTimeAsync(700);
    await run;

    expect(mocks.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
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
