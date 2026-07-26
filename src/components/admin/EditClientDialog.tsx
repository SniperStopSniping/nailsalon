'use client';

import { Loader2, X } from 'lucide-react';
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';

export type EditClientValue = {
  id: string;
  fullName: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  updatedAt: string;
};

type EditClientDialogProps = {
  isOpen: boolean;
  salonSlug: string;
  client: EditClientValue;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

type EditClientDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthday: string;
  notes: string;
};

type EditClientField = keyof EditClientDraft;
type FieldErrors = Partial<Record<EditClientField, string>>;

type ApiErrorPayload = {
  error?: {
    code?: string;
    details?: {
      fieldErrors?: Partial<Record<EditClientField | 'fullName', string[]>>;
    };
  };
};

const FIELD_IDS: Record<EditClientField, string> = {
  firstName: 'edit-client-first-name',
  lastName: 'edit-client-last-name',
  phone: 'edit-client-phone',
  email: 'edit-client-email',
  birthday: 'edit-client-birthday',
  notes: 'edit-client-notes',
};

function splitClientName(fullName: string | null): {
  firstName: string;
  lastName: string;
} {
  const normalized = fullName?.trim() ?? '';
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const firstWhitespace = normalized.search(/\s/);
  if (firstWhitespace === -1) {
    return { firstName: normalized, lastName: '' };
  }

  return {
    firstName: normalized.slice(0, firstWhitespace),
    lastName: normalized.slice(firstWhitespace).trimStart(),
  };
}

function birthdayForInput(birthday: string | null): string {
  return birthday?.slice(0, 10) ?? '';
}

function draftFromClient(client: EditClientValue): EditClientDraft {
  return {
    ...splitClientName(client.fullName),
    phone: client.phone,
    email: client.email ?? '',
    birthday: birthdayForInput(client.birthday),
    notes: client.notes ?? '',
  };
}

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

function normalizedOptional(value: string): string | null {
  return value.trim() || null;
}

function normalizedEmail(value: string): string | null {
  return value.trim().toLowerCase() || null;
}

function todayForDateInput(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidBirthday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day
  );
}

function validateDraft(draft: EditClientDraft): {
  errors: FieldErrors;
  phone: string | null;
} {
  const errors: FieldErrors = {};
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();
  const phone = normalizePhone(draft.phone);
  const email = draft.email.trim();
  const birthday = draft.birthday.trim();

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
    const hasWhitespace = Array.from(email).some(character => character.trim() === '');
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

  if (birthday) {
    const today = todayForDateInput();
    if (!isValidBirthday(birthday)) {
      errors.birthday = 'Enter a valid birthday in YYYY-MM-DD format.';
    } else if (birthday < '1900-01-01' || birthday > today) {
      errors.birthday = 'Birthday must be between January 1, 1900 and today.';
    }
  }

  if (draft.notes.length > 5000) {
    errors.notes = 'Notes must be 5,000 characters or fewer.';
  }

  return { errors, phone };
}

function apiFieldErrors(payload: ApiErrorPayload): FieldErrors {
  const serverErrors = payload.error?.details?.fieldErrors;
  if (!serverErrors) {
    return {};
  }

  const errors: FieldErrors = {};
  const fields: EditClientField[] = [
    'firstName',
    'lastName',
    'phone',
    'email',
    'birthday',
    'notes',
  ];

  for (const field of fields) {
    const message = serverErrors[field]?.[0];
    if (message) {
      errors[field] = message;
    }
  }

  if (!errors.firstName && serverErrors.fullName?.[0]) {
    errors.firstName = serverErrors.fullName[0];
  }

  return errors;
}

function errorMessage(code: string | undefined): string {
  switch (code) {
    case 'CLIENT_EDIT_CONFLICT':
      return 'This client changed while you were editing. Refresh the client profile and try again. Your entries are still here.';
    case 'CONTACT_IDENTITY_CONFLICT':
      return 'That phone number or email belongs to another client at this salon. Review the contact details and try again.';
    case 'UNSUPPORTED_CLIENT_IDENTITY':
      return 'Phone and email cannot be changed safely for this client. You can still edit the name, birthday, or notes.';
    case 'CLIENT_NOT_FOUND':
      return 'This client is no longer available. Close this form and refresh the client list.';
    case 'VALIDATION_ERROR':
      return 'Review the highlighted fields and try again.';
    default:
      return 'We could not save this client. Your entries are still here, so you can try again.';
  }
}

function FieldError({
  field,
  errors,
}: {
  field: EditClientField;
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

function fieldErrorProps(field: EditClientField, errors: FieldErrors) {
  return {
    'aria-invalid': errors[field] ? true as const : undefined,
    'aria-describedby': errors[field] ? `${FIELD_IDS[field]}-error` : undefined,
  };
}

export function EditClientDialog({
  isOpen,
  salonSlug,
  client,
  onClose,
  onSuccess,
}: EditClientDialogProps) {
  const [draft, setDraft] = useState<EditClientDraft>(() => draftFromClient(client));
  const [initialDraft, setInitialDraft] = useState<EditClientDraft>(() => draftFromClient(client));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(client.updatedAt);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const previouslyOpenRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    const justOpened = isOpen && !previouslyOpenRef.current;
    if (justOpened) {
      const nextDraft = draftFromClient(client);
      setDraft(nextDraft);
      setInitialDraft(nextDraft);
      setExpectedUpdatedAt(client.updatedAt);
      setFieldErrors({});
      setFormError(null);
      setSubmitting(false);
      submittingRef.current = false;
    }
    previouslyOpenRef.current = isOpen;
  }, [client, isOpen]);

  const normalizedCurrentPhone = normalizePhone(client.phone);
  const dirty = useMemo(() => (
    draft.firstName !== initialDraft.firstName
    || draft.lastName !== initialDraft.lastName
    || normalizePhone(draft.phone) !== normalizedCurrentPhone
    || normalizedEmail(draft.email) !== normalizedEmail(client.email ?? '')
    || normalizedOptional(draft.birthday) !== normalizedOptional(birthdayForInput(client.birthday))
    || normalizedOptional(draft.notes) !== normalizedOptional(client.notes ?? '')
  ), [
    client.birthday,
    client.email,
    client.notes,
    draft,
    initialDraft.firstName,
    initialDraft.lastName,
    normalizedCurrentPhone,
  ]);

  const updateField = (field: EditClientField, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  };

  const handleClose = () => {
    if (!submittingRef.current) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || !dirty) {
      return;
    }

    const validated = validateDraft(draft);
    if (Object.keys(validated.errors).length > 0 || !validated.phone) {
      setFieldErrors(validated.errors);
      setFormError('Review the highlighted fields and try again.');
      return;
    }

    const nameChanged = (
      draft.firstName !== initialDraft.firstName
      || draft.lastName !== initialDraft.lastName
    );
    const body: Record<string, string | null> = {
      salonSlug,
      expectedUpdatedAt,
    };
    if (nameChanged) {
      body.firstName = draft.firstName.trim();
      body.lastName = draft.lastName.trim();
    }
    if (validated.phone !== normalizedCurrentPhone) {
      body.phone = validated.phone;
    }
    if (normalizedEmail(draft.email) !== normalizedEmail(client.email ?? '')) {
      body.email = normalizedEmail(draft.email);
    }
    if (
      normalizedOptional(draft.birthday)
      !== normalizedOptional(birthdayForInput(client.birthday))
    ) {
      body.birthday = normalizedOptional(draft.birthday);
    }
    if (normalizedOptional(draft.notes) !== normalizedOptional(client.notes ?? '')) {
      body.notes = normalizedOptional(draft.notes);
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(client.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as (
        ApiErrorPayload & {
          data?: {
            client?: {
              updatedAt?: string;
            };
          };
        }
      ) | null;

      if (!response.ok) {
        const nextFieldErrors = payload ? apiFieldErrors(payload) : {};
        setFieldErrors(nextFieldErrors);
        setFormError(errorMessage(payload?.error?.code));
        return;
      }

      if (!payload?.data?.client?.updatedAt) {
        setFormError('The client was saved, but the refreshed profile could not be confirmed. Close this form and refresh the client list.');
        return;
      }

      setExpectedUpdatedAt(payload.data.client.updatedAt);
      await onSuccess();
      onClose();
    } catch {
      setFormError('We could not save this client. Check your connection and try again. Your entries are still here.');
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
      contentClassName="flex max-h-[calc(100vh-0.5rem)] min-h-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl supports-[height:100dvh]:max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl supports-[height:100dvh]:sm:max-h-[calc(100dvh-2rem)]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-client-dialog-title"
        aria-describedby="edit-client-dialog-description"
        data-testid="edit-client-dialog"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 p-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="edit-client-dialog-title" className="text-lg font-semibold text-stone-900">
              Edit client
            </h2>
            <p id="edit-client-dialog-description" className="mt-1 text-sm text-stone-500">
              Update the client’s basic profile information.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close edit client dialog"
            onClick={handleClose}
            disabled={submitting}
            className="-m-2 flex size-10 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 disabled:opacity-50"
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
            data-testid="edit-client-dialog-body"
            className="min-h-0 min-w-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6"
          >
            {formError && (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="min-w-0" htmlFor={FIELD_IDS.firstName}>
                <span className="mb-1.5 block text-sm font-medium text-stone-700">First name</span>
                <input
                  id={FIELD_IDS.firstName}
                  aria-label="First name"
                  value={draft.firstName}
                  onChange={event => updateField('firstName', event.target.value)}
                  maxLength={51}
                  autoComplete="given-name"
                  disabled={submitting}
                  {...fieldErrorProps('firstName', fieldErrors)}
                  className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 disabled:bg-stone-100"
                />
                <FieldError field="firstName" errors={fieldErrors} />
              </label>

              <label className="min-w-0" htmlFor={FIELD_IDS.lastName}>
                <span className="mb-1.5 block text-sm font-medium text-stone-700">Last name</span>
                <input
                  id={FIELD_IDS.lastName}
                  aria-label="Last name"
                  value={draft.lastName}
                  onChange={event => updateField('lastName', event.target.value)}
                  maxLength={51}
                  autoComplete="family-name"
                  disabled={submitting}
                  {...fieldErrorProps('lastName', fieldErrors)}
                  className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 disabled:bg-stone-100"
                />
                <FieldError field="lastName" errors={fieldErrors} />
              </label>
            </div>

            <label className="block min-w-0" htmlFor={FIELD_IDS.phone}>
              <span className="mb-1.5 block text-sm font-medium text-stone-700">Phone</span>
              <input
                id={FIELD_IDS.phone}
                aria-label="Phone"
                type="tel"
                inputMode="tel"
                value={draft.phone}
                onChange={event => updateField('phone', event.target.value)}
                maxLength={30}
                autoComplete="tel"
                disabled={submitting}
                {...fieldErrorProps('phone', fieldErrors)}
                className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 disabled:bg-stone-100"
              />
              <FieldError field="phone" errors={fieldErrors} />
            </label>

            <label className="block min-w-0" htmlFor={FIELD_IDS.email}>
              <span className="mb-1.5 block text-sm font-medium text-stone-700">Email</span>
              <input
                id={FIELD_IDS.email}
                aria-label="Email"
                type="email"
                inputMode="email"
                value={draft.email}
                onChange={event => updateField('email', event.target.value)}
                maxLength={321}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
                {...fieldErrorProps('email', fieldErrors)}
                className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 disabled:bg-stone-100"
              />
              <FieldError field="email" errors={fieldErrors} />
            </label>

            <label className="block min-w-0" htmlFor={FIELD_IDS.birthday}>
              <span className="mb-1.5 block text-sm font-medium text-stone-700">Birthday</span>
              <input
                id={FIELD_IDS.birthday}
                aria-label="Birthday"
                type="date"
                min="1900-01-01"
                max={todayForDateInput()}
                value={draft.birthday}
                onChange={event => updateField('birthday', event.target.value)}
                disabled={submitting}
                {...fieldErrorProps('birthday', fieldErrors)}
                className="min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 disabled:bg-stone-100"
              />
              <FieldError field="birthday" errors={fieldErrors} />
            </label>

            <label className="block min-w-0" htmlFor={FIELD_IDS.notes}>
              <span className="mb-1.5 block text-sm font-medium text-stone-700">Notes</span>
              <textarea
                id={FIELD_IDS.notes}
                aria-label="Notes"
                value={draft.notes}
                onChange={event => updateField('notes', event.target.value)}
                maxLength={5001}
                rows={5}
                disabled={submitting}
                {...fieldErrorProps('notes', fieldErrors)}
                className="w-full min-w-0 resize-y rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 disabled:bg-stone-100"
              />
              <div className="mt-1 flex items-start justify-between gap-3">
                <FieldError field="notes" errors={fieldErrors} />
                <span className="ml-auto text-xs text-stone-400">
                  {draft.notes.length.toLocaleString()}
                  /5,000
                </span>
              </div>
            </label>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-stone-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <Button
              type="button"
              variant="brandSoft"
              onClick={handleClose}
              disabled={submitting}
              className="min-h-11 min-w-0"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              data-testid="edit-client-save"
              disabled={!dirty || submitting}
              className="min-h-11 min-w-0"
            >
              {submitting
                ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving…
                    </>
                  )
                : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    </DialogShell>
  );
}
