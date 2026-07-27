'use client';

import { useEffect, useState } from 'react';

import type {
  BookingExperienceEntitlementInspection,
  BookingExperienceEntitlementOverrideServerState,
  BookingExperienceEntitlementOverrideState,
} from '@/types/salonPolicy';

const OVERRIDE_OPTIONS: ReadonlyArray<{
  value: BookingExperienceEntitlementOverrideState;
  label: string;
  description: string;
}> = [
  {
    value: 'default',
    label: 'Default from plan',
    description: 'Remove the explicit override and use the mapped plan default.',
  },
  {
    value: 'force_enabled',
    label: 'Force enabled',
    description: 'Allow Booking Experience Customization regardless of the plan default.',
  },
  {
    value: 'force_disabled',
    label: 'Force disabled',
    description: 'Lock Booking Experience Customization regardless of the plan default.',
  },
];

type Feedback = {
  kind: 'error' | 'success';
  message: string;
};

type MutationResponse = BookingExperienceEntitlementOverrideServerState & {
  changed: boolean;
};

type ConflictResponse = {
  code?: string;
  error?: string;
  current?: BookingExperienceEntitlementOverrideServerState;
};

export type BookingExperienceEntitlementOverrideControlProps = {
  salonId: string;
  inspection: BookingExperienceEntitlementInspection;
  onServerStateChange: (
    state: BookingExperienceEntitlementOverrideServerState,
  ) => void;
};

function normalizedReason(reason: string): string {
  return reason.trim();
}

function reasonDraft(
  inspection: BookingExperienceEntitlementInspection,
): string {
  return inspection.overrideState === 'default'
    ? ''
    : inspection.reason ?? '';
}

function overrideLabel(
  state: BookingExperienceEntitlementOverrideState,
): string {
  return OVERRIDE_OPTIONS.find(option => option.value === state)?.label
    ?? state;
}

function formatActor(
  inspection: BookingExperienceEntitlementInspection,
): string {
  if (!inspection.provenanceRecorded || !inspection.actor) {
    return inspection.overrideState === 'default'
      ? 'Not recorded'
      : 'Not recorded (pre-audit)';
  }

  return inspection.actor.email
    ? `${inspection.actor.email} (${inspection.actor.id})`
    : inspection.actor.id;
}

function formatUpdatedAt(
  inspection: BookingExperienceEntitlementInspection,
): string {
  if (!inspection.provenanceRecorded || !inspection.updatedAt) {
    return inspection.overrideState === 'default'
      ? 'Not recorded'
      : 'Not recorded (pre-audit)';
  }

  const date = new Date(inspection.updatedAt);
  return Number.isNaN(date.getTime())
    ? 'Not recorded'
    : date.toLocaleString();
}

function formatReason(
  inspection: BookingExperienceEntitlementInspection,
): string {
  if (inspection.overrideState === 'default') {
    return 'None';
  }
  if (!inspection.provenanceRecorded || !inspection.reason) {
    return 'Not recorded (pre-audit)';
  }
  return inspection.reason;
}

export function BookingExperienceEntitlementOverrideControl({
  salonId,
  inspection,
  onServerStateChange,
}: BookingExperienceEntitlementOverrideControlProps) {
  const [current, setCurrent] = useState(inspection);
  const [draftState, setDraftState]
    = useState<BookingExperienceEntitlementOverrideState>(
      inspection.overrideState,
    );
  const [draftReason, setDraftReason] = useState(reasonDraft(inspection));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setCurrent(inspection);
    setDraftState(inspection.overrideState);
    setDraftReason(reasonDraft(inspection));
  }, [inspection]);

  const reason = normalizedReason(draftReason);
  const forceState = draftState !== 'default';
  const reasonValid = !forceState
    || (reason.length > 0 && reason.length <= 500);
  const exactNoOp = draftState === 'default'
    ? current.overrideState === 'default'
    : current.overrideState === draftState
      && current.provenanceRecorded
      && current.reason === reason;
  const canSave = !saving && reasonValid && !exactNoOp;

  const applyServerState = (
    state: BookingExperienceEntitlementOverrideServerState,
  ) => {
    const nextInspection = state.bookingExperienceEntitlement;
    setCurrent(nextInspection);
    setDraftState(nextInspection.overrideState);
    setDraftReason(reasonDraft(nextInspection));
    onServerStateChange(state);
  };

  const selectOverrideState = (
    nextState: BookingExperienceEntitlementOverrideState,
  ) => {
    setDraftState(nextState);
    setFeedback(null);
    if (nextState === 'default') {
      setDraftReason('');
      return;
    }
    setDraftReason(
      nextState === current.overrideState
        ? current.reason ?? ''
        : '',
    );
  };

  const saveOverride = async () => {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const body = {
        overrideState: draftState,
        ...(forceState ? { reason } : {}),
        expectedOverrideState: current.overrideState,
        expectedOverrideAuditId: current.overrideAuditId,
      };
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/entitlements/booking-experience-customization`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json().catch(() => ({})) as
        MutationResponse | ConflictResponse;

      if (
        response.status === 409
        && 'code' in payload
        && payload.code === 'ENTITLEMENT_OVERRIDE_CONFLICT'
        && payload.current
      ) {
        applyServerState(payload.current);
        setFeedback({
          kind: 'error',
          message: 'Booking Experience access changed since this salon was loaded. Review the current state before submitting again.',
        });
        return;
      }

      if (!response.ok) {
        const message = 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'Booking Experience entitlement could not be saved.';
        throw new Error(message);
      }

      if (
        !('bookingExperienceEntitlement' in payload)
        || !('features' in payload)
      ) {
        throw new Error('The server returned an invalid entitlement response.');
      }

      applyServerState({
        features: payload.features,
        bookingExperienceEntitlement:
          payload.bookingExperienceEntitlement,
      });
      setFeedback({
        kind: 'success',
        message: payload.changed
          ? 'Booking Experience entitlement override saved.'
          : 'Booking Experience entitlement was already up to date.',
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : 'Booking Experience entitlement could not be saved.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-gray-200 bg-gray-50 p-4"
      data-testid="booking-experience-entitlement-control"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-900">
            Booking Experience Customization
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            Platform access only. Saved Booking Experience settings and salon preferences are preserved.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            current.entitled
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-900'
          }`}
        >
          {current.entitled ? 'Enabled' : 'Locked'}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Stored plan</dt>
          <dd className="font-medium text-gray-900">
            {current.storedPlan ?? 'Missing'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Internal plan key</dt>
          <dd className="font-medium text-gray-900">{current.planKey}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Plan default</dt>
          <dd className="font-medium text-gray-900">
            {current.planDefault ? 'Enabled' : 'Disabled'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Override state</dt>
          <dd className="font-medium text-gray-900">
            {overrideLabel(current.overrideState)}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Resolved access</dt>
          <dd className="font-medium text-gray-900">
            {current.entitled ? 'Enabled' : 'Locked'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Source</dt>
          <dd className="font-medium text-gray-900">
            {current.source === 'plan' ? 'Plan default' : 'Override'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-gray-500">Reason</dt>
          <dd className="break-words font-medium text-gray-900">
            {formatReason(current)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-gray-500">Actor</dt>
          <dd className="break-words font-medium text-gray-900">
            {formatActor(current)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-gray-500">Updated time</dt>
          <dd className="font-medium text-gray-900">
            {formatUpdatedAt(current)}
          </dd>
        </div>
      </dl>

      <fieldset className="mt-5" disabled={saving}>
        <legend className="text-sm font-semibold text-gray-900">
          Access override
        </legend>
        <div
          className="mt-2 grid gap-2"
          role="radiogroup"
          aria-label="Booking Experience entitlement override"
        >
          {OVERRIDE_OPTIONS.map(option => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-lg border bg-white p-3 ${
                draftState === option.value
                  ? 'border-indigo-400 ring-1 ring-indigo-200'
                  : 'border-gray-200'
              } ${saving ? 'cursor-wait opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="booking-experience-entitlement-override"
                value={option.value}
                checked={draftState === option.value}
                onChange={() => selectOverrideState(option.value)}
                className="mt-0.5 size-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        {forceState && (
          <div className="mt-4">
            <label
              htmlFor="booking-experience-entitlement-reason"
              className="block text-sm font-medium text-gray-900"
            >
              Reason for override
            </label>
            <textarea
              id="booking-experience-entitlement-reason"
              value={draftReason}
              onChange={(event) => {
                setDraftReason(event.target.value);
                setFeedback(null);
              }}
              rows={3}
              aria-describedby="booking-experience-entitlement-reason-help"
              aria-invalid={!reasonValid}
              placeholder="Required for forced access"
              className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div
              id="booking-experience-entitlement-reason-help"
              className={`mt-1 flex justify-between gap-3 text-xs ${
                reasonValid ? 'text-gray-500' : 'text-red-700'
              }`}
            >
              <span>
                {reason.length === 0
                  ? 'A reason is required for forced access.'
                  : reason.length > 500
                    ? 'Reason must be 500 characters or fewer.'
                    : 'The reason is stored in the entitlement audit record.'}
              </span>
              <span>
                {reason.length}
                /500
              </span>
            </div>
          </div>
        )}
      </fieldset>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void saveOverride()}
          disabled={!canSave}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving override…' : 'Save entitlement override'}
        </button>
      </div>

      <div className="mt-3 min-h-5 text-xs" aria-live="polite">
        {feedback?.kind === 'success' && (
          <p className="font-medium text-emerald-700" role="status">
            {feedback.message}
          </p>
        )}
        {feedback?.kind === 'error' && (
          <p className="font-medium text-red-700" role="alert">
            {feedback.message}
          </p>
        )}
      </div>
    </section>
  );
}
