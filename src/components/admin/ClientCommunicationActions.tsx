'use client';

import {
  Bell,
  CalendarPlus,
  ClipboardList,
  Gift,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Phone,
  RotateCcw,
  Smile,
  Star,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import {
  buildNativeSmsUrl,
  type ClientSmsAppointment,
  type ClientSmsContext,
  type ClientSmsMessageKind,
  composeClientSmsDraft,
  detectNativeSmsPlatform,
} from '@/libs/clientSmsComposer';
import { notifyRetentionDataChanged } from '@/libs/dashboardEvents';
import { resolveDirectionsLocation } from '@/libs/directions';
import {
  type ClientCommunicationKind,
  type ClientCommunicationStatus,
  REMINDER_SNOOZE_HOURS,
  RETENTION_SNOOZE_DAYS,
  type RetentionPromotionSettings,
  type RetentionSettings,
  type RetentionStage,
} from '@/types/retention';

type SalonLocation = {
  id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
};

export type CommunicationAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  technician: { name: string } | null;
  location?: SalonLocation | null;
  services: Array<{ name: string }>;
};

type OutreachKind = ClientCommunicationKind;

type OutreachStatus = Extract<
  ClientCommunicationStatus,
  'prepared' | 'marked_sent' | 'not_sent' | 'snoozed'
>;

type PendingOutreach = {
  kind: OutreachKind;
  label: string;
  messageSnapshot: string;
  appointmentId?: string;
};

type SupportData = {
  settings: RetentionSettings;
  location: SalonLocation | null;
  bookingUrl: string | null;
  timeZone: string | null;
};

type CommunicationHistoryItem = {
  id: string;
  appointmentId: string | null;
  kind: ClientCommunicationKind;
  status: ClientCommunicationStatus;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

type AppointmentReminderItem = {
  appointmentId: string;
  clientId: string;
  startTime: string;
};

type PromotionSettingsStage = Extract<
  RetentionStage,
  'promo_6w' | 'promo_8w'
>;

function openNativeUrl(href: string): void {
  window.location.assign(href);
}

const DEFAULT_SUPPORT_DATA: SupportData = {
  settings: {
    defaultRebookDays: 21,
    reminderLeadHours: 24,
    googleReviewUrl: null,
    parkingInstructions: null,
    sixWeekPromotion: {
      enabled: false,
      name: 'We miss you',
      discountType: 'percent',
      value: 0,
      eligibleServiceIds: [],
      expiryDays: 14,
      code: null,
      messageTemplate: 'Hi {firstName}, enjoy {offer} at {salonName}: {bookingLink}',
      singleUse: true,
    },
    eightWeekPromotion: {
      enabled: false,
      name: 'Come back soon',
      discountType: 'percent',
      value: 0,
      eligibleServiceIds: [],
      expiryDays: 14,
      code: null,
      messageTemplate: 'Hi {firstName}, enjoy {offer} at {salonName}: {bookingLink}',
      singleUse: true,
    },
  },
  location: null,
  bookingUrl: null,
  timeZone: null,
};

const MESSAGE_KIND_TO_OUTREACH: Record<ClientSmsMessageKind, OutreachKind> = {
  text: 'generic_text',
  rebook: 'rebook',
  appointment_reminder: 'reminder',
  appointment_details: 'appointment_details',
  directions: 'directions',
  satisfaction: 'satisfaction',
  google_review: 'google_review',
};

const HISTORY_KIND_LABELS: Record<ClientCommunicationKind, string> = {
  generic_text: 'Text',
  rebook: 'Rebook request',
  reminder: 'Appointment reminder',
  appointment_details: 'Appointment details',
  directions: 'Directions',
  satisfaction: 'Satisfaction question',
  google_review: 'Google review request',
  promo_6w: 'Six-week promotion',
  promo_8w: 'Eight-week promotion',
};

const HISTORY_STATUS_LABELS: Record<ClientCommunicationStatus, string> = {
  prepared: 'Prepared',
  marked_sent: 'Marked sent',
  not_sent: 'Not sent',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
  converted: 'Converted',
};

function formatPromotionOffer(promotion: RetentionPromotionSettings): string {
  if (promotion.discountType === 'percent') {
    return `${promotion.value}% off`;
  }

  return `${new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(promotion.value / 100)} off`;
}

function firstNameForMessage(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || 'there';
}

function renderPromotionMessage(args: {
  promotion: RetentionPromotionSettings;
  firstName: string;
  salonName: string;
  bookingUrl: string;
  expiresAt: string;
}): string {
  const expiry = new Date(args.expiresAt).toLocaleDateString('en-CA', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const replacements: Record<string, string> = {
    '{firstName}': args.firstName,
    '{salonName}': args.salonName,
    '{offer}': formatPromotionOffer(args.promotion),
    '{expiry}': expiry,
    '{bookingLink}': args.bookingUrl,
  };

  let message = args.promotion.messageTemplate;
  for (const [placeholder, value] of Object.entries(replacements)) {
    message = message.split(placeholder).join(value);
  }

  if (args.promotion.code && !message.includes(args.promotion.code)) {
    message = `${message}\nUse code ${args.promotion.code}.`;
  }
  return message;
}

function toSmsAppointment(
  appointment: CommunicationAppointment | null | undefined,
  manageUrl?: string | null,
): ClientSmsAppointment | null {
  if (!appointment) {
    return null;
  }

  return {
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    serviceNames: appointment.services.map(service => service.name),
    artistName: appointment.technician?.name ?? null,
    totalPriceCents: appointment.totalPrice,
    manageUrl,
  };
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  title,
  testId,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className="flex min-h-12 items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-left text-[13px] font-semibold text-stone-800 shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:shadow-none"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export function ClientCommunicationActions({
  salonSlug,
  salonName,
  client,
  upcomingAppointment,
  lastCompletedAppointment,
  completedAppointmentCount,
  hasGoogleReview,
  onBookAppointment,
  onOpenPromotionSettings,
  onOpenNativeUrl = openNativeUrl,
}: {
  salonSlug: string;
  salonName: string;
  client: { id: string; fullName: string | null; phone: string };
  upcomingAppointment?: CommunicationAppointment | null;
  lastCompletedAppointment?: CommunicationAppointment | null;
  completedAppointmentCount: number;
  hasGoogleReview: boolean;
  onBookAppointment: () => void;
  onOpenPromotionSettings?: (stage: PromotionSettingsStage) => void;
  onOpenNativeUrl?: (href: string) => void;
}) {
  const [supportData, setSupportData] = useState<SupportData>(DEFAULT_SUPPORT_DATA);
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [preparingKind, setPreparingKind] = useState<ClientSmsMessageKind | null>(null);
  const [preparingPromotion, setPreparingPromotion] = useState<RetentionStage | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingOutreach, setPendingOutreach] = useState<PendingOutreach | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<OutreachStatus | null>(null);
  const [history, setHistory] = useState<CommunicationHistoryItem[]>([]);
  const [retentionStage, setRetentionStage] = useState<RetentionStage | null>(null);
  const [reminderDue, setReminderDue] = useState<AppointmentReminderItem | null>(null);
  const [reviewRecorded, setReviewRecorded] = useState(hasGoogleReview);
  const [markingReviewed, setMarkingReviewed] = useState(false);

  const loadSupportData = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    setSupportLoading(true);
    setSupportError(null);
    try {
      const query = `salonSlug=${encodeURIComponent(salonSlug)}`;
      const [settingsResponse, locationResponse, todayResponse, retentionResponse] = await Promise.all([
        fetch(`/api/admin/retention/settings?${query}`, { cache: 'no-store' }),
        fetch(`/api/admin/location?${query}`, { cache: 'no-store' }),
        fetch(`/api/admin/today?${query}`, { cache: 'no-store' }),
        fetch(`/api/admin/retention?${query}&clientId=${encodeURIComponent(client.id)}`, { cache: 'no-store' }),
      ]);
      const [settingsPayload, locationPayload, todayPayload, retentionPayload] = await Promise.all([
        settingsResponse.json().catch(() => null),
        locationResponse.json().catch(() => null),
        todayResponse.json().catch(() => null),
        retentionResponse.json().catch(() => null),
      ]);

      if (!settingsResponse.ok) {
        throw new Error(
          settingsPayload?.error?.message || 'Communication settings could not be loaded.',
        );
      }

      setSupportData({
        settings: {
          ...DEFAULT_SUPPORT_DATA.settings,
          ...(settingsPayload?.data?.settings ?? {}),
        },
        location: locationResponse.ok ? (locationPayload?.data?.location ?? null) : null,
        bookingUrl: todayResponse.ok ? (todayPayload?.data?.links?.bookingUrl ?? null) : null,
        timeZone: todayResponse.ok ? (todayPayload?.data?.timeZone ?? null) : null,
      });
      if (retentionResponse.ok) {
        setHistory(retentionPayload?.data?.history ?? []);
        const ownQueueItem = (retentionPayload?.data?.retention ?? []).find(
          (item: { clientId?: string }) => item.clientId === client.id,
        );
        setRetentionStage(ownQueueItem?.stage ?? null);
        const ownReminder = (retentionPayload?.data?.appointmentReminders ?? []).find(
          (item: AppointmentReminderItem) => item.clientId === client.id
            && (!upcomingAppointment || item.appointmentId === upcomingAppointment.id),
        );
        setReminderDue(ownReminder ?? null);
      }
    } catch (error) {
      setSupportError(
        error instanceof Error
          ? error.message
          : 'Communication settings could not be loaded.',
      );
    } finally {
      setSupportLoading(false);
    }
  }, [client.id, salonSlug, upcomingAppointment]);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  useEffect(() => {
    setReviewRecorded(hasGoogleReview);
  }, [hasGoogleReview]);

  const baseContext = useMemo<ClientSmsContext>(() => {
    const directionsLocation = resolveDirectionsLocation(
      upcomingAppointment?.location,
      supportData.location,
    );

    return {
      client: {
        name: client.fullName,
        phone: client.phone,
      },
      salon: {
        name: salonName,
        bookingUrl: supportData.bookingUrl,
        googleReviewUrl: supportData.settings.googleReviewUrl,
        timeZone: supportData.timeZone,
        currency: 'CAD',
        location: directionsLocation
          ? {
              ...directionsLocation,
              parkingInstructions: supportData.settings.parkingInstructions,
            }
          : {
              parkingInstructions: supportData.settings.parkingInstructions,
            },
      },
    };
  }, [
    client.fullName,
    client.phone,
    salonName,
    supportData,
    upcomingAppointment?.location,
  ]);

  const recordOutreach = useCallback(async (
    outreach: PendingOutreach,
    status: ClientCommunicationStatus,
  ) => {
    const response = await fetch('/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: status === 'prepared',
      body: JSON.stringify({
        salonSlug,
        clientId: client.id,
        appointmentId: outreach.appointmentId,
        kind: outreach.kind,
        status,
        messageSnapshot: outreach.messageSnapshot,
        ...(status === 'snoozed'
          ? outreach.kind === 'reminder'
            ? { snoozeHours: REMINDER_SNOOZE_HOURS }
            : { snoozeDays: RETENTION_SNOOZE_DAYS }
          : {}),
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message || 'Communication history could not be updated.');
    }
    const payload = await response.json().catch(() => null);
    const communication = payload?.data?.communication as CommunicationHistoryItem | undefined;
    if (communication) {
      setHistory(current => [
        communication,
        ...current.filter(item => item.id !== communication.id),
      ].slice(0, 100));
    }
    notifyRetentionDataChanged();
    if (
      outreach.kind === 'reminder'
      && status !== 'prepared'
      && outreach.appointmentId === reminderDue?.appointmentId
    ) {
      setReminderDue(null);
    }
    return communication ?? null;
  }, [client.id, reminderDue?.appointmentId, salonSlug]);

  const openDraft = useCallback((
    kind: ClientSmsMessageKind,
    label: string,
    appointment: ClientSmsAppointment | null,
    appointmentId?: string,
  ) => {
    const draft = composeClientSmsDraft({
      kind,
      context: { ...baseContext, appointment },
      platform: detectNativeSmsPlatform(window.navigator.userAgent),
    });

    if (!draft) {
      setActionError(
        kind === 'google_review'
          ? 'Add your direct Google review link in Promotion Settings first.'
          : 'This client needs a valid mobile number before a text can be prepared.',
      );
      return;
    }

    const outreach: PendingOutreach = {
      kind: MESSAGE_KIND_TO_OUTREACH[kind],
      label,
      messageSnapshot: draft.body,
      appointmentId,
    };
    setActionError(null);
    setPendingOutreach(outreach);
    void recordOutreach(outreach, 'prepared').catch(() => {
      // The draft remains useful even if the history request is interrupted as
      // iOS switches applications. The follow-up choice retries persistence.
    });
    onOpenNativeUrl(draft.href);
  }, [baseContext, onOpenNativeUrl, recordOutreach]);

  const openAppointmentDraft = useCallback(async (
    kind: 'appointment_reminder' | 'appointment_details',
    label: string,
  ) => {
    if (!upcomingAppointment) {
      setActionError('This client does not have an upcoming appointment.');
      return;
    }

    setPreparingKind(kind);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/appointments/${encodeURIComponent(upcomingAppointment.id)}/manage-link?salonSlug=${encodeURIComponent(salonSlug)}`,
        { method: 'POST' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data?.manageUrl) {
        throw new Error(payload?.error?.message || 'The secure appointment link could not be prepared.');
      }

      openDraft(
        kind,
        label,
        toSmsAppointment(upcomingAppointment, payload.data.manageUrl),
        upcomingAppointment.id,
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The secure appointment link could not be prepared.',
      );
    } finally {
      setPreparingKind(null);
    }
  }, [openDraft, salonSlug, upcomingAppointment]);

  const preparePromotion = useCallback(async (
    stage: Extract<RetentionStage, 'promo_6w' | 'promo_8w'>,
  ) => {
    const promotion = stage === 'promo_6w'
      ? supportData.settings.sixWeekPromotion
      : supportData.settings.eightWeekPromotion;
    if (!promotion.enabled || promotion.value <= 0) {
      setActionError(null);
      if (onOpenPromotionSettings) {
        onOpenPromotionSettings(stage);
      } else {
        setActionError('Configure and enable this offer in Promotion Settings first.');
      }
      return;
    }

    const label = stage === 'promo_6w' ? 'Six-week promotion' : 'Eight-week promotion';
    const provisionalOutreach: PendingOutreach = {
      kind: stage,
      label,
      messageSnapshot: '',
    };
    setPreparingPromotion(stage);
    setActionError(null);
    try {
      const communication = await recordOutreach(provisionalOutreach, 'prepared');
      const response = await fetch('/api/admin/retention/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          clientId: client.id,
          stage,
          ...(communication?.id ? { communicationId: communication.id } : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      const campaign = payload?.data?.campaign;
      if (!response.ok || !campaign?.bookingUrl || !campaign?.expiresAt) {
        throw new Error(payload?.error?.message || 'The secure promotion link could not be prepared.');
      }

      const messageSnapshot = renderPromotionMessage({
        promotion,
        firstName: firstNameForMessage(client.fullName),
        salonName,
        bookingUrl: campaign.bookingUrl,
        expiresAt: campaign.expiresAt,
      });
      const href = buildNativeSmsUrl({
        phone: client.phone,
        body: messageSnapshot,
        platform: detectNativeSmsPlatform(window.navigator.userAgent),
      });
      if (!href) {
        throw new Error('This client needs a valid mobile number before a text can be prepared.');
      }

      const outreach = { ...provisionalOutreach, messageSnapshot };
      await recordOutreach(outreach, 'prepared');
      setPendingOutreach(outreach);
      onOpenNativeUrl(href);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The promotion could not be prepared.',
      );
    } finally {
      setPreparingPromotion(null);
    }
  }, [
    client.fullName,
    client.id,
    client.phone,
    onOpenPromotionSettings,
    onOpenNativeUrl,
    recordOutreach,
    salonName,
    salonSlug,
    supportData.settings.eightWeekPromotion,
    supportData.settings.sixWeekPromotion,
  ]);

  const resolveRetentionAlert = useCallback(async (
    status: Extract<ClientCommunicationStatus, 'snoozed' | 'dismissed'>,
  ) => {
    if (!retentionStage) {
      return;
    }
    const outreach: PendingOutreach = {
      kind: retentionStage,
      label: HISTORY_KIND_LABELS[retentionStage],
      messageSnapshot: '',
    };
    setActionError(null);
    try {
      await recordOutreach(outreach, status);
      setRetentionStage(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The retention alert could not be updated.',
      );
    }
  }, [recordOutreach, retentionStage]);

  const markAlreadyReviewed = useCallback(async () => {
    if (!lastCompletedAppointment) {
      return;
    }
    setMarkingReviewed(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/appointments/${encodeURIComponent(lastCompletedAppointment.id)}/review-followup?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'already_reviewed' }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.data?.clientHasGoogleReview !== true) {
        throw new Error(payload?.error?.message || 'The review status could not be updated.');
      }
      setReviewRecorded(true);
      void recordOutreach({
        kind: 'google_review',
        label: 'Google review',
        messageSnapshot: 'Client already reviewed; no request sent.',
        appointmentId: lastCompletedAppointment.id,
      }, 'dismissed').catch(() => {
        setActionError('Review status was saved, but the communication timeline could not be updated.');
      });
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The review status could not be updated.',
      );
    } finally {
      setMarkingReviewed(false);
    }
  }, [lastCompletedAppointment, recordOutreach, salonSlug]);

  const resolveReminderAlert = useCallback(async (
    status: Extract<ClientCommunicationStatus, 'snoozed' | 'dismissed'>,
  ) => {
    if (!reminderDue) {
      return;
    }
    setActionError(null);
    try {
      await recordOutreach({
        kind: 'reminder',
        label: 'Appointment reminder',
        messageSnapshot: '',
        appointmentId: reminderDue.appointmentId,
      }, status);
      setReminderDue(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The reminder alert could not be updated.',
      );
    }
  }, [recordOutreach, reminderDue]);

  const finishPendingOutreach = useCallback(async (status: OutreachStatus) => {
    if (!pendingOutreach) {
      return;
    }

    setRecordingStatus(status);
    setActionError(null);
    try {
      await recordOutreach(pendingOutreach, status);
      if (
        (status === 'marked_sent' || status === 'snoozed')
        && ['rebook', 'promo_6w', 'promo_8w'].includes(pendingOutreach.kind)
      ) {
        setRetentionStage(null);
      }
      setPendingOutreach(null);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Communication history could not be updated.',
      );
    } finally {
      setRecordingStatus(null);
    }
  }, [pendingOutreach, recordOutreach]);

  const reviewDisabled = completedAppointmentCount < 1
    || !supportData.settings.googleReviewUrl
    || reviewRecorded;
  const reviewDisabledTitle = completedAppointmentCount < 1
    ? 'Available after a completed appointment'
    : reviewRecorded
      ? 'This client is already marked as reviewed'
      : !supportData.settings.googleReviewUrl
          ? 'Add a Google review link in Promotion Settings'
          : undefined;

  return (
    <div className="mt-4 w-full" data-testid="client-communication-actions">
      {reminderDue && (
        <div className="mb-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-left" data-testid="client-reminder-alert">
          <p className="text-sm font-semibold text-blue-950">Appointment reminder is due</p>
          <p className="mt-1 text-xs text-blue-800">
            Use Send reminder below to prepare the secure message, or clear this reminder.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              className="text-xs font-semibold text-blue-800 underline"
              onClick={() => void resolveReminderAlert('snoozed')}
            >
              Snooze 3 hours
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-blue-600 underline"
              onClick={() => void resolveReminderAlert('dismissed')}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {retentionStage && (
        <div
          className={`mb-3 rounded-2xl border p-3 text-left ${retentionStage === 'promo_8w'
            ? 'border-purple-200 bg-purple-50'
            : retentionStage === 'promo_6w'
              ? 'border-orange-200 bg-orange-50'
              : 'border-blue-200 bg-blue-50'}`}
          data-testid="client-retention-alert"
        >
          <p className="text-sm font-semibold text-stone-950">
            {retentionStage === 'promo_8w'
              ? 'Eight-week win-back is ready'
              : retentionStage === 'promo_6w'
                ? 'Six-week win-back is ready'
                : 'This client is due for rebooking'}
          </p>
          <p className="mt-1 text-xs text-stone-600">
            {retentionStage === 'rebook'
              ? 'Prepare a friendly rebooking text, book for the client, or snooze this reminder.'
              : 'Send the configured secure offer, rebook without a promotion, or clear this alert.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs font-semibold text-stone-700 underline"
              onClick={() => void resolveRetentionAlert('snoozed')}
            >
              Snooze 7 days
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-stone-500 underline"
              onClick={() => void resolveRetentionAlert('dismissed')}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ActionButton
          icon={<Phone size={15} />}
          label="Call"
          onClick={() => onOpenNativeUrl(`tel:${client.phone}`)}
        />
        <ActionButton
          icon={<MessageCircle size={15} />}
          label="Text"
          onClick={() => openDraft('text', 'Text', null)}
        />
        <ActionButton
          icon={<RotateCcw size={15} />}
          label="Rebook"
          onClick={() => openDraft(
            'rebook',
            'Rebook request',
            toSmsAppointment(lastCompletedAppointment),
          )}
        />
        {(retentionStage === 'promo_6w' || retentionStage === 'promo_8w') && (
          <ActionButton
            icon={preparingPromotion
              ? <LoaderCircle size={15} className="animate-spin" />
              : <Gift size={15} />}
            label={retentionStage === 'promo_6w' ? 'Send 6-week offer' : 'Send 8-week offer'}
            disabled={preparingPromotion !== null}
            onClick={() => void preparePromotion(retentionStage)}
          />
        )}
        <ActionButton
          icon={preparingKind === 'appointment_reminder'
            ? <LoaderCircle size={15} className="animate-spin" />
            : <Bell size={15} />}
          label="Send reminder"
          disabled={!upcomingAppointment || preparingKind !== null}
          title={!upcomingAppointment ? 'No upcoming appointment' : undefined}
          onClick={() => void openAppointmentDraft('appointment_reminder', 'Appointment reminder')}
        />
        <ActionButton
          icon={preparingKind === 'appointment_details'
            ? <LoaderCircle size={15} className="animate-spin" />
            : <ClipboardList size={15} />}
          label="Appointment details"
          disabled={!upcomingAppointment || preparingKind !== null}
          title={!upcomingAppointment ? 'No upcoming appointment' : undefined}
          onClick={() => void openAppointmentDraft('appointment_details', 'Appointment details')}
        />
        <ActionButton
          icon={<MapPin size={15} />}
          label="Directions"
          onClick={() => openDraft('directions', 'Directions', null)}
        />
        <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-3">
          <ActionButton
            icon={<Smile size={15} />}
            label="Happy?"
            disabled={completedAppointmentCount < 1}
            title={completedAppointmentCount < 1 ? 'Available after a completed appointment' : undefined}
            onClick={() => openDraft('satisfaction', 'Satisfaction question', null)}
          />
          <ActionButton
            icon={<Star size={15} />}
            label="Google review"
            disabled={reviewDisabled || supportLoading}
            title={reviewDisabledTitle}
            onClick={() => openDraft('google_review', 'Google review request', null)}
          />
        </div>
        <ActionButton
          icon={<CalendarPlus size={15} />}
          label="Book for client"
          onClick={onBookAppointment}
          testId="client-book-appointment"
        />
      </div>

      {completedAppointmentCount > 0 && (
        <div className="mt-2 text-left text-xs text-stone-500">
          {reviewRecorded
            ? 'Google review already recorded — review requests are suppressed.'
            : (
                <button
                  type="button"
                  className="font-semibold text-stone-600 underline disabled:opacity-50"
                  disabled={markingReviewed}
                  onClick={() => void markAlreadyReviewed()}
                >
                  {markingReviewed ? 'Saving review status…' : 'Client already reviewed? Mark it'}
                </button>
              )}
        </div>
      )}

      {supportError && (
        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
          {supportError}
          {' '}
          <button type="button" className="font-semibold underline" onClick={() => void loadSupportData()}>
            Try again
          </button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-left text-xs text-red-800">
          {actionError}
        </div>
      )}

      {pendingOutreach && (
        <div
          role="dialog"
          aria-label="Confirm text status"
          className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-left"
          data-testid="outreach-send-confirmation"
        >
          <p className="text-sm font-semibold text-blue-950">
            Did you send the
            {' '}
            {pendingOutreach.label.toLowerCase()}
            ?
          </p>
          <p className="mt-1 text-xs text-blue-800">
            Messages cannot report delivery back to Luster. Choose what happened so the client history stays accurate.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="brand"
              size="pillSm"
              disabled={recordingStatus !== null}
              onClick={() => void finishPendingOutreach('marked_sent')}
            >
              {recordingStatus === 'marked_sent' ? 'Saving…' : 'Mark as sent'}
            </Button>
            <Button
              type="button"
              variant="brandSoft"
              size="pillSm"
              disabled={recordingStatus !== null}
              onClick={() => void finishPendingOutreach('not_sent')}
            >
              Not sent
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="pillSm"
              disabled={recordingStatus !== null}
              onClick={() => void finishPendingOutreach('snoozed')}
            >
              {pendingOutreach.kind === 'reminder'
                ? 'Snooze 3 hours'
                : 'Snooze 7 days'}
            </Button>
          </div>
        </div>
      )}

      <details className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-left">
        <summary className="cursor-pointer text-sm font-semibold text-stone-800">
          Communication history
          {history.length > 0 ? ` (${history.length})` : ''}
        </summary>
        {history.length === 0
          ? (
              <p className="mt-2 text-xs text-stone-500">No outreach has been recorded yet.</p>
            )
          : (
              <ol className="mt-3 space-y-2" data-testid="client-communication-history">
                {history.map(item => (
                  <li key={item.id} className="rounded-xl bg-white px-3 py-2 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs font-semibold text-stone-800">
                        {HISTORY_KIND_LABELS[item.kind] ?? item.kind}
                      </span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                        {HISTORY_STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-stone-500">
                      {new Date(item.updatedAt || item.createdAt).toLocaleString('en-CA', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {item.status === 'snoozed' && item.snoozedUntil
                        ? ` · until ${new Date(item.snoozedUntil).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
      </details>
    </div>
  );
}
