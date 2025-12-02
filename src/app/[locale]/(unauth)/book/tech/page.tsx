"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageLayout } from "@/components/PageLayout";
import { MainCard } from "@/components/MainCard";

type Technician = {
  id: string;
  name: string;
  imageUrl: string;
  specialties: string[];
  rating: number;
};

const TECHNICIANS: Technician[] = [
  {
    id: "daniela",
    name: "Daniela",
    imageUrl: "/assets/images/tech-daniela.jpeg",
    specialties: ["BIAB", "Gel-X", "French"],
    rating: 4.8,
  },
  {
    id: "tiffany",
    name: "Tiffany",
    imageUrl: "/assets/images/tech-tiffany.jpeg",
    specialties: ["BIAB", "Gel Manicure"],
    rating: 4.9,
  },
  {
    id: "jenny",
    name: "Jenny",
    imageUrl: "/assets/images/tech-jenny.jpeg",
    specialties: ["Gel-X", "Pedicure"],
    rating: 4.7,
  },
];

export default function BookTechPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || "en";
  const serviceIds = searchParams.get("serviceIds")?.split(",") || [];
  const [selectedTech, setSelectedTech] = useState<string | null>(null);

  const handleSelectTech = (techId: string) => {
    setSelectedTech(techId);
    // Navigate after 200ms to show the highlight
    setTimeout(() => {
      router.push(
        `/${locale}/book/time?serviceIds=${serviceIds.join(",")}&techId=${techId}`
      );
    }, 200);
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <PageLayout>
      {/* Luxury Step Bar */}
      <div className="pt-2 pb-1">
        <div className="flex items-center justify-center max-w-sm mx-auto gap-2">
          {[
            { label: "Service", step: 1 },
            { label: "Tech", step: 2 },
            { label: "Time", step: 3 },
            { label: "Confirm", step: 4 },
          ].map((item, index, array) => (
            <div key={item.step} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`text-[9px] font-medium tracking-wide transition-colors ${
                    item.step === 2
                      ? "text-[#7b4ea3]"
                      : "text-black/70"
                  }`}
                >
                  {item.label}
                </div>
                <div
                  className={`mt-0.5 h-px w-6 rounded-full transition-colors ${
                    item.step === 2
                      ? "bg-[#7b4ea3]"
                      : "bg-black/40"
                  }`}
                />
              </div>
              {index < array.length - 1 && (
                <div className="mx-1.5 flex-shrink-0">
                  <svg
                    width="12"
                    height="8"
                    viewBox="0 0 16 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="text-black/30"
                  >
                    <path
                      d="M0 6H14M14 6L10 2M14 6L10 10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Top bar with back button */}
      <div className="pt-1 relative flex items-center">
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

        {/* Title - centered */}
        <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
          Choose Technician
        </div>
      </div>

      {/* Technicians grid */}
      <div className="grid grid-cols-2 gap-3 mt-[5px]">
        {TECHNICIANS.map((tech) => {
          const isSelected = selectedTech === tech.id;
          return (
            <button
              key={tech.id}
              type="button"
              onClick={() => handleSelectTech(tech.id)}
              className={`relative rounded-2xl overflow-hidden text-left shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-all duration-150 p-4 min-h-[200px] ${
                isSelected
                  ? "bg-[#d6a249]/20 ring-2 ring-[#d6a249] ring-offset-1 ring-offset-[#f6ebdd]"
                  : "bg-white"
              }`}
              onMouseEnter={(e) => {
                if (window.innerWidth >= 768) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0_4px_20px_rgba(0, 0, 0, 0.1)';
                }
              }}
              onMouseLeave={(e) => {
                if (window.innerWidth >= 768) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0_4px_20px_rgba(0, 0, 0, 0.08)';
                }
              }}
            >
              <div className="flex flex-col items-center gap-2">
                <div className="h-[110px] w-[110px] rounded-full bg-[#f0dfc9] overflow-hidden flex-shrink-0">
                  <img
                    src={tech.imageUrl}
                    alt={tech.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 text-center">
                  <div className="text-base font-semibold text-neutral-900">
                    {tech.name}
                  </div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="currentColor"
                      className="text-[#f4b864]"
                    >
                      <path d="M6 0L7.5 4.5L12 4.5L8.25 7.5L9.75 12L6 9L2.25 12L3.75 7.5L0 4.5L4.5 4.5L6 0Z" />
                    </svg>
                    <span className="text-xs font-semibold text-neutral-900">
                      {tech.rating}
                    </span>
                  </div>
                  <div className="text-sm text-neutral-600 mt-1">
                    {tech.specialties.join(" • ")}
                  </div>
                </div>
                {isSelected && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-[#d6a249] flex items-center justify-center text-xs font-bold text-white shadow-md">
                    ✓
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </PageLayout>
  );
}
