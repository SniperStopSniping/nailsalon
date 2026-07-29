import 'server-only';

import type { ClientSessionPrincipal } from '@/libs/clientAuth';
import { legacyCustomerAuthDisabledResponse } from '@/libs/clientAuth';
import type { Salon } from '@/models/Schema';

import { getResolvedSalon, getSalonFromSlugOrCookie } from './tenant';

type GuardFailure = { ok: false; response: Response };

type ClientSessionGuard = {
  ok: true;
  normalizedPhone: string;
  phoneVariants: string[];
  session: ClientSessionPrincipal;
} | GuardFailure;

type ClientSalonGuard = {
  ok: true;
  salon: Salon;
} | GuardFailure;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

export function normalizeClientPhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

export async function requireClientApiSession(): Promise<ClientSessionGuard> {
  return {
    ok: false,
    response: legacyCustomerAuthDisabledResponse(),
  };
}

export async function requireClientSalonFromQuery(
  searchParams: URLSearchParams,
): Promise<ClientSalonGuard> {
  const salon = await getResolvedSalon(searchParams);

  if (!salon) {
    return {
      ok: false,
      response: errorResponse(400, 'MISSING_SALON', 'Salon slug is required'),
    };
  }

  return { ok: true, salon };
}

export async function requireClientSalonFromBody(
  salonSlug?: string | null,
): Promise<ClientSalonGuard> {
  const salon = await getSalonFromSlugOrCookie(salonSlug);

  if (!salon) {
    return {
      ok: false,
      response: errorResponse(400, 'MISSING_SALON', 'Salon slug is required'),
    };
  }

  return { ok: true, salon };
}
