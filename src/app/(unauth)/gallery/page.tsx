'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

// =============================================================================
// Types
// =============================================================================

type GalleryPhoto = {
  id: string;
  appointmentId: string;
  photoType: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  createdAt: string;
  appointmentDate: string;
  services: string[];
  technicianName: string | null;
};

// =============================================================================
// Helper: Normalize phone number
// =============================================================================

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// =============================================================================
// Gallery Page Component
// =============================================================================

export default function GalleryPage() {
  const router = useRouter();
  const { salonSlug, salonName } = useSalon();

  const [mounted, setMounted] = useState(false);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [clientPhone, setClientPhone] = useState('');

  // Load client phone from cookie and fetch photos
  useEffect(() => {
    setMounted(true);

    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));

    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) {
        setClientPhone(phone);
      }
    }
  }, []);

  // Fetch photos when we have phone and salon
  const fetchPhotos = useCallback(async () => {
    if (!clientPhone || !salonSlug) {
      setLoading(false);
      return;
    }

    try {
      const normalizedPhone = normalizePhone(clientPhone);
      const response = await fetch(
        `/api/gallery?phone=${normalizedPhone}&salonSlug=${salonSlug}`,
      );

      if (response.ok) {
        const data = await response.json();
        setPhotos(data.data?.photos || []);
      }
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
    } finally {
      setLoading(false);
    }
  }, [clientPhone, salonSlug]);

  useEffect(() => {
    if (clientPhone && salonSlug) {
      fetchPhotos();
    }
  }, [clientPhone, salonSlug, fetchPhotos]);

  const handleBack = () => {
    router.back();
  };

  // Calculate stats from real photos
  const totalVisits = new Set(photos.map(p => p.appointmentId)).size;

  const techCounts = photos.reduce((acc, photo) => {
    if (photo.technicianName) {
      acc[photo.technicianName] = (acc[photo.technicianName] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
  const favoriteTech = Object.entries(techCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const serviceCounts = photos.reduce((acc, photo) => {
    photo.services.forEach(service => {
      acc[service] = (acc[service] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);
  const favoriteService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

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
            My Nail Gallery
          </h1>
          <p className="mt-1 text-base italic text-neutral-500">
            Your nail journey
          </p>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div
              className="size-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
            />
            <p className="mt-4 text-neutral-500">Loading your nail journey...</p>
          </div>
        )}

        {/* Content when not loading */}
        {!loading && (
          <>
            {/* Stats Summary Card - only show when there are photos */}
            {photos.length > 0 && (
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
                      <div className="mt-0.5 text-xs text-white/70">Total Visits</div>
                    </div>
                    <div className="h-12 w-px bg-white/20" />
                    <div className="flex-1 px-2 text-center">
                      <div className="truncate text-lg font-bold" style={{ color: themeVars.primary }}>{favoriteTech}</div>
                      <div className="mt-0.5 text-xs text-white/70">Favorite Tech</div>
                    </div>
                    <div className="h-12 w-px bg-white/20" />
                    <div className="flex-1 px-1 text-center">
                      <div className="truncate text-sm font-bold text-white">{favoriteService}</div>
                      <div className="mt-0.5 text-xs text-white/70">Favorite Service</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Photo Grid */}
            {photos.length > 0 && (
              <div className="space-y-4">
                {photos.map((photo, index) => (
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
                        alt={photo.services.join(', ') || 'Nail photo'}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {/* Photo type badge */}
                      {photo.photoType === 'before' && (
                        <div className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-xs font-medium shadow-lg backdrop-blur-sm">
                          Before
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
                            {photo.services.join(', ') || 'Nail Service'}
                          </div>
                          {photo.technicianName && (
                            <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-600">
                              <span style={{ color: themeVars.accent }}>✦</span>
                              <span>
                                Tech:
                                {' '}
                                {photo.technicianName}
                              </span>
                            </div>
                          )}
                          {photo.caption && (
                            <div className="mt-1 text-sm italic text-neutral-500">
                              {photo.caption}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-neutral-700">
                            {formatDate(photo.appointmentDate)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {photos.length === 0 && (
              <div
                className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: themeVars.cardBorder,
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                  transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
                }}
              >
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="mb-4 text-6xl">📸</div>
                  <h2
                    className="mb-2 text-xl font-bold"
                    style={{ color: themeVars.titleText }}
                  >
                    Your Nail Journey Starts Here
                  </h2>
                  <p className="mb-6 max-w-xs text-neutral-500">
                    Photos from your appointments will appear here after your visits. Each session adds to your beautiful nail collection!
                  </p>

                  {/* Placeholder images */}
                  <div className="grid w-full grid-cols-3 gap-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="relative aspect-square overflow-hidden rounded-xl"
                        style={{
                          background: `linear-gradient(to bottom right, ${themeVars.background}, color-mix(in srgb, ${themeVars.primaryDark} 20%, white))`,
                        }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-2xl opacity-30">💅</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-xs text-neutral-400">
                    These placeholders will be replaced with your real nail photos
                  </p>

                  <button
                    type="button"
                    onClick={() => router.push('/book/service')}
                    className="mt-6 rounded-full px-6 py-3 font-bold text-neutral-900 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                    }}
                  >
                    Book Your First Appointment
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Photo Detail Modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedPhoto(null)}
          onKeyDown={(e) => e.key === 'Escape' && setSelectedPhoto(null)}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <Image
              src={selectedPhoto.imageUrl}
              alt={selectedPhoto.services.join(', ') || 'Nail photo'}
              width={800}
              height={600}
              className="rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute -right-2 -top-2 flex size-10 items-center justify-center rounded-full bg-white shadow-lg"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
