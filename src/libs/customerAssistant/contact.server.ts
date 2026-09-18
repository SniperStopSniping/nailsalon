import 'server-only';

import { createHmac } from 'node:crypto';

import type { CustomerContact } from './contact';

/**
 * Binds request-only PII to this review operation without putting it in a
 * signed browser capability, audit metadata, model input, or response body.
 */
export function createCustomerContactBinding(args: {
  secret: string;
  salonId: string;
  sessionId: string;
  contact: CustomerContact;
}): string {
  const material = JSON.stringify({
    domain: 'luster.customer-review-contact.v1',
    salonId: args.salonId,
    sessionId: args.sessionId,
    contact: args.contact,
  });
  return createHmac('sha256', args.secret).update(material, 'utf8').digest('base64url');
}
