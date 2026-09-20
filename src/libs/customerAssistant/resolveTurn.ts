import type { z } from 'zod';

import type { SalonFeatures } from '@/types/salonPolicy';

import type { CustomerMenu } from './catalogue.server';
import { validateCustomerMenuDraft } from './catalogueSelection';
import { planCustomerClarification } from './clarification';
import type { CustomerAssistantLocale, CustomerAssistantResult } from './contracts';
import type { CustomerConversation } from './conversation.server';
import type { customerInterpretationSchema } from './interpretation';
import { applyTimingFeedback, clarificationChoices, mergeCatalogChoices, receptionistAnswer, transitionFailure } from './receptionist';
import { emptyFacts, hasKnownClarificationAnswer, mergeFacts } from './semanticFacts';
import { resolveSemanticSelection, selectionConflictsWithExplicitFacts } from './semanticSelection';

type Authorities = {
  buildCustomerProposal: typeof import('./catalogue.server').buildCustomerProposal;
  loadCustomerClarificationSnapshot: typeof import('./catalogue.server').loadCustomerClarificationSnapshot;
  lookupCustomerSlots: typeof import('./slots.server').lookupCustomerSlots;
  lookupNextCustomerSlots: typeof import('./slots.server').lookupNextCustomerSlots;
};

/**
 * A length belongs to an extension design, not permanently to a customer.
 * When a customer explicitly switches both treatment and desired application
 * from extensions to a natural-nail service, do not make the new service ask
 * for the old extension length. A changed supplied length still wins. Model
 * patches repeat prior values in some valid structured outputs, so merely
 * echoing the old value cannot keep an extension-only fact alive. Explicitly
 * retaining the same length is preserved using latest-turn provenance.
 */
function clearInheritedServiceFacts(args: {
  previous: import('./semanticFacts').Facts;
  facts: import('./semanticFacts').Facts;
  patch: z.infer<typeof customerInterpretationSchema>['factUpdates'];
  lengthExplicitThisTurn: boolean;
}): import('./semanticFacts').Facts {
  const changedTreatment = args.patch.treatment !== null && args.patch.treatment !== args.previous.treatment;
  const changedApplication = args.patch.desiredApplication !== null && args.patch.desiredApplication !== args.previous.desiredApplication;
  const switchedApplication = args.previous.desiredApplication === 'extensions' && args.patch.desiredApplication === 'natural_nails';
  const changedLength = args.patch.length !== null && args.patch.length !== args.previous.length;
  const length = changedTreatment && switchedApplication && !changedLength && !args.lengthExplicitThisTurn
    ? 'unknown'
    : args.facts.length;
  // A refill describes the prior requested service. A changed treatment or
  // application without an explicit new maintenance choice must not turn a
  // new service into an inherited refill. Keep current-product/origin facts:
  // they are still required to determine whether the change needs removal.
  const desiredApplication = changedTreatment && args.patch.desiredApplication === null
    ? 'unknown'
    : args.facts.desiredApplication;
  const maintenance = (changedTreatment || changedApplication) && args.patch.maintenance === null
    ? 'unknown'
    : args.facts.maintenance;
  // A prior “no removal” answer belongs to the prior service/refill. Do not
  // reuse it to quote a changed service over a known current product unless
  // the customer explicitly repeats that choice for the new request.
  const removal = (changedTreatment || changedApplication)
    && args.patch.removal === null
    && args.previous.removal === 'no'
    ? 'unknown'
    : args.facts.removal;
  return { ...args.facts, length, desiredApplication, maintenance, removal };
}

/** Channel-independent interpretation orchestration. All booking facts come from injected Luster authorities. */
export async function resolveCustomerTurn(args: { salonId: string; salonSlug: string; features: SalonFeatures | null; locale: CustomerAssistantLocale }, menu: CustomerMenu, intent: z.infer<typeof customerInterpretationSchema>, conversation: CustomerConversation, nextState: CustomerConversation, authority: Authorities): Promise<CustomerAssistantResult> {
  const { buildCustomerProposal, loadCustomerClarificationSnapshot, lookupCustomerSlots, lookupNextCustomerSlots } = authority;
  let result: CustomerAssistantResult;
  const fallbackSearch = conversation.availabilitySearch?.fallback ? conversation.availabilitySearch : null;
  // Keep legacy timingFeedback for already-issued structured outputs, but let
  // the unambiguous customer-facing direction win for new model responses.
  const requestedTimingFeedback = intent.timeDirection === 'earlier'
    ? 'too_late'
    : intent.timeDirection === 'later'
      ? 'too_early'
      : intent.timingFeedback;
  const anchorContinuation = intent.action === 'availability'
    && !intent.dateExplicitThisTurn
    && conversation.context?.question === 'date'
    && fallbackSearch
    && intent.availabilityAnchor !== null;
  const effectiveTimingFeedback = anchorContinuation
    ? (requestedTimingFeedback !== 'none' ? requestedTimingFeedback : fallbackSearch.pendingTimingFeedback ?? 'none')
    : requestedTimingFeedback;
  const relativeFeedback = intent.action === 'availability' && effectiveTimingFeedback !== 'none' && !intent.dateExplicitThisTurn;
  const displayedPreference = conversation.availabilitySearch?.displayedPreference ?? conversation.booking?.datePreference ?? null;
  let timingSlots: readonly Pick<import('./contracts').CustomerAvailableSlot, 'time'>[] = conversation.booking?.offeredSlots ?? [];
  const explicitOriginalReference = intent.action === 'availability'
    && intent.dateExplicitThisTurn
    && fallbackSearch
    && intent.datePreference?.date === fallbackSearch.requestedPreference.date;
  if (anchorContinuation) {
    const preference = intent.availabilityAnchor === 'requested'
      ? fallbackSearch.requestedPreference
      : fallbackSearch.displayedPreference;
    // The original request has no shown slots. Its own boundary is the only
    // truthful reference for “earlier” or “later” on that original window.
    if (intent.availabilityAnchor === 'requested') {
      const boundary = effectiveTimingFeedback === 'too_late' ? preference.earliest : preference.latest;
      timingSlots = [{ time: boundary }];
    }
    intent = { ...intent, datePreference: preference, timingFeedback: effectiveTimingFeedback };
  } else if (explicitOriginalReference) {
    const preference = fallbackSearch.requestedPreference;
    const boundary = effectiveTimingFeedback === 'too_late' ? preference.earliest : preference.latest;
    timingSlots = [{ time: boundary }];
  } else if (relativeFeedback && displayedPreference) {
    // A relative request has no authority to introduce a new date. Bind it to
    // the actual displayed availability window before applying its time bound.
    intent = {
      ...intent,
      datePreference: { ...(intent.datePreference ?? displayedPreference), date: displayedPreference.date },
      timingFeedback: effectiveTimingFeedback,
    };
  }
  if (intent.datePreference) {
    intent = { ...intent, datePreference: applyTimingFeedback(intent.datePreference, effectiveTimingFeedback, timingSlots) };
  }
  if (intent.informationServiceIds.some(id => !menu.services.some(service => service.id === id)) || (intent.action === 'answer' && intent.serviceId && !menu.services.some(service => service.id === intent.serviceId))) {
    throw new Error('CUSTOMER_MODEL_INVALID');
  }
  const subjects = intent.informationServiceIds.length ? intent.informationServiceIds : intent.action === 'answer' && intent.serviceId ? [intent.serviceId] : [];
  if (subjects.length) {
    if (JSON.stringify(subjects) !== JSON.stringify(conversation.subjects ?? [])) {
      nextState.priorSubjects = conversation.subjects;
    }
    nextState.subjects = subjects;
  }
  const previousFacts = conversation.facts ?? emptyFacts();
  const facts = clearInheritedServiceFacts({
    previous: previousFacts,
    facts: mergeFacts(previousFacts, intent.factUpdates),
    patch: intent.factUpdates,
    lengthExplicitThisTurn: intent.lengthExplicitThisTurn,
  });
  nextState.facts = facts;
  if (JSON.stringify(facts) !== JSON.stringify(previousFacts)) {
    // A previously accepted catalog selection cannot authorize changed intent.
    nextState.booking = undefined;
    nextState.context = undefined;
    nextState.availabilitySearch = undefined;
  }
  if (intent.datePreference) {
    nextState.availabilityPreference = intent.datePreference;
  }
  const priorDraft = conversation.requestedSelection ?? conversation.context?.selection ?? null;
  // An educational subject is not a request to switch services. Explicit fact
  // and design patches still survive the answer; the next proposal resolves them.
  const candidate = mergeCatalogChoices({ menu, previous: priorDraft, serviceId: intent.action === 'answer' ? priorDraft?.baseServiceId ?? null : intent.serviceId, addOns: intent.action === 'answer' ? [] : intent.addOns, updates: intent.addOnUpdates ?? (intent.action === 'answer' ? { add: [], remove: [] } : undefined) });
  if (JSON.stringify(candidate) !== JSON.stringify(priorDraft)) {
    nextState.context = undefined;
    nextState.booking = undefined;
    nextState.availabilitySearch = undefined;
  }
  // Desired choices are not a quote/booking capability. Preserve them through
  // educational answers and incomplete clarification, then resolve afresh.
  if (candidate) {
    try {
      validateCustomerMenuDraft(menu, candidate);
      nextState.requestedSelection = candidate;
    } catch {
      nextState.requestedSelection = undefined;
      return { kind: 'unavailable', reason: 'incompatible_selection' };
    }
  }
  // An informational question or an explicit design edit can change a draft.
  // Resolve that change through the same L1 path before displaying any amount.
  const candidateChanged = JSON.stringify(candidate) !== JSON.stringify(priorDraft);
  const explicitDesignUpdate = Boolean(intent.addOnUpdates?.add.length || intent.addOnUpdates?.remove.length);
  if ((intent.action === 'answer' || (intent.action === 'clarify' && candidateChanged && explicitDesignUpdate)) && candidate
    && (JSON.stringify(facts) !== JSON.stringify(previousFacts) || candidateChanged)) {
    // This edit consumes a malformed model clarification. Do not carry its
    // semantic option IDs into the L1 planner after the authoritative draft has
    // been updated.
    return resolveCustomerTurn(args, menu, { ...intent, action: 'propose', serviceId: candidate.baseServiceId, addOns: candidate.selectedAddOns, question: 'details', optionIds: [] }, conversation, nextState, authority);
  }
  const resolveServiceIntent = intent.action === 'propose'
    || (intent.action === 'clarify' && intent.question !== 'date' && (menu.l1 || hasKnownClarificationAnswer(intent.question, facts)));
  const crossProductRefillNeedsConfirmation = resolveServiceIntent
    && facts.maintenance === 'refill'
    && facts.existingProduct !== 'unknown'
    && facts.existingProduct !== 'none'
    && facts.treatment !== 'unknown'
    && facts.treatment !== facts.existingProduct;
  // A different requested product plus a current product cannot be treated as
  // a refill merely because the interpreter echoed a prior maintenance fact.
  // This is deliberately not an unsupported-service claim or an inferred
  // removal: Luster must confirm the transition before it can quote it.
  if (crossProductRefillNeedsConfirmation) {
    return { kind: 'unavailable', reason: 'transition_needs_confirmation' };
  }
  const transition = transitionFailure(menu, facts);
  // A fallback answer contains two honest reference points: the original
  // requested window and the later window we could display. “Earlier?” alone
  // does not say which one the customer means. Ask once instead of silently
  // searching a model-inferred date or making an unsupported comparison.
  if (relativeFeedback && fallbackSearch && nextState.context?.selection && !anchorContinuation) {
    const direction = effectiveTimingFeedback === 'too_late'
      ? { en: 'earlier', fr: 'plus tôt' }
      : { en: 'later', fr: 'plus tard' };
    return {
      kind: 'clarification',
      question: 'date',
      options: [],
      message: args.locale === 'fr'
        ? `Voulez-vous une heure ${direction.fr} le jour demandé au départ, ou par rapport aux heures que je viens d’afficher?`
        : `Do you mean ${direction.en} on the day you originally asked about, or relative to the times I just showed?`,
      availabilitySearch: { ...fallbackSearch, pendingTimingFeedback: effectiveTimingFeedback },
    };
  }
  // A model can label a request as a service clarification while its facts
  // plainly describe a new application. Treat that as a service-resolution
  // attempt for the starting-condition guard, but never apply the guard to an
  // ordinary informational answer.
  const serviceResolutionAttempt = resolveServiceIntent
    || (intent.action === 'clarify'
      && intent.question === 'service'
      && (facts.treatment !== 'unknown' || facts.desiredApplication !== 'unknown'));
  const crossProductWithoutRemoval = facts.removal === 'no'
    && facts.existingProduct !== 'unknown'
    && facts.existingProduct !== 'none'
    && facts.treatment !== 'unknown'
    && facts.treatment !== facts.existingProduct;
  if (serviceResolutionAttempt && !transition && crossProductWithoutRemoval) {
    return { kind: 'unavailable', reason: 'transition_needs_confirmation' };
  }
  const outsideStartingConditionUnresolved = serviceResolutionAttempt
    // A known unsupported transition is more useful than another generic
    // starting-condition question. Preserve that authoritative answer.
    && !transition
    && facts.existingProduct !== 'unknown'
    && facts.existingProduct !== 'none'
    // A stated “no removal” cannot make a cross-product change a bare-nail
    // quote. Ask for the pre-visit starting condition instead of adding a
    // removal or assuming the existing product is absent.
    && facts.removal === 'unknown'
    // A known refill is a different operational path. Never infer that an
    // outside set is a refill, but do not interrupt a verified refill with a
    // removal question.
    && facts.maintenance !== 'refill'
    // Ask only when this turn can actually resolve or quote a new service.
    // Informational turns remain conversational answers.
    && (candidate !== null || facts.treatment !== 'unknown' || facts.desiredApplication !== 'unknown');
  if (outsideStartingConditionUnresolved) {
    // Existing outside work does not authorize a new-set quote or assume a
    // removal/refill rule. Ask one truthful starting-condition question first.
    return { kind: 'clarification', question: facts.origin === 'unknown' ? 'origin' : 'removal', options: [] };
  }
  if (intent.action === 'answer') {
    const topic = intent.answerTopic ?? 'conversation';
    const educational = ['compare_treatments', 'length_options', 'service_options', 'unknown_product', 'service_information'].includes(topic);
    result = educational ? receptionistAnswer({ menu, facts, topic: topic as import('./receptionist').AnswerTopic, locale: args.locale, serviceId: intent.serviceId }) : { kind: 'answer', topic, message: '', options: [] };
    // Informational chips follow the actual subjects, never the whole menu.
    result.options = subjects.map(id => menu.services.find(service => service.id === id)!.name).slice(0, 3);
  } else if (transition) {
    result = { kind: 'unavailable', reason: transition };
  } else if (facts.currentProductUncertain && facts.existingProduct === 'unknown' && resolveServiceIntent) {
    result = { kind: 'unavailable', reason: 'unknown_product' };
  } else if (resolveServiceIntent) {
    let resolved = resolveSemanticSelection({
      menu,
      facts,
      candidate,
    });
    if (menu.l1) {
      const modelQuestion = intent.action === 'clarify' ? intent.question : resolved.kind === 'clarification' ? resolved.question : 'details';
      // Establish the starting condition before offering removal products. A
      // customer need not choose a removal SKU to say their nails are bare.
      const requestedQuestion = modelQuestion === 'removal' && facts.existingProduct === 'unknown' ? 'product' : modelQuestion;
      if (requestedQuestion === 'date') {
        throw new Error('CUSTOMER_MODEL_INVALID');
      }
      const snapshot = await loadCustomerClarificationSnapshot(args.salonId);
      resolved = planCustomerClarification({
        menu,
        action: intent.action === 'propose' ? 'propose' : 'clarify',
        snapshot,
        facts,
        candidate,
        question: requestedQuestion,
        optionIds: intent.optionIds,
      });
      // Starting condition matters only when THIS viable selection has a
      // compatible removal path. Reuse the L1 witness check, not menu-wide hints.
      if (resolved.kind === 'selection' && facts.existingProduct === 'unknown' && facts.removal !== 'no') {
        resolved = planCustomerClarification({ menu, snapshot, facts, candidate: resolved.selection, action: 'clarify', question: 'product', optionIds: [] });
      }
    }
    if (resolved.kind === 'no_match') {
      result = { kind: 'unavailable', reason: 'no_match' };
    } else if (resolved.kind === 'clarification') {
      const labels = resolved.optionIds.map(id => [...menu.services, ...menu.addOns].find(item => item.id === id)?.name);
      if (labels.includes(undefined)) {
        throw new Error('CUSTOMER_MODEL_INVALID');
      }
      result = { kind: 'clarification', question: resolved.question, options: clarificationChoices(resolved.question, labels as string[], args.locale) };
    } else {
      const proposal = await buildCustomerProposal(args.salonId, args.features, resolved.selection);
      // L1 may apply required/automatic selections. Never silently promise a
      // choice that contradicts the facts after that authoritative resolution.
      if (selectionConflictsWithExplicitFacts(menu, facts, {
        baseServiceId: proposal.service.id,
        selectedAddOns: proposal.addOns.map(item => ({ addOnId: item.id, quantity: item.quantity })),
      })) {
        result = { kind: 'unavailable', reason: 'selection_changed' };
      } else {
        result = { kind: 'proposal', proposal };
      }
    }
  } else if (intent.action === 'availability' && nextState.context?.selection && intent.datePreference) {
    const fresh = await lookupCustomerSlots({
      salon: { id: args.salonId, slug: args.salonSlug },
      features: args.features,
      selection: nextState.context.selection,
      preference: intent.datePreference,
    });
    if (!fresh) {
      result = { kind: 'unavailable', reason: 'unavailable' };
    } else if (fresh.quoteChanged || (nextState.booking?.acceptedFingerprint && fresh.proposal.fingerprint !== nextState.booking.acceptedFingerprint)) {
      nextState.booking = undefined;
      result = { kind: 'proposal', proposal: fresh.proposal };
    } else if (!fresh.slots.length) {
      const fromDate = new Date(Date.parse(`${intent.datePreference.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const next = await lookupNextCustomerSlots({ salon: { id: args.salonId, slug: args.salonSlug }, features: args.features, selection: nextState.context.selection, fromDate });
      if (!next) {
        nextState.booking = undefined;
        nextState.availabilityPreference = undefined;
        nextState.availabilitySearch = undefined;
      }
      result = next
        ? {
            kind: 'slots',
            proposal: next.proposal,
            preference: next.preference,
            timeZone: next.timeZone,
            slots: next.slots,
            checkedAt: new Date().toISOString(),
            search: {
              requestedPreference: intent.datePreference,
              displayedPreference: next.preference,
              fallback: true,
            },
            message: args.locale === 'fr' ? 'Aucun créneau ne correspond à votre demande. Voici les prochaines disponibilités.' : 'There are no times matching that request. Here are the next available times.',
          }
        : { kind: 'unavailable', reason: 'no_availability' };
    } else {
      result = {
        kind: 'slots',
        proposal: fresh.proposal,
        preference: intent.datePreference,
        timeZone: fresh.timeZone,
        slots: fresh.slots,
        checkedAt: new Date().toISOString(),
        search: {
          requestedPreference: intent.datePreference,
          displayedPreference: intent.datePreference,
          fallback: false,
        },
      };
    }
  } else if (intent.action === 'availability' && nextState.context?.selection) {
    if (intent.availabilityScope === 'specific_window') {
      result = { kind: 'clarification', question: 'date', options: [] };
    } else {
      const fresh = await lookupNextCustomerSlots({ salon: { id: args.salonId, slug: args.salonSlug }, features: args.features, selection: nextState.context.selection });
      result = fresh
        ? {
            kind: 'slots',
            proposal: fresh.proposal,
            preference: fresh.preference,
            timeZone: fresh.timeZone,
            slots: fresh.slots,
            checkedAt: new Date().toISOString(),
            search: {
              requestedPreference: fresh.preference,
              displayedPreference: fresh.preference,
              fallback: false,
            },
          }
        : { kind: 'unavailable', reason: 'no_availability' };
    }
  } else if (intent.action === 'clarify') {
    if (intent.question === 'date' && !(conversation.context?.selection && nextState.booking?.acceptedFingerprint)) {
      result = { kind: 'unavailable', reason: 'no_match' };
    } else {
      // Only current public labels can become chips. Unknown/cross-tenant IDs
      // and unrelated add-ons invalidate the answer instead of being echoed.
      const eligibleAddOnIds = new Set(menu.bindings.filter(binding => binding.serviceId === intent.serviceId).map(binding => binding.addOnId));
      const choices = [...menu.services, ...menu.addOns.filter(item => eligibleAddOnIds.has(item.id))];
      const options = intent.optionIds.map(id => choices.find(item => item.id === id)?.name);
      if (options.includes(undefined)) {
        throw new Error('CUSTOMER_MODEL_INVALID');
      }
      result = { kind: 'clarification', question: intent.question, options: options as string[] };
    }
  } else {
    result = { kind: 'unavailable', reason: 'no_match' };
  }
  return result;
}

export function applyCustomerTurnResult(nextState: CustomerConversation, result: CustomerAssistantResult): void {
  if (result.kind === 'proposal') {
    nextState.requestedSelection = result.proposal.selection;
    nextState.context = { question: null, options: [], selection: result.proposal.selection };
    if (nextState.booking?.acceptedFingerprint !== result.proposal.fingerprint) {
      nextState.booking = undefined;
    }
  } else if (result.kind === 'answer') {
    nextState.context = { question: null, answerTopic: result.topic, options: result.options, selection: nextState.context?.selection ?? null };
  } else if (result.kind === 'clarification') {
    nextState.context = {
      question: result.question,
      options: result.options,
      selection: nextState.context?.selection ?? null,
    };
    if (result.availabilitySearch) {
      nextState.availabilitySearch = result.availabilitySearch;
    }
  }
  if (result.kind === 'slots') {
    nextState.availabilityPreference = result.preference;
    nextState.availabilitySearch = result.search ?? {
      requestedPreference: result.preference,
      displayedPreference: result.preference,
      fallback: false,
    };
    nextState.requestedSelection = result.proposal.selection;
    nextState.context = { question: null, options: [], selection: result.proposal.selection };
    nextState.booking = {
      acceptedFingerprint: nextState.booking?.acceptedFingerprint === result.proposal.fingerprint ? result.proposal.fingerprint : null,
      datePreference: result.preference,
      offeredSlots: result.slots,
      selectedSlot: null,
    };
  }
}
