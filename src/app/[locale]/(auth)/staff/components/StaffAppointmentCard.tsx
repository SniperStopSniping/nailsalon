'use client';

import Image from 'next/image';

import { ProgressRing } from './ProgressRing';

// =============================================================================
// Types
// =============================================================================

export type AppointmentPhoto = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  photoType: string;
};

export type AppointmentData = {
  id: string;
  clientName: string | null;
  clientPhone: string;
  startTime: string;
  endTime: string;
  status: string;
  canvasState?: string | null;
  technicianId: string | null;
  services: Array<{ name: string }>;
  totalPrice: number;
  photos: AppointmentPhoto[];
};

// =============================================================================
// Cappuccino Design Tokens
// =============================================================================

const cappuccino = {
  title: '#6F4E37',
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
  primary: '#4B2E1E',
  secondary: '#EADBC8',
  secondaryText: '#4B2E1E',
};

// =============================================================================
// Canvas State Chip
// =============================================================================

function CanvasStateChip({ state }: { state: string }) {
  const stateConfig: Record<string, { label: string; bg: string; text: string }> = {
    waiting: { label: 'Waiting', bg: '#FEF3C7', text: '#92400E' },
    working: { label: 'Working', bg: '#DBEAFE', text: '#1E40AF' },
    wrap_up: { label: 'Wrap-Up', bg: '#E0E7FF', text: '#3730A3' },
    complete: { label: 'Complete', bg: '#D1FAE5', text: '#065F46' },
    cancelled: { label: 'Cancelled', bg: '#FEE2E2', text: '#991B1B' },
    no_show: { label: 'No Show', bg: '#FEE2E2', text: '#991B1B' },
  };

  const defaultConfig = { label: 'Waiting', bg: '#FEF3C7', text: '#92400E' };
  const config = stateConfig[state] ?? defaultConfig;

  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}

// =============================================================================
// Photo Status Indicator
// =============================================================================

function PhotoIndicator({ label, hasPhoto }: { label: string; hasPhoto: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        hasPhoto ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'
      }`}
    >
      {hasPhoto ? '✓' : '○'}
      {' '}
      {label}
    </span>
  );
}

// =============================================================================
// Staff Appointment Card Component
// =============================================================================

type StaffAppointmentCardProps = {
  appointment: AppointmentData;
  onViewClient?: (phone: string) => void;
  onOpenActions: (appointment: AppointmentData) => void;
};

export function StaffAppointmentCard({
  appointment,
  onViewClient,
  onOpenActions,
}: StaffAppointmentCardProps) {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`;
  };

  // Determine canvas state (fallback to legacy status mapping)
  const canvasState = appointment.canvasState || mapLegacyStatus(appointment.status);
  const hasBeforePhoto = appointment.photos.some(p => p.photoType === 'before');
  const hasAfterPhoto = appointment.photos.some(p => p.photoType === 'after');

  return (
    <div
      className="overflow-hidden rounded-2xl shadow-sm"
      style={{
        backgroundColor: cappuccino.cardBg,
        borderWidth: 1,
        borderColor: cappuccino.cardBorder,
      }}
    >
      <div className="p-4">
        {/* Header Row */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* Client Name */}
            <button
              type="button"
              onClick={() => onViewClient?.(appointment.clientPhone)}
              className="text-left transition-opacity hover:opacity-70"
            >
              <div
                className="text-lg font-semibold"
                style={{ color: cappuccino.title }}
              >
                {appointment.clientName || 'Client'}
              </div>
              <div className="text-xs text-neutral-500">
                {appointment.clientPhone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
              </div>
            </button>

            {/* Time */}
            <div className="mt-1 text-sm text-neutral-600">
              {formatTime(appointment.startTime)}
              {' '}
              –
              {formatTime(appointment.endTime)}
            </div>

            {/* Services */}
            <div
              className="mt-1 text-sm font-medium"
              style={{ color: cappuccino.primary }}
            >
              {appointment.services.map(s => s.name).join(', ')}
            </div>
          </div>

          {/* Right Column */}
          <div className="flex items-start gap-2">
            <ProgressRing state={canvasState} size={36} />
            <div className="text-right">
              <div
                className="text-lg font-bold"
                style={{ color: cappuccino.title }}
              >
                {formatPrice(appointment.totalPrice)}
              </div>
              <div className="mt-1">
                <CanvasStateChip state={canvasState} />
              </div>
            </div>
          </div>
        </div>

        {/* Photo Thumbnails */}
        {appointment.photos.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex gap-1">
              {appointment.photos.slice(0, 4).map(photo => (
                <div
                  key={photo.id}
                  className="relative size-12 overflow-hidden rounded-lg"
                >
                  <Image
                    src={photo.thumbnailUrl || photo.imageUrl}
                    alt={photo.photoType}
                    fill
                    className="object-cover"
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[9px] font-medium text-white"
                    style={{
                      backgroundColor: photo.photoType === 'before' ? '#D97706' : '#059669',
                    }}
                  >
                    {photo.photoType}
                  </div>
                </div>
              ))}
            </div>
            {appointment.photos.length > 4 && (
              <span className="text-xs text-neutral-500">
                +
                {appointment.photos.length - 4}
                {' '}
                more
              </span>
            )}
          </div>
        )}

        {/* Photo Status Indicators */}
        <div className="mt-3 flex gap-2">
          <PhotoIndicator label="Before" hasPhoto={hasBeforePhoto} />
          <PhotoIndicator label="After" hasPhoto={hasAfterPhoto} />
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={() => onOpenActions(appointment)}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ backgroundColor: cappuccino.primary }}
        >
          Manage Appointment
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Helper: Map legacy status to canvas state
// =============================================================================

function mapLegacyStatus(status: string): string {
  const mapping: Record<string, string> = {
    pending: 'waiting',
    confirmed: 'waiting',
    in_progress: 'working',
    completed: 'complete',
    cancelled: 'cancelled',
    no_show: 'no_show',
  };
  return mapping[status] || 'waiting';
}

export default StaffAppointmentCard;
