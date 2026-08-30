import type { AssetRepository } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/types';
import type {
  LocalImageReference,
  OnboardingLabState,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/types';
import type { OnboardingSiteMediaRole } from './contracts';

export type OnboardingMediaRole = OnboardingSiteMediaRole;

export type OnboardingMediaReference = {
  altText: string | null;
  assetId: string;
  fileName: string;
  localItemId: string;
  mimeType: string;
  order: number;
  role: OnboardingMediaRole;
};

export type ClaimedOnboardingMedia = OnboardingMediaReference & {
  height: number;
  serverMediaId: string;
  url: string;
  width: number;
};

export type MediaClaimFailureCode =
  | 'asset_missing'
  | 'invalid_response'
  | 'role_conflict'
  | 'storage_unavailable'
  | 'upload_failed';

export type MediaClaimFailure = {
  assetId: string;
  code: MediaClaimFailureCode;
  fileName: string;
  message: string;
  role: OnboardingMediaRole;
};

export type ClaimOnboardingMediaResult = {
  failures: MediaClaimFailure[];
  uploaded: ClaimedOnboardingMedia[];
  verifiedRevision: number;
};

type ClaimOnboardingMediaInput = {
  draftId: string;
  fetcher?: typeof fetch;
  idempotencyKey: string;
  repository: AssetRepository | null;
  signal?: AbortSignal;
  siteId: string;
  siteRevision: number;
  state: OnboardingLabState;
};

type UploadResponse = {
  data?: {
    media?: {
      height?: unknown;
      id?: unknown;
      url?: unknown;
      width?: unknown;
    };
  };
  error?: { message?: unknown };
};

type VerifyResponse = {
  data?: { revision?: unknown };
  error?: { message?: unknown };
};

const ownerMessageForRole = (role: OnboardingMediaRole): string => {
  switch (role) {
    case 'custom_design':
      return 'One Canva page could not be saved. Your local copy is still safe.';
    case 'gallery':
      return 'One Gallery photo could not be saved. Your local copy is still safe.';
    case 'logo':
      return 'Your logo could not be saved. Your local copy is still safe.';
    case 'profile':
      return 'Your profile photo could not be saved. Your local copy is still safe.';
  }
};

const asReference = (
  image: LocalImageReference | undefined,
  role: OnboardingMediaRole,
  order: number,
): OnboardingMediaReference | null => {
  if (!image?.storageId || image.source !== 'indexed_db') {
    return null;
  }
  return {
    altText: image.altText?.trim() || null,
    assetId: image.storageId,
    fileName: image.fileName,
    localItemId: image.id,
    mimeType: image.mimeType,
    order,
    role,
  };
};

export const collectOnboardingMediaReferences = (
  state: OnboardingLabState,
): OnboardingMediaReference[] => {
  const candidates = [
    asReference(state.profile.profilePhoto, 'profile', 0),
    asReference(state.profile.logo, 'logo', 0),
    ...state.gallery.images.map((image, order) =>
      asReference(image, 'gallery', order)),
    ...state.canva.images.map((image, order) =>
      asReference(image, 'custom_design', order)),
  ].filter((reference): reference is OnboardingMediaReference => reference !== null);

  const identityRoles = new Map<string, OnboardingMediaRole>();
  const unique = new Map<string, OnboardingMediaReference>();
  for (const reference of candidates) {
    const priorRole = identityRoles.get(reference.assetId);
    if (
      priorRole
      && priorRole !== reference.role
      && (priorRole === 'logo'
        || priorRole === 'profile'
        || reference.role === 'logo'
        || reference.role === 'profile')
    ) {
      throw new Error(
        `ONBOARDING_MEDIA_ROLE_CONFLICT:${reference.assetId}:${priorRole}:${reference.role}`,
      );
    }
    identityRoles.set(reference.assetId, reference.role);
    unique.set(
      `${reference.role}:${reference.assetId}:${reference.order}`,
      reference,
    );
  }
  return [...unique.values()];
};

/**
 * Once the server has verified the saved revision, remove only assets retained
 * in the onboarding cleanup ledger that are no longer referenced by the
 * recoverable local draft. Current profile, logo, Gallery, and Custom Design
 * assets stay available for the same-browser Change setup fallback.
 */
export const cleanupVerifiedUnreferencedOnboardingMedia = async (
  repository: AssetRepository | null,
  state: OnboardingLabState,
): Promise<{ failedAssetIds: string[]; removedAssetIds: string[] }> => {
  const referenced = new Set(
    collectOnboardingMediaReferences(state).map(reference => reference.assetId),
  );
  const candidates = [...new Set(state.canva.ownedAssetIds)]
    .filter(assetId => !referenced.has(assetId));
  if (!repository || candidates.length === 0) {
    return {
      failedAssetIds: repository ? [] : candidates,
      removedAssetIds: [],
    };
  }
  const failedAssetIds: string[] = [];
  const removedAssetIds: string[] = [];
  for (const assetId of candidates) {
    try {
      await repository.delete(assetId);
      removedAssetIds.push(assetId);
    } catch {
      failedAssetIds.push(assetId);
    }
  }
  return { failedAssetIds, removedAssetIds };
};

const responseMessage = (
  body: UploadResponse | VerifyResponse | null,
  fallback: string,
): string => {
  const message = body?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};

const uploadOne = async ({
  draftId,
  fetcher,
  idempotencyKey,
  reference,
  repository,
  signal,
  siteId,
  siteRevision,
}: {
  draftId: string;
  fetcher: typeof fetch;
  idempotencyKey: string;
  reference: OnboardingMediaReference;
  repository: AssetRepository;
  signal?: AbortSignal;
  siteId: string;
  siteRevision: number;
}): Promise<ClaimedOnboardingMedia> => {
  const [blob, metadata] = await Promise.all([
    repository.getOriginal(reference.assetId),
    repository.getMetadata(reference.assetId),
  ]);
  if (!blob || !metadata) {
    throw new Error('LOCAL_ASSET_MISSING');
  }

  const form = new FormData();
  form.set('draftId', draftId);
  form.set('file', blob, reference.fileName);
  form.set('fileName', reference.fileName);
  form.set('idempotencyKey', `${idempotencyKey}:${reference.localItemId}:${reference.role}:${reference.order}`);
  form.set('localItemId', reference.localItemId);
  form.set('mimeType', metadata.mimeType);
  form.set('order', String(reference.order));
  form.set('role', reference.role);
  form.set('siteId', siteId);
  form.set('siteRevision', String(siteRevision));
  if (reference.altText) {
    form.set('altText', reference.altText);
  }

  const response = await fetcher('/api/onboarding/v1/media', {
    body: form,
    method: 'POST',
    signal,
  });
  const body = await response.json().catch(() => null) as UploadResponse | null;
  if (!response.ok) {
    throw new Error(responseMessage(body, 'MEDIA_UPLOAD_FAILED'));
  }
  const media = body?.data?.media;
  if (
    typeof media?.id !== 'string'
    || typeof media.url !== 'string'
    || typeof media.width !== 'number'
    || typeof media.height !== 'number'
  ) {
    throw new TypeError('INVALID_MEDIA_RESPONSE');
  }
  return {
    ...reference,
    height: media.height,
    serverMediaId: media.id,
    url: media.url,
    width: media.width,
  };
};

export const claimOnboardingMedia = async ({
  draftId,
  fetcher = fetch,
  idempotencyKey,
  repository,
  signal,
  siteId,
  siteRevision,
  state,
}: ClaimOnboardingMediaInput): Promise<ClaimOnboardingMediaResult> => {
  let references: OnboardingMediaReference[];
  try {
    references = collectOnboardingMediaReferences(state);
  } catch {
    const fallbackReference: OnboardingMediaReference = {
      altText: null,
      assetId: 'role-conflict',
      fileName: 'Profile photo or logo',
      localItemId: 'role-conflict',
      mimeType: 'application/octet-stream',
      order: 0,
      role: 'profile',
    };
    return {
      failures: [{
        assetId: fallbackReference.assetId,
        code: 'role_conflict',
        fileName: fallbackReference.fileName,
        message: 'Your profile photo and logo must use separate images. Choose or replace one image, then try again.',
        role: fallbackReference.role,
      }],
      uploaded: [],
      verifiedRevision: siteRevision,
    };
  }

  if (!repository && references.length > 0) {
    return {
      failures: references.map(reference => ({
        assetId: reference.assetId,
        code: 'storage_unavailable' as const,
        fileName: reference.fileName,
        message: ownerMessageForRole(reference.role),
        role: reference.role,
      })),
      uploaded: [],
      verifiedRevision: siteRevision,
    };
  }

  const uploaded: ClaimedOnboardingMedia[] = [];
  const failures: MediaClaimFailure[] = [];
  for (const reference of references) {
    try {
      if (!repository) {
        throw new Error('LOCAL_STORAGE_UNAVAILABLE');
      }
      uploaded.push(await uploadOne({
        draftId,
        fetcher,
        idempotencyKey,
        reference,
        repository,
        signal,
        siteId,
        siteRevision,
      }));
    } catch (error) {
      failures.push({
        assetId: reference.assetId,
        code: error instanceof Error && error.message === 'LOCAL_ASSET_MISSING'
          ? 'asset_missing'
          : error instanceof Error && error.message === 'INVALID_MEDIA_RESPONSE'
            ? 'invalid_response'
            : 'upload_failed',
        fileName: reference.fileName,
        message: ownerMessageForRole(reference.role),
        role: reference.role,
      });
    }
  }

  const verifyResponse = await fetcher('/api/onboarding/v1/media/verify', {
    body: JSON.stringify({
      expected: uploaded.map(media => ({
        localItemId: media.localItemId,
        order: media.order,
        role: media.role,
        serverMediaId: media.serverMediaId,
      })),
      siteId,
      siteRevision,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  });
  const verifyBody = await verifyResponse.json().catch(() => null) as VerifyResponse | null;
  if (!verifyResponse.ok || typeof verifyBody?.data?.revision !== 'number') {
    throw new Error(responseMessage(verifyBody, 'MEDIA_VERIFICATION_FAILED'));
  }

  return {
    failures,
    uploaded,
    verifiedRevision: verifyBody.data.revision,
  };
};
