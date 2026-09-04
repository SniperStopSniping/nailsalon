import { normalizeSalonSlug } from '@/libs/tenantSlug';

import type {
  OnboardingClaimConflict,
  OnboardingClaimSuccess,
  OnboardingDraftClaimRequest,
  OnboardingPlanIntent,
  OnboardingPlanIntentRequest,
  OnboardingSiteSlugAvailability,
} from './contracts';

type ErrorEnvelope = {
  error?: {
    code?: unknown;
    conflict?: unknown;
    message?: unknown;
  };
};

type DataEnvelope<Value> = { data?: Value };

export type ClaimSiteResult =
  | { status: 'saved'; value: OnboardingClaimSuccess }
  | { conflict: OnboardingClaimConflict; status: 'conflict' };

export type SavePlanIntentResult = {
  confirmationMessage: string;
  dashboardUrl: string;
  intent: OnboardingPlanIntent;
  siteId: string;
};

export type OnboardingDraftClaimStatus = {
  claim: OnboardingClaimSuccess | null;
};

export class OnboardingIntegrationRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code?: string; status: number }) {
    super(message);
    this.name = 'OnboardingIntegrationRequestError';
    this.code = options.code ?? 'ONBOARDING_REQUEST_FAILED';
    this.status = options.status;
  }
}

const readJson = async <Value>(response: Response): Promise<Value | null> =>
  response.json().catch(() => null) as Promise<Value | null>;

const ownerMessage = (body: ErrorEnvelope | null, fallback: string): string => {
  const message = body?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};

export const checkOnboardingSiteSlugAvailability = async (
  slug: string,
  signal?: AbortSignal,
  options: { fetcher?: typeof fetch; knownAvailableSlug?: string } = {},
): Promise<OnboardingSiteSlugAvailability> => {
  const normalizedSlug = normalizeSalonSlug(slug) ?? '';
  if (
    options.knownAvailableSlug
    && normalizeSalonSlug(options.knownAvailableSlug) === normalizedSlug
  ) {
    return { available: true, reason: 'available', slug: normalizedSlug };
  }
  const response = await (options.fetcher ?? fetch)('/api/onboarding/v1/slug-availability', {
    body: JSON.stringify({ slug }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  });
  const body = await readJson<DataEnvelope<OnboardingSiteSlugAvailability> & ErrorEnvelope>(response);
  const availability = body?.data;
  if (
    !response.ok
    || !availability
    || typeof availability.available !== 'boolean'
    || typeof availability.slug !== 'string'
    || availability.slug !== normalizedSlug
    || !['available', 'invalid', 'unavailable'].includes(availability.reason)
    || availability.available !== (availability.reason === 'available')
  ) {
    throw new OnboardingIntegrationRequestError(
      ownerMessage(body, 'We couldn’t check this URL right now.'),
      {
        code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
        status: response.status,
      },
    );
  }
  return availability;
};

export const claimOnboardingDraft = async (
  request: OnboardingDraftClaimRequest,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ClaimSiteResult> => {
  const response = await (options.fetcher ?? fetch)('/api/onboarding/v1/claim', {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: options.signal,
  });
  const body = await readJson<
    DataEnvelope<OnboardingClaimSuccess> & ErrorEnvelope
  >(response);

  if (response.status === 409) {
    const conflict = body?.error?.conflict;
    if (
      conflict
      && typeof conflict === 'object'
      && ('code' in conflict)
      && (conflict.code === 'BUSINESS_TARGET_REQUIRED' || conflict.code === 'SITE_CONFLICT')
    ) {
      return { conflict: conflict as OnboardingClaimConflict, status: 'conflict' };
    }
  }

  if (!response.ok || !body?.data) {
    throw new OnboardingIntegrationRequestError(
      ownerMessage(body, 'We couldn’t finish saving your site. Your work is still safe on this device.'),
      {
        code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
        status: response.status,
      },
    );
  }
  return { status: 'saved', value: body.data };
};

export const getOnboardingDraftClaimStatus = async (
  anonymousDraftToken: string,
  options: { fetcher?: typeof fetch; savedSiteId?: string; signal?: AbortSignal } = {},
): Promise<OnboardingDraftClaimStatus> => {
  const response = await (options.fetcher ?? fetch)('/api/onboarding/v1/status', {
    body: JSON.stringify({ anonymousDraftToken, ...(options.savedSiteId ? { savedSiteId: options.savedSiteId } : {}) }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: options.signal,
  });
  const body = await readJson<
    DataEnvelope<OnboardingDraftClaimStatus> & ErrorEnvelope
  >(response);
  if (!response.ok || !body?.data) {
    throw new OnboardingIntegrationRequestError(
      ownerMessage(
        body,
        'We couldn’t confirm the saved website yet. Your work is still safe on this device.',
      ),
      {
        code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
        status: response.status,
      },
    );
  }
  return body.data;
};

export type OnboardingOrganizationResolution = {
  created: boolean;
  organizations: { id: string; name: string }[];
};

/**
 * Resolves the Clerk "choose-organization" session task server-side so the
 * owner never lands on a generic organization screen. Returns the owner's
 * organizations, creating one named after the salon when none exists.
 */
export const resolveOnboardingOrganization = async (
  businessName: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<OnboardingOrganizationResolution> => {
  const response = await (options.fetcher ?? fetch)('/api/onboarding/v1/organization', {
    body: JSON.stringify({ businessName }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: options.signal,
  });
  const body = await readJson<
    DataEnvelope<OnboardingOrganizationResolution> & ErrorEnvelope
  >(response);
  if (!response.ok || !body?.data) {
    throw new OnboardingIntegrationRequestError(
      ownerMessage(body, 'We couldn’t finish setting up your business. Try again.'),
      {
        code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
        status: response.status,
      },
    );
  }
  return body.data;
};

export const saveOnboardingPlanIntent = async (
  request: OnboardingPlanIntentRequest,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SavePlanIntentResult> => {
  const response = await (options.fetcher ?? fetch)('/api/onboarding/v1/plan', {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    signal: options.signal,
  });
  const body = await readJson<DataEnvelope<SavePlanIntentResult> & ErrorEnvelope>(response);
  if (!response.ok || !body?.data) {
    throw new OnboardingIntegrationRequestError(
      ownerMessage(body, 'Your plan choice could not be saved. Nothing was charged.'),
      {
        code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
        status: response.status,
      },
    );
  }
  return body.data;
};
