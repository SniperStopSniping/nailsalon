'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import type { CustomerAssistantLocale } from '@/libs/customerAssistant/contracts';
import type { CustomerReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';
import { formatMoney } from '@/libs/formatMoney';
import { formatDuration } from '@/utils/Helpers';

const copy = {
  en: {
    title: 'Your booking details',
    pending: 'Not booked yet. This time is not held. Final pricing, text reminders and booking confirmation still need to be completed in the standard booking flow.',
    expired: 'These details need a fresh check. Review them again before continuing.',
    salon: 'Salon',
    location: 'Location',
    privateLocation: 'Location details are shared according to the salon’s booking policy.',
    services: 'Services',
    addOns: 'Add-ons',
    technician: 'Technician',
    anyArtist: 'Any available artist',
    date: 'Date and time',
    duration: 'Duration',
    subtotal: 'Service subtotal',
    tax: 'Estimated tax',
    total: 'Estimated total',
    priceNote: 'Before any eligible discounts. The final amount is not yet confirmed.',
    deposit: 'Deposit estimate',
    noDeposit: 'No deposit under the current policy and estimate.',
    unknownDeposit: 'The payment requirement needs to be checked again.',
    depositNote: 'The final deposit depends on the confirmed booking total. Payment is collected only through secure checkout.',
    mode: 'Booking process',
    instant: 'Confirmed after booking and any required payment are completed.',
    approval: 'The salon must approve the request before it is confirmed.',
    reminders: 'Text reminders',
    remindersPending: 'Choose your reminder preference when completing the booking.',
  },
  fr: {
    title: 'Détails de votre réservation',
    pending: 'Aucun rendez-vous réservé. Cette heure n’est pas retenue. Le prix final, les rappels texto et la confirmation doivent encore être complétés dans le parcours de réservation habituel.',
    expired: 'Ces détails doivent être vérifiés à nouveau avant de continuer.',
    salon: 'Salon',
    location: 'Lieu',
    privateLocation: 'Les détails du lieu sont communiqués selon la politique du salon.',
    services: 'Services',
    addOns: 'Suppléments',
    technician: 'Artiste',
    anyArtist: 'Toute artiste disponible',
    date: 'Date et heure',
    duration: 'Durée',
    subtotal: 'Sous-total des services',
    tax: 'Taxe estimée',
    total: 'Total estimé',
    priceNote: 'Avant les rabais admissibles. Le montant final n’est pas encore confirmé.',
    deposit: 'Acompte estimé',
    noDeposit: 'Aucun acompte selon la politique et l’estimation actuelles.',
    unknownDeposit: 'L’exigence de paiement doit être vérifiée à nouveau.',
    depositNote: 'L’acompte final dépend du total confirmé. Le paiement se fait uniquement par un parcours sécurisé.',
    mode: 'Processus de réservation',
    instant: 'Confirmation après la réservation et tout paiement requis.',
    approval: 'Le salon doit approuver la demande avant sa confirmation.',
    reminders: 'Rappels texto',
    remindersPending: 'Choisissez votre préférence de rappel en complétant la réservation.',
  },
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-neutral-600">{label}</dt>
      <dd className="break-words text-sm text-neutral-950">{children}</dd>
    </div>
  );
}

export function CustomerBookingReviewCard({ review, locale }: { review: CustomerReviewSnapshot; locale: CustomerAssistantLocale }) {
  const text = copy[locale];
  const language = locale === 'fr' ? 'fr-CA' : 'en-CA';
  const money = (cents: number) => formatMoney(cents, review.financial.currency, language);
  const [expired, setExpired] = useState(() => Date.parse(review.expiresAt) <= Date.now());
  useEffect(() => {
    const remaining = Date.parse(review.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    const timer = setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [review.expiresAt]);
  const date = new Intl.DateTimeFormat(language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${review.date}T12:00:00Z`));
  const locationParts = review.location
    ? [review.location.name, review.location.address, review.location.city, review.location.state, review.location.zipCode].filter(Boolean)
    : [];

  return (
    <section data-customer-review aria-label={text.title} className="space-y-4 rounded-2xl border border-black/10 bg-white p-4">
      <h3 className="text-base font-semibold text-neutral-950">{text.title}</h3>
      <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">{expired ? text.expired : text.pending}</p>
      <dl className="space-y-4">
        <Detail label={text.salon}>{review.salon.name}</Detail>
        <Detail label={text.location}>{locationParts.length ? locationParts.join(', ') : text.privateLocation}</Detail>
        <Detail label={text.services}>{review.services.map(service => <div key={service.id}>{service.name}</div>)}</Detail>
        {review.addOns.length > 0 && <Detail label={text.addOns}>{review.addOns.map(addOn => <div key={addOn.id}>{`${addOn.quantity > 1 ? `${addOn.quantity} × ` : ''}${addOn.name}`}</div>)}</Detail>}
        <Detail label={text.technician}>{text.anyArtist}</Detail>
        <Detail label={text.date}>{`${date}, ${review.time} (${review.timeZone})`}</Detail>
        <Detail label={text.duration}>{formatDuration(review.durationMinutes)}</Detail>
        <Detail label={text.subtotal}>{money(review.financial.subtotalCents)}</Detail>
        <Detail label={text.tax}>{money(review.financial.estimatedTaxCents)}</Detail>
        <Detail label={text.total}>
          <strong>{money(review.financial.estimatedTotalCents)}</strong>
          <p className="mt-1 text-xs text-neutral-600">{text.priceNote}</p>
        </Detail>
        <Detail label={text.deposit}>
          {review.deposit.status === 'required'
            ? formatMoney(review.deposit.amountCents, review.deposit.currency, language)
            : review.deposit.status === 'not_required' ? text.noDeposit : text.unknownDeposit}
          <p className="mt-1 text-xs text-neutral-600">{text.depositNote}</p>
        </Detail>
        <Detail label={text.mode}>{review.confirmationMode === 'request_approval' ? text.approval : text.instant}</Detail>
        <Detail label={text.reminders}>{text.remindersPending}</Detail>
      </dl>
      {review.bookingPolicy.required && (
        <details className="rounded-xl bg-neutral-50 p-3">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-neutral-950">{review.bookingPolicy.title}</summary>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-700">{review.bookingPolicy.text}</p>
          <p className="mt-3 text-xs text-neutral-600">{review.bookingPolicy.acknowledgmentText}</p>
        </details>
      )}
    </section>
  );
}
