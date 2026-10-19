import { resolveSetupPolicy, setupPolicyInput } from './booking-policy';
import type { SetupDocument, SetupOperation } from './contracts';

type PolicyDocument = { bookingPolicy?: SetupDocument['bookingPolicy']; website: { content: { websiteDetails?: SetupDocument['website']['content']['websiteDetails'] } } };

/** A narrow presentation request never authorizes changing the agreement itself. */
export function savedPolicyVisibilityRequest(message: string): boolean | null {
  const subject = /\b(?:my|saved|current|existing)\s+(?:(?:booking|appointment)\s+)?(?:policy|policies|agreement)\b/iu.exec(message);
  if (!/\b(?:website|site|page|homepage)\b/iu.test(message)
    || !subject
    || /\b(?:rewrite|replace|edit|change)\b.{1,40}\b(?:policy|agreement|wording|text)\b/iu.test(message)) {
    return null;
  }
  // Use the nearest verb before this subject, rather than an unrelated command
  // later in the same message (e.g. show the policy and remove a photo).
  const prefix = message.slice(Math.max(0, subject.index - 60), subject.index);
  const verb = [...prefix.matchAll(/\b(?:(?:don't|do not|don’t)\s+)?(?:show|include|display|add|put|hide|remove)\b/giu)].at(-1)?.[0];
  return verb ? !/^(?:hide|remove|don't|do not|don’t)/iu.test(verb) : null;
}

export function isSavedPolicyVisibilityOperation(operation: SetupOperation, document: PolicyDocument, desired: boolean | null) {
  if (desired === null || !['booking_policy', 'booking_policy_visibility'].includes(operation.type) || !document.bookingPolicy?.enabled || !document.bookingPolicy.text) {
    return false;
  }
  if (operation.type === 'booking_policy_visibility') {
    return operation.showOnServicePage === desired;
  }
  if (operation.type !== 'booking_policy') {
    return false;
  }
  const expected = { ...setupPolicyInput(document.bookingPolicy), showOnServicePage: desired };
  const proposed = setupPolicyInput(resolveSetupPolicy(operation.values, document.bookingPolicy));
  return JSON.stringify(expected) === JSON.stringify(proposed);
}

export class PolicyPresentationError extends Error {
  constructor() {
    super('Use booking_policy_visibility with only showOnServicePage to change where the saved agreement appears. The application preserves its title, full text, acceptance and all other flags. Remove only an identical copied agreement section from website_details, preserving every unrelated section. Never maintain a separate copy of the saved agreement.');
    this.name = 'PolicyPresentationError';
  }
}

/** Schema-valid copied text can still drift; admit one authoritative policy only. */
export function assertSavedPolicyPresentation(document: PolicyDocument, message: string, scope: string, operations: SetupOperation[]) {
  const desired = savedPolicyVisibilityRequest(message);
  if (scope === 'service_price' || desired === null || !document.bookingPolicy?.enabled || !document.bookingPolicy.text) {
    return;
  }
  let sections = document.website.content.websiteDetails?.sections ?? [];
  let visibilityChanged = false;
  for (const operation of operations) {
    if (operation.type === 'booking_policy' || operation.type === 'booking_policy_visibility') {
      if (!isSavedPolicyVisibilityOperation(operation, document, desired)) {
        throw new PolicyPresentationError();
      }
      visibilityChanged = true;
    }
    if (operation.type === 'website_details' && operation.values.sections) {
      sections = operation.values.sections;
    }
  }
  const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ');
  const copiedPolicy = sections.some(section => normalize(section.text) === normalize(document.bookingPolicy!.text!));
  if ((!visibilityChanged && document.bookingPolicy.showOnServicePage !== desired) || copiedPolicy) {
    throw new PolicyPresentationError();
  }
}
