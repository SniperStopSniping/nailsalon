import { describe, expect, it } from 'vitest';

import { compactCustomerModelContext } from './boundedModelContext';

const turn = (role: 'user' | 'assistant', content: string) => ({ role, content });

describe('bounded customer model context', () => {
  it('removes legacy message duplication and preserves the full newest role exchange', () => {
    const result = compactCustomerModelContext({
      prompt: 'system',
      maxBytes: 4_000,
      context: {
        dialogue: [turn('user', 'first'), turn('assistant', 'first answer'), turn('user', 'latest question'), turn('assistant', 'latest answer')],
        customerMessages: ['first', 'latest question'],
        menu: { services: [{ id: 'public-id', name: 'Service' }] },
        facts: { public: 'fact' },
      },
    });

    expect(JSON.parse(result.data)).not.toHaveProperty('customerMessages');
    expect(result.dialogue).toEqual([turn('user', 'first'), turn('assistant', 'first answer'), turn('user', 'latest question'), turn('assistant', 'latest answer')]);
    expect(result.fits).toBe(true);
  });

  it('compacts oldest UTF-8 dialogue pairs while preserving latest message, state and public menu', () => {
    const long = '💅é'.repeat(1_500);
    const result = compactCustomerModelContext({
      prompt: 'system',
      maxBytes: 16_000,
      context: {
        latestCustomerMessage: 'the original day',
        dialogue: [turn('user', long), turn('assistant', long), turn('user', long), turn('assistant', long), turn('user', 'newest user'), turn('assistant', 'newest assistant')],
        menu: { services: [{ id: 'service-public', name: 'Gel' }], addOns: [{ id: 'addon-public', name: 'French' }] },
        facts: { selection: 'known' },
        lastShown: { question: 'date', options: [], selection: { baseServiceId: 'service-public', selectedAddOns: [] } },
        bookingState: { acceptedFingerprint: null, offeredSlots: Array.from({ length: 8 }, (_, index) => ({ time: `0${index}:00`, startTime: `2026-09-20T0${index}:00:00.000Z` })) },
        availabilitySearch: { requestedPreference: { date: '2026-09-20', earliest: '17:00', latest: '23:59' }, displayedPreference: { date: '2026-09-22', earliest: '00:00', latest: '23:59' }, fallback: true },
      },
    });
    const parsed = JSON.parse(result.data);

    expect(result.compacted).toBe(true);
    expect(result.fits).toBe(true);
    expect(result.dialogue).toEqual([turn('user', 'newest user'), turn('assistant', 'newest assistant')]);
    expect(parsed.latestCustomerMessage).toBe('the original day');
    expect(parsed.menu.services[0].id).toBe('service-public');
    expect(parsed.menu.addOns[0].id).toBe('addon-public');
    expect(parsed.facts).toEqual({ selection: 'known' });
    expect(parsed.lastShown.question).toBe('date');
    expect(parsed.bookingState.offeredSlots).toHaveLength(8);
    expect(parsed.availabilitySearch.fallback).toBe(true);
  });

  it('keeps the newest exchange from an odd-length history', () => {
    const result = compactCustomerModelContext({
      prompt: 'system',
      maxBytes: 1_500,
      context: {
        dialogue: [turn('user', 'old'.repeat(200)), turn('assistant', 'middle'.repeat(200)), turn('user', 'newest question')],
        latestCustomerMessage: 'current message',
      },
    });

    expect(result.dialogue).toEqual([turn('assistant', 'middle'.repeat(200)), turn('user', 'newest question')]);
    expect(result.fits).toBe(true);
  });

  it('counts a separate final user turn within the unchanged UTF-8 input cap', () => {
    const context = { menu: { services: [{ id: 'public-id' }] }, dialogue: [] };
    const prompt = 'system';
    const finalMessage = '💅'.repeat(200);
    const base = compactCustomerModelContext({ context, prompt, maxBytes: 500 });
    const withFinalTurn = compactCustomerModelContext({ context, prompt, additionalInput: finalMessage, maxBytes: 500 });

    expect(base.fits).toBe(true);
    expect(withFinalTurn.fits).toBe(false);
    expect(withFinalTurn.data).toBe(base.data);
  });

  it('converts legacy user-only history once and fails closed if protected context still exceeds the cap', () => {
    const result = compactCustomerModelContext({
      prompt: 'system',
      maxBytes: 50,
      legacyMessages: ['old', 'new'],
      context: { latestCustomerMessage: 'new', menu: { services: [{ id: 'must-not-prune', description: 'x'.repeat(1_000) }] }, facts: { fresh: true } },
    });

    expect(result.dialogue).toEqual([turn('user', 'old'), turn('user', 'new')]);
    expect(result.fits).toBe(false);
    expect(JSON.parse(result.data).menu.services[0].id).toBe('must-not-prune');
  });
});
