'use client';

import { useState } from 'react';

import type { CustomerAssistantAction, CustomerAssistantLocale, CustomerAssistantResult } from '@/libs/customerAssistant/contracts';

const scheduleCopy = {
  en: {
    accept: 'Choose these services',
    date: 'What day works for you?',
    show: 'Show available times',
    input: 'Preferred date',
    availability: 'Available times',
    empty: 'No matching times are available. Try another day or time.',
    note: 'Times are checked live. Choosing a time does not reserve it.',
    selected: 'Selected time',
    pending: 'This time is not held and no appointment has been created. Add your contact details to review and confirm your booking.',
    stale: 'That time is no longer available. Here are the current options.',
    change: 'Choose another date',
  },
  fr: {
    accept: 'Choisir ces services',
    date: 'Quel jour vous convient ?',
    show: 'Voir les disponibilités',
    input: 'Date souhaitée',
    availability: 'Heures disponibles',
    empty: 'Aucune heure ne correspond. Essayez un autre jour ou une autre heure.',
    note: 'Les disponibilités sont vérifiées en direct. Choisir une heure ne la réserve pas.',
    selected: 'Heure choisie',
    pending: 'Cette heure n’est pas réservée et aucun rendez-vous n’a été créé. Ajoutez vos coordonnées pour vérifier et confirmer votre réservation.',
    stale: 'Cette heure n’est plus disponible. Voici les options actuelles.',
    change: 'Choisir une autre date',
  },
};

type SchedulingResult = Extract<CustomerAssistantResult, { kind: 'date_prompt' | 'slots' | 'slot_selected' }>;

export function AcceptSelection({ fingerprint, locale, disabled, onAction }: { fingerprint: string; locale: CustomerAssistantLocale; disabled: boolean; onAction: (action: CustomerAssistantAction) => void }) {
  return <button type="button" disabled={disabled} onClick={() => onAction({ action: 'accept_selection', fingerprint })} className="mt-3 min-h-11 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{scheduleCopy[locale].accept}</button>;
}

export function ScheduleCards({ result, locale, disabled, onAction }: { result: SchedulingResult; locale: CustomerAssistantLocale; disabled: boolean; onAction: (action: CustomerAssistantAction) => void }) {
  const copy = scheduleCopy[locale];
  const [date, setDate] = useState('');
  const selectedDate = result.kind === 'date_prompt' ? result.today : result.preference.date;
  const dateLabel = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedDate}T12:00:00Z`));
  const timeLabel = (startTime: string) => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { hour: 'numeric', minute: '2-digit', timeZone: result.timeZone }).format(new Date(startTime));

  return (
    <section aria-label={copy.availability} className="space-y-3 rounded-2xl border border-black/10 bg-white p-4">
      <h3 className="font-semibold text-neutral-950">{result.kind === 'date_prompt' ? copy.date : dateLabel}</h3>
      {result.kind === 'slots' && (
        <>
          {result.slotDisappeared && <p role="status" className="text-sm text-amber-900">{copy.stale}</p>}
          <div className="flex flex-wrap gap-2">
            {result.slots.map(slot => <button key={slot.startTime} type="button" disabled={disabled} onClick={() => onAction({ action: 'select_slot', startTime: slot.startTime })} className="min-h-11 rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50">{timeLabel(slot.startTime)}</button>)}
          </div>
          {result.slots.length === 0 && <p role="status" className="text-sm text-neutral-700">{copy.empty}</p>}
          <p className="text-xs text-neutral-600">{copy.note}</p>
        </>
      )}
      {result.kind === 'slot_selected' && (
        <div role="status" className="space-y-2 text-sm text-neutral-700">
          <p className="font-semibold">
            {copy.selected}
            :
            {' '}
            {timeLabel(result.slot.startTime)}
          </p>
          <p>{copy.pending}</p>
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="customer-assistant-date" className="block text-sm font-medium text-neutral-800">{result.kind === 'date_prompt' ? copy.input : copy.change}</label>
        <input id="customer-assistant-date" type="date" value={date || selectedDate} onChange={event => setDate(event.target.value)} disabled={disabled} className="min-h-11 w-full min-w-0 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-950" />
        <button type="button" disabled={disabled} onClick={() => onAction({ action: 'choose_date', date: date || selectedDate })} className="min-h-11 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{copy.show}</button>
      </div>
    </section>
  );
}
