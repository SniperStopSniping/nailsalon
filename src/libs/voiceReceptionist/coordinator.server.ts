import 'server-only';

import { randomUUID } from 'node:crypto';

import WebSocket from 'ws';

import type { CustomerBookingStatus } from '@/libs/customerAssistant/bookingOperationContracts';
import { readCustomerBookingStatus } from '@/libs/customerAssistant/bookingStatus.server';
import { readCustomerBookingOperation } from '@/libs/customerAssistant/operationStore.server';
import { loadCustomerPublicFacts } from '@/libs/customerAssistant/publicFacts.server';
import { getSalonById } from '@/libs/queries';

import { chooseVoiceSlot, createVoiceDraft, prepareVoiceReview, runVoiceConsultation, type VoiceSalon } from './authority.server';
import { formatVoiceCheckpointReview } from './checkpoint';
import { requestVoiceCheckpoint } from './checkpoint.server';
import { VOICE_CALL_LIMIT_SECONDS, type VoiceRuntimeConfig } from './config.server';
import { advanceVoiceContact, completedVoiceContact, contactPrompt, correctVoiceContact, isExplicitVoiceBookingConsent, isVoiceContactAffirmation, matchVoiceOfferedSlot, normalizedSpeech, spokenPhone, VoiceConsentGate, voiceReviewText } from './conversation';
import { liveSessionPath, voiceLiveRequest } from './live.server';
import type { VoiceCallState } from './state';
import { claimVoiceLease, getVoiceCall, getVoiceSettings, releaseVoiceLease, renewVoiceLease, saveVoiceCall } from './storage.server';

type CallState = VoiceCallState;
type ProviderEvent = { type?: string; event_id?: string; delta?: string; start_ms?: number; end_ms?: number; offset_ms?: number; delegation?: { id?: string; target?: string }; usage?: { seconds?: number }; reason?: string };
type Input = { text: string; start: number; end: number };

function safeStoredState(value: unknown, salonId: string, callId: string): CallState {
  const stored = value as Partial<CallState> | null;
  if (stored?.booking?.conversation?.salonId === salonId && stored.booking.conversation.sessionId === callId) {
    return {
      booking: { ...stored.booking, conversation: { ...stored.booking.conversation, messages: [], dialogue: [] } },
      contact: stored.contact ?? null,
      callbackPending: false,
      consentHash: null,
      bookingStatus: stored.bookingStatus ?? null,
    };
  }
  return { booking: createVoiceDraft(salonId, callId), contact: null, callbackPending: false, consentHash: null, bookingStatus: null };
}

function statusFacts(status: CustomerBookingStatus): string {
  if (status.status === 'confirmed') {
    return 'Luster confirms the appointment is booked. Normal Luster confirmation delivery is handled by the existing booking workflow; do not claim a text/email was delivered.';
  }
  if (status.status === 'payment_required' || status.status === 'payment_processing') {
    return 'Luster created an appointment pending the required deposit. It is not confirmed yet. The customer must complete Luster secure checkout before the hold expires. Do not take card details or claim payment succeeded.';
  }
  if (status.status === 'awaiting_approval') {
    return 'Luster recorded the appointment request; salon approval is still required. Do not describe it as confirmed.';
  }
  return `Luster booking state: ${status.status}. Failure: ${status.lastFailure ?? 'none'}. Do not claim success or create another booking. Offer the normal booking page or callback when unresolved.`;
}

/** One leased sideband, no audio bridge, no stored call transcript. */
export async function coordinateVoiceCall(callId: string, config: VoiceRuntimeConfig, existingLease?: string, reconnectAttempt = 0): Promise<void> {
  const leaseToken = existingLease ?? randomUUID();
  const call = await claimVoiceLease(callId, leaseToken, 90_000);
  if (!call?.liveSessionId || call.endedAt) {
    return;
  }
  const salon = await getSalonById(call.salonId);
  if (!salon) {
    await releaseVoiceLease(call.id, call.salonId, leaseToken);
    return;
  }
  const boundSalon = salon as VoiceSalon;
  const settings = await getVoiceSettings(call.salonId);
  const sandbox = call.provider === 'browser';
  const state = safeStoredState(call.draft, call.salonId, call.id);
  const consent = new VoiceConsentGate();
  const started = Date.now();
  const deadline = call.createdAt.getTime() + VOICE_CALL_LIMIT_SECONDS * 1000;
  const savedMetrics = call.metrics as Record<string, number | boolean | string> | null;
  const sameLiveSession = savedMetrics?.liveSessionId === call.liveSessionId;
  const baseVoiceSeconds = sameLiveSession ? Number(savedMetrics?.baseVoiceSeconds ?? 0) : call.voiceSeconds ?? 0;
  const metrics: Record<string, number | boolean | string> = { interrupted: 0, delegations: 0, recovered: !!call.draft, finalUsageConfirmed: false, liveSessionId: call.liveSessionId, baseVoiceSeconds };
  let epoch = 0;
  let lastOutputEnd = 0;
  let lastInputEnd = 0;
  let input: Input | null = null;
  let pendingDelegation: string | null = null;
  let busy = false;
  let stopped = false;
  let ended = false;
  let handedOff = false;
  let reconnect = false;
  let language: 'en' | 'es' = settings.language === 'es' ? 'es' : 'en';
  let voiceSeconds = call.voiceSeconds ?? 0;
  let outcome = call.outcome ?? 'inquiry';
  let summary = call.summary ?? 'Call connected to the AI receptionist.';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval>;
  let cutoff: ReturnType<typeof setTimeout>;
  let wrapup: ReturnType<typeof setTimeout>;
  const seen = new Set<string>();
  const socket = new WebSocket(`wss://api.openai.com/v1/live/sessions${liveSessionPath(call.liveSessionId)}/attach`, {
    headers: { Authorization: `Bearer ${config.apiKey}`, ...(config.projectId ? { 'OpenAI-Project': config.projectId } : {}) },
    handshakeTimeout: 10_000,
    maxPayload: 1_048_576,
  });
  const send = (type: string, content: string, delegationId: string | null = null) => {
    if (socket.readyState !== WebSocket.OPEN || stopped) {
      return;
    }
    // A token contains at least one UTF-8 byte. A 400-byte content budget is
    // conservative even for non-Latin languages, without splitting a codepoint.
    const chunks: string[] = [];
    let chunk = '';
    let bytes = 0;
    for (const character of content) {
      const size = Buffer.byteLength(character, 'utf8');
      if (bytes + size > 400) {
        chunks.push(chunk);
        chunk = '';
        bytes = 0;
      }
      chunk += character;
      bytes += size;
    }
    chunks.push(chunk);
    chunks.forEach((chunk, index) => socket.send(JSON.stringify({ type: index < chunks.length - 1 ? 'session.thinking.append' : type, event_id: randomUUID(), delegation_id: delegationId, content: chunk })));
  };
  const persist = async (patch: Parameters<typeof saveVoiceCall>[3] = {}) => {
    const saved = await saveVoiceCall(call.id, call.salonId, leaseToken, { draft: state, metrics, summary: summary.slice(0, 1000), outcome, voiceSeconds: Math.ceil(voiceSeconds), ...patch });
    if (!saved) {
      throw new Error('VOICE_LEASE_LOST');
    }
  };
  const assertEpoch = (expected: number) => {
    if (stopped || epoch !== expected || Date.now() >= deadline) {
      throw new Error('VOICE_TURN_SUPERSEDED');
    }
  };
  const emitReview = (delegationId: string) => {
    if (!state.booking.review || !state.booking.operation) {
      return;
    }
    consent.arm(state.booking.operation.fingerprint, state.booking.operation.revision, state.booking.operation.expiresAt, Math.max(lastInputEnd, lastOutputEnd));
    send('session.commentary.append', voiceReviewText(state.booking.review), delegationId);
  };
  const processInput = async (current: Input, delegationId: string, expected: number) => {
    metrics.delegations = Number(metrics.delegations) + 1;
    const text = current.text.trim();
    if (!text || text.length > 1200) {
      send('session.commentary.append', 'Please ask the caller for a shorter clarification. Nothing has been booked.', delegationId);
      return;
    }
    if (/\b(?:\d[ -]?){13,19}\b/.test(text)) {
      consent.invalidate();
      send('session.instructions.append', 'Do not collect or repeat payment card details. Ask the caller to use the secure Luster checkout page.', null);
      return;
    }
    if (state.bookingStatus?.appointment) {
      send('session.commentary.append', statusFacts(state.bookingStatus), delegationId);
      return;
    }
    if (state.callbackPending) {
      const number = spokenPhone(text) ?? (isVoiceContactAffirmation(text) ? spokenPhone(call.callerNumber ?? '') : null);
      state.callbackPending = false;
      if (number) {
        assertEpoch(expected);
        summary = 'Caller requested a salon callback at the number they confirmed.';
        outcome = 'callback_requested';
        await persist({ callbackRequested: true, callerNumber: `+1${number}` });
        send('session.commentary.append', 'The callback request was recorded for the salon. Do not promise a callback time.', delegationId);
        return;
      }
    }
    if (/\b(?:call me back|callback|llamame|devolverme la llamada)\b/i.test(normalizedSpeech(text)) && settings.callbackEnabled) {
      consent.invalidate();
      state.callbackPending = true;
      send('session.commentary.append', call.callerNumber ? `Confirm that ${call.callerNumber.split('').join(' ')} is the right callback number, or ask for a different number.` : 'Ask for the callback number with area code.', delegationId);
      return;
    }
    const contactCorrection = correctVoiceContact(state.contact, text);
    if (contactCorrection && state.contact) {
      consent.invalidate();
      state.contact = contactCorrection;
      state.booking.contact = null;
      state.booking.review = null;
      await persist();
      send('session.commentary.append', contactPrompt(contactCorrection), delegationId);
      return;
    }
    if (state.booking.review && state.booking.operation) {
      if (consent.accepts(text, current.start, state.booking.operation.fingerprint, state.booking.operation.revision)) {
        consent.invalidate();
        if (sandbox || !settings.bookingEnabled || !settings.enabled) {
          send('session.commentary.append', sandbox ? 'The sandbox review is complete. No appointment, payment, or message was created. The live phone pilot uses this same Luster booking review.' : 'Booking by phone is currently disabled. Offer the normal Luster booking page.', delegationId);
          return;
        }
        // Live transcript consent is never booking authority. A real phone
        // booking uses the separate, signed finalized-speech checkpoint.
        emitReview(delegationId);
        return;
      }
      consent.invalidate();
      state.consentHash = null;
      if (isVoiceContactAffirmation(text) || isExplicitVoiceBookingConsent(text)) {
        emitReview(delegationId);
        return;
      }
    }
    const materialCorrection = /\b(?:actually|instead|change|short|medium|long|remove|removal|french|design|earlier|later|saturday|sunday|monday|tuesday|wednesday|thursday|friday|cambia|corto|cortas|largo|largas|diseno|antes|despues|sabado)\b/i.test(normalizedSpeech(text));
    if (state.contact && state.contact.step !== 'complete' && !materialCorrection) {
      const nextContact = advanceVoiceContact(state.contact, text);
      const contact = completedVoiceContact(nextContact);
      if (contact) {
        const prepared = await prepareVoiceReview({ salon: boundSalon, draft: state.booking, contact, smsConsent: nextContact.smsConsent, secret: config.signingSecret });
        // Preparation can durably revise the operation before a caller
        // interrupts. Retain recovery identity even if this result is stale.
        state.booking.lastOperationRevision = prepared.draft.lastOperationRevision;
        state.booking.lastOperationCapability = prepared.draft.lastOperationCapability;
        assertEpoch(expected);
        state.contact = nextContact;
        state.booking = prepared.draft;
        await persist({ callerNumber: `+1${contact.phone}` });
        if (prepared.review) {
          if (!sandbox && settings.enabled && settings.bookingEnabled) {
            assertEpoch(expected);
            const reviewWords = formatVoiceCheckpointReview(prepared.review, language, contact).split(/\s+/).length;
            if ((deadline - Date.now()) / 1000 < reviewWords / 2 + 20) {
              throw new Error('VOICE_REVIEW_NEEDS_MANUAL_BOOKING');
            }
            handedOff = true;
            clearInterval(heartbeat);
            clearTimeout(cutoff);
            clearTimeout(wrapup);
            send('session.instructions.append', 'Luster is ready for the final review. Say briefly: I will confirm the final details now.');
            try {
              await requestVoiceCheckpoint({ call, state, config, leaseToken, language });
            } catch {
              await persist({ status: 'failed', outcome: 'confirmation_unavailable', endedAt: new Date() }).catch(() => undefined);
              await voiceLiveRequest(config, `${liveSessionPath(call.liveSessionId!)}/hangup`).catch(() => undefined);
            } finally {
              stopped = true;
              socket.close();
            }
          } else {
            emitReview(delegationId);
          }
        } else {
          send('session.commentary.append', 'The booking could not be reviewed safely. Recheck the selected time or offer the booking page. No appointment was created.', delegationId);
        }
      } else {
        assertEpoch(expected);
        state.contact = nextContact;
        await persist();
        send('session.commentary.append', contactPrompt(state.contact), delegationId);
      }
      return;
    }
    const selected = matchVoiceOfferedSlot(state.booking.conversation.booking?.offeredSlots ?? [], text);
    const toolStarted = performance.now();
    const response = selected
      ? await chooseVoiceSlot({ salon: boundSalon, draft: state.booking, startTime: selected })
      : await runVoiceConsultation({ salon: boundSalon, draft: state.booking, message: text, voiceApiKey: config.apiKey });
    assertEpoch(expected);
    metrics.lastToolMs = Math.round(performance.now() - toolStarted);
    metrics.lastBackendResultMs = metrics.lastToolMs;
    if ('modelCalls' in response) {
      metrics.interpreterCalls = Number(metrics.interpreterCalls ?? 0) + Number(response.modelCalls ?? 0);
    }
    state.booking = response.draft;
    state.consentHash = null;
    if ('proposal' in response.result) {
      const proposal = response.result.proposal;
      summary = `Discussed ${[proposal.service.name, ...proposal.addOns.map(item => item.name)].join(', ')}. ${response.result.kind === 'slot_selected' ? `Selected ${response.result.preference.date} at ${response.result.slot.time}; not yet booked.` : 'No appointment created yet.'}`;
      outcome = 'consultation';
    } else if (response.result.kind === 'unavailable') {
      summary = `Consultation needs follow-up: ${response.result.reason.replace(/_/g, ' ')}. No appointment created.`;
      outcome = 'follow_up_needed';
    }
    if (response.result.kind === 'slot_selected') {
      state.contact = state.contact?.step === 'complete' ? { ...state.contact, step: 'verify' } : state.contact ?? { step: 'name', name: '', email: '', phone: spokenPhone(call.callerNumber ?? '') ?? '' };
      send('session.commentary.append', `Luster rechecked this offered slot; it is not held. ${contactPrompt(state.contact)}`, delegationId);
    } else {
      send('session.commentary.append', `Authoritative Luster result (use these facts, no invention): ${JSON.stringify(response.result)}`, delegationId);
      if ('publicFacts' in response && response.publicFacts) {
        send('session.thinking.append', `Public salon facts: ${JSON.stringify(response.publicFacts)}`, delegationId);
      }
    }
    await persist();
  };
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (busy || !pendingDelegation || !input || stopped) {
        return;
      }
      const current = input;
      const delegation = pendingDelegation;
      input = null;
      pendingDelegation = null;
      busy = true;
      const expected = epoch;
      void processInput(current, delegation, expected).catch(async () => {
        if (epoch !== expected && !stopped) {
          input = input ? { text: (current.text + input.text).slice(-2400), start: current.start, end: input.end } : current;
          pendingDelegation ??= delegation;
        }
        consent.invalidate();
        state.consentHash = null;
        // Reconcile the same durable operation after an ambiguous response. Never start another.
        if (state.booking.operation) {
          try {
            const operation = await readCustomerBookingOperation({ salonId: call.salonId, capability: state.booking.operation.capability, secret: config.signingSecret });
            if (operation.appointmentId) {
              state.bookingStatus = await readCustomerBookingStatus(operation, config.signingSecret);
              await persist({ appointmentId: operation.appointmentId });
            }
          } catch { /* Unresolved remains unresolved; no retry with another operation. */ }
        }
        if (epoch === expected) {
          send('session.commentary.append', state.bookingStatus ? statusFacts(state.bookingStatus) : 'Luster could not safely complete that step. Nothing further will be booked. Offer a fresh availability check, the normal booking page, or a callback.', delegation);
        }
      }).finally(() => {
        busy = false;
        if (input && pendingDelegation) {
          schedule();
        }
      });
    }, 650);
  };
  heartbeat = setInterval(() => {
    void renewVoiceLease(call.id, call.salonId, leaseToken, 90_000, { liveSessionId: call.liveSessionId! }).then((claimed) => {
      if (!claimed) {
        stopped = true;
        socket.close();
      }
    }).catch(() => {
      stopped = true;
      socket.close();
    });
  }, 20_000);
  cutoff = setTimeout(() => {
    consent.invalidate();
    stopped = true;
    void voiceLiveRequest(config, `${liveSessionPath(call.liveSessionId!)}/hangup`).catch(() => undefined).finally(() => socket.close());
  }, Math.max(1, deadline - Date.now()));
  wrapup = setTimeout(() => send('session.instructions.append', 'This call is nearing its time limit. Finish any confirmed result, and offer the booking page or a callback for unfinished work.'), Math.max(1, deadline - Date.now() - 45_000));
  try {
    await new Promise<void>((resolve) => {
      socket.on('open', () => {
        metrics.attachMs = Date.now() - started;
        void (async () => {
          if (state.booking.operation) {
            const operation = await readCustomerBookingOperation({ salonId: call.salonId, capability: state.booking.operation.capability, secret: config.signingSecret });
            if (operation.appointmentId) {
              state.bookingStatus = await readCustomerBookingStatus(operation, config.signingSecret);
            }
          }
          const facts = await loadCustomerPublicFacts({ salonId: salon.id, salonSlug: salon.slug, features: salon.features as VoiceSalon['features'], locale: 'en' });
          send('session.thinking.append', `Verified public salon facts. Base prices are not booking quotes: ${JSON.stringify(facts)}`);
          await persist({ status: 'connected' });
          if (call.draft) {
            send('session.thinking.append', `Saved authoritative consultation: ${JSON.stringify(state.booking.lastResult)}. ${state.contact ? contactPrompt(state.contact) : ''}`);
          }
          send('session.instructions.append', call.draft ? `READY. The backend reconnected. Consent has been reset. ${state.bookingStatus ? statusFacts(state.bookingStatus) : 'Resume the saved consultation and obtain a new review and confirmation before booking.'}` : `READY. Greet the caller now: identify yourself as the AI receptionist for ${salon.name}. Ask how you can help. ${settings.greeting ?? ''}`);
        })().catch(() => {
          stopped = true;
          socket.close();
        });
      });
      socket.on('message', (raw) => {
        let event: ProviderEvent;
        try {
          event = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (event.event_id) {
          if (seen.has(event.event_id)) {
            return;
          }
          seen.add(event.event_id);
          if (seen.size > 4096) {
            seen.delete(seen.values().next().value!);
          }
        }
        if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string' && Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms)) {
          epoch += 1;
          const start = event.start_ms!;
          lastInputEnd = Math.max(lastInputEnd, event.end_ms!);
          if (start < lastOutputEnd) {
            metrics.interrupted = Number(metrics.interrupted) + 1;
            consent.invalidate();
          }
          input = input ? { text: (input.text + event.delta).slice(-2400), start: Math.min(input.start, start), end: Math.max(input.end, event.end_ms!) } : { text: event.delta, start, end: event.end_ms! };
          if (pendingDelegation) {
            schedule();
          }
        } else if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string' && Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms)) {
          lastOutputEnd = Math.max(lastOutputEnd, event.end_ms!);
          if (settings.language === 'auto' && /\b(?:cita|correo|nombre|precio|gracias|quieres)\b/i.test(event.delta)) {
            language = 'es';
          }
          consent.observeOutput(event.delta, event.start_ms!, event.end_ms!);
          if (!metrics.firstSpokenOutputMs) {
            metrics.firstSpokenOutputMs = Date.now() - started;
          }
          if (event.start_ms! >= lastInputEnd && lastInputEnd > 0) {
            metrics.lastTranscriptResponseGapMs = event.start_ms! - lastInputEnd;
          }
        } else if (event.type === 'session.delegation.created' && event.delegation?.target === 'client' && event.delegation.id) {
          pendingDelegation = event.delegation.id;
          schedule();
        } else if (event.type === 'session.usage.updated' && Number.isFinite(event.usage?.seconds)) {
          voiceSeconds = Math.max(voiceSeconds, baseVoiceSeconds + event.usage!.seconds!);
        } else if (event.type === 'session.closed') {
          ended = true;
          stopped = true;
          metrics.finalUsageConfirmed = true;
          if (Number.isFinite(event.usage?.seconds)) {
            voiceSeconds = Math.max(voiceSeconds, baseVoiceSeconds + event.usage!.seconds!);
          }
          socket.close();
          resolve();
        }
      });
      socket.on('error', () => resolve());
      socket.on('close', () => resolve());
    });
  } finally {
    stopped = true;
    consent.invalidate();
    clearInterval(heartbeat);
    clearTimeout(cutoff);
    clearTimeout(wrapup);
    if (timer) {
      clearTimeout(timer);
    }
    socket.terminate();
    const current = await getVoiceCall(call.id, call.salonId).catch(() => null);
    const transferred = handedOff || current?.status === 'awaiting_confirmation' || (current?.liveSessionId && current.liveSessionId !== call.liveSessionId) || (current?.leaseToken && current.leaseToken !== leaseToken);
    if (!transferred && !ended && reconnectAttempt < 2 && Date.now() < deadline - 15_000 && current && !current.endedAt) {
      await persist({ status: 'connected' }).catch(() => undefined);
      await releaseVoiceLease(call.id, call.salonId, leaseToken).catch(() => undefined);
      reconnect = true;
    }
    if (!transferred && !reconnect) {
      if (!ended) {
        await voiceLiveRequest(config, `${liveSessionPath(call.liveSessionId!)}/hangup`).catch(() => undefined);
      }
      await persist({ status: ended ? 'completed' : 'dropped', endedAt: new Date(), durationSeconds: Math.max(0, Math.ceil((Date.now() - call.createdAt.getTime()) / 1000)) }).catch(() => undefined);
      await releaseVoiceLease(call.id, call.salonId, leaseToken).catch(() => undefined);
    }
  }
  if (reconnect) {
    await coordinateVoiceCall(call.id, config, undefined, reconnectAttempt + 1);
  }
}
