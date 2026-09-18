import { runCustomerBookingRecoveryAction } from '@/libs/customerAssistant/recoveryAction.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ salonId: string }> }): Promise<Response> {
  const { salonId } = await context.params;
  return runCustomerBookingRecoveryAction(request, salonId, 'manage');
}
