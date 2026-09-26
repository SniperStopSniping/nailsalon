'use client';

import type { FormEvent } from 'react';
import { useId, useState } from 'react';

import { BOOKING_SMS_WORDING_VERSION, type BookingSmsConsentInput, type BookingSmsMode } from '@/libs/bookingSmsConsent';
import type { CustomerAssistantLocale } from '@/libs/customerAssistant/contracts';
import { isValidPhone } from '@/libs/phone';

export type CustomerContactValues = { name: string; email: string; phone: string };

const copy = {
  en: {
    title: 'Your contact details',
    name: 'Full name',
    email: 'Email address',
    phone: 'Phone number',
    privacy: 'Luster uses these details to create your booking. They are not sent to the AI or stored in this conversation.',
    submit: 'Review booking details',
    invalid: 'Enter your name, a valid email address and a 10-digit phone number.',
  },
  fr: {
    title: 'Vos coordonnées',
    name: 'Nom complet',
    email: 'Adresse courriel',
    phone: 'Numéro de téléphone',
    privacy: 'Luster utilise ces coordonnées pour créer votre réservation. Elles ne sont pas envoyées à l’IA ni enregistrées dans cette conversation.',
    submit: 'Vérifier les détails',
    invalid: 'Entrez votre nom, une adresse courriel valide et un numéro de téléphone à 10 chiffres.',
  },
};

export function ContactDetailsForm({ locale, contact, disabled, onChange, onReview, smsMode = 'default_on', smsConsent, onSmsChange }: {
  locale: CustomerAssistantLocale;
  contact: CustomerContactValues;
  disabled: boolean;
  onChange: (contact: CustomerContactValues) => void;
  onReview: () => void;
  smsMode?: BookingSmsMode;
  smsConsent?: BookingSmsConsentInput;
  onSmsChange?: (consent: BookingSmsConsentInput) => void;
}) {
  const text = copy[locale];
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    if (!contact.name.trim() || !event.currentTarget.checkValidity() || !isValidPhone(contact.phone)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onReview();
  };
  const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-950 disabled:bg-neutral-100';

  return (
    <form aria-label={text.title} onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-black/10 bg-white p-4">
      <h3 className="font-semibold text-neutral-950">{text.title}</h3>
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="block text-sm font-medium text-neutral-800">{text.name}</label>
        <input id={`${id}-name`} autoComplete="name" required maxLength={100} value={contact.name} disabled={disabled} onChange={event => onChange({ ...contact, name: event.target.value })} className={inputClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-email`} className="block text-sm font-medium text-neutral-800">{text.email}</label>
        <input id={`${id}-email`} type="email" autoComplete="email" required maxLength={254} value={contact.email} disabled={disabled} onChange={event => onChange({ ...contact, email: event.target.value })} className={inputClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-phone`} className="block text-sm font-medium text-neutral-800">{text.phone}</label>
        <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel" required maxLength={40} value={contact.phone} disabled={disabled} onChange={event => onChange({ ...contact, phone: event.target.value })} className={inputClass} />
      </div>
      {smsMode !== 'disabled' && (
        <div className="space-y-1">
          <label className="flex min-h-11 items-center gap-3 text-sm text-neutral-950">
            <input type="checkbox" aria-label={locale === 'fr' ? 'Messages texto' : 'Text updates'} aria-describedby={`${id}-sms-details`} disabled={disabled} checked={smsConsent?.granted ?? smsMode === 'default_on'} onChange={event => onSmsChange?.({ granted: event.target.checked, selection: event.target.checked ? 'explicit_on' : 'explicit_off', wordingVersion: BOOKING_SMS_WORDING_VERSION })} className="size-4 accent-neutral-950" />
            {locale === 'fr' ? 'Envoyez-moi les confirmations, rappels, demandes d’avis et promotions du salon par texto' : 'Text me appointment confirmations, reminders, review requests, and salon promotions'}
          </label>
          <p id={`${id}-sms-details`} className="text-xs text-neutral-600">{locale === 'fr' ? 'Vous pouvez désactiver cette option maintenant ou répondre STOP à tout moment.' : 'You can turn this off now or reply STOP at any time.'}</p>
        </div>
      )}
      <p className="text-xs leading-relaxed text-neutral-600">{text.privacy}</p>
      {invalid && <p role="alert" className="text-sm text-red-800">{text.invalid}</p>}
      <button type="submit" disabled={disabled} className="min-h-11 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{text.submit}</button>
    </form>
  );
}
