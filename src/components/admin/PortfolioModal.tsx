'use client';

import { AlertTriangle, Check, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
      if (!salonSlug) {
        return;
      }

      setBusy(true);

      try {
        await fetch(
          `/api/admin/portfolio/${encodeURIComponent(photoId)}?salonSlug=${encodeURIComponent(salonSlug)}`,
          { method: 'DELETE' },
        );
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, salonSlug],
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
                              aria-label="Delete photo"
                              disabled={busy}
                              onClick={() => void removePhoto(photo.id)}
                              className="p-1 text-gray-400 disabled:opacity-40"
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
    </div>
  );
}
