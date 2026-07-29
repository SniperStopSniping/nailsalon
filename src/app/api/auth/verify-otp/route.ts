import { legacyCustomerAuthDisabledResponse } from '@/libs/clientAuth';

export async function POST(_request: Request): Promise<Response> {
  return legacyCustomerAuthDisabledResponse();
}
