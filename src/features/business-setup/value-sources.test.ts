import { describe, expect, it } from 'vitest';

import { hasUnverifiedAiValues, resolvedValueSources, suggestedValueSources, updatedValueSources, valueSourcesSummary } from './value-sources';

const biab = { id: 'service:biab', name: 'BIAB', priceCents: 6500, durationMinutes: 75, origin: 'assistant' };
const gel = { id: 'service:gel', name: 'Gel Manicure', priceCents: 5000, durationMinutes: 60, origin: 'assistant' };
const peers = [biab, gel];

describe('source labels without approval authority', () => {
  it('recognizes separately supplied prices and times in a multi-service owner message', () => {
    const ownerMessage = 'BIAB at CAD65 for 75 minutes and Gel Manicure at CAD50 for 60 minutes. Keep my address private.';
    for (const item of peers) {
      const sources = updatedValueSources(undefined, item, 'assistant', undefined, peers, { ownerMessage });

      expect(sources).toEqual({ name: 'owner', priceCents: 'owner', durationMinutes: 'owner' });
      expect(valueSourcesSummary(item, sources)).toBe('Supplied by you');
      expect(hasUnverifiedAiValues(item, sources)).toBe(false);
    }
  });

  it('separates an owner price from a requested AI appointment length', () => {
    const sources = updatedValueSources(undefined, gel, 'assistant', undefined, peers, { ownerMessage: 'Gel Manicure at CAD50. Suggest the appointment length.' });

    expect(sources).toEqual({ name: 'owner', priceCents: 'owner', durationMinutes: 'suggested' });
    expect(valueSourcesSummary(gel, sources)).toBe('Name: Supplied by you · Price: Supplied by you · Time: AI suggestion');
    expect(hasUnverifiedAiValues(gel, sources)).toBe(true);
  });

  it('does not attribute one service’s numbers to another service', () => {
    const sources = updatedValueSources(undefined, { ...biab, priceCents: 5000, durationMinutes: 60 }, 'assistant', undefined, peers, { ownerMessage: 'BIAB at CAD65 for 75 minutes and Gel Manicure at CAD50 for 60 minutes.' });

    expect(sources).toEqual({ name: 'owner', priceCents: 'conversation', durationMinutes: 'conversation' });
  });

  it('does not confuse cleanup time, a deposit or another sentence with the service price/time', () => {
    const sources = updatedValueSources(undefined, biab, 'assistant', undefined, peers, { ownerMessage: 'BIAB; deposit CAD65 and cleanup 75 minutes.' });

    expect(sources).toEqual({ name: 'owner', priceCents: 'conversation', durationMinutes: 'conversation' });
  });

  it('does not treat a minute count as an unmarked price', () => {
    const item = { ...biab, priceCents: 7500 };
    const sources = updatedValueSources(undefined, item, 'assistant', undefined, peers, { ownerMessage: 'BIAB at 75 minutes.' });

    expect(sources.priceCents).toBe('conversation');
    expect(sources.durationMinutes).toBe('owner');
  });

  it('keeps a price/time range ambiguous', () => {
    const sources = updatedValueSources(undefined, { ...biab, durationMinutes: 90 }, 'assistant', undefined, peers, { ownerMessage: 'BIAB CAD65, 60–90 minutes depending on removal.' });

    expect(sources.priceCents).toBe('owner');
    expect(sources.durationMinutes).toBe('conversation');
  });

  it('does not turn an endpoint of a suggested price range into an owner-supplied fixed price', () => {
    const sources = updatedValueSources(undefined, biab, 'assistant', undefined, peers, { ownerMessage: 'BIAB $60–$65 for 75 minutes; suggest a price in that range.' });

    expect(sources.priceCents).toBe('suggested');
    expect(sources.durationMinutes).toBe('owner');
  });

  it('does not attribute explicitly rejected prices and times to the owner', () => {
    const sources = updatedValueSources(undefined, biab, 'assistant', undefined, peers, { ownerMessage: 'BIAB not CAD65 and not 75 minutes.' });

    expect(sources.priceCents).toBe('conversation');
    expect(sources.durationMinutes).toBe('conversation');
  });

  it('does not mistake one part of an hour/minute expression for the complete appointment length', () => {
    const sources = updatedValueSources(undefined, { ...biab, durationMinutes: 60 }, 'assistant', undefined, peers, { ownerMessage: 'BIAB CAD65 for 1 hour and 15 minutes.' });

    expect(sources.durationMinutes).toBe('conversation');
  });

  it.each([
    ['BIAB at $65 for 1.25 hours', 6500, 75],
    ['BIAB priced at CAD123.45 for 90 minutes', 12345, 90],
    ['BIAB CAD1,200.50 for 60 min', 120050, 60],
    ['BIAB CAD65 for 75 extra minutes', 6500, 75],
    ['BIAB CAD65 for 75 additional minutes', 6500, 75],
    ['BIAB CAD65 for 1 hour and 15 minutes', 6500, 75],
  ])('matches explicit currency/length evidence: %s', (ownerMessage, priceCents, durationMinutes) => {
    expect(updatedValueSources(undefined, { ...biab, priceCents, durationMinutes }, 'assistant', undefined, peers, { ownerMessage }))
      .toEqual({ name: 'owner', priceCents: 'owner', durationMinutes: 'owner' });
  });

  it('does not label an unmatched explicit time as a suggestion requested for a different service', () => {
    const sources = updatedValueSources(undefined, { ...biab, durationMinutes: 60 }, 'assistant', undefined, peers, { ownerMessage: 'BIAB CAD65 for one hour. Gel Manicure CAD50; suggest the length for that.' });

    expect(sources.priceCents).toBe('owner');
    expect(sources.durationMinutes).toBe('conversation');
  });

  it('supports an unambiguous saved BIAB short name without guessing an ambiguous service', () => {
    const item = { ...biab, name: 'BIAB / Builder Gel Overlay' };
    const previous = { ...item, priceCents: 7000, origin: 'existing' };
    const sources = updatedValueSources(previous, item, 'assistant', undefined, [item], { ownerMessage: 'Change BIAB to $65.' });

    expect(sources.priceCents).toBe('owner');
    expect(sources.durationMinutes).toBe('saved');

    const ambiguous = [{ ...biab, id: 'one' }, { ...biab, id: 'two' }];

    expect(updatedValueSources(undefined, ambiguous[0]!, 'assistant', undefined, ambiguous, { ownerMessage: 'BIAB CAD65 for 75 minutes' }).priceCents).toBe('conversation');
  });

  it('preserves uploaded prices when only the missing duration is filled for the preview', () => {
    const uploaded = { ...biab, origin: 'upload', durationMinutes: null };
    const sources = suggestedValueSources(uploaded, biab);

    expect(sources).toEqual({ name: 'upload', priceCents: 'upload', durationMinutes: 'suggested' });
    expect(hasUnverifiedAiValues(biab, sources)).toBe(true);
  });

  it('preserves reviewed/saved value evidence across unrelated assistant edits', () => {
    const previous = { ...biab, origin: 'existing' };
    const sources = updatedValueSources(previous, biab, 'assistant', undefined, peers, { ownerMessage: 'Make the website pink.' });

    expect(sources).toEqual({ name: 'saved', priceCents: 'saved', durationMinutes: 'saved' });
  });

  it('labels requested new recommendations while keeping supplied service names separate', () => {
    const sources = updatedValueSources(undefined, biab, 'assistant', undefined, peers, { ownerMessage: 'Suggest prices and lengths for BIAB and Gel Manicure.' });

    expect(sources).toEqual({ name: 'owner', priceCents: 'suggested', durationMinutes: 'suggested' });
  });

  it('keeps legacy assistant records conservative instead of inventing provenance', () => {
    expect(valueSourcesSummary(biab)).toBe('Prepared in chat');
    expect(resolvedValueSources({ ...biab, origin: 'upload' })).toEqual({ name: 'upload', priceCents: 'upload', durationMinutes: 'upload' });
    expect(resolvedValueSources({ ...biab, durationMinutes: null }, { durationMinutes: 'owner' })).not.toHaveProperty('durationMinutes');
  });
});
