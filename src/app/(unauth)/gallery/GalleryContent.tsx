'use client';

import type { Easing } from 'framer-motion';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  ChevronRight,
  Heart,
  ImageIcon,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';

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

// Simple web haptic helper
const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

// =============================================================================
// Helper: Normalize phone number
// =============================================================================

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// --- Animation Variants ---
const meshVariant = {
  animate: {
    scale: [1, 1.1, 0.9, 1],
    x: [0, 20, -20, 0],
    y: [0, -20, 20, 0],
    rotate: [0, 10, -10, 0],
    transition: {
      duration: 15,
      repeat: Infinity,
      ease: 'easeInOut' as Easing,
    },
  },
};

// --- Subcomponents ---

/**
 * Stats Card with animated mesh background
 */
const StatsCard = ({
  totalVisits,
  favoriteTech,
  favoriteService,
  photoCount,
}: {
  totalVisits: number;
  favoriteTech: string;
  favoriteService: string;
  photoCount: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="relative w-full overflow-hidden bg-[var(--n5-bg-card)]"
    style={{
      borderRadius: n5.radiusCard,
      boxShadow: n5.shadowLg,
    }}
  >
    {/* Animated Mesh Background */}
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: n5.radiusCard }}>
      <motion.div
        variants={meshVariant}
        animate="animate"
        className="absolute -top-1/2 left-[-20%] h-full w-4/5 rounded-full bg-[var(--n5-accent-soft)] opacity-50 blur-[80px]"
      />
      <motion.div
        variants={meshVariant}
        animate="animate"
        transition={{ delay: 2, duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-[-20%] right-[-10%] h-4/5 w-3/5 rounded-full bg-[var(--n5-bg-highlight)] opacity-30 blur-[60px]"
      />
    </div>

    {/* Glass Surface */}
    <div
      className="bg-[var(--n5-bg-card)]/30 absolute inset-0 backdrop-blur-[20px]"
      style={{ borderRadius: n5.radiusCard }}
    />

    {/* Content */}
    <div className="relative z-10" style={{ padding: n5.spaceLg }}>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Camera className="size-5 text-[var(--n5-accent)]" strokeWidth={2} />
        <span className="font-body text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--n5-ink-main)] opacity-80">
          Your Nail Journey
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-3">
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="font-body text-2xl font-bold text-[var(--n5-accent)]"
          >
            {photoCount}
          </motion.div>
          <div className="font-body mt-0.5 text-[9px] uppercase tracking-wider text-[var(--n5-ink-muted)]">
            Photos
          </div>
        </div>
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="font-body text-2xl font-bold text-[var(--n5-ink-main)]"
          >
            {totalVisits}
          </motion.div>
          <div className="font-body mt-0.5 text-[9px] uppercase tracking-wider text-[var(--n5-ink-muted)]">
            Visits
          </div>
        </div>
        <div className="col-span-2 flex flex-col items-center justify-center border-l border-[var(--n5-border-muted)] pl-3">
          <div className="flex items-center gap-1.5">
            <Heart className="size-3.5 text-[var(--n5-accent)]" fill="currentColor" />
            <span className="font-body truncate text-sm font-bold text-[var(--n5-ink-main)]">
              {favoriteTech}
            </span>
          </div>
          <div className="font-body mt-0.5 text-[9px] uppercase tracking-wider text-[var(--n5-ink-muted)]">
            Favorite Tech
          </div>
        </div>
      </div>

      {/* Favorite Service Pill */}
      {favoriteService !== '—' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-[var(--n5-bg-surface)]/50 mt-4 flex items-center justify-center gap-2 border py-2"
          style={{
            borderRadius: n5.radiusPill,
            borderColor: 'var(--n5-border)',
          }}
        >
          <Sparkles className="size-3.5 text-[var(--n5-accent)]" />
          <span className="font-body text-xs font-medium text-[var(--n5-ink-main)]">
            Most loved:
            {' '}
            <span className="font-bold">{favoriteService}</span>
          </span>
        </motion.div>
      )}
    </div>
  </motion.div>
);

/**
 * Photo Card Component
 */
const PhotoCard = ({
  photo,
  index,
  onClick,
}: {
  photo: GalleryPhoto;
  index: number;
  onClick: () => void;
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
      className="group overflow-hidden bg-[var(--n5-bg-card)]"
      style={{
        borderRadius: n5.radiusCard,
        boxShadow: n5.shadowSm,
      }}
    >
      {/* Image */}
      <button
        type="button"
        className="relative aspect-[4/3] w-full cursor-pointer overflow-hidden"
        onClick={() => {
          triggerHaptic();
          onClick();
        }}
      >
        <Image
          src={photo.imageUrl}
          alt={photo.services.join(', ') || 'Nail photo'}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Photo type badge */}
        {photo.photoType === 'before' && (
          <div
            className="font-body absolute left-3 top-3 bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--n5-ink-main)] shadow-lg backdrop-blur-md"
            style={{ borderRadius: n5.radiusPill }}
          >
            Before
          </div>
        )}

        {/* Date badge */}
        <div
          className="font-body absolute right-3 top-3 bg-black/50 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg backdrop-blur-md"
          style={{ borderRadius: n5.radiusPill }}
        >
          {formatDate(photo.appointmentDate)}
        </div>

        {/* Gradient overlay */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      </button>

      {/* Info */}
      <div style={{ padding: n5.spaceMd }}>
        <h3 className="font-heading text-base font-semibold leading-tight text-[var(--n5-ink-main)]">
          {photo.services.join(' + ') || 'Nail Service'}
        </h3>
        {photo.technicianName && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Star className="size-3 text-[var(--n5-accent)]" fill="currentColor" />
            <span className="font-body text-xs font-medium text-[var(--n5-ink-muted)]">
              {photo.technicianName}
            </span>
          </div>
        )}
        {photo.caption && (
          <p className="font-body mt-2 line-clamp-2 text-xs italic text-[var(--n5-ink-muted)]">
            "
            {photo.caption}
            "
          </p>
        )}
      </div>
    </motion.div>
  );
};

/**
 * Empty State Component
 */
const EmptyState = ({ onBook }: { onBook: () => void }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay: 0.1 }}
    className="overflow-hidden bg-[var(--n5-bg-card)]"
    style={{
      borderRadius: n5.radiusCard,
      boxShadow: n5.shadowSm,
    }}
  >
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        className="mb-6 flex size-20 items-center justify-center bg-[var(--n5-accent-soft)]"
        style={{ borderRadius: n5.radiusPill }}
      >
        <ImageIcon className="size-10 text-[var(--n5-accent)]" strokeWidth={1.5} />
      </motion.div>

      <h2 className="font-heading mb-2 text-xl font-semibold text-[var(--n5-ink-main)]">
        Your Nail Journey Starts Here
      </h2>
      <p className="font-body mb-8 max-w-xs text-sm leading-relaxed text-[var(--n5-ink-muted)]">
        Photos from your appointments will appear here. Each visit adds to your beautiful nail collection!
      </p>

      {/* Placeholder Grid */}
      <div className="mb-6 grid w-full max-w-xs grid-cols-3 gap-2">
        {[1, 2, 3].map(i => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + i * 0.1 }}
            className="relative aspect-square overflow-hidden bg-[var(--n5-bg-surface)]"
            style={{ borderRadius: n5.radiusMd }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl opacity-20">💅</span>
            </div>
          </motion.div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          triggerHaptic();
          onBook();
        }}
        className="font-body bg-[var(--n5-accent)] px-8 py-3.5 text-sm font-bold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98]"
        style={{
          borderRadius: n5.radiusMd,
          boxShadow: n5.shadowSm,
        }}
      >
        Book Your First Appointment
      </button>
    </div>
  </motion.div>
);

/**
 * Photo Modal Component
 */
const PhotoModal = ({
  photo,
  onClose,
}: {
  photo: GalleryPhoto;
  onClose: () => void;
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative max-h-[90vh] w-full max-w-lg overflow-hidden bg-[var(--n5-bg-card)]"
        style={{ borderRadius: n5.radiusCard }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center bg-black/50 text-white shadow-lg backdrop-blur-md transition-transform active:scale-90"
          style={{ borderRadius: n5.radiusPill }}
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        {/* Image */}
        <div className="relative aspect-[4/3] w-full">
          <Image
            src={photo.imageUrl}
            alt={photo.services.join(', ') || 'Nail photo'}
            fill
            className="object-cover"
          />
        </div>

        {/* Info */}
        <div style={{ padding: n5.spaceLg }}>
          <h3 className="font-heading text-xl font-semibold text-[var(--n5-ink-main)]">
            {photo.services.join(' + ') || 'Nail Service'}
          </h3>

          <div className="mt-3 flex items-center gap-4">
            {photo.technicianName && (
              <div className="flex items-center gap-1.5">
                <Star className="size-4 text-[var(--n5-accent)]" fill="currentColor" />
                <span className="font-body text-sm font-medium text-[var(--n5-ink-main)]">
                  {photo.technicianName}
                </span>
              </div>
            )}
            <div className="font-body text-sm text-[var(--n5-ink-muted)]">
              {formatDate(photo.appointmentDate)}
            </div>
          </div>

          {photo.caption && (
            <p className="font-body mt-4 text-sm italic leading-relaxed text-[var(--n5-ink-muted)]">
              "
              {photo.caption}
              "
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

/**
 * Loading Skeleton
 */
const GallerySkeleton = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="space-y-6"
  >
    <div
      className="bg-[var(--n5-bg-card)]/50 h-40 w-full animate-pulse"
      style={{ borderRadius: n5.radiusCard }}
    />
    <div className="grid grid-cols-2 gap-4">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="bg-[var(--n5-bg-card)]/50 aspect-[4/5] w-full animate-pulse"
          style={{ borderRadius: n5.radiusCard }}
        />
      ))}
    </div>
  </motion.div>
);

// =============================================================================
// Gallery Content Component
// =============================================================================

export default function GalleryContent() {
  const router = useRouter();
  const { salonSlug, salonName } = useSalon();

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [clientPhone, setClientPhone] = useState('');

  // Load client phone from cookie
  useEffect(() => {
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
    } else {
      setLoading(false);
    }
  }, [clientPhone, salonSlug, fetchPhotos]);

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

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
    photo.services.forEach((service) => {
      acc[service] = (acc[service] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);
  const favoriteService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  return (
    <div className="min-h-screen bg-[var(--n5-bg-page)]" style={{ fontFamily: n5.fontBody }}>
      {/* Navbar - Fixed & Blurred */}
      <nav
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 pb-2 pt-12 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex size-10 items-center justify-center bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)] shadow-sm transition-transform active:scale-90"
          style={{ borderRadius: n5.radiusPill }}
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          My Gallery
        </span>
        <div className="w-10" />
        {' '}
        {/* Spacer for centering */}
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-6 px-5 py-28">
        <AnimatePresence mode="wait">
          {loading && <GallerySkeleton key="skeleton" />}
          {!loading && (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              {/* Stats Card - only show when there are photos */}
              {photos.length > 0 && (
                <StatsCard
                  totalVisits={totalVisits}
                  favoriteTech={favoriteTech}
                  favoriteService={favoriteService}
                  photoCount={photos.length}
                />
              )}

              {/* Photo Grid */}
              {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {photos.map((photo, index) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      index={index}
                      onClick={() => setSelectedPhoto(photo)}
                    />
                  ))}
                </div>
              )}

              {/* Empty State */}
              {photos.length === 0 && (
                <EmptyState onBook={() => router.push('/book')} />
              )}

              {/* Footer */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="pt-6 text-center opacity-40"
              >
                <p className="font-heading text-[10px] italic text-[var(--n5-ink-main)]">
                  {salonName || 'Nail Salon No.5'}
                  {' '}
                  · Gallery
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Photo Modal */}
      <AnimatePresence>
        {selectedPhoto && (
          <PhotoModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
