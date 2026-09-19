import 'server-only';

import { createHash } from 'node:crypto';

import { redis } from '@/core/redis/redisClient';

import type { CustomerAssistantResponse } from './contracts';
import { verifyCustomerConversation } from './conversation.server';

type ReplayRequest = { salonId: string; conversation: string; message: string; locale: string };

function key(request: ReplayRequest): string {
  const scope = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  const digest = createHash('sha256').update(JSON.stringify([scope, request.salonId, request.conversation, request.message, request.locale])).digest('hex');
  return `luster:customer-booking-assistant:{customer-booking-assistant}:reply:${digest}`;
}

async function bounded<T>(operation: Promise<T> | undefined): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation ?? Promise.resolve(null), new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 1_000);
      timer.unref?.();
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Contains only the already public response and signed bounded non-contact conversation. */
export async function readCompletedCustomerTurn(request: ReplayRequest, secret: string): Promise<CustomerAssistantResponse | null> {
  try {
    const encoded = await bounded(redis?.get(key(request)));
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 40_000) {
      return null;
    }
    const result = JSON.parse(encoded) as CustomerAssistantResponse;
    verifyCustomerConversation(result.conversation, request.salonId, secret);
    return result;
  } catch {
    return null;
  }
}

export async function storeCompletedCustomerTurn(request: ReplayRequest, response: CustomerAssistantResponse): Promise<void> {
  try {
    const encoded = JSON.stringify(response);
    if (Buffer.byteLength(encoded) <= 40_000) {
      await bounded(redis?.set(key(request), encoded, 'EX', 2 * 60 * 60 + 60));
    }
  } catch {
    // A failed response cache never releases the already consumed turn or spend.
  }
}
