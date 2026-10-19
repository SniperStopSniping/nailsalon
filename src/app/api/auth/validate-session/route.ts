import { legacyCustomerAuthDisabledResponse } from '@/libs/clientAuth';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return legacyCustomerAuthDisabledResponse();
}
