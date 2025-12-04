'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type GalleryPhoto = {
  id: string;
  date: string;
  service: string;
  tech: string;
  imageUrl: string;
  isFavorite?: boolean;
};

const RECENT_PHOTOS: GalleryPhoto[] = [
  {
    id: '1',
    date: 'Dec 18, 2025',
    service: 'BIAB Short',
    tech: 'Daniela',
    imageUrl: '/assets/images/biab-short.webp',
    isFavorite: true,
  },
  {
    id: '2',
    date: 'Dec 5, 2025',
    service: 'Gel-X Extensions',
    tech: 'Tiffany',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
  },
  {
    id: '3',
    date: 'Nov 28, 2025',
    service: 'BIAB Medium',
    tech: 'Jenny',
    imageUrl: '/assets/images/biab-medium.webp',
    isFavorite: true,
  },
  {
    id: '4',
    date: 'Nov 15, 2025',
    service: 'BIAB French',
    tech: 'Daniela',
    imageUrl: '/assets/images/biab-french.jpg',
  },
  {
    id: '5',
    date: 'Nov 2, 2025',
    service: 'Gel Manicure',
    tech: 'Tiffany',
    imageUrl: '/assets/images/biab-short.webp',
  },
  {
    id: '6',
    date: 'Oct 20, 2025',
    service: 'BIAB Short',
    tech: 'Jenny',
    imageUrl: '/assets/images/biab-medium.webp',
  },
  {
    id: '7',
    date: 'Oct 8, 2025',
    service: 'Gel-X Extensions',
    tech: 'Daniela',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
  },
  {
    id: '8',
    date: 'Sep 25, 2025',
    service: 'BIAB Medium',
    tech: 'Tiffany',
    imageUrl: '/assets/images/biab-french.jpg',
  },
  {
    id: '9',
    date: 'Sep 12, 2025',
    service: 'Classic Mani/Pedi',
    tech: 'Jenny',
    imageUrl: '/assets/images/biab-short.webp',
  },
];

export default function GalleryPage() {
  const router = useRouter();
  const { salonName } = useSalon();
  const t = useTranslations('Gallery');
  const [mounted, setMounted] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  // Calculate stats
  const totalVisits = RECENT_PHOTOS.length;
  const techCounts = RECENT_PHOTOS.reduce((acc, photo) => {
    acc[photo.tech] = (acc[photo.tech] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const favoriteTech = Object.entries(techCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const serviceCounts = RECENT_PHOTOS.reduce((acc, photo) => {
    acc[photo.service] = (acc[photo.service] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const favoriteService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="relative flex items-center pb-2 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div
          className="pb-6 pt-4 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition:
              'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: themeVars.titleText }}
          >
            {t('title')}
          </h1>
          <p className="mt-1 text-base italic text-neutral-500">
            {t('subtitle')}
          </p>
        </div>

        {/* Stats Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? 'translateY(0) scale(1)'
              : 'translateY(10px) scale(0.97)',
            transition:
              'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white">{totalVisits}</div>
                <div className="mt-0.5 text-xs text-white/70">{t('total_visits')}</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 px-2 text-center">
                <div className="truncate text-lg font-bold" style={{ color: themeVars.primary }}>{favoriteTech}</div>
                <div className="mt-0.5 text-xs text-white/70">{t('favorite_tech')}</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 px-1 text-center">
                <div className="truncate text-sm font-bold text-white">{favoriteService}</div>
                <div className="mt-0.5 text-xs text-white/70">{t('favorite_service')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Button */}
        <button
          type="button"
          onClick={handleUpload}
          className="mb-6 flex w-full items-center justify-center gap-3 rounded-full px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
          style={{
            background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition:
              'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
          }}
        >
          <span className="text-xl">📸</span>
          {t('upload_new')}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Upload photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              // Handle file upload
            }
          }}
        />

        {/* Photo Grid */}
        <div className="space-y-4">
          {RECENT_PHOTOS.map((photo, index) => (
            <div
              key={photo.id}
              className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
              style={{
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: themeVars.cardBorder,
                opacity: mounted ? 1 : 0,
                transform: mounted
                  ? 'translateY(0) scale(1)'
                  : 'translateY(15px) scale(0.98)',
                transition: `opacity 300ms ease-out ${250 + index * 40}ms, transform 300ms ease-out ${250 + index * 40}ms`,
              }}
            >
              {/* Image */}
              <button
                type="button"
                className="group relative aspect-[4/3] w-full cursor-pointer"
                onClick={() => setSelectedPhoto(photo)}
                style={{
                  background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                }}
              >
                <Image
                  src={photo.imageUrl}
                  alt={photo.service}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {/* Favorite badge */}
                {photo.isFavorite && (
                  <div className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur-sm">
                    <span className="text-red-500">❤️</span>
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              </button>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-bold text-neutral-900">
                      {photo.service}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-600">
                      <span style={{ color: themeVars.accent }}>✦</span>
                      <span>
                        {t('tech')}
                        :
                        {' '}
                        {photo.tech}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-neutral-700">
                      {photo.date}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Load More */}
        <button
          type="button"
          className="mt-6 w-full py-3 text-base font-bold transition-colors"
          style={{
            color: themeVars.accent,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 600ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.8';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          {t('view_all_photos')}
        </button>

        {/* Empty State (hidden when there are photos) */}
        {RECENT_PHOTOS.length === 0 && (
          <div
            className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: themeVars.cardBorder,
            }}
          >
            <div className="px-6 py-16 text-center">
              <div
                className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full"
                style={{
                  background: `linear-gradient(to bottom right, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}))`,
                }}
              >
                <span className="text-4xl">📷</span>
              </div>
              <p className="text-lg font-semibold text-neutral-700">
                {t('empty_state')}
              </p>
              <p className="mb-6 mt-1 text-sm text-neutral-500">
                {t('empty_description')}
              </p>
              <button
                type="button"
                onClick={handleUpload}
                className="rounded-full px-6 py-3 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{ backgroundColor: themeVars.primary }}
              >
                {t('upload_new')}
              </button>
            </div>
          </div>
        )}

        {/* Photo Modal */}
        {selectedPhoto && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Photo detail"
          >
            {/* Backdrop button for closing */}
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              onClick={() => setSelectedPhoto(null)}
              onKeyDown={e => e.key === 'Escape' && setSelectedPhoto(null)}
              aria-label="Close modal"
              tabIndex={-1}
            />
            <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
              <button
                type="button"
                onClick={() => setSelectedPhoto(null)}
                aria-label="Close modal"
                className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur-sm transition-colors hover:bg-white"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M18 6L6 18M6 6L18 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div
                className="relative aspect-square"
                style={{
                  background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                }}
              >
                <Image
                  src={selectedPhoto.imageUrl}
                  alt={selectedPhoto.service}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold text-neutral-900">
                      {selectedPhoto.service}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-base text-neutral-600">
                      <span style={{ color: themeVars.accent }}>✦</span>
                      <span>
                        Nail Artist:
                        {selectedPhoto.tech}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-neutral-700">
                      {selectedPhoto.date}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    className="flex-1 rounded-full px-4 py-3 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                    }}
                  >
                    Book Same Style
                  </button>
                  <button
                    type="button"
                    className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-xl transition-colors hover:bg-neutral-200"
                  >
                    {selectedPhoto.isFavorite ? '❤️' : '🤍'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
