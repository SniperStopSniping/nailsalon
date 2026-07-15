import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { encryptIntegrationSecret, verifyOAuthState } from '@/libs/lusterSecurity';
import { salonGoogleCalendarConnectionSchema } from '@/models/Schema';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const state = verifyOAuthState<{ provider: string; salonId: string; salonSlug: string }>(url.searchParams.get('state') || '');
    if (state.provider !== 'google') {
      throw new Error('Invalid provider state');
    }
    const guard = await requireAdmin(state.salonId);
    if (!guard.ok) {
      return guard.response;
    }
    const code = url.searchParams.get('code');
    if (!code || !Env.GOOGLE_OAUTH_CLIENT_ID || !Env.GOOGLE_OAUTH_CLIENT_SECRET || !Env.GOOGLE_OAUTH_REDIRECT_URI) {
      throw new Error('Google OAuth callback is incomplete');
    }
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: Env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: Env.GOOGLE_OAUTH_REDIRECT_URI,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error_description?: string };
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
      throw new Error(token.error_description || 'Google did not return offline access. Reconnect and approve access.');
    }
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const userInfo = userInfoResponse.ok ? await userInfoResponse.json() as { id?: string; email?: string } : {};
    const encrypted = encryptIntegrationSecret(token.refresh_token);
    await db.insert(salonGoogleCalendarConnectionSchema).values({
      salonId: state.salonId,
      googleAccountId: userInfo.id || null,
      googleEmail: userInfo.email || null,
      encryptedRefreshToken: encrypted.ciphertext,
      encryptionKeyVersion: encrypted.keyVersion,
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      scopes: token.scope?.split(' ') || [],
      status: 'active',
      tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
      lastError: null,
      inboundSyncEnabled: true,
      inboundSyncedAt: new Date(),
      inboundSyncError: null,
    }).onConflictDoUpdate({
      target: salonGoogleCalendarConnectionSchema.salonId,
      set: {
        googleAccountId: userInfo.id || null,
        googleEmail: userInfo.email || null,
        encryptedRefreshToken: encrypted.ciphertext,
        encryptionKeyVersion: encrypted.keyVersion,
        scopes: token.scope?.split(' ') || [],
        status: 'active',
        tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
        lastError: null,
        inboundSyncEnabled: true,
        inboundSyncedAt: new Date(),
        inboundSyncError: null,
        updatedAt: new Date(),
      },
    });
    return Response.redirect(new URL(`/en/admin/luster?salon=${encodeURIComponent(state.salonSlug)}&google=connected`, request.url));
  } catch (error) {
    console.error('[Google OAuth callback]', error);
    return Response.redirect(new URL('/en/admin/luster?google=error', request.url));
  }
}
