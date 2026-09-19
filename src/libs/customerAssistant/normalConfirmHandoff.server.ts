import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const FLOW_LIFETIME_MS = 2 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NormalConfirmHandoff = {
  flowToken: string;
  expiresAt: string;
};

type FlowPayload = { salonId: string; flowId: string; issuedAt: number };

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
export function issueNormalConfirmHandoff(args: { salonId: string; secret: string; flowId?: string; now?: Date }): NormalConfirmHandoff {
  const issuedAt = (args.now ?? new Date()).getTime();
  if (args.flowId !== undefined && !UUID.test(args.flowId)) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  const payload: FlowPayload = { salonId: args.salonId, flowId: args.flowId ?? randomUUID(), issuedAt };
  const parts = ['v1', payload.flowId, String(payload.issuedAt), sign(args.secret, payload)];
  return { flowToken: parts.join('.'), expiresAt: new Date(issuedAt + FLOW_LIFETIME_MS).toISOString() };
}

export function verifyNormalConfirmHandoff(args: { salonId: string; flowToken: string; secret: string; now?: Date; allowExpired?: boolean }): { flowId: string; expiresAt: Date } {
  const [version, flowId, issuedAtText, mac, extra] = args.flowToken.split('.');
  const issuedAt = Number(issuedAtText);
  if (version !== 'v1' || !UUID.test(flowId ?? '') || !Number.isSafeInteger(issuedAt) || !mac || extra) {
    throw new Error('NORMAL_CONFIRM_HANDOFF_INVALID');
  }
  const payload: FlowPayload = { salonId: args.salonId, flowId: flowId!, issuedAt };
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
  return { flowId: flowId!, expiresAt };
}
