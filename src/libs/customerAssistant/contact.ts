import { z } from 'zod';

import { normalizePhone } from '@/libs/phone';

const CONTACT_MAX_NAME = 100;

export const customerContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(CONTACT_MAX_NAME),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(1).max(40),
}).strict();

export type CustomerContact = {
  name: string;
  email: string;
  phone: string;
};

/** Match the guest appointment route's trimmed/lower-cased 10-digit contract. */
export function normalizeCustomerContact(input: z.infer<typeof customerContactRequestSchema>): CustomerContact | null {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  if (!name || phone.length !== 10) {
    return null;
  }
  return { name, email, phone };
}
