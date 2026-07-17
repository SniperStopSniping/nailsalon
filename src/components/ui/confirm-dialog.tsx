'use client';

import { DialogShell } from '@/components/ui/dialog-shell';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  /** Plain-language consequences of confirming — no status codes. */
  description?: React.ReactNode;
  /** Extra controls (reason chips, note field) rendered between description and actions. */
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** While busy the dialog cannot be dismissed and confirm is disabled. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  isOpen,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Go back',
  tone = 'default',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      maxWidthClassName="max-w-sm"
      contentClassName="rounded-2xl bg-white p-5 shadow-2xl"
    >
      <div data-testid="confirm-dialog">
        <div className="text-base font-semibold text-neutral-900">{title}</div>
        {description && (
          <div className="mt-2 text-sm leading-6 text-neutral-600">{description}</div>
        )}
        {children && <div className="mt-3">{children}</div>}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${tone === 'danger' ? 'bg-red-600' : 'bg-neutral-900'}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
