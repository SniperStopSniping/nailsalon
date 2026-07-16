import { requireAdminSalon } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import { signOAuthState } from '@/libs/lusterSecurity';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const salonSlug = url.searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json({ error: 'salonSlug is required' }, { status: 400 });
  }
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error || Response.json({ error: 'Salon not found' }, { status: 404 });
  }
  if (
    !Env.GOOGLE_OAUTH_CLIENT_ID
    || !Env.GOOGLE_OAUTH_CLIENT_SECRET
    || !Env.GOOGLE_OAUTH_REDIRECT_URI
    || !Env.INTEGRATION_ENCRYPTION_KEY
    || !Env.OAUTH_STATE_SECRET
  ) {
    const returnUrl = new URL('/en/admin/luster', request.url);
    returnUrl.searchParams.set('salon', salon.slug);
    returnUrl.searchParams.set('google', 'not_configured');
    return Response.redirect(returnUrl);
  }
  const state = signOAuthState({ provider: 'google', salonId: salon.id, salonSlug: salon.slug });
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: Env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: Env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
    state,
  }).toString();
  return Response.redirect(authorizationUrl);
}
