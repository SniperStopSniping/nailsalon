'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { useId, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

type ReviewPolicyAgreementProps = {
  title: string | null;
  text: string;
  acknowledgmentText?: string | null;
  required: boolean;
  acknowledged: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
};

export function ReviewPolicyAgreement({ title, text, acknowledgmentText, required, acknowledged, disabled, onChange }: ReviewPolicyAgreementProps) {
  const t = useTranslations('BookingConfirmation');
  const [open, setOpen] = useState(false);
  const [dialogStyle, setDialogStyle] = useState<CSSProperties>({});
  const headingId = useId();
  const helpId = useId();

  return (
    <div data-testid={required ? 'booking-policy-acknowledgment' : undefined} className="border-t border-[var(--n5-border-muted)] pt-3">
      {required && (
        <>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6">
            <input type="checkbox" required aria-required="true" aria-describedby={acknowledged ? undefined : helpId} disabled={disabled} checked={acknowledged} onChange={event => onChange(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--n5-accent)] disabled:cursor-not-allowed" />
            <span className="min-w-0 whitespace-pre-line break-words">{acknowledgmentText}</span>
            <span className="shrink-0 text-xs font-medium">{t('review_required')}</span>
          </label>
          {!acknowledged && <p id={helpId} role="status" className="text-sm leading-5">{t('review_agreement_hint')}</p>}
        </>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
        // DialogShell is portalled outside the tenant theme wrapper. Carry
        // the rendered salon colours into the dialog rather than falling back
        // to a different salon's default palette.
          event.currentTarget.focus({ preventScroll: true });
          const style = getComputedStyle(event.currentTarget);
          setDialogStyle({ backgroundColor: style.getPropertyValue('--n5-bg-card'), color: style.color, fontFamily: style.fontFamily, borderColor: style.getPropertyValue('--n5-border') });
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold underline underline-offset-4 disabled:opacity-60"
      >
        {t('review_view_policy')}
      </button>
      <DialogShell isOpen={open} onClose={() => setOpen(false)} maxWidthClassName="max-w-lg" contentClassName="max-h-[calc(100dvh-2rem)] touch-pan-y overflow-y-auto overscroll-contain rounded-2xl">
        <div role="dialog" aria-modal="true" aria-labelledby={headingId} data-testid="booking-review-policy-dialog" className="rounded-2xl border p-4" style={dialogStyle}>
          <div className="flex items-start justify-between gap-3">
            <h2 id={headingId} className="min-w-0 break-words text-lg font-semibold leading-7">{title || t('review_policy_title')}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label={t('review_close_policy')} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><X aria-hidden="true" className="size-5" /></button>
          </div>
          <p className="mt-2 whitespace-pre-line break-words text-sm leading-6">{text}</p>
        </div>
      </DialogShell>
    </div>
  );
}
