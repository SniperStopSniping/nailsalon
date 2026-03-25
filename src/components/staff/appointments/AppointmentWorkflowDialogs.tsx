'use client';

import Image from 'next/image';

import { DialogShell } from '@/components/ui/dialog-shell';
import { themeVars } from '@/theme';

import type { PaymentMethod, StaffAppointmentData } from './types';

function PaymentMethodSelector({
  selected,
  onSelect,
}: {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}) {
  const methods: { id: PaymentMethod; label: string; icon: string }[] = [
    { id: 'cash', label: 'Cash', icon: '💵' },
    { id: 'card', label: 'Card', icon: '💳' },
    { id: 'e-transfer', label: 'E-Transfer', icon: '📱' },
  ];

  return (
    <div className="flex gap-2">
      {methods.map(method => (
        <button
          key={method.id}
          type="button"
          onClick={() => onSelect(method.id)}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl p-3 transition-all"
          style={{
            backgroundColor: selected === method.id ? themeVars.selectedBackground : '#f5f5f5',
            borderWidth: 2,
            borderStyle: 'solid',
            borderColor: selected === method.id ? themeVars.primary : 'transparent',
          }}
        >
          <span className="text-xl">{method.icon}</span>
          <span className="text-xs font-medium">{method.label}</span>
        </button>
      ))}
    </div>
  );
}

function CancelReasonSelector({
  onSelect,
  onCancel,
  isSubmitting,
}: {
  onSelect: (reason: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const reasons = [
    { id: 'client_request', label: 'Client Request', icon: '👤' },
    { id: 'no_show', label: 'No Show', icon: '❌' },
    { id: 'rescheduled', label: 'Rescheduled', icon: '📅' },
  ];

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-neutral-700">Select cancellation reason:</div>
      <div className="space-y-2">
        {reasons.map(reason => (
          <button
            key={reason.id}
            type="button"
            onClick={() => onSelect(reason.id)}
            disabled={isSubmitting}
            className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all hover:bg-neutral-100 disabled:opacity-50"
            style={{ backgroundColor: themeVars.surfaceAlt }}
          >
            <span className="text-xl">{reason.icon}</span>
            <span className="font-medium">{reason.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-xl py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100"
      >
        Back
      </button>
    </div>
  );
}

type AppointmentWorkflowDialogsProps = {
  appointment: StaffAppointmentData | null;
  showCompleteDialog: boolean;
  showCancelDialog: boolean;
  uploadingPhoto: boolean;
  uploadError: string | null;
  completing: boolean;
  cancelling: boolean;
  paymentMethod: PaymentMethod;
  onCloseWorkflow: () => void;
  onStart: () => void;
  onTriggerFileInput: (photoType: 'before' | 'after') => void;
  onOpenCompleteDialog: () => void;
  onCloseCompleteDialog: () => void;
  onComplete: () => void;
  onOpenCancelDialog: () => void;
  onCloseCancelDialog: () => void;
  onCancel: (reason: string) => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  formatTime: (dateStr: string) => string;
  formatPrice: (cents: number) => string;
};

export function AppointmentWorkflowDialogs({
  appointment,
  showCompleteDialog,
  showCancelDialog,
  uploadingPhoto,
  uploadError,
  completing,
  cancelling,
  paymentMethod,
  onCloseWorkflow,
  onStart,
  onTriggerFileInput,
  onOpenCompleteDialog,
  onCloseCompleteDialog,
  onComplete,
  onOpenCancelDialog,
  onCloseCancelDialog,
  onCancel,
  onPaymentMethodChange,
  formatTime,
  formatPrice,
}: AppointmentWorkflowDialogsProps) {
  const showWorkflowDialog = Boolean(appointment && !showCancelDialog && !showCompleteDialog);
  const hasAfterPhoto = appointment?.photos.some(photo => photo.photoType === 'after');

  return (
    <>
      <DialogShell
        isOpen={showWorkflowDialog}
        onClose={onCloseWorkflow}
        alignClassName="items-end justify-center bg-black/50 sm:items-center"
        maxWidthClassName="max-w-md"
        contentClassName="max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl"
        closeOnBackdrop={!uploadingPhoto}
        closeOnEscape={!uploadingPhoto}
      >
        {appointment && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
                Appointment Workflow
              </h2>
              <button
                type="button"
                onClick={onCloseWorkflow}
                className="text-2xl text-neutral-400 hover:text-neutral-600"
                disabled={uploadingPhoto}
              >
                ×
              </button>
            </div>

            <div className="mb-4 rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
              <div className="font-medium text-neutral-700">
                {appointment.clientName || 'Client'}
              </div>
              <div className="text-sm text-neutral-500">
                {appointment.services.map(service => service.name).join(', ')}
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm text-neutral-500">
                  {formatTime(appointment.startTime)}
                  {' '}
                  -
                  {formatTime(appointment.endTime)}
                </span>
                <span className="font-bold" style={{ color: themeVars.primary }}>
                  {formatPrice(appointment.totalPrice)}
                </span>
              </div>
            </div>

            {appointment.status === 'confirmed' && (
              <button
                type="button"
                onClick={onStart}
                className="mb-4 w-full rounded-xl py-3 text-center font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: themeVars.accent }}
              >
                ▶ Start Appointment
              </button>
            )}

            {uploadError && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {uploadError}
              </div>
            )}

            {appointment.photos.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-sm font-medium text-neutral-600">
                  Photos (
                  {appointment.photos.length}
                  )
                </div>
                <div className="flex flex-wrap gap-2">
                  {appointment.photos.map(photo => (
                    <div key={photo.id} className="relative size-20 overflow-hidden rounded-lg">
                      <Image
                        src={photo.thumbnailUrl || photo.imageUrl}
                        alt={photo.photoType}
                        fill
                        className="object-cover"
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 py-0.5 text-center text-xs font-medium text-white"
                        style={{ backgroundColor: photo.photoType === 'before' ? themeVars.accent : '#22c55e' }}
                      >
                        {photo.photoType}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => onTriggerFileInput('before')}
                disabled={uploadingPhoto}
                className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-neutral-50 disabled:opacity-50"
                style={{ borderColor: themeVars.borderMuted }}
              >
                <div className="text-2xl">📷</div>
                <div className="mt-1 font-medium text-neutral-700">Upload Before Photo</div>
                <div className="text-xs text-neutral-400">Optional - before service</div>
              </button>

              <button
                type="button"
                onClick={() => onTriggerFileInput('after')}
                disabled={uploadingPhoto}
                className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-neutral-50 disabled:opacity-50"
                style={{ borderColor: themeVars.primary }}
              >
                <div className="text-2xl">✨</div>
                <div className="mt-1 font-medium" style={{ color: themeVars.accent }}>
                  Upload After Photo
                </div>
                <div className="text-xs text-neutral-400">Required to complete</div>
              </button>
            </div>

            {uploadingPhoto && (
              <div className="mt-4 flex items-center justify-center gap-2 text-neutral-600">
                <div
                  className="size-4 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
                />
                Uploading...
              </div>
            )}

            <div className="mt-6 space-y-2">
              {appointment.status === 'in_progress' && hasAfterPhoto && (
                <button
                  type="button"
                  onClick={onOpenCompleteDialog}
                  disabled={completing || uploadingPhoto}
                  className="w-full rounded-full py-3 text-center font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                  style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                >
                  ✓ Complete & Mark Paid
                </button>
              )}

              <button
                type="button"
                onClick={onOpenCancelDialog}
                className="w-full rounded-full py-2 text-center text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Cancel Appointment
              </button>
            </div>
          </>
        )}
      </DialogShell>

      <DialogShell
        isOpen={Boolean(showCompleteDialog && appointment)}
        onClose={onCloseCompleteDialog}
        closeOnBackdrop={!completing}
        closeOnEscape={!completing}
      >
        {showCompleteDialog && appointment && (
          <>
            <h3 className="mb-4 text-lg font-bold" style={{ color: themeVars.titleText }}>
              Complete Appointment
            </h3>

            <div className="mb-4">
              <div className="mb-2 text-sm font-medium text-neutral-700">Payment Method</div>
              <PaymentMethodSelector selected={paymentMethod} onSelect={onPaymentMethodChange} />
            </div>

            <div className="mb-4 rounded-xl p-3" style={{ backgroundColor: themeVars.highlightBackground }}>
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">Total</span>
                <span className="text-xl font-bold" style={{ color: themeVars.accent }}>
                  {formatPrice(appointment.totalPrice)}
                </span>
              </div>
            </div>

            {uploadError && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {uploadError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCloseCompleteDialog}
                disabled={completing}
                className="flex-1 rounded-full py-3 text-center font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onComplete}
                disabled={completing}
                className="flex-1 rounded-full py-3 text-center font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
              >
                {completing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </DialogShell>

      <DialogShell
        isOpen={Boolean(showCancelDialog && appointment)}
        onClose={onCloseCancelDialog}
        closeOnBackdrop={!cancelling}
        closeOnEscape={!cancelling}
      >
        {showCancelDialog && appointment && (
          <>
            <h3 className="mb-4 text-lg font-bold text-red-600">
              Cancel Appointment
            </h3>
            <CancelReasonSelector
              onSelect={onCancel}
              onCancel={onCloseCancelDialog}
              isSubmitting={cancelling}
            />
          </>
        )}
      </DialogShell>
    </>
  );
}
