import { getPublicBookingAvailability } from '@/libs/publicBookingAvailability.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return getPublicBookingAvailability(request);
}
