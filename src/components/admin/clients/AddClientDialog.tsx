'use client';

import { Loader2, X } from 'lucide-react';
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';

export type AddedClient = {
  id: string;
  fullName: string | null;
  phone: string;
  email: string | null;
  archived: boolean;
};

export type AddClientResult = {
  client: AddedClient;
  /** False when the phone/email already resolved to a client in the book. */
  created: boolean;
  message: string;
};

type AddClientDialogProps = {
  isOpen: boolean;
  salonSlug: string;
  onClose: () => void;
  onSuccess: (result: AddClientResult) => void;
};

type AddClientDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes: string;
};

type AddClientField = keyof AddClientDraft;
type FieldErrors = Partial<Record<AddClientField, string>>;

type ApiPayload = {
  data?: {
    client?: AddedClient;
    created?: boolean;
    message?: string;
  };
  error?: {
    code?: string;
    details?: {
      fieldErrors?: Partial<Record<AddClientField, string[]>>;
    };
  };
};

const FIELD_IDS: Record<AddClientField, string> = {
  firstName: 'add-client-first-name',
  lastName: 'add-client-last-name',
  phone: 'add-client-phone',
  email: 'add-client-email',
  notes: 'add-client-notes',
};

const EMPTY_DRAFT: AddClientDraft = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  notes: '',
};

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return null;
}

function validateAddClientDraft(draft: AddClientDraft): {
  errors: FieldErrors;
  phone: string | null;
} {
  const errors: FieldErrors = {};
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  const phone = normalizePhone(draft.phone);
  const email = draft.email.trim();

  if (!firstName) {
    errors.firstName = 'Enter a first name.';
  } else if (firstName.length > 50) {
    errors.firstName = 'First name must be 50 characters or fewer.';
  }

  if (lastName.length > 50) {
    errors.lastName = 'Last name must be 50 characters or fewer.';
  }

  if (!phone) {
    errors.phone = 'Enter a valid Canadian or US phone number.';
  }

  if (email.length > 320) {
    errors.email = 'Email must be 320 characters or fewer.';
  } else if (email) {
    const atIndex = email.indexOf('@');
    const domainDotIndex = email.indexOf('.', atIndex + 2);
    const hasWhitespace = Array.from(email).some(
      character => character.trim() === '',
    );
    if (
      atIndex < 1
      || atIndex !== email.lastIndexOf('@')
      || domainDotIndex <= atIndex + 1
      || domainDotIndex === email.length - 1
      || hasWhitespace
    ) {
      errors.email = 'Enter a valid email address.';
    }
  }

  if (draft.notes.length > 5000) {
    errors.notes = 'Notes must be 5,000 characters or fewer.';
  }

  return { errors, phone };
}

function apiFieldErrors(payload: ApiPayload | null): FieldErrors {
  const serverErrors = payload?.error?.details?.fieldErrors;
  if (!serverErrors) {
    return {};
  }
  const errors: FieldErrors = {};
  for (const field of Object.keys(FIELD_IDS) as AddClientField[]) {
    const message = serverErrors[field]?.[0];
    if (message) {
      errors[field] = message;
    }
  }
  return errors;
}

function errorMessage(code: string | undefined): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'Review the highlighted fields and try again.';
    case 'CLIENT_IDENTITY_BUSY':
      return 'This client was being updated somewhere else. Try adding them again.';
    case 'UNSUPPORTED_CLIENT_IDENTITY':
      return 'This phone number is already tied to more than one record here. Open the existing client instead.';
    default:
      return 'We could not add this client. Your entries are still here, so you can try again.';
  }
}

function FieldError({
  field,
  errors,
}: {
  field: AddClientField;
  errors: FieldErrors;
}) {
  if (!errors[field]) {
    return null;
  }
  return (
    <p id={`${FIELD_IDS[field]}-error`} className="mt-1 text-xs text-red-600">
      {errors[field]}
    </p>
  );
}

function fieldErrorProps(field: AddClientField, errors: FieldErrors) {
  return {
    'aria-invalid': errors[field] ? true as const : undefined,
    'aria-describedby': errors[field] ? `${FIELD_IDS[field]}-error` : undefined,
  };
}

const INPUT_CLASS
  = 'owner-form-field';

/**
 * Records a walk-in or phone client straight into the salon book.
 *
 * The POST it calls reuses the booking path's identity resolution, so a phone
 * number that is already in the book returns THAT client instead of forking a
 * second row. This dialog therefore reports two different successes: "added"
 * and "already in your book".
 */
export function AddClientDialog({
  isOpen,
  salonSlug,
  onClose,
  onSuccess,
}: AddClientDialogProps) {
  const [draft, setDraft] = useState<AddClientDraft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFocusVersion, setErrorFocusVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const formBodyRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (errorFocusVersion === 0) {
      return;
    }
    const invalidField = formBodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalidField ?? errorRef.current)?.focus();
  }, [errorFocusVersion]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraft(EMPTY_DRAFT);
    setFieldErrors({});
    setFormError(null);
    const focusTimer = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  const updateField = (field: AddClientField, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleClose = () => {
    if (submittingRef.current) {
      return;
    }
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const { errors, phone } = validateAddClientDraft(draft);
    if (Object.keys(errors).length > 0 || !phone) {
      setFieldErrors(errors);
      setFormError('Review the highlighted fields and try again.');
      setErrorFocusVersion(current => current + 1);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const response = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          phone,
          email: draft.email.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null) as ApiPayload | null;

      if (!response.ok || !payload?.data?.client) {
        const nextFieldErrors = apiFieldErrors(payload);
        setFieldErrors(nextFieldErrors);
        setFormError(errorMessage(payload?.error?.code));
        setErrorFocusVersion(current => current + 1);
        return;
      }

      try {
        onSuccess({
          client: payload.data.client,
          created: payload.data.created !== false,
          message: payload.data.message ?? 'Client added to your book.',
        });
      } catch {
        // The write is committed. A parent render failure must not read as a
        // save failure, and must not invite a duplicate submission.
      }
      onClose();
    } catch {
      setFormError('We could not add this client. Check your connection and try again. Your entries are still here.');
      setErrorFocusVersion(current => current + 1);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={handleClose}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      alignClassName="items-end justify-center sm:items-center sm:p-4"
      maxWidthClassName="max-w-lg"
      contentClassName="flex max-h-[calc(100vh-0.5rem)] min-h-0 flex-col overflow-hidden rounded-t-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] shadow-[var(--owner-shadow-card)] supports-[height:100dvh]:max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl supports-[height:100dvh]:sm:max-h-[calc(100dvh-2rem)]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-client-dialog-title"
        aria-describedby="add-client-dialog-description"
        data-testid="add-client-dialog"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--owner-line)] p-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="add-client-dialog-title"
              className="owner-title text-[28px] font-normal leading-tight text-[var(--owner-ink)]"
            >
              Add client
            </h2>
            <p
              id="add-client-dialog-description"
              className="mt-2 text-[15px] leading-relaxed text-[var(--owner-muted)]"
            >
              Record a walk-in or phone client. If the number is already in your
              book we open that client instead of creating a second one.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close add client dialog"
            onClick={handleClose}
            disabled={submitting}
            className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--owner-muted)] transition hover:bg-[var(--owner-blush)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div
            ref={formBodyRef}
            data-testid="add-client-dialog-body"
            className="min-h-0 min-w-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6"
          >
            {formError && (
              <div
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {formError}
              </div>
            )}

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="min-w-0" htmlFor={FIELD_IDS.firstName}>
                <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
                  First name
                </span>
                <input
                  id={FIELD_IDS.firstName}
                  ref={firstFieldRef}
                  aria-label="First name"
                  value={draft.firstName}
                  onChange={event => updateField('firstName', event.target.value)}
                  maxLength={51}
                  autoComplete="given-name"
                  disabled={submitting}
                  {...fieldErrorProps('firstName', fieldErrors)}
                  className={INPUT_CLASS}
                />
                <FieldError field="firstName" errors={fieldErrors} />
              </label>

              <label className="min-w-0" htmlFor={FIELD_IDS.lastName}>
                <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
                  Last name
                </span>
                <input
                  id={FIELD_IDS.lastName}
                  aria-label="Last name"
                  value={draft.lastName}
                  onChange={event => updateField('lastName', event.target.value)}
                  maxLength={51}
                  autoComplete="family-name"
                  disabled={submitting}
                  {...fieldErrorProps('lastName', fieldErrors)}
                  className={INPUT_CLASS}
                />
                <FieldError field="lastName" errors={fieldErrors} />
              </label>
            </div>

            <label className="block min-w-0" htmlFor={FIELD_IDS.phone}>
              <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
                Phone
              </span>
              <input
                id={FIELD_IDS.phone}
                aria-label="Phone"
                type="tel"
                inputMode="tel"
                value={draft.phone}
                onChange={event => updateField('phone', event.target.value)}
                maxLength={50}
                autoComplete="tel"
                disabled={submitting}
                {...fieldErrorProps('phone', fieldErrors)}
                className={INPUT_CLASS}
              />
              <FieldError field="phone" errors={fieldErrors} />
            </label>

            <label className="block min-w-0" htmlFor={FIELD_IDS.email}>
              <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
                Email
                {' '}
                <span className="font-normal text-[var(--owner-muted)]">(optional)</span>
              </span>
              <input
                id={FIELD_IDS.email}
                aria-label="Email"
                type="email"
                inputMode="email"
                value={draft.email}
                onChange={event => updateField('email', event.target.value)}
                maxLength={321}
                autoComplete="email"
                disabled={submitting}
                {...fieldErrorProps('email', fieldErrors)}
                className={INPUT_CLASS}
              />
              <FieldError field="email" errors={fieldErrors} />
            </label>

            <label className="block min-w-0" htmlFor={FIELD_IDS.notes}>
              <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
                Notes
                {' '}
                <span className="font-normal text-[var(--owner-muted)]">
                  (optional, staff only)
                </span>
              </span>
              <textarea
                id={FIELD_IDS.notes}
                aria-label="Notes"
                value={draft.notes}
                onChange={event => updateField('notes', event.target.value)}
                maxLength={5001}
                rows={4}
                disabled={submitting}
                {...fieldErrorProps('notes', fieldErrors)}
                className="owner-form-field resize-y"
              />
              <FieldError field="notes" errors={fieldErrors} />
            </label>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-[var(--owner-line)] bg-[var(--owner-surface)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <Button
              type="button"
              variant="ownerSecondary"
              size="pill"
              onClick={handleClose}
              disabled={submitting}
              className="h-auto min-h-12 min-w-0 px-4 py-3 text-[15px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="ownerPrimary"
              size="pill"
              data-testid="add-client-save"
              disabled={submitting}
              className="h-auto min-h-12 min-w-0 px-4 py-3 text-[15px]"
            >
              {submitting
                ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Adding…
                    </>
                  )
                : 'Add client'}
            </Button>
          </div>
        </form>
      </div>
    </DialogShell>
  );
}
