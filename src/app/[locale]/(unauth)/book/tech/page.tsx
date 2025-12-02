'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type Technician = {
  id: string;
  name: string;
  imageUrl: string;
  specialties: string[];
  rating: number;
  reviewCount: number;
};

const TECHNICIANS: Technician[] = [
  {
    id: 'daniela',
    name: 'Daniela',
    imageUrl: '/assets/images/tech-daniela.jpeg',
    specialties: ['BIAB', 'Gel-X', 'French'],
    rating: 4.8,
    reviewCount: 127,
  },
  {
    id: 'tiffany',
    name: 'Tiffany',
    imageUrl: '/assets/images/tech-tiffany.jpeg',
    specialties: ['BIAB', 'Gel Manicure'],
    rating: 4.9,
    reviewCount: 203,
  },
  {
    id: 'jenny',
    name: 'Jenny',
    imageUrl: '/assets/images/tech-jenny.jpeg',
    specialties: ['Gel-X', 'Pedicure'],
    rating: 4.7,
    reviewCount: 89,
  },
];

const SERVICES: Record<string, { name: string; price: number }> = {
  'biab-short': { name: 'BIAB Short', price: 65 },
  'biab-medium': { name: 'BIAB Medium', price: 75 },
  'gelx-extensions': { name: 'Gel-X Extensions', price: 90 },
  'biab-french': { name: 'BIAB French', price: 75 },
  'spa-pedi': { name: 'SPA Pedicure', price: 60 },
  'gel-pedi': { name: 'Gel Pedicure', price: 70 },
  'biab-gelx-combo': { name: 'BIAB + Gel-X Combo', price: 130 },
  'mani-pedi': { name: 'Classic Mani + Pedi', price: 95 },
};

export default function BookTechPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedServices = serviceIds.map(id => SERVICES[id]).filter(Boolean);
  const serviceNames = selectedServices.map(s => s.name).join(' + ');
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const handleSelectTech = (techId: string) => {
    setSelectedTech(techId);
    setTimeout(() => {
      router.push(
        `/${locale}/book/time?serviceIds=${serviceIds.join(',')}&techId=${techId}`,
      );
    }, 300);
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4]">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Header */}
        <div
          className="relative flex items-center pb-4 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Progress Steps - Same as Time page */}
        <div
          className="mb-6 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 50ms',
          }}
        >
          {['Service', 'Artist', 'Time', 'Confirm'].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${i === 1 ? 'opacity-100' : 'opacity-40'}`}>
                <div className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                  i < 1 ? 'bg-[#7b4ea3] text-white' : i === 1 ? 'bg-[#f4b864] text-neutral-900' : 'bg-neutral-300 text-neutral-600'
                }`}
                >
                  {i < 1 ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === 1 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                  {step}
                </span>
              </div>
              {i < 3 && <div className="h-px w-4 bg-neutral-300" />}
            </div>
          ))}
        </div>

        {/* Service Summary */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="mb-0.5 text-xs text-white/70">You selected</div>
                <div className="text-lg font-bold text-white">{serviceNames || 'Service'}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-[#f4b864]">
                  $
                  {totalPrice}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div
          className="mb-5 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900">
            Choose Your Artist
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Select your favorite nail technician
          </p>
        </div>

        {/* Technicians grid */}
        <div className="grid grid-cols-2 gap-3">
          {TECHNICIANS.map((tech, index) => {
            const isSelected = selectedTech === tech.id;
            return (
              <button
                key={tech.id}
                type="button"
                onClick={() => handleSelectTech(tech.id)}
                className={`relative overflow-hidden rounded-2xl text-left transition-all duration-300 ${
                  isSelected
                    ? 'scale-[1.02] bg-gradient-to-br from-[#f4b864]/30 to-[#d6a249]/20 shadow-xl ring-2 ring-[#f4b864]'
                    : 'border border-[#e6d6c2] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:scale-[1.02] hover:border-[#d6a249]/50 hover:shadow-lg'
                }`}
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(20px)',
                  transition: `opacity 300ms ease-out ${200 + index * 100}ms, transform 300ms ease-out ${200 + index * 100}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                }}
              >
                {/* Selection checkmark */}
                {isSelected && (
                  <div className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#f4b864] to-[#d6a249] shadow-lg">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}

                <div className="flex flex-col items-center p-4">
                  {/* Avatar with subtle animation */}
                  <div
                    className={`relative mb-3 size-24 overflow-hidden rounded-full transition-transform duration-300 ${
                      isSelected ? 'scale-105' : ''
                    }`}
                  >
                    {/* Ring around avatar */}
                    <div className={`border-3 absolute inset-0 rounded-full transition-colors duration-300 ${
                      isSelected ? 'border-[#f4b864]' : 'border-transparent'
                    }`}
                    />
                    <img
                      src={tech.imageUrl}
                      alt={tech.name}
                      className="size-full object-cover"
                    />
                  </div>

                  {/* Name */}
                  <div className="mb-1 text-lg font-bold text-neutral-900">
                    {tech.name}
                  </div>

                  {/* Rating */}
                  <div className="mb-2 flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(star => (
                        <svg
                          key={star}
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          fill={star <= Math.floor(tech.rating) ? '#f4b864' : '#e5e5e5'}
                        >
                          <path d="M6 0L7.5 4.5L12 4.5L8.25 7.5L9.75 12L6 9L2.25 12L3.75 7.5L0 4.5L4.5 4.5L6 0Z" />
                        </svg>
                      ))}
                    </div>
                    <span className="text-sm font-bold text-neutral-900">{tech.rating}</span>
                    <span className="text-xs text-neutral-400">
                      (
                      {tech.reviewCount}
                      )
                    </span>
                  </div>

                  {/* Specialties */}
                  <div className="flex flex-wrap justify-center gap-1">
                    {tech.specialties.map(specialty => (
                      <span
                        key={specialty}
                        className="rounded-full bg-[#f6ebdd] px-2 py-0.5 text-xs font-medium text-neutral-600"
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* "Any Artist" option */}
        <button
          type="button"
          onClick={() => handleSelectTech('any')}
          className="mt-4 w-full rounded-2xl border border-dashed border-[#d6a249]/50 bg-white/50 py-4 text-center transition-all hover:border-[#d6a249] hover:bg-white"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 500ms',
          }}
        >
          <span className="text-base font-medium text-neutral-600">
            🎲 Surprise me with any available artist
          </span>
        </button>

        {/* Footer */}
        <div
          className="mt-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 600ms',
          }}
        >
          <p className="text-xs text-neutral-400">
            All our artists are highly trained professionals
          </p>
        </div>
      </div>
    </div>
  );
}
