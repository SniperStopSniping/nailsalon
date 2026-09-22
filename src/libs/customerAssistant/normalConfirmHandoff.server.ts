import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const FLOW_LIFETIME_MS = 2 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NormalConfirmHandoff = {
  flowToken: string;
  expiresAt: string;
};

type ManualContext = { currentProduct: 'gel_x' | 'builder_gel' | 'acrylic' | 'gel_polish' | 'unknown'; itemIds: string[] };
type FlowPayload = { salonId: string; flowId: string; issuedAt: number; manualConfirmationContext?: ManualContext };

function sign(secret: string, payload: FlowPayload): string {
  if (secret.length < 32) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  return createHmac('sha256', secret).update(JSON.stringify(['luster.normal-confirm-handoff.v1', payload])).digest('base64url');
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Opaque bearer for a normal-flow handoff; it authorizes only a stable operation session id. */
export function issueNormalConfirmHandoff(args: { salonId: string; secret: string; flowId?: string; now?: Date; manualConfirmationContext?: ManualContext }): NormalConfirmHandoff {
  const issuedAt = (args.now ?? new Date()).getTime();
  if (args.flowId !== undefined && !UUID.test(args.flowId)) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  const payload: FlowPayload = { salonId: args.salonId, flowId: args.flowId ?? randomUUID(), issuedAt, ...(args.manualConfirmationContext ? { manualConfirmationContext: args.manualConfirmationContext } : {}) };
  const context = payload.manualConfirmationContext ? Buffer.from(JSON.stringify(payload.manualConfirmationContext)).toString('base64url') : null;
  const parts = context ? ['v1', payload.flowId, String(payload.issuedAt), context, sign(args.secret, payload)] : ['v1', payload.flowId, String(payload.issuedAt), sign(args.secret, payload)];
  return { flowToken: parts.join('.'), expiresAt: new Date(issuedAt + FLOW_LIFETIME_MS).toISOString() };
}

export function verifyNormalConfirmHandoff(args: { salonId: string; flowToken: string; secret: string; now?: Date; allowExpired?: boolean }): { flowId: string; expiresAt: Date; manualConfirmationContext?: ManualContext } {
  const parts = args.flowToken.split('.');
  const [version, flowId, issuedAtText] = parts;
  const contextText = parts.length === 5 ? parts[3] : null;
  const mac = parts.length === 5 ? parts[4] : parts[3];
  let manualConfirmationContext: ManualContext | undefined;
  if (contextText) {
    try {
      const candidate = JSON.parse(Buffer.from(contextText, 'base64url').toString('utf8')) as ManualContext;
      if (!['gel_x', 'builder_gel', 'acrylic', 'gel_polish', 'unknown'].includes(candidate.currentProduct) || !Array.isArray(candidate.itemIds) || candidate.itemIds.length > 20 || candidate.itemIds.some(id => typeof id !== 'string' || id.length > 100)) {
        throw new Error('NORMAL_CONFIRM_HANDOFF_CONTEXT_INVALID');
      }
      manualConfirmationContext = candidate;
    } catch {
      throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
    }
  }
  const issuedAt = Number(issuedAtText);
  if (version !== 'v1' || !UUID.test(flowId ?? '') || !Number.isSafeInteger(issuedAt) || !mac || (parts.length !== 4 && parts.length !== 5)) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  const payload: FlowPayload = { salonId: args.salonId, flowId: flowId!, issuedAt, ...(manualConfirmationContext ? { manualConfirmationContext } : {}) };
  if (!equal(mac, sign(args.secret, payload))) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  if (issuedAt < 0 || issuedAt > (args.now ?? new Date()).getTime() + 60_000) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  const expiresAt = new Date(issuedAt + FLOW_LIFETIME_MS);
  if (expiresAt <= (args.now ?? new Date()) && !args.allowExpired) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_EXPIRED');
  }
  return { flowId: flowId!, expiresAt, ...(manualConfirmationContext ? { manualConfirmationContext } : {}) };
}
