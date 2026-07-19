import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { verifyOAuthState } from '@/libs/lusterSecurity';
import { salonTwilioConnectionSchema } from '@/models/Schema';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const state = verifyOAuthState<{ provider: string; salonId: string; salonSlug: string }>(url.searchParams.get('state') || '');
    if (state.provider !== 'twilio') {
      throw new Error('Invalid provider state');
    }
    const guard = await requireAdmin(state.salonId);
    if (!guard.ok) {
      return guard.response;
    }
    const accountSid = url.searchParams.get('AccountSid') || url.searchParams.get('account_sid');
    if (!accountSid?.startsWith('AC')) {
      throw new Error('Twilio did not return an account SID');
    }
    await db.insert(salonTwilioConnectionSchema).values({
      salonId: state.salonId,
      connectAccountSid: accountSid,
      status: 'pending',
      deauthorizedAt: null,
      lastError: null,
    }).onConflictDoUpdate({
      target: salonTwilioConnectionSchema.salonId,
      set: { connectAccountSid: accountSid, status: 'pending', deauthorizedAt: null, lastError: null, updatedAt: new Date() },
    });
    // Land on the Integrations app (Text messaging view) to finish number setup.
    return Response.redirect(new URL(`/en/admin?salon=${encodeURIComponent(state.salonSlug)}&app=integrations&twilio=authorized`, request.url));
  } catch (error) {
    console.error('[Twilio Connect callback]', error);
    return Response.redirect(new URL('/en/admin?app=integrations&twilio=error', request.url));
  }
}
