import { requireAdminSalon } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import { signOAuthState } from '@/libs/lusterSecurity';

export async function GET(request: Request) {
  const salonSlug = new URL(request.url).searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json({ error: 'salonSlug is required' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  if (!Env.TWILIO_CONNECT_APP_SID || !Env.TWILIO_CONNECT_REDIRECT_URI) {
    return Response.json({ error: 'Twilio Connect is not configured' }, { status: 503 });
  }
  const state = signOAuthState({ provider: 'twilio', salonId: salon.id, salonSlug: salon.slug });
  const authorizeUrl = new URL(`https://www.twilio.com/authorize/${Env.TWILIO_CONNECT_APP_SID}`);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('redirect_uri', Env.TWILIO_CONNECT_REDIRECT_URI);
  return Response.redirect(authorizeUrl);
}
