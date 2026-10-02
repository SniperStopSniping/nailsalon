'use client';

import { Calendar, MapPin, Pencil, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';
import { formatDuration } from '@/utils/Helpers';

import type { AddOnSummary, LocationSummary, ServiceSummary, TechnicianSummary } from './BookConfirmClient';

type ReviewAppointmentSummaryProps = {
  services: ServiceSummary[];
  addOns: AddOnSummary[];
  technician: TechnicianSummary;
  dateStr: string;
  timeStr: string;
  totalDuration: number;
  location: LocationSummary;
  currency: string;
  rewardsEnabled: boolean;
  pointsEarned: number;
  disabled: boolean;
  onEdit: () => void;
};

function ServiceThumbnail({ service }: { service: ServiceSummary }) {
  const [failed, setFailed] = useState(false);
  if (!service.imageUrl || failed) {
    return null;
  }
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl">
      <Image src={service.imageUrl} alt="" fill sizes="64px" className="object-cover" onError={() => setFailed(true)} />
    </div>
  );
}

// The address can already contain a city from the salon's public profile.
// Preserve the published address and append only missing components.
function reviewAddress(location: NonNullable<LocationSummary>) {
  const parts = [location.address, location.city, location.state, location.zipCode];
  const result: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value) {
      continue;
    }
    const words = result.join(', ').toLocaleLowerCase().split(/[,\s]+/u).filter(Boolean);
    const valueWords = value.toLocaleLowerCase().split(/[,\s]+/u).filter(Boolean);
    if (!valueWords.every(word => words.includes(word))) {
      result.push(value);
    }
  }
  return result.join(', ');
}

export function ReviewAppointmentSummary({ services, addOns, technician, dateStr, timeStr, totalDuration, location, currency, rewardsEnabled, pointsEarned, disabled, onEdit }: ReviewAppointmentSummaryProps) {
  const t = useTranslations('BookingConfirmation');
  const params = useParams();
  const locale = params?.locale === 'fr' ? 'fr-CA' : 'en-CA';
  const date = dateStr ? new Date(`${dateStr}T00:00:00`) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
    : t('review_date_missing');
  const [hours, minutes = '00'] = timeStr.split(':');
  const hour = Number(hours);
  const timeLabel = timeStr ? `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}` : '';
  const matchingService = (addOn: AddOnSummary) => services.find(service => (
    addOn.serviceId ? service.id === addOn.serviceId : addOn.serviceName ? service.name === addOn.serviceName : services.length === 1
  ));
  const addOnRow = (addOn: AddOnSummary, index: number) => (
    <li key={`${addOn.serviceId ?? addOn.serviceName ?? 'legacy'}:${addOn.id}:${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-5">
      <span className="min-w-0 flex-1 break-words">
        {addOn.name}
        {addOn.quantity > 1 ? ` ×${addOn.quantity}` : ''}
      </span>
      <span className="max-w-full font-medium">
        {addOn.priceMode === 'manual_confirmation'
          ? t('review_price_pending')
          : addOn.quantity > 1 ? formatMoney(Math.round(addOn.price * 100), currency) : addOn.priceDisplayText ?? formatMoney(Math.round(addOn.price * 100), currency)}
      </span>
    </li>
  );

  return (
    <section data-testid="booking-review-summary" data-public-surface="appointmentSummaryCard" aria-label={t('review_summary_label')} className="booking-review-summary rounded-2xl border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-[var(--n5-ink-main)] shadow-sm">
      <div data-testid="booking-receipt-when" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--n5-border-muted)] pb-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--n5-accent) 10%, var(--n5-bg-card))' }}>
          <Calendar aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1 basis-[100px]">
          <p className="break-words font-heading text-xl font-semibold leading-7">{dateLabel}</p>
          <p className="break-words text-lg font-semibold leading-6">{timeLabel}</p>
        </div>
        <button type="button" onClick={onEdit} disabled={disabled} className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60">
          <Pencil aria-hidden="true" className="size-4" />
          {t('review_edit')}
        </button>
      </div>
      <div data-testid="booking-receipt-services" className="space-y-2 pt-3">
        {services.map(service => (
          <div key={service.id} className="flex items-start gap-3">
            <ServiceThumbnail service={service} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="min-w-0 flex-1 break-words text-base font-semibold leading-6">{service.name}</p>
                <span className="text-base font-semibold leading-6">{service.priceDisplayText ?? formatMoney(Math.round(service.price * 100), currency)}</span>
              </div>
              {services.length > 1 && <p className="text-sm leading-5">{formatDuration(service.duration)}</p>}
              {addOns.some(addOn => matchingService(addOn)?.id === service.id) && (
                <ul data-public-surface="appointmentSummaryCard" data-testid="booking-receipt-add-ons" aria-label={t('review_add_ons')} className="space-y-1">{addOns.filter(addOn => matchingService(addOn)?.id === service.id).map(addOnRow)}</ul>
              )}
            </div>
          </div>
        ))}
        {addOns.some(addOn => !matchingService(addOn)) && (
          <ul data-public-surface="appointmentSummaryCard" data-testid="booking-receipt-add-ons" aria-label={t('review_add_ons')} className="space-y-1">{addOns.filter(addOn => !matchingService(addOn)).map(addOnRow)}</ul>
        )}
        <p className="text-sm leading-5">
          {technician?.name ?? t('review_any_artist')}
          {' · '}
          <span data-testid="booking-receipt-duration">{formatDuration(totalDuration)}</span>
        </p>
        {location && (
          <div className="flex items-start gap-2 pt-1">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-sm leading-5">
              <p className="font-semibold">{location.name}</p>
              {reviewAddress(location) && <p>{reviewAddress(location)}</p>}
            </div>
          </div>
        )}
        {addOns.some(addOn => addOn.priceMode === 'manual_confirmation') && (
          <p data-testid="booking-manual-price-note" className="text-sm leading-5">{t('review_manual_price_note')}</p>
        )}
        {rewardsEnabled && (
          <p className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium leading-5" style={{ backgroundColor: 'color-mix(in srgb, var(--n5-accent) 8%, var(--n5-bg-card))' }}>
            <Sparkles aria-hidden="true" className="size-4 shrink-0" />
            <span>{t('review_points', { points: pointsEarned.toLocaleString(locale) })}</span>
          </p>
        )}
      </div>
    </section>
  );
}
