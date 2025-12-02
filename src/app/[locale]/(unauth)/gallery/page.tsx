"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useEffect, useRef } from "react";

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
    id: "1",
    date: "Dec 18, 2025",
    service: "BIAB Short",
    tech: "Daniela",
    imageUrl: "/assets/images/biab-short.webp",
    isFavorite: true,
  },
  {
    id: "2",
    date: "Dec 5, 2025",
    service: "Gel-X Extensions",
    tech: "Tiffany",
    imageUrl: "/assets/images/gel-x-extensions.jpg",
  },
  {
    id: "3",
    date: "Nov 28, 2025",
    service: "BIAB Medium",
    tech: "Jenny",
    imageUrl: "/assets/images/biab-medium.webp",
    isFavorite: true,
  },
  {
    id: "4",
    date: "Nov 15, 2025",
    service: "BIAB French",
    tech: "Daniela",
    imageUrl: "/assets/images/biab-french.jpg",
  },
  {
    id: "5",
    date: "Nov 2, 2025",
    service: "Gel Manicure",
    tech: "Tiffany",
    imageUrl: "/assets/images/biab-short.webp",
  },
  {
    id: "6",
    date: "Oct 20, 2025",
    service: "BIAB Short",
    tech: "Jenny",
    imageUrl: "/assets/images/biab-medium.webp",
  },
  {
    id: "7",
    date: "Oct 8, 2025",
    service: "Gel-X Extensions",
    tech: "Daniela",
    imageUrl: "/assets/images/gel-x-extensions.jpg",
  },
  {
    id: "8",
    date: "Sep 25, 2025",
    service: "BIAB Medium",
    tech: "Tiffany",
    imageUrl: "/assets/images/biab-french.jpg",
  },
  {
    id: "9",
    date: "Sep 12, 2025",
    service: "Classic Mani/Pedi",
    tech: "Jenny",
    imageUrl: "/assets/images/biab-short.webp",
  },
];

export default function GalleryPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Gallery");
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
  const favoriteTech = Object.entries(techCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  
  const serviceCounts = RECENT_PHOTOS.reduce((acc, photo) => {
    acc[photo.service] = (acc[photo.service] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const favoriteService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4] pb-10">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="pt-6 pb-2 relative flex items-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 300ms ease-out, transform 300ms ease-out",
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-11 h-11 rounded-full hover:bg-white/60 active:scale-95 transition-all duration-200 z-10"
          >
            <svg
              width="22"
              height="22"
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

          <div className="absolute left-1/2 transform -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Title section */}
        <div
          className="text-center pt-4 pb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition:
              "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
          }}
        >
          <h1 className="text-3xl font-bold tracking-tight text-[#7b4ea3]">
            {t("title")}
          </h1>
          <p className="text-base text-neutral-500 mt-1 italic">
            {t("subtitle")}
          </p>
        </div>

        {/* Stats Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms",
          }}
        >
          <div className="px-5 py-5">
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-white">{totalVisits}</div>
                <div className="text-xs text-white/70 mt-0.5">{t("total_visits")}</div>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center flex-1 px-2">
                <div className="text-lg font-bold text-[#f4b864] truncate">{favoriteTech}</div>
                <div className="text-xs text-white/70 mt-0.5">{t("favorite_tech")}</div>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center flex-1 px-1">
                <div className="text-sm font-bold text-white truncate">{favoriteService}</div>
                <div className="text-xs text-white/70 mt-0.5">{t("favorite_service")}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Button */}
        <button
          type="button"
          onClick={handleUpload}
          className="mb-6 w-full flex items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition:
              "opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms",
          }}
        >
          <span className="text-xl">📸</span>
          {t("upload_new")}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              console.log("File selected:", file.name);
            }
          }}
        />

        {/* Photo Grid */}
        <div className="space-y-4">
          {RECENT_PHOTOS.map((photo, index) => (
            <div
              key={photo.id}
              className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted
                  ? "translateY(0) scale(1)"
                  : "translateY(15px) scale(0.98)",
                transition: `opacity 300ms ease-out ${250 + index * 40}ms, transform 300ms ease-out ${250 + index * 40}ms`,
              }}
            >
              {/* Image */}
              <div 
                className="relative aspect-[4/3] bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] cursor-pointer group"
                onClick={() => setSelectedPhoto(photo)}
              >
                <img
                  src={photo.imageUrl}
                  alt={photo.service}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {/* Favorite badge */}
                {photo.isFavorite && (
                  <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg">
                    <span className="text-red-500">❤️</span>
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-bold text-neutral-900">
                      {photo.service}
                    </div>
                    <div className="text-sm text-neutral-600 mt-1 flex items-center gap-1.5">
                      <span className="text-[#7b4ea3]">✦</span>
                      <span>{t("tech")}: {photo.tech}</span>
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
          className="mt-6 w-full text-base font-bold text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors py-3"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 600ms",
          }}
        >
          {t("view_all_photos")}
        </button>

        {/* Empty State (hidden when there are photos) */}
        {RECENT_PHOTOS.length === 0 && (
          <div className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            <div className="text-center py-16 px-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#f6ebdd] to-[#f0dfc9] flex items-center justify-center">
                <span className="text-4xl">📷</span>
              </div>
              <p className="text-lg font-semibold text-neutral-700">
                {t("empty_state")}
              </p>
              <p className="text-sm text-neutral-500 mt-1 mb-6">
                {t("empty_description")}
              </p>
              <button
                type="button"
                onClick={handleUpload}
                className="rounded-full bg-[#f4b864] px-6 py-3 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                {t("upload_new")}
              </button>
            </div>
          </div>
        )}

        {/* Photo Modal */}
        {selectedPhoto && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setSelectedPhoto(null)}
          >
            <div 
              className="relative max-w-lg w-full rounded-2xl overflow-hidden bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setSelectedPhoto(null)}
                className="absolute top-3 right-3 z-10 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg hover:bg-white transition-colors"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
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
              <div className="aspect-square bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa]">
                <img
                  src={selectedPhoto.imageUrl}
                  alt={selectedPhoto.service}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold text-neutral-900">
                      {selectedPhoto.service}
                    </div>
                    <div className="text-base text-neutral-600 mt-1 flex items-center gap-1.5">
                      <span className="text-[#7b4ea3]">✦</span>
                      <span>Nail Artist: {selectedPhoto.tech}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-neutral-700">
                      {selectedPhoto.date}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button
                    type="button"
                    className="flex-1 rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-4 py-3 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Book Same Style
                  </button>
                  <button
                    type="button"
                    className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center text-xl hover:bg-neutral-200 transition-colors"
                  >
                    {selectedPhoto.isFavorite ? "❤️" : "🤍"}
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
