'use client';

import { ReviewRequestAction } from '@/components/appointments/ReviewRequestAction';
import { DialogShell } from '@/components/ui/dialog-shell';
import { useSalon } from '@/providers/SalonProvider';

type Props = {
  appointmentId: string;
  clientName: string | null;
  /** Closes the staff completion flow. */
  onDone: () => void;
};

/** Uses the normal protected review-request flow with no satisfaction screening. */
export function ReviewFollowupModal({ appointmentId, clientName, onDone }: Props) {
  const { salonSlug } = useSalon();

  return (
    <DialogShell
      isOpen
      onClose={onDone}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[90vh] touch-pan-y overflow-y-auto overscroll-contain rounded-t-2xl bg-[#FAF8F5] shadow-2xl sm:rounded-2xl"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="review-followup-title" className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="review-followup-title" className="text-xl font-semibold text-[#6F4E37]">Appointment completed</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Request a review from
              {clientName?.trim().split(/\s+/)[0] || 'your client'}
              {' '}
              when they are eligible.
            </p>
          </div>
          <button type="button" aria-label="Close review follow-up" onClick={onDone} className="flex size-11 items-center justify-center rounded-lg text-2xl text-neutral-400 hover:text-neutral-600">×</button>
        </div>
        {salonSlug
          ? (
              <ReviewRequestAction appointmentId={appointmentId} salonSlug={salonSlug} timeZone="America/Toronto" appointmentStatus="completed" />
            )
          : (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Review requests are unavailable until the salon is loaded.</p>
            )}
        <button type="button" onClick={onDone} className="mt-4 min-h-11 w-full rounded-xl border border-[#E6DED6] bg-white px-4 text-sm font-semibold text-[#4B2E1E]">Done</button>
      </div>
    </DialogShell>
  );
}

export default ReviewFollowupModal;
