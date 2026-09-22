'use client';

import { useEffect, useState } from 'react';

import { VoiceMicSandbox } from './VoiceMicSandbox';

type Settings = {
  enabled: boolean;
  bookingEnabled: boolean;
  greeting: string | null;
  voice: 'marin' | 'cedar';
  language: 'auto' | 'en' | 'es';
  answerMode: 'always' | 'after_hours';
  callbackEnabled: boolean;
};
type Call = { id: string; callerNumber: string | null; status: string; outcome: string | null; summary: string | null; appointmentId: string | null; callbackRequested: boolean; durationSeconds: number; createdAt: string };
type Payload = { settings: Settings; readiness: { configured: boolean; numberReady: boolean; globallyEnabled: boolean; providerReady: boolean }; calls: Call[] };

const COPY = {
  en: {
    title: 'AI phone receptionist',
    description: 'Answers inbound calls as an AI receptionist and can book after a caller confirms.',
    readiness: 'A provisioned phone number and required configuration are needed before this can answer calls.',
    answer: 'Answer incoming calls',
    booking: 'Allow appointment booking',
    callbacks: 'Offer callbacks',
    greeting: 'Greeting',
    greetingPlaceholder: 'Leave blank to use the salon greeting.',
    voice: 'Voice',
    language: 'Language',
    answerMode: 'Answer mode',
    automatic: 'Automatic',
    english: 'English',
    spanish: 'Spanish',
    always: 'Always',
    afterHours: 'After hours',
    saving: 'Saving…',
    save: 'Save phone settings',
    loading: 'Loading phone receptionist…',
    loadError: 'Could not load phone receptionist settings.',
    saveError: 'Could not save phone receptionist settings.',
    history: 'Recent calls',
    empty: 'No calls yet. Call audio and full transcripts are not retained here.',
    unknownCaller: 'Unknown caller',
    noSummary: 'No summary available',
    callbackRequested: 'Callback requested',
    noCallback: 'No callback requested',
    appointment: 'View appointment',
    outcomes: { booked: 'Appointment booked', deposit_pending: 'Deposit pending', call_ended: 'Call ended', provider_unavailable: 'Call ended unexpectedly', booking_result_unresolved: 'Booking needs review', step_unresolved: 'Call needs review', confirmation_unavailable: 'Confirmation unavailable', checkpoint_handoff_failed: 'Call needs review', completed: 'Completed', failed: 'Unable to complete', dropped: 'Call ended', created: 'Connecting', accepting: 'Connecting', connected: 'In progress', in_progress: 'In progress', awaiting_confirmation: 'Awaiting confirmation' },
    duration: (minutes: number, seconds: number) => minutes > 0 ? `${minutes} min ${seconds} sec` : `${seconds} sec`,
  },
  es: {
    title: 'Recepcionista telefónica con IA',
    description: 'Responde llamadas entrantes como recepcionista con IA y puede reservar después de la confirmación.',
    readiness: 'Se necesita un número de teléfono configurado y la configuración requerida antes de responder llamadas.',
    answer: 'Responder llamadas entrantes',
    booking: 'Permitir reservas por teléfono',
    callbacks: 'Ofrecer devoluciones de llamada',
    greeting: 'Saludo',
    greetingPlaceholder: 'Déjalo en blanco para usar el saludo del salón.',
    voice: 'Voz',
    language: 'Idioma',
    answerMode: 'Modo de respuesta',
    automatic: 'Automático',
    english: 'Inglés',
    spanish: 'Español',
    always: 'Siempre',
    afterHours: 'Fuera del horario',
    saving: 'Guardando…',
    save: 'Guardar ajustes del teléfono',
    loading: 'Cargando la recepcionista telefónica…',
    loadError: 'No se pudieron cargar los ajustes de la recepcionista.',
    saveError: 'No se pudieron guardar los ajustes de la recepcionista.',
    history: 'Llamadas recientes',
    empty: 'Aún no hay llamadas. Aquí no se conservan el audio ni las transcripciones completas.',
    unknownCaller: 'Número desconocido',
    noSummary: 'No hay resumen disponible',
    callbackRequested: 'Solicitó devolución de llamada',
    noCallback: 'No solicitó devolución de llamada',
    appointment: 'Ver cita',
    outcomes: { booked: 'Cita reservada', deposit_pending: 'Depósito pendiente', call_ended: 'Llamada finalizada', provider_unavailable: 'La llamada terminó inesperadamente', booking_result_unresolved: 'La reserva necesita revisión', step_unresolved: 'La llamada necesita revisión', confirmation_unavailable: 'No se pudo confirmar', checkpoint_handoff_failed: 'La llamada necesita revisión', completed: 'Completada', failed: 'No se pudo completar', dropped: 'Llamada finalizada', created: 'Conectando', accepting: 'Conectando', connected: 'En curso', in_progress: 'En curso', awaiting_confirmation: 'Esperando confirmación' },
    duration: (minutes: number, seconds: number) => minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`,
  },
  fr: {
    title: 'Réceptionniste téléphonique IA',
    description: 'Répond aux appels entrants et peut réserver après la confirmation du client.',
    readiness: 'Un numéro de téléphone configuré et la configuration requise sont nécessaires avant de répondre aux appels.',
    answer: 'Répondre aux appels entrants',
    booking: 'Autoriser les réservations par téléphone',
    callbacks: 'Proposer un rappel',
    greeting: 'Accueil',
    greetingPlaceholder: 'Laissez vide pour utiliser l’accueil du salon.',
    voice: 'Voix',
    language: 'Langue',
    answerMode: 'Mode de réponse',
    automatic: 'Automatique',
    english: 'Anglais',
    spanish: 'Espagnol',
    always: 'Toujours',
    afterHours: 'Après les heures d’ouverture',
    saving: 'Enregistrement…',
    save: 'Enregistrer les réglages du téléphone',
    loading: 'Chargement de la réceptionniste téléphonique…',
    loadError: 'Impossible de charger les réglages de la réceptionniste.',
    saveError: 'Impossible d’enregistrer les réglages de la réceptionniste.',
    history: 'Appels récents',
    empty: 'Aucun appel pour le moment. L’audio et les transcriptions complètes ne sont pas conservés ici.',
    unknownCaller: 'Numéro inconnu',
    noSummary: 'Aucun résumé disponible',
    callbackRequested: 'Rappel demandé',
    noCallback: 'Aucun rappel demandé',
    appointment: 'Voir le rendez-vous',
    outcomes: { booked: 'Rendez-vous réservé', deposit_pending: 'Dépôt en attente', call_ended: 'Appel terminé', provider_unavailable: 'L’appel s’est terminé de façon inattendue', booking_result_unresolved: 'La réservation doit être vérifiée', step_unresolved: 'L’appel doit être vérifié', confirmation_unavailable: 'Confirmation indisponible', checkpoint_handoff_failed: 'L’appel doit être vérifié', completed: 'Terminé', failed: 'Impossible de terminer', dropped: 'Appel terminé', created: 'Connexion', accepting: 'Connexion', connected: 'En cours', in_progress: 'En cours', awaiting_confirmation: 'En attente de confirmation' },
    duration: (minutes: number, seconds: number) => minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`,
  },
} as const;

function settingsRequest(draft: Settings) {
  return {
    enabled: draft.enabled,
    bookingEnabled: draft.bookingEnabled,
    greeting: draft.greeting,
    voice: draft.voice,
    language: draft.language,
    answerMode: draft.answerMode,
    callbackEnabled: draft.callbackEnabled,
  };
}

export function VoiceReceptionistSettings({ salonSlug, locale = 'en' }: { salonSlug: string; locale?: 'en' | 'fr' | 'es' }) {
  const copy = COPY[locale];
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/voice-receptionist?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        if (!response.ok) {
          throw new Error(body?.error?.message || copy.loadError);
        }
        setData(body.data);
        setDraft(body.data.settings);
      }).catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : copy.loadError);
        }
      });
    return () => controller.abort();
  }, [copy.loadError, salonSlug]);
  const save = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/voice-receptionist?salonSlug=${encodeURIComponent(salonSlug)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsRequest(draft)) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || copy.saveError);
      }
      setData(current => current ? { ...current, settings: body.data.settings, readiness: body.data.readiness } : current);
      setDraft(body.data.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveError);
    } finally {
      setSaving(false);
    }
  };
  if (!data || !draft) {
    return <div className="p-4 text-sm text-[var(--owner-muted)]" role={error ? 'alert' : 'status'}>{error ?? copy.loading}</div>;
  }
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft(current => current ? { ...current, [key]: value } : current);
  return (
    <div className="space-y-5 px-4 pb-8 pt-2">
      <section className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
        <p className="text-sm font-semibold text-[var(--owner-ink)]">{copy.title}</p>
        <p className="mt-1 text-sm text-[var(--owner-muted)]">{copy.description}</p>
        {!data.readiness.configured && <p className="mt-3 text-sm text-amber-800" role="status">{copy.readiness}</p>}
        <label className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--owner-ink)]">
          <span>{copy.answer}</span>
          <input aria-label={copy.answer} type="checkbox" checked={draft.enabled} disabled={!data.readiness.configured} onChange={event => update('enabled', event.target.checked)} />
        </label>
        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-[var(--owner-ink)]">
          <span>{copy.booking}</span>
          <input aria-label={copy.booking} type="checkbox" checked={draft.bookingEnabled} onChange={event => update('bookingEnabled', event.target.checked)} />
        </label>
        <label className="mt-3 flex items-center justify-between gap-3 text-sm text-[var(--owner-ink)]">
          <span>{copy.callbacks}</span>
          <input aria-label={copy.callbacks} type="checkbox" checked={draft.callbackEnabled} onChange={event => update('callbackEnabled', event.target.checked)} />
        </label>
      </section>
      <section className="space-y-3 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
        <label className="block text-sm font-medium text-[var(--owner-ink)]">
          {copy.greeting}
          <textarea aria-label={copy.greeting} maxLength={300} value={draft.greeting ?? ''} onChange={event => update('greeting', event.target.value || null)} className="mt-1 min-h-20 w-full rounded-lg border border-[var(--owner-line)] bg-transparent p-2 text-sm" placeholder={copy.greetingPlaceholder} />
        </label>
        <label className="block text-sm font-medium text-[var(--owner-ink)]">
          {copy.voice}
          <select aria-label={copy.voice} value={draft.voice} onChange={event => update('voice', event.target.value as Settings['voice'])} className="ml-2 rounded border border-[var(--owner-line)] bg-transparent p-1">
            <option value="marin">Marin</option>
            <option value="cedar">Cedar</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-[var(--owner-ink)]">
          {copy.language}
          <select aria-label={copy.language} value={draft.language} onChange={event => update('language', event.target.value as Settings['language'])} className="ml-2 rounded border border-[var(--owner-line)] bg-transparent p-1">
            <option value="auto">{copy.automatic}</option>
            <option value="en">{copy.english}</option>
            <option value="es">{copy.spanish}</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-[var(--owner-ink)]">
          {copy.answerMode}
          <select aria-label={copy.answerMode} value={draft.answerMode} onChange={event => update('answerMode', event.target.value as Settings['answerMode'])} className="ml-2 rounded border border-[var(--owner-line)] bg-transparent p-1">
            <option value="always">{copy.always}</option>
            <option value="after_hours">{copy.afterHours}</option>
          </select>
        </label>
        <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-[var(--owner-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? copy.saving : copy.save}</button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>
      <VoiceMicSandbox salonSlug={salonSlug} locale={locale} />
      <section className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
        <p className="text-sm font-semibold text-[var(--owner-ink)]">{copy.history}</p>
        <div className="mt-3 space-y-3">
          {data.calls.length === 0
            ? <p className="text-sm text-[var(--owner-muted)]">{copy.empty}</p>
            : data.calls.map(call => (
              <div key={call.id} className="border-t border-[var(--owner-line)] pt-3 text-sm">
                <p className="font-medium text-[var(--owner-ink)]">
                  {call.callerNumber ?? copy.unknownCaller}
                  {' '}
                  ·
                  {' '}
                  {copy.outcomes[call.outcome as keyof typeof copy.outcomes] ?? copy.outcomes[call.status as keyof typeof copy.outcomes] ?? copy.outcomes.completed}
                </p>
                <p className="mt-1 text-[var(--owner-muted)]">
                  {call.summary ?? copy.noSummary}
                </p>
                <p className="mt-1 text-[var(--owner-muted)]">
                  {new Intl.DateTimeFormat(locale === 'en' ? 'en-CA' : locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(call.createdAt))}
                  {' '}
                  ·
                  {' '}
                  {copy.duration(Math.floor(Math.max(0, call.durationSeconds) / 60), Math.max(0, call.durationSeconds) % 60)}
                  {' '}
                  ·
                  {' '}
                  {call.callbackRequested ? copy.callbackRequested : copy.noCallback}
                </p>
                {call.appointmentId && <a className="mt-2 inline-block font-medium text-[var(--owner-accent)] underline" href={`/${locale}/admin?app=bookings&salon=${encodeURIComponent(salonSlug)}&appointment=${encodeURIComponent(call.appointmentId)}`}>{copy.appointment}</a>}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
