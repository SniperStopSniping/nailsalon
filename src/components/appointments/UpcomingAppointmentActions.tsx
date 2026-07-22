'use client';

import {
  Bell,
  CalendarClock,
  ClipboardList,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Phone,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AppointmentManageDetail } from '@/libs/appointmentManage';
import {
  buildNativeSmsUrl,
  type ClientSmsContext,
  type ClientSmsMessageKind,
  composeClientSmsDraft,
  detectNativeSmsPlatform,
} from '@/libs/clientSmsComposer';
import { notifyRetentionDataChanged } from '@/libs/dashboardEvents';
import { buildDirectionsDestination } from '@/libs/directions';
import type {
  ClientCommunicationKind,
  ClientCommunicationStatus,
} from '@/types/retention';

type PendingOutreach = {
  kind: ClientCommunicationKind;
  label: string;
  body: string;
  appointmentId: string;
};

type ReminderFallback = {
  phone: string;
  body: string;
};

type ReminderResponse = {
  mode: 'automatic' | 'manual';
  sent: boolean;
  reason?: string;
  phone?: string;
  body?: string;
  sentAt?: string;
};

const MESSAGE_KIND_TO_OUTREACH: Record<
  Extract<ClientSmsMessageKind, 'text' | 'appointment_reminder' | 'appointment_details' | 'directions'>,
  ClientCommunicationKind
> = {
  text: 'generic_text',
  appointment_reminder: 'reminder',
  appointment_details: 'appointment_details',
  directions: 'directions',
};

function defaultOpenNativeUrl(href: string): void {
  window.location.assign(href);
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'default',
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`flex min-h-12 items-center gap-2 rounded-2xl border bg-white px-3 py-2 text-left text-[13px] font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none ${tone === 'danger' ? 'border-red-200 text-red-700' : 'border-neutral-200 text-neutral-800'}`}
    >
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-700'}`}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function latestReminderDelivery(detail: AppointmentManageDetail) {
  return detail.communications.find(delivery => (
    delivery.purpose.includes('appointment_reminder')
    && ['queued', 'accepted', 'sent', 'delivered'].includes(delivery.status)
  )) ?? null;
}

export function UpcomingAppointmentActions({
  detail,
  saving,
  onChangeAppointment,
  onCancelAppointment,
  onReminderSent,
  onOpenNativeUrl = defaultOpenNativeUrl,
}: {
  detail: AppointmentManageDetail;
  saving: boolean;
  onChangeAppointment: () => void;
  onCancelAppointment: () => void;
  onReminderSent?: () => void | Promise<void>;
  onOpenNativeUrl?: (href: string) => void;
}) {
  const [preparingKind, setPreparingKind] = useState<ClientSmsMessageKind | null>(null);
  const [pendingOutreach, setPendingOutreach] = useState<PendingOutreach | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<ClientCommunicationStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [reminderDue, setReminderDue] = useState(false);
  const [manualReminderSentAt, setManualReminderSentAt] = useState<string | null>(null);
  const [confirmResend, setConfirmResend] = useState(false);
  const [manualFallback, setManualFallback] = useState<ReminderFallback | null>(null);
  const latestReminder = latestReminderDelivery(detail);

  useEffect(() => {
    const controller = new AbortController();
    const query = detail.appointment.salonSlug
      ? `?salonSlug=${encodeURIComponent(detail.appointment.salonSlug)}`
      : '';
    void fetch(`/api/appointments/${encodeURIComponent(detail.appointment.id)}/communication${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        setReminderDue(payload?.data?.reminderDue === true);
        const latestManualReminder = Array.isArray(payload?.data?.history)
          ? payload.data.history.find((item: { kind?: string; status?: string }) => (
            item.kind === 'reminder' && item.status === 'marked_sent'
          ))
          : null;
        setManualReminderSentAt(latestManualReminder?.updatedAt ?? null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setReminderDue(false);
        }
      });

    return () => controller.abort();
  }, [detail.appointment.id, detail.appointment.salonSlug]);

  const messageContext = useMemo<ClientSmsContext>(() => ({
    client: {
      name: detail.appointment.clientName,
      phone: detail.appointment.clientPhone,
    },
    salon: {
      name: detail.appointment.salonName,
      timeZone: detail.appointment.timeZone,
      currency: 'CAD',
      location: detail.location
        ? {
            ...detail.location,
            parkingInstructions: detail.appointment.parkingInstructions,
          }
        : detail.appointment.parkingInstructions
          ? { parkingInstructions: detail.appointment.parkingInstructions }
          : null,
    },
    appointment: {
      startTime: detail.appointment.startTime,
      endTime: detail.appointment.endTime,
      serviceNames: detail.services.map(service => service.name),
      artistName: detail.technicianOptions.find(
        technician => technician.id === detail.appointment.technicianId,
      )?.name ?? null,
      totalPriceCents: detail.appointment.totalPrice,
    },
  }), [detail]);

  const recordOutreach = useCallback(async (
    outreach: PendingOutreach,
    status: ClientCommunicationStatus,
  ) => {
    const query = detail.appointment.salonSlug
      ? `?salonSlug=${encodeURIComponent(detail.appointment.salonSlug)}`
      : '';
    const response = await fetch(
      `/api/appointments/${encodeURIComponent(detail.appointment.id)}/communication${query}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: outreach.kind,
          status,
          messageSnapshot: outreach.body,
          ...(status === 'snoozed'
            ? { snoozeHours: outreach.kind === 'reminder' ? 3 : undefined }
            : {}),
        }),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Communication history could not be updated.');
    }
    notifyRetentionDataChanged();
  }, [detail.appointment.id, detail.appointment.salonSlug]);

  const openDraft = useCallback((
    kind: Extract<ClientSmsMessageKind, 'text' | 'appointment_reminder' | 'appointment_details' | 'directions'>,
    label: string,
    context: ClientSmsContext,
    serverDraft?: ReminderFallback,
  ) => {
    const draft = serverDraft
      ? (() => {
          const href = buildNativeSmsUrl({
            phone: serverDraft.phone,
            body: serverDraft.body,
            platform: detectNativeSmsPlatform(window.navigator.userAgent),
          });
          return href ? { href, body: serverDraft.body } : null;
        })()
      : composeClientSmsDraft({
        kind,
        context,
        platform: detectNativeSmsPlatform(window.navigator.userAgent),
      });

    if (!draft) {
      setActionError('This client needs a valid mobile number before a text can be prepared.');
      return;
    }

    const outreach: PendingOutreach = {
      kind: MESSAGE_KIND_TO_OUTREACH[kind],
      label,
      body: draft.body,
      appointmentId: detail.appointment.id,
    };
    setActionError(null);
    setActionNotice(null);
    setManualFallback(null);
    setPendingOutreach(outreach);
    void recordOutreach(outreach, 'prepared').catch(() => {
      // Keep the useful draft open even when history persistence is interrupted
      // as iOS switches from the browser to Messages.
    });
    onOpenNativeUrl(draft.href);
  }, [detail.appointment.id, onOpenNativeUrl, recordOutreach]);

  const openAppointmentDraft = useCallback(async (
    kind: 'appointment_details',
    label: string,
  ) => {
    setPreparingKind(kind);
    setActionError(null);
    setActionNotice(null);
    try {
      const query = detail.appointment.salonSlug
        ? `?salonSlug=${encodeURIComponent(detail.appointment.salonSlug)}`
        : '';
      const response = await fetch(
        `/api/appointments/${encodeURIComponent(detail.appointment.id)}/manage-link${query}`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data?.manageUrl) {
        throw new Error(payload?.error?.message || 'The secure appointment link could not be prepared.');
      }
      openDraft(kind, label, {
        ...messageContext,
        appointment: {
          ...messageContext.appointment,
          manageUrl: payload.data.manageUrl,
        },
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The appointment text could not be prepared.');
    } finally {
      setPreparingKind(null);
    }
  }, [detail.appointment.id, detail.appointment.salonSlug, messageContext, openDraft]);

  const sendReminder = useCallback(async (force = false) => {
    setPreparingKind('appointment_reminder');
    setActionError(null);
    setActionNotice(null);
    setManualFallback(null);
    setConfirmResend(false);
    try {
      const query = detail.appointment.salonSlug
        ? `?salonSlug=${encodeURIComponent(detail.appointment.salonSlug)}`
        : '';
      const response = await fetch(
        `/api/appointments/${encodeURIComponent(detail.appointment.id)}/send-reminder${query}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        },
      );
      const payload = await response.json().catch(() => null);
      const fallback = payload?.manualFallback ?? payload?.error?.manualFallback ?? null;
      if (!response.ok) {
        if (fallback?.phone && fallback?.body) {
          setManualFallback(fallback);
        }
        throw new Error(payload?.error?.message || 'The reminder could not be sent.');
      }

      const result = payload?.data as ReminderResponse | undefined;
      if (result?.mode === 'automatic' && result.sent) {
        const duplicateSuppressed = result.reason === 'DUPLICATE_SUPPRESSED';

        setReminderDue(false);
        setActionNotice(
          duplicateSuppressed
            ? 'A reminder was just sent, so the duplicate was skipped.'
            : 'Reminder sent automatically from your salon number.',
        );
        if (!duplicateSuppressed) {
          await recordOutreach({
            kind: 'reminder',
            label: 'Appointment reminder',
            body: 'Automatic appointment reminder sent through Twilio.',
            appointmentId: detail.appointment.id,
          }, 'marked_sent').catch(() => {
            setActionError('The reminder was sent, but its client-history entry could not be updated.');
          });
        }
        await onReminderSent?.();
        return;
      }
      if (result?.mode === 'manual' && result.phone && result.body) {
        openDraft(
          'appointment_reminder',
          'Appointment reminder',
          messageContext,
          { phone: result.phone, body: result.body },
        );
        return;
      }
      throw new Error('The reminder could not be prepared.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The reminder could not be sent.');
    } finally {
      setPreparingKind(null);
    }
  }, [detail.appointment.id, detail.appointment.salonSlug, messageContext, onReminderSent, openDraft, recordOutreach]);

  const finishPendingOutreach = useCallback(async (status: ClientCommunicationStatus) => {
    if (!pendingOutreach) {
      return;
    }
    setRecordingStatus(status);
    setActionError(null);
    try {
      await recordOutreach(pendingOutreach, status);
      if (pendingOutreach.kind === 'reminder' && status !== 'prepared') {
        setReminderDue(false);
      }
      if (pendingOutreach.kind === 'reminder' && status === 'marked_sent') {
        setManualReminderSentAt(new Date().toISOString());
      }
      setPendingOutreach(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Communication history could not be updated.');
    } finally {
      setRecordingStatus(null);
    }
  }, [pendingOutreach, recordOutreach]);

  const resolveReminderDue = useCallback(async (status: 'snoozed' | 'dismissed') => {
    const outreach: PendingOutreach = {
      kind: 'reminder',
      label: 'Appointment reminder',
      body: '',
      appointmentId: detail.appointment.id,
    };
    setActionError(null);
    try {
      await recordOutreach(outreach, status);
      setReminderDue(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The reminder could not be updated.');
    }
  }, [detail.appointment.id, recordOutreach]);

  const hasRecordedReminder = Boolean(latestReminder || manualReminderSentAt);
  const reminderLabel = hasRecordedReminder ? 'Resend reminder' : 'Send reminder';
  const canChange = detail.permissions.canMove
    || detail.permissions.canChangeService
    || detail.permissions.canReassignTechnician;
  const hasDirections = Boolean(
    buildDirectionsDestination(detail.location)
    || detail.appointment.parkingInstructions,
  );

  return (
    <section className="rounded-2xl border border-neutral-200 p-4" data-testid="upcoming-appointment-actions">
      <div className="text-sm font-semibold text-neutral-900">Client actions</div>
      <p className="mt-1 text-xs text-neutral-500">Contact the client or manage this upcoming visit.</p>

      {reminderDue && (
        <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3" data-testid="appointment-reminder-due">
          <p className="text-sm font-semibold text-blue-950">Appointment reminder is due</p>
          <p className="mt-1 text-xs text-blue-800">Send it now, snooze it for 3 hours, or clear it.</p>
          <div className="mt-2 flex gap-3">
            <button type="button" className="text-xs font-semibold text-blue-800 underline" onClick={() => void resolveReminderDue('snoozed')}>
              Snooze 3 hours
            </button>
            <button type="button" className="text-xs font-semibold text-blue-600 underline" onClick={() => void resolveReminderDue('dismissed')}>
              Skip
            </button>
          </div>
        </div>
      )}

      {latestReminder && (
        <p className="mt-3 text-xs text-emerald-700" data-testid="appointment-reminder-last-sent">
          {latestReminder.status === 'queued' || latestReminder.status === 'accepted'
            ? 'Reminder queued'
            : 'Last reminder sent'}
          {' '}
          {new Date(latestReminder.updatedAt).toLocaleString()}
          {' '}
          via
          {' '}
          {latestReminder.channel.toUpperCase()}
        </p>
      )}
      {!latestReminder && manualReminderSentAt && (
        <p className="mt-3 text-xs text-emerald-700" data-testid="appointment-reminder-last-sent">
          Reminder marked sent
          {' '}
          {new Date(manualReminderSentAt).toLocaleString()}
          {' '}
          via SMS draft
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ActionButton
          icon={<Phone size={15} />}
          label="Call"
          onClick={() => onOpenNativeUrl(`tel:${detail.appointment.clientPhone}`)}
        />
        <ActionButton
          icon={<MessageCircle size={15} />}
          label="Text"
          onClick={() => openDraft('text', 'Text', messageContext)}
        />
        <ActionButton
          icon={preparingKind === 'appointment_reminder'
            ? <LoaderCircle size={15} className="animate-spin" />
            : <Bell size={15} />}
          label={reminderLabel}
          disabled={saving || preparingKind !== null}
          testId="appointment-send-reminder"
          onClick={() => {
            if (hasRecordedReminder && !confirmResend) {
              setConfirmResend(true);
              return;
            }
            void sendReminder(false);
          }}
        />
        <ActionButton
          icon={preparingKind === 'appointment_details'
            ? <LoaderCircle size={15} className="animate-spin" />
            : <ClipboardList size={15} />}
          label="Send details"
          disabled={saving || preparingKind !== null}
          onClick={() => void openAppointmentDraft('appointment_details', 'Appointment details')}
        />
        {hasDirections && (
          <ActionButton
            icon={<MapPin size={15} />}
            label="Directions"
            onClick={() => openDraft('directions', 'Directions', messageContext)}
          />
        )}
        {canChange && (
          <ActionButton
            icon={<CalendarClock size={15} />}
            label="Change appointment"
            disabled={saving}
            onClick={onChangeAppointment}
          />
        )}
        {detail.permissions.canCancel && (
          <ActionButton
            icon={<Trash2 size={15} />}
            label="Cancel appointment"
            tone="danger"
            testId="appointment-sheet-cancel"
            disabled={saving}
            onClick={onCancelAppointment}
          />
        )}
      </div>

      {confirmResend && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3" role="alert">
          <p className="text-sm font-semibold text-amber-950">Send another reminder?</p>
          <p className="mt-1 text-xs text-amber-800">A reminder is already recorded for this appointment.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="rounded-full bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => void sendReminder(true)}>
              Send again
            </button>
            <button type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-amber-900" onClick={() => setConfirmResend(false)}>
              Keep existing
            </button>
          </div>
        </div>
      )}

      {manualFallback && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">Automatic delivery was not confirmed.</p>
          <p className="mt-1 text-xs text-amber-800">To avoid a duplicate, open a manual draft only if the client did not receive the reminder.</p>
          <button
            type="button"
            className="mt-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-amber-900"
            onClick={() => openDraft('appointment_reminder', 'Appointment reminder', messageContext, manualFallback)}
          >
            Prepare manual text
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800" role="status">
          {actionNotice}
        </div>
      )}
      {actionError && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {actionError}
        </div>
      )}

      {pendingOutreach && (
        <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3" role="dialog" aria-label="Confirm text status">
          <p className="text-sm font-semibold text-blue-950">
            Did you send the
            {' '}
            {pendingOutreach.label.toLowerCase()}
            ?
          </p>
          <p className="mt-1 text-xs text-blue-800">Confirm what happened so the client history stays accurate.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={recordingStatus !== null} className="rounded-full bg-blue-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" onClick={() => void finishPendingOutreach('marked_sent')}>
              {recordingStatus === 'marked_sent' ? 'Saving…' : 'Mark as sent'}
            </button>
            <button type="button" disabled={recordingStatus !== null} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-blue-900 disabled:opacity-50" onClick={() => void finishPendingOutreach('not_sent')}>
              Not sent
            </button>
            {pendingOutreach.kind === 'reminder' && (
              <button type="button" disabled={recordingStatus !== null} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-blue-900 disabled:opacity-50" onClick={() => void finishPendingOutreach('snoozed')}>
                Snooze 3 hours
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
