import 'server-only';

import type { SalonFeatures } from '@/types/salonPolicy';

import { getCustomerAssistantConfig } from './access.server';
import type { CustomerBookingOperationReference } from './bookingOperationContracts';
import { buildCustomerProposal } from './catalogue.server';
import type { CustomerAssistantHandoffResponse } from './contracts';
import { verifyCustomerConversation } from './conversation.server';
import { issueNormalConfirmHandoff, verifyNormalConfirmHandoff } from './normalConfirmHandoff.server';

type BoundSalon = { id: string; slug: string };

function unavailable(conversation: string, reason: Extract<CustomerAssistantHandoffResponse['result'], { kind: 'unavailable' }>['reason']): CustomerAssistantHandoffResponse {
  return { conversation, result: { kind: 'unavailable', reason } };
}

/**
 * Revalidates a signed proposal before client navigation into the ordinary
 * booking flow. The returned flow token is opaque and must stay out of URLs.
 */
export async function runCustomerHandoff(args: {
  salon: BoundSalon;
  features: SalonFeatures | null;
  conversation: string;
  fingerprint: string;
  flowToken?: string;
  operationCapability?: string;
  now?: Date;
}): Promise<CustomerAssistantHandoffResponse> {
  const config = getCustomerAssistantConfig();
  if (!config) {
    return unavailable(args.conversation, 'unavailable');
  }
  let state;
  try {
    state = verifyCustomerConversation(args.conversation, args.salon.id, config.signingSecret, args.now?.getTime());
  } catch {
    return unavailable(args.conversation, 'invalid_conversation');
  }
  const selection = state.context?.selection;
  if (!selection) {
    return unavailable(args.conversation, 'selection_changed');
  }
  let proposal;
  try {
    proposal = await buildCustomerProposal(args.salon.id, args.features, selection);
  } catch {
    return unavailable(args.conversation, 'selection_changed');
  }
  if (proposal.fingerprint !== args.fingerprint) {
    return { conversation: args.conversation, result: { kind: 'proposal', proposal } };
  }
  let flowId = state.sessionId;
  let operation: CustomerBookingOperationReference | undefined;
  if (args.operationCapability) {
    try {
      const { customerBookingOperationReference, readCustomerBookingOperation } = await import('./operationStore.server');
      const existing = await readCustomerBookingOperation({ salonId: args.salon.id, capability: args.operationCapability, secret: config.signingSecret, now: args.now });
      if (existing.appointmentId) {
        return unavailable(args.conversation, 'invalid_handoff');
      }
      flowId = existing.sessionId;
      operation = customerBookingOperationReference(existing, config.signingSecret);
    } catch {
      return unavailable(args.conversation, 'invalid_handoff');
    }
  }
  if (args.flowToken) {
    try {
      const verifiedFlowId = verifyNormalConfirmHandoff({ salonId: args.salon.id, secret: config.signingSecret, flowToken: args.flowToken, now: args.now, allowExpired: true }).flowId;
      if (operation && verifiedFlowId !== flowId) {
        return unavailable(args.conversation, 'invalid_handoff');
      }
      flowId = verifiedFlowId;
    } catch (error) {
      return unavailable(args.conversation, error instanceof Error && error.message === 'NORMAL_CONFIRM_HANDOFF_EXPIRED' ? 'handoff_expired' : 'invalid_handoff');
    }
  }
  const flow = issueNormalConfirmHandoff({
    salonId: args.salon.id,
    secret: config.signingSecret,
    flowId,
    now: args.now,
  });
  return {
    conversation: args.conversation,
    result: {
      kind: 'handoff',
      handoff: {
        selection: proposal.selection,
        flow,
        ...(operation ? { operation } : {}),
        datePreference: state.booking?.datePreference ?? state.availabilityPreference,
      },
    },
  };
}
