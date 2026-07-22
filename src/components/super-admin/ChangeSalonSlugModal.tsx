'use client';

import { AlertTriangle, Globe2, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import { isValidSalonSlug, normalizeSalonSlug } from '@/libs/tenantSlug';

export type SalonSlugUpdateResult = {
  salon: {
    id: string;
    name: string;
    slug: string;
    customDomain: string | null;
    slugLockedAt: string | null;
    updatedAt: string;
  };
  canonicalUrls: {
    publicUrl: string;
    bookingUrl: string;
    findBookingUrl: string;
  };
};

type ChangeSalonSlugModalProps = {
  isOpen: boolean;
  salonId: string;
  salonName: string;
  currentSlug: string;
  canonicalPublicUrl: string | null;
  hasCustomDomain: boolean;
  onClose: () => void;
  onSuccess: (result: SalonSlugUpdateResult) => void | Promise<void>;
  onConflict?: (result: SalonSlugUpdateResult) => void;
};

type WebsiteAddressPreview = {
  kind: 'path' | 'subdomain' | 'custom-domain' | 'unknown';
  url: string | null;
};

/**
 * Preview the canonical URL after a slug change without duplicating the
 * server's deployment-specific URL rules. A custom domain deliberately stays
 * unchanged because it is independent from the salon slug.
 */
function getWebsiteAddressPreview(
  canonicalPublicUrl: string | null,
  currentSlug: string,
  nextSlug: string,
  hasCustomDomain: boolean,
): WebsiteAddressPreview {
  if (!canonicalPublicUrl) {
    return { kind: 'unknown', url: null };
  }

  const normalizedCurrentSlug = normalizeSalonSlug(currentSlug);
  const normalizedNextSlug = normalizeSalonSlug(nextSlug);
  if (!normalizedCurrentSlug || !normalizedNextSlug) {
    return { kind: 'unknown', url: canonicalPublicUrl };
  }

  if (hasCustomDomain) {
    return { kind: 'custom-domain', url: canonicalPublicUrl };
  }

  try {
    const url = new URL(canonicalPublicUrl);
    const pathParts = url.pathname.split('/');
    const slugIndex = pathParts.findIndex((part) => {
      try {
        return decodeURIComponent(part).toLowerCase() === normalizedCurrentSlug;
      } catch {
        return false;
      }
    });

    if (slugIndex >= 0) {
      pathParts[slugIndex] = normalizedNextSlug;
      url.pathname = pathParts.join('/');
      return { kind: 'path', url: url.toString() };
    }

    const hostnameParts = url.hostname.split('.');
    if (
      hostnameParts.length > 1
      && hostnameParts[0]?.toLowerCase() === normalizedCurrentSlug
    ) {
      hostnameParts[0] = normalizedNextSlug;
      url.hostname = hostnameParts.join('.');
      return { kind: 'subdomain', url: url.toString() };
    }

    return { kind: 'custom-domain', url: url.toString() };
  } catch {
    return { kind: 'unknown', url: canonicalPublicUrl };
  }
}

function getResponseError(payload: unknown): string {
  const candidate = payload as { error?: unknown } | null;
  if (typeof candidate?.error === 'string' && candidate.error.trim()) {
    return candidate.error;
  }
  if (
    candidate?.error
    && typeof candidate.error === 'object'
    && 'message' in candidate.error
    && typeof candidate.error.message === 'string'
    && candidate.error.message.trim()
  ) {
    return candidate.error.message;
  }
  return 'The website address could not be changed.';
}

function isSalonSlugUpdateResult(payload: unknown): payload is SalonSlugUpdateResult {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<SalonSlugUpdateResult>;
  return Boolean(
    candidate.salon
    && typeof candidate.salon.id === 'string'
    && typeof candidate.salon.name === 'string'
    && typeof candidate.salon.slug === 'string'
    && (candidate.salon.customDomain === null || typeof candidate.salon.customDomain === 'string')
    && (candidate.salon.slugLockedAt === null || typeof candidate.salon.slugLockedAt === 'string')
    && typeof candidate.salon.updatedAt === 'string'
    && candidate.canonicalUrls
    && typeof candidate.canonicalUrls.publicUrl === 'string'
    && typeof candidate.canonicalUrls.bookingUrl === 'string'
    && typeof candidate.canonicalUrls.findBookingUrl === 'string',
  );
}

export function ChangeSalonSlugModal({
  isOpen,
  salonId,
  salonName,
  currentSlug,
  canonicalPublicUrl,
  hasCustomDomain,
  onClose,
  onSuccess,
  onConflict,
}: ChangeSalonSlugModalProps) {
  const [slugInput, setSlugInput] = useState(currentSlug);
  const [currentSlugSnapshot, setCurrentSlugSnapshot] = useState(currentSlug);
  const [canonicalUrlSnapshot, setCanonicalUrlSnapshot] = useState(canonicalPublicUrl);
  const [acknowledged, setAcknowledged] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const justOpened = isOpen && !wasOpen.current;
    wasOpen.current = isOpen;

    if (!justOpened) {
      return;
    }

    setSlugInput(currentSlug);
    setCurrentSlugSnapshot(currentSlug);
    setCanonicalUrlSnapshot(canonicalPublicUrl);
    setAcknowledged(false);
    setHasInteracted(false);
    setSaving(false);
    setError(null);
  }, [canonicalPublicUrl, currentSlug, isOpen]);

  const normalizedSlug = normalizeSalonSlug(slugInput) ?? '';
  const normalizedCurrentSlug = normalizeSalonSlug(currentSlugSnapshot) ?? '';
  const isDifferentSlug = normalizedSlug !== normalizedCurrentSlug;
  const isValidSlug = isValidSalonSlug(normalizedSlug);
  const canSubmit = isDifferentSlug && isValidSlug && acknowledged && !saving;

  const preview = useMemo(
    () => getWebsiteAddressPreview(
      canonicalUrlSnapshot,
      currentSlugSnapshot,
      normalizedSlug,
      hasCustomDomain,
    ),
    [canonicalUrlSnapshot, currentSlugSnapshot, hasCustomDomain, normalizedSlug],
  );

  let validationMessage: string | null = null;
  if (!normalizedSlug) {
    validationMessage = 'Enter a website address.';
  } else if (!isDifferentSlug) {
    validationMessage = 'Enter a different address to continue.';
  } else if (!isValidSlug) {
    validationMessage = 'Use letters, numbers, and hyphens only. The address cannot begin or end with a hyphen or use a reserved Luster name.';
  }

  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasInteracted(true);

    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/slug`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: normalizedSlug,
          expectedCurrentSlug: normalizedCurrentSlug,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409 && isSalonSlugUpdateResult(payload)) {
          setCurrentSlugSnapshot(payload.salon.slug);
          setCanonicalUrlSnapshot(payload.canonicalUrls.publicUrl);
          setAcknowledged(false);
          setError(`The current address changed to "${payload.salon.slug}" since this dialog opened. Review the new URL and confirm again.`);
          onConflict?.(payload);
          return;
        }

        throw new Error(getResponseError(payload));
      }

      if (!isSalonSlugUpdateResult(payload)) {
        throw new Error('The server returned an invalid website address response.');
      }

      await onSuccess(payload);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The website address could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={handleClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-lg"
      contentClassName="overflow-hidden rounded-2xl bg-white shadow-2xl"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-salon-slug-title"
        aria-describedby="change-salon-slug-description"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50">
              <Globe2 className="size-5 text-indigo-700" />
            </div>
            <div>
              <h2 id="change-salon-slug-title" className="text-lg font-semibold text-gray-900">
                Change website address
              </h2>
              <p id="change-salon-slug-description" className="text-sm text-gray-500">
                {salonName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            aria-label="Close change website address dialog"
            className="-m-2 rounded-lg p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="salon-website-slug" className="mb-1 block text-sm font-medium text-gray-700">
              Website address
            </label>
            <input
              autoFocus
              id="salon-website-slug"
              type="text"
              value={slugInput}
              onChange={(event) => {
                setSlugInput(event.target.value.toLowerCase());
                setHasInteracted(true);
                setAcknowledged(false);
                setError(null);
              }}
              onBlur={() => setSlugInput(value => value.trim())}
              aria-invalid={hasInteracted && Boolean(validationMessage)}
              aria-describedby="salon-website-slug-help"
              disabled={saving}
              maxLength={47}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
            />
            <p
              id="salon-website-slug-help"
              className={`mt-1 text-xs ${hasInteracted && validationMessage ? 'text-red-600' : 'text-gray-500'}`}
            >
              {hasInteracted && validationMessage
                ? validationMessage
                : 'Use 1–47 lowercase letters, numbers, or hyphens. Leading and trailing spaces are removed.'}
            </p>
          </div>

          {isDifferentSlug && isValidSlug && preview.url && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {preview.kind === 'custom-domain' ? 'Public domain stays the same' : 'New public URL'}
              </div>
              <div className="mt-1 break-all text-sm font-medium text-indigo-700">
                {preview.url}
              </div>
              {preview.kind === 'custom-domain' && (
                <p className="mt-1 text-xs text-gray-500">
                  This salon uses a custom domain. Its domain will not change; only its internal salon slug will be updated.
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <div className="text-sm font-semibold text-amber-900">Links using the old address will stop working</div>
                <p className="mt-1 text-sm leading-5 text-amber-800">
                  Website and booking links containing the old slug will no longer open this salon. Any impersonation session using it will become invalid and must be restarted.
                </p>
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={event => setAcknowledged(event.target.checked)}
              disabled={saving || !isDifferentSlug || !isValidSlug}
              className="mt-0.5 size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
            <span>I understand that links using the old address will stop working and I have confirmed the new address.</span>
          </label>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {saving ? 'Changing…' : 'Change address'}
            </button>
          </div>
        </form>
      </div>
    </DialogShell>
  );
}
