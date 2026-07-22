'use client';

import { CalendarPlus, Clock3, Mail, MapPin, UserRound } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { UpcomingAppointmentActions } from '@/components/appointments/UpcomingAppointmentActions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import type { AppointmentManageDetail, ManageWarning } from '@/libs/appointmentManage';
import { formatAppointmentStatus } from '@/libs/appointmentStatusDisplay';
import { themeVars } from '@/theme';

type AppointmentQuickEditSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  detail: AppointmentManageDetail | null;
  loading: boolean;
  saving: boolean;
  actionError: string | null;
  attemptedTimeLabel?: string | null;
  warnings?: ManageWarning[];
  photos?: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    photoType: string;
  }>;
  uploadingPhoto?: boolean;
  onUploadPhoto?: (photoType: 'before' | 'after') => void;
  onSaveEdits: (args: {
    baseServiceId: string;
    technicianId: string | null;
    startTime: string;
  }) => Promise<void>;
  onMoveToNextAvailable: () => Promise<void>;
  onCancelAppointment: (args: { reason: string; internalNote?: string }) => Promise<void>;
  /** Opens the dedicated Complete-appointment checkout flow. */
  onMarkCompleted: () => void | Promise<void>;
  onStartAppointment: () => Promise<void>;
  onConfirmAppointment?: () => Promise<void>;
  onMarkNoShow?: () => Promise<void>;
  onResendConfirmation?: () => Promise<void>;
  onRebook?: () => void;
  /** Opens the snapshot receipt for a completed appointment. */
  onViewReceipt?: () => void;
  /** Called when the detail failed to load and the user wants to retry. */
  onRetryLoad?: () => void;
  /** Refreshes delivery history after an automatic reminder succeeds. */
  onReminderSent?: () => void | Promise<void>;
  /** Opens the given confirmation as soon as detail loads (e.g. a Cancel button on an appointment card). */
  initialPendingAction?: 'cancel' | null;
};

const EMPTY_WARNINGS: ManageWarning[] = [];
const EMPTY_PHOTOS: NonNullable<AppointmentQuickEditSheetProps['photos']> = [];

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDateTimeValue(iso: string) {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function warningMessage(warning: ManageWarning) {
  switch (warning) {
    case 'INVALID_ADD_ONS_REMOVED':
      return 'Some add-ons no longer match the updated service and will be removed.';
    case 'LEGACY_MULTI_SERVICE_REPLACED':
      return 'Legacy multi-service booking was simplified to the new service selection.';
    default:
      return 'Appointment details were updated.';
  }
}

export function AppointmentQuickEditSheet({
  isOpen,
  onClose,
  detail,
  loading,
  saving,
  actionError,
  attemptedTimeLabel,
  warnings = EMPTY_WARNINGS,
  photos = EMPTY_PHOTOS,
  uploadingPhoto = false,
  onUploadPhoto,
  onSaveEdits,
  onMoveToNextAvailable,
  onCancelAppointment,
  onMarkCompleted,
  onStartAppointment,
  onConfirmAppointment,
  onMarkNoShow,
  onResendConfirmation,
  onRebook,
  onViewReceipt,
  onRetryLoad,
  onReminderSent,
  initialPendingAction = null,
}: AppointmentQuickEditSheetProps) {
  const [baseServiceId, setBaseServiceId] = useState('');
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('');
  const [cancelReason, setCancelReason] = useState('client_request');
  const [internalNote, setInternalNote] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<'cancel' | 'no_show' | null>(null);
  const editSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!detail) {
      return;
    }

    setBaseServiceId(detail.appointment.baseServiceId ?? detail.serviceOptions[0]?.id ?? '');
    setTechnicianId(detail.appointment.technicianId ?? null);
    setStartTime(formatDateTimeValue(detail.appointment.startTime));
    if (initialPendingAction === 'cancel' && detail.permissions.canCancel) {
      setPendingConfirm('cancel');
    }
  }, [detail, initialPendingAction]);

  const currentBaseService = useMemo(
    () => detail?.serviceOptions.find(service => service.id === baseServiceId) ?? null,
    [detail, baseServiceId],
  );

  const selectedTechnicianName = useMemo(() => {
    if (!detail) {
      return 'Unassigned';
    }
    if (!technicianId) {
      return 'Unassigned';
    }
    return detail.technicianOptions.find(technician => technician.id === technicianId)?.name ?? 'Unassigned';
  }, [detail, technicianId]);

  const currentAddOnTotal = useMemo(
    () => detail?.addOns.reduce((sum, addOn) => sum + addOn.lineTotalCents, 0) ?? 0,
    [detail],
  );
  const currentAddOnDuration = useMemo(
    () => detail?.addOns.reduce((sum, addOn) => sum + addOn.lineDurationMinutes, 0) ?? 0,
    [detail],
  );

  const projectedPrice = currentBaseService
    ? currentBaseService.priceCents + currentAddOnTotal
    : detail?.appointment.totalPrice ?? 0;
  const projectedDuration = currentBaseService
    ? currentBaseService.durationMinutes + currentAddOnDuration
    : detail?.appointment.totalDurationMinutes ?? 0;

  const isDirty = Boolean(
    detail
    && (
      baseServiceId !== (detail.appointment.baseServiceId ?? '')
      || technicianId !== (detail.appointment.technicianId ?? null)
      || startTime !== formatDateTimeValue(detail.appointment.startTime)
    ),
  );

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      // Accidental dismissal protection: while a save is running or edits are
      // unsaved, the sheet only closes through its explicit buttons.
      closeOnBackdrop={!isDirty && !saving}
      closeOnEscape={!isDirty && !saving}
      maxWidthClassName="w-full sm:h-full sm:max-w-lg"
      alignClassName="items-end justify-center bg-black/50 p-0 sm:items-stretch sm:justify-end"
      contentClassName="flex h-[92vh] max-h-[92vh] min-h-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl supports-[height:100dvh]:h-[92dvh] supports-[height:100dvh]:max-h-[92dvh] sm:ml-auto sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-3xl sm:supports-[height:100dvh]:h-full sm:supports-[height:100dvh]:max-h-none"
    >
      <div data-testid="appointment-quick-edit-sheet" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-4 pb-3 pt-4 sm:px-5">
          <div>
            <div className="text-lg font-semibold text-neutral-900">Appointment</div>
            <div className="text-sm text-neutral-500">Quick edit</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>

        <div
          data-testid="appointment-sheet-scroll-region"
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-4 sm:px-5"
        >
          {loading
            ? (
                <div className="py-10">
                  <div className="text-sm text-neutral-500">Loading appointment details…</div>
                </div>
              )
            : !detail
                ? (
                    <div className="py-10">
                      <div className="text-sm text-neutral-500">
                        {actionError || 'Appointment details are unavailable.'}
                      </div>
                      {onRetryLoad && (
                        <button
                          type="button"
                          data-testid="appointment-sheet-retry-load"
                          onClick={onRetryLoad}
                          className="mt-3 min-h-11 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-900"
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  )
                : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                        <div className="text-base font-semibold text-neutral-900">
                          {detail.appointment.clientName || 'Guest client'}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock3 className="size-4" />
                            {new Date(detail.appointment.startTime).toLocaleString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <UserRound className="size-4" />
                            {selectedTechnicianName}
                          </span>
                          {detail.appointment.locationName && (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="size-4" />
                              {detail.appointment.locationName}
                            </span>
                          )}
                          {detail.appointment.clientEmail && (
                            <span className="inline-flex items-center gap-1.5">
                              <Mail className="size-4" />
                              {detail.appointment.clientEmail}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.08em] text-neutral-400">Status</div>
                            <div className="text-sm font-medium text-neutral-700">
                              {formatAppointmentStatus(detail.appointment.status)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs uppercase tracking-[0.08em] text-neutral-400">Current total</div>
                            <div className="text-lg font-semibold" style={{ color: themeVars.primary }}>
                              {formatCurrency(detail.appointment.totalPrice)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {['pending', 'confirmed'].includes(detail.appointment.status) && (
                        <UpcomingAppointmentActions
                          detail={detail}
                          saving={saving}
                          onChangeAppointment={() => {
                            editSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            window.setTimeout(() => {
                              const firstEnabledControl = editSectionRef.current?.querySelector<HTMLElement>(
                                'select:not(:disabled), input:not(:disabled)',
                              );
                              firstEnabledControl?.focus({ preventScroll: true });
                            }, 250);
                          }}
                          onCancelAppointment={() => setPendingConfirm('cancel')}
                          onReminderSent={onReminderSent}
                        />
                      )}

                      {(detail.client?.sensitivities
                        || detail.client?.notes
                        || Object.values(detail.client?.nailPreferences ?? {}).some(Boolean)
                        || detail.appointment.notes
                        || detail.appointment.techNotes) && (
                        <div className="rounded-2xl border border-neutral-200 p-4" data-testid="appointment-client-prep-notes">
                          <div className="text-sm font-semibold text-neutral-900">Client prep notes</div>
                          {detail.client?.sensitivities && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-800">Sensitivities</div>
                              <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-amber-950">{detail.client.sensitivities}</p>
                            </div>
                          )}
                          {Object.entries(detail.client?.nailPreferences ?? {}).some(([, value]) => Boolean(value)) && (
                            <div className="mt-3 rounded-xl bg-neutral-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">Nail preferences</div>
                              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                {Object.entries(detail.client?.nailPreferences ?? {}).map(([key, value]) => value
                                  ? (
                                      <div key={key}>
                                        <dt className="capitalize text-neutral-500">{key.replace(/([A-Z])/g, ' $1')}</dt>
                                        <dd className="font-medium text-neutral-900">{value}</dd>
                                      </div>
                                    )
                                  : null)}
                              </dl>
                            </div>
                          )}
                          {detail.client?.notes && (
                            <div className="mt-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">Client note</div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{detail.client.notes}</p>
                            </div>
                          )}
                          {detail.appointment.notes && (
                            <div className="mt-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">Appointment request</div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{detail.appointment.notes}</p>
                            </div>
                          )}
                          {detail.appointment.techNotes && (
                            <div className="mt-3 rounded-xl bg-amber-50 p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-800">Private tech note</div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">{detail.appointment.techNotes}</p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="rounded-2xl border border-neutral-200 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-neutral-900">Client confirmation email</div>
                            <div className="mt-1 text-sm text-neutral-500">
                              {detail.confirmationDelivery?.status === 'sent'
                                ? 'Delivered to the email on this appointment.'
                                : detail.confirmationDelivery?.status === 'failed'
                                  ? 'Delivery failed. Verify the address and resend.'
                                  : detail.confirmationDelivery
                                    ? 'Delivery is being processed.'
                                    : 'No tracked confirmation has been sent yet.'}
                            </div>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${detail.confirmationDelivery?.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : detail.confirmationDelivery?.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                            {detail.confirmationDelivery?.status || 'not sent'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void onResendConfirmation?.()}
                          disabled={saving || !detail.appointment.clientEmail || !onResendConfirmation}
                          className="mt-3 w-full rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Resend confirmation & management link
                        </button>
                      </div>

                      {(detail.communications?.length ?? 0) > 0 && (
                        <div className="rounded-2xl border border-neutral-200 p-4">
                          <div className="text-sm font-semibold text-neutral-900">Communication history</div>
                          <div className="mt-3 divide-y divide-neutral-100">
                            {detail.communications?.map((delivery, index) => (
                              <div key={`${delivery.channel}-${delivery.purpose}-${delivery.updatedAt}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <div>
                                  <p className="font-medium capitalize text-neutral-800">{delivery.purpose.replaceAll('_', ' ')}</p>
                                  <p className="text-xs text-neutral-500">
                                    {delivery.channel.toUpperCase()}
                                    {' '}
                                    ·
                                    {' '}
                                    {new Date(delivery.updatedAt).toLocaleString()}
                                  </p>
                                </div>
                                <span className={`rounded-full px-2 py-1 text-xs font-medium ${delivery.status === 'sent' || delivery.status === 'delivered' ? 'bg-emerald-50 text-emerald-700' : delivery.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-600'}`}>{delivery.status}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {actionError && (
                        <div
                          data-testid="appointment-sheet-inline-error"
                          className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                        >
                          <div className="font-medium">Unable to update appointment</div>
                          <div>{actionError}</div>
                          {attemptedTimeLabel && (
                            <div className="mt-1 text-red-600">
                              Attempted time:
                              {attemptedTimeLabel}
                            </div>
                          )}
                        </div>
                      )}

                      {warnings.length > 0 && (
                        <div
                          data-testid="appointment-sheet-warning"
                          className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                        >
                          {warnings.map(warning => (
                            <div key={warning}>{warningMessage(warning)}</div>
                          ))}
                        </div>
                      )}

                      <div className="rounded-2xl border border-neutral-200 p-4">
                        <div className="mb-3 text-sm font-semibold text-neutral-900">Booked services</div>
                        <div className="space-y-3">
                          <div className="rounded-xl bg-neutral-50 p-3">
                            <div className="text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">Base service</div>
                            <div className="mt-1 text-sm font-semibold text-neutral-900">{detail.appointment.baseServiceName}</div>
                          </div>
                          {detail.addOns.length > 0 && (
                            <div data-testid="appointment-sheet-addons" className="rounded-xl bg-neutral-50 p-3">
                              <div className="text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">Add-ons</div>
                              <div className="mt-2 space-y-2">
                                {detail.addOns.map(addOn => (
                                  <div
                                    key={addOn.id}
                                    data-testid={`appointment-sheet-addon-${addOn.id}`}
                                    className="flex items-center justify-between gap-3 text-sm text-neutral-700"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-medium text-neutral-900">{addOn.name}</div>
                                      <div className="text-xs text-neutral-500">
                                        Qty
                                        {' '}
                                        {addOn.quantity}
                                        {' '}
                                        ·
                                        {' '}
                                        {addOn.lineDurationMinutes}
                                        min
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-sm font-medium text-neutral-900">
                                      {formatCurrency(addOn.lineTotalCents)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div ref={editSectionRef} className="scroll-mt-4 rounded-2xl border border-neutral-200 p-4">
                        <div className="mb-3 text-sm font-semibold text-neutral-900">Edit booking details</div>
                        <div className="space-y-3">
                          <label className="block" htmlFor="appointment-service-select">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">
                              Service
                            </span>
                            <select
                              id="appointment-service-select"
                              data-testid="appointment-sheet-service-select"
                              value={baseServiceId}
                              onChange={event => setBaseServiceId(event.target.value)}
                              className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900"
                              disabled={saving || !detail.permissions.canChangeService}
                            >
                              {detail.serviceOptions.map(service => (
                                <option key={service.id} value={service.id}>
                                  {service.name}
                                  {' '}
                                  ·
                                  {' '}
                                  {formatCurrency(service.priceCents)}
                                  {' '}
                                  ·
                                  {' '}
                                  {service.durationMinutes}
                                  min
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block" htmlFor="appointment-technician-select">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">
                              Technician
                            </span>
                            <select
                              id="appointment-technician-select"
                              data-testid="appointment-sheet-technician-select"
                              value={technicianId ?? ''}
                              onChange={event => setTechnicianId(event.target.value || null)}
                              className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900"
                              disabled={saving || !detail.permissions.canReassignTechnician}
                            >
                              {!detail.permissions.canReassignTechnician && detail.appointment.technicianId && (
                                <option value={detail.appointment.technicianId}>
                                  {selectedTechnicianName}
                                </option>
                              )}
                              {detail.permissions.canReassignTechnician && (
                                <>
                                  <option value="">Unassigned</option>
                                  {detail.technicianOptions.map(technician => (
                                    <option key={technician.id} value={technician.id}>
                                      {technician.name}
                                    </option>
                                  ))}
                                </>
                              )}
                            </select>
                          </label>

                          <label className="block" htmlFor="appointment-start-time">
                            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">
                              Reschedule
                            </span>
                            <input
                              id="appointment-start-time"
                              data-testid="appointment-sheet-start-time"
                              type="datetime-local"
                              value={startTime}
                              step={(detail.appointment.slotIntervalMinutes ?? 15) * 60}
                              onChange={event => setStartTime(event.target.value)}
                              className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900"
                              disabled={saving || !detail.permissions.canMove}
                            />
                          </label>
                        </div>

                        <div className="mt-4 rounded-xl bg-neutral-50 p-3 text-sm text-neutral-600">
                          <div className="flex items-center justify-between">
                            <span>Projected duration</span>
                            <span data-testid="appointment-sheet-projected-duration" className="font-medium text-neutral-900">
                              {projectedDuration}
                              {' '}
                              min
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span>Projected subtotal</span>
                            <span data-testid="appointment-sheet-projected-price" className="font-medium text-neutral-900">
                              {formatCurrency(projectedPrice)}
                            </span>
                          </div>
                          {detail.addOns.length > 0 && (
                            <div className="mt-2 text-xs text-neutral-500">
                              Existing add-ons are preserved when possible and removed automatically if the new service does not allow them.
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Photos render whenever an uploader is wired — the first
                          photo must be addable from here, not only once one
                          already exists. */}
                      {(photos.length > 0 || onUploadPhoto) && (
                        <div className="rounded-2xl border border-neutral-200 p-4" data-testid="appointment-sheet-photos">
                          <div className="mb-3 text-sm font-semibold text-neutral-900">Photos</div>
                          {photos.length > 0 && (
                            <div className="mb-3 flex gap-2 overflow-x-auto">
                              {photos.map(photo => (
                                <div key={photo.id} className="relative size-20 shrink-0 overflow-hidden rounded-xl">
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
                          {onUploadPhoto && (
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                data-testid="appointment-sheet-upload-before"
                                onClick={() => onUploadPhoto('before')}
                                disabled={uploadingPhoto}
                                className="rounded-xl border border-dashed border-neutral-300 p-3 text-sm font-medium text-neutral-700"
                              >
                                Upload before
                              </button>
                              <button
                                type="button"
                                data-testid="appointment-sheet-upload-after"
                                onClick={() => onUploadPhoto('after')}
                                disabled={uploadingPhoto}
                                className="rounded-xl border border-dashed border-neutral-300 p-3 text-sm font-medium text-neutral-700"
                              >
                                Upload after
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="rounded-2xl border border-neutral-200 p-4">
                        <div className="mb-3 text-sm font-semibold text-neutral-900">Quick actions</div>
                        <div className="grid grid-cols-2 gap-2">
                          {onRebook && (
                            <button
                              type="button"
                              onClick={onRebook}
                              disabled={saving}
                              className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                            >
                              <CalendarPlus className="size-4" />
                              Rebook client
                            </button>
                          )}
                          {detail.permissions.canMove && (
                            <button
                              type="button"
                              data-testid="appointment-sheet-next-available"
                              onClick={() => void onMoveToNextAvailable()}
                              disabled={saving}
                              className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                            >
                              Next available
                            </button>
                          )}
                          {detail.permissions.canStart && (
                            <button
                              type="button"
                              onClick={() => void onStartAppointment()}
                              disabled={saving}
                              className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                            >
                              Start appointment
                            </button>
                          )}
                          {detail.permissions.canConfirm && onConfirmAppointment && (
                            <button type="button" onClick={() => void onConfirmAppointment()} disabled={saving} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
                              Confirm appointment
                            </button>
                          )}
                          {detail.permissions.canMarkCompleted && (
                            <button
                              type="button"
                              data-testid="appointment-sheet-mark-completed"
                              onClick={() => void onMarkCompleted()}
                              disabled={saving}
                              className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                            >
                              Mark completed
                            </button>
                          )}
                          {detail.appointment.status === 'completed' && onViewReceipt && (
                            <button
                              type="button"
                              data-testid="appointment-sheet-view-receipt"
                              onClick={onViewReceipt}
                              disabled={saving}
                              className="rounded-xl border border-neutral-200 p-3 text-sm font-medium text-neutral-900"
                            >
                              View receipt
                            </button>
                          )}
                          {detail.permissions.canMarkNoShow && onMarkNoShow && (
                            <button
                              type="button"
                              data-testid="appointment-sheet-no-show"
                              onClick={() => setPendingConfirm('no_show')}
                              disabled={saving}
                              className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900"
                            >
                              Mark no-show
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
        </div>

        {detail && (
          <div
            className="shrink-0 border-t border-neutral-200 bg-white px-4 pt-3 sm:px-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                data-testid="appointment-sheet-close"
                className="flex-1 rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-medium text-neutral-700"
              >
                Close
              </button>
              <button
                type="button"
                data-testid="appointment-sheet-save"
                onClick={() => void onSaveEdits({
                  baseServiceId,
                  technicianId,
                  startTime,
                })}
                disabled={saving || !isDirty}
                className="flex-[1.4] rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: themeVars.primary }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingConfirm === 'cancel'}
        title="Cancel this appointment?"
        tone="danger"
        busy={saving}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep appointment"
        description="This frees the time slot for other clients, updates the salon's Google Calendar, and stops reminder messages. If client emails are enabled, the client will be notified."
        onClose={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null);
          void onCancelAppointment({
            reason: cancelReason,
            internalNote: internalNote.trim() || undefined,
          }).then(() => setInternalNote(''));
        }}
      >
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">Reason</div>
          <div className="flex flex-wrap gap-2">
            {([
              ['client_request', 'Client request'],
              ['no_show', 'No show'],
              ['rescheduled', 'Rescheduled'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid={`cancel-reason-${value}`}
                onClick={() => setCancelReason(value)}
                className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-medium ${cancelReason === value ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="mt-3 block" htmlFor="appointment-cancel-note">
            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-neutral-400">
              Internal note (not sent to the client)
            </span>
            <textarea
              id="appointment-cancel-note"
              data-testid="appointment-cancel-note"
              value={internalNote}
              onChange={event => setInternalNote(event.target.value)}
              rows={2}
              className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900"
              placeholder="Optional — why was this cancelled?"
            />
          </label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={pendingConfirm === 'no_show'}
        title="Mark as no-show?"
        tone="danger"
        busy={saving}
        confirmLabel="Mark no-show"
        cancelLabel="Go back"
        description="This is recorded on the client's profile and frees the time slot."
        onClose={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null);
          void onMarkNoShow?.();
        }}
      />
    </DialogShell>
  );
}
