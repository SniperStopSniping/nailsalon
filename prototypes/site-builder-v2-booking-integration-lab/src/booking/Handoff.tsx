import { ArrowRight, CheckCircle2, X } from 'lucide-react';

import { BookingOverlayDialog } from './BookingOverlayDialog';
import type { SelectionSummary } from './types';

const BOOKING_FLOW_STEPS = [
  'Service',
  'Options',
  'Technician',
  'Time',
  'Details',
  'Payment',
  'Confirmation',
] as const;

export type HandoffProps = {
  open: boolean;
  summary: SelectionSummary | null;
  onClose: () => void;
};

export function Handoff({ open, summary, onClose }: HandoffProps) {
  if (!open) {
    return null;
  }

  return (
    <BookingOverlayDialog
      className="booking-handoff-dialog"
      labelledBy="booking-handoff-title"
      onClose={onClose}
      testId="booking-handoff-dialog"
    >
      <div className="booking-dialog-panel booking-handoff-panel" role="document">
        <button
          className="booking-dialog-close"
          type="button"
          aria-label="Close booking handoff"
          onClick={onClose}
        >
          <X aria-hidden="true" size={20} />
        </button>
        <span className="booking-handoff-mark" aria-hidden="true">
          <CheckCircle2 size={30} />
        </span>
        <h2 id="booking-handoff-title">Booking flow continues here</h2>
        <p>
          {summary
            ? `${summary.service.name} · ${summary.durationLabel} · ${summary.price.label}`
            : 'Select a service to continue.'}
        </p>
        <div className="booking-flow-steps" aria-label="Booking steps">
          {BOOKING_FLOW_STEPS.map((step, index) => (
            <span key={step}>
              {step}
              {index < BOOKING_FLOW_STEPS.length - 1
                ? <ArrowRight size={12} aria-hidden="true" />
                : null}
            </span>
          ))}
        </div>
        <button className="customer-primary-button" type="button" onClick={onClose}>
          Back to the menu
        </button>
      </div>
    </BookingOverlayDialog>
  );
}
