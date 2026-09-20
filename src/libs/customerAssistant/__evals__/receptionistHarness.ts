import { createHash } from 'node:crypto';

import type { z } from 'zod';

import { resolveCatalogSelection } from '@/libs/catalogResolverCore';

import type { CustomerAssistantResult, CustomerProposal } from '../contracts';
import type { CustomerConversation } from '../conversation.server';
import type { customerInterpretationSchema } from '../interpretation';
import { applyCustomerTurnResult, resolveCustomerTurn } from '../resolveTurn';
import type { ReceptionistEvalTurn } from './receptionistCases';
import { SEMANTIC_L1_MENU, SEMANTIC_L1_SNAPSHOT } from './semanticCases';

/** A bounded synthetic schedule with Sunday closed and no evening starts. */
function workingHoursSlots(preference: { date: string; earliest: string; latest: string }) {
  const time = preference.earliest < '09:00' ? '09:00' : preference.earliest;
  if (new Date(`${preference.date}T12:00:00Z`).getUTCDay() === 0 || time > preference.latest || time >= '17:00') {
    return [];
  }
  return [{ time, startTime: new Date(`${preference.date}T${time}:00-04:00`).toISOString() }];
}

/** Synthetic adapters, exact runtime orchestration and exact L1 resolver. No database/provider writes. */
export async function evaluateReceptionistTurn(intent: z.infer<typeof customerInterpretationSchema>, conversation: CustomerConversation, turn: ReceptionistEvalTurn) {
  const next = { ...conversation, messages: [...conversation.messages, turn.message].slice(-16), turnIndex: conversation.turnIndex + 1 };
  const buildProposal: typeof import('../catalogue.server').buildCustomerProposal = async (_salonId, _features, selection) => {
    const resolved = resolveCatalogSelection(SEMANTIC_L1_SNAPSHOT, { serviceId: selection.baseServiceId, selectedAddOns: selection.selectedAddOns });
    if (!resolved.ok || resolved.selection.blocksContinue) {
      throw new Error('synthetic_invalid_selection');
    }
    const value = resolved.selection;
    const service = SEMANTIC_L1_SNAPSHOT.services.find(item => item.id === value.serviceId)!;
    const proposal: CustomerProposal = {
      selection: { baseServiceId: value.serviceId, selectedAddOns: value.addOns.map(item => ({ addOnId: item.addOnId, quantity: item.quantity })) },
      fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      service: { id: service.id, name: service.name, priceCents: service.priceCents },
      addOns: value.addOns.map(item => ({ id: item.addOnId, name: SEMANTIC_L1_MENU.addOns.find(addOn => addOn.id === item.addOnId)!.name, quantity: item.quantity, priceCents: item.lineTotalCents })),
      subtotalCents: value.subtotalCents,
      durationMinutes: value.totalDurationMinutes,
      currency: 'CAD',
      expiresAt: '2026-09-18T23:59:00Z',
    };
    return proposal;
  };
  const result = await resolveCustomerTurn({ salonId: 'synthetic-isla', salonSlug: 'synthetic-isla', features: null, locale: 'en' }, SEMANTIC_L1_MENU, intent, conversation, next, {
    buildCustomerProposal: buildProposal,
    loadCustomerClarificationSnapshot: async () => SEMANTIC_L1_SNAPSHOT,
    lookupCustomerSlots: async args => ({ proposal: await buildProposal(args.salon.id, args.features, args.selection), today: '2026-09-18', timeZone: 'America/Toronto', slots: turn.availabilityFixture === 'working_hours' ? workingHoursSlots(args.preference) : [{ time: args.preference.earliest < '09:00' ? '09:00' : args.preference.earliest, startTime: new Date(Date.parse(`${args.preference.date}T${args.preference.earliest < '09:00' ? '09:00' : args.preference.earliest}:00-04:00`)).toISOString() }], selected: null, quoteChanged: false }),
    lookupNextCustomerSlots: async (args) => {
      const proposal = await buildProposal(args.salon.id, args.features, args.selection);
      if (turn.availabilityFixture !== 'working_hours') {
        return { proposal, today: '2026-09-18', timeZone: 'America/Toronto', preference: { date: '2026-09-19', earliest: '00:00', latest: '23:59' }, slots: [{ time: '12:30', startTime: '2026-09-19T16:30:00.000Z' }], selected: null, quoteChanged: false };
      }
      const date = new Date(`${args.fromDate ?? '2026-09-18'}T12:00:00Z`);
      for (let offset = 0; offset < 14; offset += 1) {
        const preference = { date: date.toISOString().slice(0, 10), earliest: args.earliest ?? '00:00', latest: args.latest ?? '23:59' };
        const slots = workingHoursSlots(preference);
        if (slots.length) {
          return { proposal, today: '2026-09-18', timeZone: 'America/Toronto', preference, slots, selected: null, quoteChanged: false };
        }
        date.setUTCDate(date.getUTCDate() + 1);
      }
      throw new Error('Synthetic availability fixture exhausted');
    },
  });
  applyCustomerTurnResult(next, result);
  const failures: string[] = [];
  for (const [key, value] of Object.entries(turn.facts ?? {})) {
    if (next.facts?.[key as keyof typeof next.facts] !== value) {
      failures.push(`fact:${key}`);
    }
  }
  if (!turn.kinds.includes(result.kind)) {
    failures.push(`outcome:${result.kind}`);
  }
  if (turn.reason && (result.kind !== 'unavailable' || result.reason !== turn.reason)) {
    failures.push('reason');
  }
  if (turn.price !== undefined && (result.kind !== 'proposal' || result.proposal.subtotalCents !== turn.price)) {
    failures.push('price');
  }
  if (turn.duration !== undefined && (result.kind !== 'proposal' || result.proposal.durationMinutes !== turn.duration)) {
    failures.push('duration');
  }
  if (result.kind === 'clarification' && turn.forbiddenQuestion === result.question) {
    failures.push('known_fact_reasked');
  }
  if (turn.date && (result.kind !== 'slots' || result.preference.date !== turn.date)) {
    failures.push('date');
  }
  if (turn.latestBefore && (result.kind !== 'slots' || result.preference.latest >= turn.latestBefore)) {
    failures.push('rejected_time_retained');
  }
  return { next, result, failures };
}

export function publicEvaluationResult(result: CustomerAssistantResult) {
  return result;
}
