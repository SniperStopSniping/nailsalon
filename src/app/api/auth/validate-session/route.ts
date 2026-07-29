import {
  clearClientSessionCookies,
  legacyCustomerAuthDisabledResponse,
} from '@/libs/clientAuth';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  await clearClientSessionCookies();
  return legacyCustomerAuthDisabledResponse();
}
