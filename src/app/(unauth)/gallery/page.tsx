'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type GalleryPhoto = {
  id: string;
  date: string;
  service: string;
  tech: string;
  imageUrl: string;
};

const RECENT_PHOTOS: GalleryPhoto[] = [
  {
    id: '1',
    date: 'Dec 18, 2025',
    service: 'BIAB Short',
    tech: 'Daniela',
    imageUrl: '/assets/images/biab-short.webp',
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
    imageUrl: '/images/gallery/photo-5.jpg',
  },
  {
    id: '6',
    date: 'Oct 20, 2025',
    service: 'BIAB Short',
    tech: 'Jenny',
    imageUrl: '/images/gallery/photo-6.jpg',
  },
  {
    id: '7',
    date: 'Oct 8, 2025',
    service: 'Gel-X Extensions',
    tech: 'Daniela',
    imageUrl: '/images/gallery/photo-7.jpg',
  },
  {
    id: '8',
    date: 'Sep 25, 2025',
    service: 'BIAB Medium',
    tech: 'Tiffany',
    imageUrl: '/images/gallery/photo-8.jpg',
  },
  {
    id: '9',
    date: 'Sep 12, 2025',
    service: 'Classic Mani/Pedi',
    tech: 'Jenny',
    imageUrl: '/images/gallery/photo-9.jpg',
  },
];

export default function GalleryPage() {
  const router = useRouter();
  const { salonName } = useSalon();

  const handleBack = () => {
    router.back();
  };

  const handleViewAll = () => {
    // TODO: Navigate to full gallery view
  };

  return (
    <div
      className="flex min-h-screen justify-center py-4"
      style={{ backgroundColor: themeVars.background }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top bar with back button */}
        <div className="relative flex items-center pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="z-10 flex size-10 items-center justify-center rounded-full transition-all duration-150 hover:bg-white/50 active:scale-95"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
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

          {/* Salon name - centered */}
          <div
            className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div className="pt-2 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">My Nail Gallery</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Your nail art journey
          </p>
        </div>

        {/* Main content card */}
        <div className="rounded-xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          {/* 3x3 Grid */}
          <div className="mb-4 grid grid-cols-3 gap-2.5">
            {RECENT_PHOTOS.map(photo => (
              <div
                key={photo.id}
                className="overflow-hidden rounded-xl shadow-sm"
                style={{ backgroundColor: themeVars.surfaceAlt }}
              >
                {/* Image area - same aspect ratio as service/tech cards */}
                <div
                  className="relative aspect-[3/4] overflow-hidden"
                  style={{ background: `linear-gradient(to bottom right, ${themeVars.selectedBackground}, ${themeVars.borderMuted})` }}
                >
                  <Image
                    src={photo.imageUrl}
                    alt={photo.service}
                    fill
                    className="object-cover"
                  />
                </div>

                {/* Content */}
                <div className="space-y-1 p-2">
                  <div className="text-[10px] font-semibold leading-tight text-neutral-900">
                    {photo.date}
                  </div>
                  <div className="text-[9px] leading-tight text-neutral-600">
                    {photo.service}
                  </div>
                  <div className="text-[9px] text-neutral-600">
                    Tech:
                    {' '}
                    {photo.tech}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* View all photos link */}
          <div className="border-t border-neutral-100 pt-2">
            <button
              type="button"
              onClick={handleViewAll}
              className="w-full py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: themeVars.accent }}
            >
              View All Photos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
