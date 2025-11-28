"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

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
    // Navigate to time selection page
    router.push(`/${locale}/book/time?serviceIds=${serviceIds.join(",")}&techId=${techId}`);
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-[#f6ebdd] flex justify-center py-4">
      <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
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

          {/* Title - centered */}
          <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
            Choose Technician
          </div>
        </div>

        {/* Technicians grid */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          {TECHNICIANS.map((tech) => {
            const isSelected = selectedTech === tech.id;
            return (
              <button
                key={tech.id}
                type="button"
                onClick={() => handleSelectTech(tech.id)}
                className={`relative rounded-2xl overflow-hidden text-left shadow-sm transition-all duration-150 p-4 ${
                  isSelected
                    ? "bg-[#f5e6d3] ring-2 ring-[#d6a249] ring-offset-1 ring-offset-[#f6ebdd]"
                    : "bg-white"
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  {/* Tech image */}
                  <div className="h-20 w-20 rounded-full bg-[#f0dfc9] overflow-hidden flex-shrink-0">
                    <img
                      src={tech.imageUrl}
                      alt={tech.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Tech info */}
                  <div className="flex-1 text-center">
                    <div className="text-lg font-semibold text-neutral-900">
                      {tech.name}
                    </div>
                    {/* Rating */}
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
                    <div className="text-xs text-neutral-600 mt-1">
                      {tech.specialties.join(" • ")}
                    </div>
                  </div>

                  {/* Check mark */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-[#d6a249] flex items-center justify-center text-xs font-bold text-white">
                      ✓
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

