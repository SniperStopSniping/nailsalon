'use client';

import Image from 'next/image';

import { SectionCard } from '@/components/ui/section-card';
import { themeVars } from '@/theme';

import type { StaffAppointmentData } from './types';

type StaffAppointmentsListProps = {
  appointments: StaffAppointmentData[];
  mounted: boolean;
  onSelect: (appointment: StaffAppointmentData) => void;
  formatTime: (dateStr: string) => string;
  formatPrice: (cents: number) => string;
};

export function StaffAppointmentsList({
  appointments,
  mounted,
  onSelect,
  formatTime,
  formatPrice,
}: StaffAppointmentsListProps) {
  return (
    <div className="space-y-4">
      {appointments.map((appointment, index) => (
        <SectionCard
          key={appointment.id}
          className="overflow-hidden shadow-lg"
          contentClassName="py-4"
          style={{
            borderColor: themeVars.cardBorder,
            borderWidth: 1,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(15px)',
            transition: `opacity 300ms ease-out ${100 + index * 50}ms, transform 300ms ease-out ${100 + index * 50}ms`,
          }}
        >
          <div>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-neutral-900">
                  {appointment.clientName || 'Client'}
                </div>
                <div className="text-sm text-neutral-600">
                  {formatTime(appointment.startTime)}
                  {' '}
                  -
                  {formatTime(appointment.endTime)}
                </div>
                <div className="mt-1 text-sm" style={{ color: themeVars.accent }}>
                  {appointment.services.map(service => service.name).join(', ')}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold" style={{ color: themeVars.primary }}>
                  {formatPrice(appointment.totalPrice)}
                </div>
                <div
                  className="mt-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    background: appointment.status === 'in_progress'
                      ? themeVars.primary
                      : themeVars.selectedBackground,
                    color: appointment.status === 'in_progress' ? 'white' : themeVars.titleText,
                  }}
                >
                  {appointment.status === 'in_progress' ? 'In Progress' : 'Confirmed'}
                </div>
              </div>
            </div>

            {appointment.photos.length > 0 && (
              <div className="mt-3 flex gap-2">
                {appointment.photos.map(photo => (
                  <div key={photo.id} className="relative size-16 overflow-hidden rounded-lg">
                    <Image
                      src={photo.thumbnailUrl || photo.imageUrl}
                      alt={photo.photoType}
                      fill
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => onSelect(appointment)}
              className="mt-4 w-full rounded-full px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: themeVars.accent }}
            >
              📸 Manage Photos & Workflow
            </button>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
