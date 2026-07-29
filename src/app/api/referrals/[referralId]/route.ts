import { legacyCustomerAuthDisabledResponse } from '@/libs/clientAuth';

export async function GET(
  _request: Request,
  _context: { params: Promise<{ referralId: string }> },
): Promise<Response> {
  return legacyCustomerAuthDisabledResponse();
}
