'use client';

import { AlertTriangle, Check, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  ASSIGNABLE_DISCOVER_NAIL_LENGTHS,
  ASSIGNABLE_DISCOVER_SERVICE_FAMILIES,
  type DiscoverNailLength,
  discoverNailLengthLabel,
  type DiscoverServiceFamily,
  discoverServiceFamilyLabel,
} from '@/libs/discoverTaxonomy';
import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';

type PortfolioModalProps = {
  onClose: () => void;
};

type PortfolioPhoto = {
  id: string;
  publicId: string;
  imageUrl: string;
  width: number;
  height: number;
  ownerVisible: boolean;
  discoverIncluded: boolean;
  serviceFamily: DiscoverServiceFamily;
  nailLength: DiscoverNailLength;
  altText: string | null;
  crop: { x: number; y: number; width: number; height: number } | null;
  eligibility: {
    planEligible: boolean;
    profileEligible: boolean;
    discoverEligible: boolean;
    retainedOverAllowance: boolean;
    discoverCropReady: boolean;
    discoverMetadataComplete: boolean;
  } | null;
};

type Usage = {
  stored: number;
  max: number;
  remaining: number;
  overAllowance: boolean;
  plan: string;
  source: 'plan' | 'override';
};

type Readiness = {
  discoverEligiblePhotos: number;
  retainedOverAllowance: number;
  missingCrop: number;
  missingServiceFamily: number;
  missingNailLength: number;
  unbookableFamily: number;
};

type PortfolioResponse = {
  usage: Usage;
  readiness: Readiness;
  bookableFamilies: DiscoverServiceFamily[];
  photos: PortfolioPhoto[];
  error?: { message?: string };
};

const UNLIMITED = -1;

function usageLabel(usage: Usage): string {
  if (usage.max === UNLIMITED) {
    return `${usage.stored} portfolio photos used`;
  }

  return `${usage.stored} of ${usage.max} portfolio photos used`;
}

export function PortfolioModal({ onClose }: PortfolioModalProps) {
  const { salonSlug } = useSalon();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [photoPendingDeletion, setPhotoPendingDeletion] = useState<PortfolioPhoto | null>(null);
  const photoDeleteInFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `/api/admin/portfolio?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = (await response.json()) as PortfolioResponse;

      if (!response.ok) {
        setError(payload.error?.message ?? 'Could not load your portfolio.');
        return;
      }

      setData(payload);
      setError(null);
    } catch {
      setError('Could not load your portfolio.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSelected = useCallback((photoId: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }

      return next;
    });
  }, []);

  const applyBatch = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!salonSlug || selected.size === 0) {
        return;
      }

      setBusy(true);

      try {
        const response = await fetch('/api/admin/portfolio', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug, photoIds: [...selected], patch }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as PortfolioResponse;

          setError(payload.error?.message ?? 'Could not update those photos.');
          return;
        }

        setSelected(new Set());
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, salonSlug, selected],
  );

  const removePhoto = useCallback(
    async (photoId: string) => {
      if (!salonSlug || photoDeleteInFlightRef.current) {
        return;
      }

      photoDeleteInFlightRef.current = true;
      setBusy(true);

      try {
        await fetch(
          `/api/admin/portfolio/${encodeURIComponent(photoId)}?salonSlug=${encodeURIComponent(salonSlug)}`,
          { method: 'DELETE' },
        );
        await load();
        setPhotoPendingDeletion(null);
      } finally {
        photoDeleteInFlightRef.current = false;
        setBusy(false);
      }
    },
    [load, salonSlug],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);

  /**
   * Presign → upload to Cloudinary → finalize.
   *
   * The browser never picks the public id and never talks to our database:
   * it receives a signed, app-scoped target, and the server re-derives every
   * fact about the file from Cloudinary's own decoded metadata at finalize.
   * Publication rights are confirmed before the upload is authorized, and the
   * durable record is written with the row.
   */
  const uploadFiles = useCallback(
    async (files: FileList) => {
      if (!salonSlug || !rightsConfirmed) {
        return;
      }

      setUploading(true);
      setError(null);

      try {
        for (const file of Array.from(files)) {
          const presignResponse = await fetch('/api/admin/portfolio/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              salonSlug,
              contentType: file.type,
              fileSize: file.size,
              publicationRightsConfirmed: true,
            }),
          });

          const presign = (await presignResponse.json()) as {
            upload?: Record<string, string | number | boolean>;
            error?: { message?: string };
          };

          if (!presignResponse.ok || !presign.upload) {
            setError(presign.error?.message ?? 'That photo could not be uploaded.');
            break;
          }

          const upload = presign.upload;
          const form = new FormData();

          form.append('file', file);
          form.append('api_key', String(upload.apiKey));
          form.append('timestamp', String(upload.timestamp));
          form.append('signature', String(upload.signature));
          form.append('upload_preset', String(upload.uploadPreset));
          form.append('public_id', String(upload.publicId));
          form.append('overwrite', 'false');
          form.append('type', 'upload');
          form.append('tags', String(upload.tags));
          form.append('context', String(upload.context));

          const cloudinaryResponse = await fetch(String(upload.uploadUrl), {
            method: 'POST',
            body: form,
          });

          if (!cloudinaryResponse.ok) {
            setError('That photo could not be uploaded.');
            break;
          }

          const asset = (await cloudinaryResponse.json()) as { asset_id?: string };

          const finalizeResponse = await fetch('/api/admin/portfolio/upload', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              salonSlug,
              assetId: asset.asset_id,
              publicId: upload.publicId,
              finalizeToken: upload.finalizeToken,
              timestamp: upload.timestamp,
              publicationRightsConfirmed: true,
            }),
          });

          if (!finalizeResponse.ok) {
            const payload = (await finalizeResponse.json()) as { error?: { message?: string } };

            setError(payload.error?.message ?? 'That photo could not be saved.');
            break;
          }
        }

        await load();
      } finally {
        setUploading(false);

        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [load, rightsConfirmed, salonSlug],
  );

  const atLimit = useMemo(
    () => Boolean(data && data.usage.max !== UNLIMITED && data.usage.remaining <= 0),
    [data],
  );

  return (
    <div className="flex h-full flex-col bg-[#F2F2F7]">
      <ModalHeader
        title="Portfolio"
        subtitle={data ? usageLabel(data.usage) : undefined}
        leftAction={<BackButton onClick={onClose} />}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span className="ml-2 text-[15px]">Loading your portfolio…</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-800"
          >
            {error}
          </div>
        )}

        {data && !loading && (
          <>
            {data.usage.overAllowance && (
              <div
                role="status"
                className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
                <div className="text-[15px] text-amber-900">
                  <p className="font-medium">
                    You have more photos than your current plan allows.
                  </p>
                  <p className="mt-1 text-[13px]">
                    Nothing has been deleted. The first
                    {' '}
                    {data.usage.max}
                    {' '}
                    photos in your order stay active — drag to choose which ones,
                    or upgrade to make them all active again.
                  </p>
                </div>
              </div>
            )}

            {atLimit && !data.usage.overAllowance && (
              <div
                role="status"
                className="mb-4 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-gray-700"
              >
                You&rsquo;ve used all
                {' '}
                {data.usage.max}
                {' '}
                portfolio photos on your current plan. Upgrade to add more of your work.
              </div>
            )}

            <section className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-gray-500">
                Add photos
              </h3>

              <label className="mt-3 flex items-start gap-3 text-[15px] text-gray-800">
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={event => setRightsConfirmed(event.target.checked)}
                  className="mt-1 size-4"
                />
                <span>
                  I confirm I have permission to publicly display this image.
                </span>
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    void uploadFiles(event.target.files);
                  }
                }}
              />

              <button
                type="button"
                disabled={!rightsConfirmed || uploading || atLimit}
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-[15px] text-white disabled:opacity-40"
              >
                {uploading
                  ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  : <ImagePlus className="size-4" aria-hidden="true" />}
                {uploading ? 'Uploading…' : 'Choose photos'}
              </button>

              {!rightsConfirmed && (
                <p className="mt-2 text-[13px] text-gray-500">
                  Confirm the permission above to add photos.
                </p>
              )}
            </section>

            <section className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-gray-500">
                Discover readiness
              </h3>
              <p className="mt-2 text-[15px] text-gray-900">
                {data.readiness.discoverEligiblePhotos}
                {' '}
                {data.readiness.discoverEligiblePhotos === 1 ? 'photo is' : 'photos are'}
                {' '}
                ready for Discover.
              </p>
              <ul className="mt-2 space-y-1 text-[13px] text-gray-600">
                {data.readiness.missingServiceFamily > 0 && (
                  <li>
                    {data.readiness.missingServiceFamily}
                    {' '}
                    still need a service tag.
                  </li>
                )}
                {data.readiness.missingNailLength > 0 && (
                  <li>
                    {data.readiness.missingNailLength}
                    {' '}
                    still need a length tag.
                  </li>
                )}
                {data.readiness.missingCrop > 0 && (
                  <li>
                    {data.readiness.missingCrop}
                    {' '}
                    still need a crop.
                  </li>
                )}
                {data.readiness.unbookableFamily > 0 && (
                  <li>
                    {data.readiness.unbookableFamily}
                    {' '}
                    are tagged for a service you no longer offer.
                  </li>
                )}
              </ul>
            </section>

            {selected.size > 0 && (
              <section
                aria-label="Batch tagging"
                className="mb-4 rounded-2xl border border-gray-200 bg-white p-4"
              >
                <p className="text-[15px] font-medium text-gray-900">
                  {selected.size}
                  {' '}
                  selected
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {ASSIGNABLE_DISCOVER_SERVICE_FAMILIES.map(family => (
                    <button
                      key={family}
                      type="button"
                      disabled={busy || !data.bookableFamilies.includes(family)}
                      onClick={() => void applyBatch({ serviceFamily: family })}
                      className="rounded-full border border-gray-300 px-3 py-1.5 text-[13px] disabled:opacity-40"
                    >
                      {discoverServiceFamilyLabel(family)}
                    </button>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {ASSIGNABLE_DISCOVER_NAIL_LENGTHS.map(length => (
                    <button
                      key={length}
                      type="button"
                      disabled={busy}
                      onClick={() => void applyBatch({ nailLength: length })}
                      className="rounded-full border border-gray-300 px-3 py-1.5 text-[13px] disabled:opacity-40"
                    >
                      {discoverNailLengthLabel(length)}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void applyBatch({ discoverIncluded: true })}
                    className="rounded-full bg-gray-900 px-3 py-1.5 text-[13px] text-white disabled:opacity-40"
                  >
                    Show in Discover
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void applyBatch({ discoverIncluded: false })}
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-[13px] disabled:opacity-40"
                  >
                    Hide from Discover
                  </button>
                </div>
              </section>
            )}

            {data.photos.length === 0
              ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
                    <ImagePlus className="mx-auto size-8 text-gray-400" aria-hidden="true" />
                    <p className="mt-3 text-[17px] font-medium text-gray-900">
                      Add your first photos
                    </p>
                    <p className="mt-1 text-[15px] text-gray-600">
                      Upload your best nail work once, and it powers your profile
                      and Luster Discover.
                    </p>
                  </div>
                )
              : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {data.photos.map((photo) => {
                      const isSelected = selected.has(photo.id);

                      return (
                        <li key={photo.id} className="relative">
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            aria-label={photo.altText ?? 'Portfolio photo'}
                            onClick={() => toggleSelected(photo.id)}
                            className={`
                              block w-full overflow-hidden rounded-2xl border-2 bg-white
                              ${isSelected ? 'border-gray-900' : 'border-transparent'}
                            `}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only
                                grid of already-optimized Cloudinary variants; next/image adds a
                                second optimization hop for no gain on this surface. */}
                            <img
                              src={photo.imageUrl}
                              alt={photo.altText ?? ''}
                              width={photo.width}
                              height={photo.height}
                              loading="lazy"
                              className="aspect-[4/5] w-full object-cover"
                            />
                          </button>

                          {isSelected && (
                            <span className="absolute left-2 top-2 rounded-full bg-gray-900 p-1 text-white">
                              <Check className="size-3" aria-hidden="true" />
                            </span>
                          )}

                          {photo.eligibility?.retainedOverAllowance && (
                            <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white">
                              Over plan
                            </span>
                          )}

                          <div className="mt-1 flex items-center justify-between px-1">
                            <span className="text-[12px] text-gray-600">
                              {discoverServiceFamilyLabel(photo.serviceFamily)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Delete ${photo.altText || 'portfolio photo'}`}
                              disabled={busy}
                              onClick={() => setPhotoPendingDeletion(photo)}
                              className="flex size-11 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-40"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
          </>
        )}
      </div>
      <ConfirmDialog
        isOpen={photoPendingDeletion !== null}
        title="Delete this portfolio photo?"
        description={photoPendingDeletion?.altText
          ? `“${photoPendingDeletion.altText}” will be permanently removed.`
          : 'This portfolio photo will be permanently removed.'}
        confirmLabel="Delete photo"
        tone="danger"
        busy={busy}
        onClose={() => setPhotoPendingDeletion(null)}
        onConfirm={() => {
          if (photoPendingDeletion) {
            void removePhoto(photoPendingDeletion.id);
          }
        }}
      />
    </div>
  );
}
