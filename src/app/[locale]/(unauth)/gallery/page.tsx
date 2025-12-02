"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { MainCard } from "@/components/MainCard";

type GalleryPhoto = {
  id: string;
  date: string;
  service: string;
  tech: string;
  imageUrl: string;
};

const RECENT_PHOTOS: GalleryPhoto[] = [
  {
    id: "1",
    date: "Dec 18, 2025",
    service: "BIAB Short",
    tech: "Daniela",
    imageUrl: "/assets/images/biab-short.webp",
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
    imageUrl: "/images/gallery/photo-5.jpg",
  },
  {
    id: "6",
    date: "Oct 20, 2025",
    service: "BIAB Short",
    tech: "Jenny",
    imageUrl: "/images/gallery/photo-6.jpg",
  },
  {
    id: "7",
    date: "Oct 8, 2025",
    service: "Gel-X Extensions",
    tech: "Daniela",
    imageUrl: "/images/gallery/photo-7.jpg",
  },
  {
    id: "8",
    date: "Sep 25, 2025",
    service: "BIAB Medium",
    tech: "Tiffany",
    imageUrl: "/images/gallery/photo-8.jpg",
  },
  {
    id: "9",
    date: "Sep 12, 2025",
    service: "Classic Mani/Pedi",
    tech: "Jenny",
    imageUrl: "/images/gallery/photo-9.jpg",
  },
];

export default function GalleryPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Gallery");

  const handleBack = () => {
    router.back();
  };

  return (
    <PageLayout>
      {/* Top bar with back button */}
      <div className="pt-2 relative flex items-center">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/50 active:scale-95 transition-all duration-150 z-10"
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

        <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
          Nail Salon No.5
        </div>
      </div>

      {/* Title section */}
      <div className="text-center pt-2">
        <h1 className="text-3xl font-semibold text-[#7b4ea3]">{t("title")}</h1>
        <p className="text-sm text-neutral-600 mt-1">{t("subtitle")}</p>
      </div>

      {/* Main content card */}
      <MainCard>
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {RECENT_PHOTOS.map((photo) => (
            <div
              key={photo.id}
              className="rounded-2xl overflow-hidden shadow-sm bg-white"
            >
              <div className="aspect-[3/4] bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] relative overflow-hidden">
                <img
                  src={photo.imageUrl}
                  alt={photo.service}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
              <div className="px-2 py-2 space-y-1">
                <div className="text-[10px] font-semibold text-neutral-900 leading-tight">
                  {photo.date}
                </div>
                <div className="text-[9px] text-neutral-600 leading-tight">
                  {photo.service}
                </div>
                <div className="text-[9px] text-neutral-600">
                  Tech: {photo.tech}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-neutral-100">
          <button
            type="button"
            onClick={() => console.log("View all photos")}
            className="w-full text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors py-2"
          >
            {t("view_all_photos")}
          </button>
        </div>
      </MainCard>
    </PageLayout>
  );
}
