'use client';

/**
 * Luster L1 PR6 — owner catalog configuration: "group these services" (C).
 *
 * HARD SAFETY PROPERTY (not a nicety): every attach/detach ALWAYS calls
 * `/service-families/inspect` first and shows the owner exactly what would
 * change plus any warnings, before `/service-families` ever commits
 * anything. There is no path in this file that writes without that review
 * step being shown first.
 *
 * Legacy simplicity: a salon with only flat services renders every one of
 * them under "Not grouped" — nothing here auto-creates a family. Grouping
 * only ever happens when the owner explicitly opens this panel and confirms
 * a reviewed change.
 */

import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import type { ServiceResponse } from '@/types/admin';

import { describeFamilyChange, describeFamilyWarning, extractApiError } from './shared';

// Structurally identical to `ServiceFamilyChange`/`ServiceFamilyWarning`
// (`ownerCatalogFamilies.server.ts`, type-only imported by `shared.ts`) so
// the API response can be passed straight into `describeFamilyChange`
// without a `.server.ts` value import from this client component.
type FamilyChange = {
  field: 'parentServiceId' | 'variantLabel' | 'variantKind' | 'selectionMode';
  serviceId: string;
  from: string | null;
  to: string | null;
};
type FamilyWarning = { code: string; message: string };

type GroupServicesPanelProps = {
  salonSlug: string;
  services: ServiceResponse[];
  onRefresh: () => void;
};

const DIALOG_ALIGN = 'items-end justify-center p-4 sm:items-center';
const DIALOG_CONTENT = 'max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl';

type AttachDraft = {
  parentServiceId: string;
  childServiceId: string;
  variantLabel: string;
  variantKind: string;
};

function ServiceFamilyDialog({
  salonSlug,
  services,
  mode,
  fixedChildServiceId,
  onClose,
  onCommitted,
}: {
  salonSlug: string;
  services: ServiceResponse[];
  mode: 'attach' | 'detach';
  /** Pre-selected child for a detach flow launched from an existing family row. */
  fixedChildServiceId?: string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [draft, setDraft] = useState<AttachDraft>({
    parentServiceId: '',
    childServiceId: fixedChildServiceId ?? '',
    variantLabel: '',
    variantKind: '',
  });
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [changes, setChanges] = useState<FamilyChange[]>([]);
  const [warnings, setWarnings] = useState<FamilyWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const selectedParent = services.find(s => s.id === draft.parentServiceId) ?? null;
  const parentHasChildren = selectedParent
    ? services.some(s => s.parentServiceId === selectedParent.id)
    : false;
  const establishesNewAxis = selectedParent !== null && !parentHasChildren && !selectedParent.variantKind;

  const buildBody = () => (mode === 'attach'
    ? {
        salonSlug,
        operation: 'attach' as const,
        parentServiceId: draft.parentServiceId,
        childServiceId: draft.childServiceId,
        variantLabel: draft.variantLabel.trim(),
        variantKind: draft.variantKind.trim() || undefined,
      }
    : {
        salonSlug,
        operation: 'detach' as const,
        childServiceId: draft.childServiceId,
      });

  const handleInspect = async () => {
    if (submitInFlightRef.current) {
      return;
    }
    if (mode === 'attach') {
      if (!draft.parentServiceId || !draft.childServiceId) {
        setError('Pick both the parent service and the variant service.');
        return;
      }
      if (draft.parentServiceId === draft.childServiceId) {
        setError('A service cannot be its own parent.');
        return;
      }
      if (!draft.variantLabel.trim()) {
        setError('Enter a label for this variant (e.g. "Short", "XL").');
        return;
      }
      if (establishesNewAxis && !draft.variantKind.trim()) {
        setError('Say what this family varies along (e.g. "length", "shape").');
        return;
      }
    }

    submitInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/salon/service-families/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not evaluate this change. Try again.');
        return;
      }
      setChanges(payload?.data?.changes ?? []);
      setWarnings(payload?.data?.warnings ?? []);
      setStep('review');
    } catch {
      setError('We could not evaluate this change. Check your connection and try again.');
    } finally {
      setBusy(false);
      submitInFlightRef.current = false;
    }
  };

  const handleCommit = async () => {
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/salon/service-families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      if (!response.ok) {
        setError(await extractApiError(response, 'This change could not be saved. Try again.'));
        return;
      }
      onCommitted();
    } catch {
      setError('We could not save this change. Check your connection and try again.');
    } finally {
      setBusy(false);
      submitInFlightRef.current = false;
    }
  };

  const eligibleParents = services.filter(s => s.id !== draft.childServiceId);
  const eligibleChildren = services.filter(s => s.id !== draft.parentServiceId);

  return (
    <DialogShell
      isOpen
      onClose={busy ? () => {} : onClose}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      maxWidthClassName="max-w-md"
      contentClassName={DIALOG_CONTENT}
      alignClassName={DIALOG_ALIGN}
    >
      <div className="space-y-4" data-testid="service-family-dialog">
        <h2 className="text-xl font-semibold text-[#1C1C1E]">
          {mode === 'attach' ? 'Group these services' : 'Remove from family'}
        </h2>

        {step === 'form' && mode === 'attach' && (
          <>
            <p className="text-sm text-[#6B7280]">
              Turn one service into a variant of another — e.g. "Gel Manicure —
              Long" as a variant of "Gel Manicure".
            </p>
            <label className="block" htmlFor="family-parent">
              <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Parent service</span>
              <select
                id="family-parent"
                value={draft.parentServiceId}
                onChange={event => setDraft(current => ({ ...current, parentServiceId: event.target.value }))}
                disabled={busy}
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
              >
                <option value="">Select a service</option>
                {eligibleParents.map(service => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </label>
            <label className="block" htmlFor="family-child">
              <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Variant service</span>
              <select
                id="family-child"
                value={draft.childServiceId}
                onChange={event => setDraft(current => ({ ...current, childServiceId: event.target.value }))}
                disabled={busy || Boolean(fixedChildServiceId)}
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
              >
                <option value="">Select a service</option>
                {eligibleChildren.map(service => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </label>
            <label className="block" htmlFor="family-variant-label">
              <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Variant label</span>
              <input
                id="family-variant-label"
                type="text"
                value={draft.variantLabel}
                onChange={event => setDraft(current => ({ ...current, variantLabel: event.target.value }))}
                placeholder="Short, Long, XL…"
                disabled={busy}
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
              />
            </label>
            {selectedParent && !establishesNewAxis && selectedParent.variantKind && (
              <p className="text-xs text-[#6B7280]">
                This family already varies by "
                {selectedParent.variantKind}
                ".
              </p>
            )}
            {establishesNewAxis && (
              <label className="block" htmlFor="family-variant-kind">
                <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">What do these variants vary by?</span>
                <input
                  id="family-variant-kind"
                  type="text"
                  value={draft.variantKind}
                  onChange={event => setDraft(current => ({ ...current, variantKind: event.target.value }))}
                  placeholder="length, shape…"
                  disabled={busy}
                  className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                />
              </label>
            )}
          </>
        )}

        {step === 'form' && mode === 'detach' && (
          <p className="text-sm text-[#6B7280]">
            This service will become standalone again. Its own details and
            price stay unchanged.
          </p>
        )}

        {step === 'review' && (
          <div className="space-y-3" data-testid="service-family-review">
            <div className="rounded-xl border border-gray-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-[#8E8E93]">What will change</p>
              {changes.length === 0
                ? <p className="text-sm text-[#6B7280]">No changes.</p>
                : (
                    <ul className="space-y-1.5 text-sm text-[#1C1C1E]">
                      {changes.map((change, index) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <li key={index}>{describeFamilyChange(change, services)}</li>
                      ))}
                    </ul>
                  )}
            </div>
            {warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-amber-700">
                  <AlertTriangle className="size-3.5" />
                  Heads up
                </p>
                <ul className="space-y-1.5 text-sm text-amber-800">
                  {warnings.map(warning => (
                    <li key={warning.code}>{describeFamilyWarning(warning)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {step === 'form'
            ? (
                <>
                  <Button type="button" variant="brandSoft" size="pillSm" onClick={onClose} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="brand"
                    size="pillSm"
                    onClick={() => void handleInspect()}
                    disabled={busy || (mode === 'attach' && (!draft.parentServiceId || !draft.childServiceId))}
                    data-testid="service-family-preview"
                  >
                    {busy
                      ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Checking…
                          </>
                        )
                      : 'Preview changes'}
                  </Button>
                </>
              )
            : (
                <>
                  <Button type="button" variant="brandSoft" size="pillSm" onClick={() => setStep('form')} disabled={busy}>
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="brand"
                    size="pillSm"
                    onClick={() => void handleCommit()}
                    disabled={busy}
                    data-testid="service-family-commit"
                  >
                    {busy
                      ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Saving…
                          </>
                        )
                      : 'Confirm & save'}
                  </Button>
                </>
              )}
        </div>
      </div>
    </DialogShell>
  );
}

export function GroupServicesPanel({ salonSlug, services, onRefresh }: GroupServicesPanelProps) {
  const [dialog, setDialog] = useState<{ mode: 'attach' } | { mode: 'detach'; childServiceId: string } | null>(null);

  const childIdsByParent = new Map<string, ServiceResponse[]>();
  for (const service of services) {
    if (service.parentServiceId) {
      const list = childIdsByParent.get(service.parentServiceId) ?? [];
      list.push(service);
      childIdsByParent.set(service.parentServiceId, list);
    }
  }
  const parents = services.filter(service => childIdsByParent.has(service.id));
  const standalone = services.filter(service => !service.parentServiceId && !childIdsByParent.has(service.id));

  return (
    <div className="space-y-6" data-testid="catalog-group-services-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Group these services</h3>
          <p className="mt-0.5 text-[13px] text-[#6B7280]">
            Turn related services (like "Gel — Short" and "Gel — Long") into
            variants of one parent service.
          </p>
        </div>
        <Button
          type="button"
          variant="brandSoft"
          size="pillSm"
          onClick={() => setDialog({ mode: 'attach' })}
          disabled={services.length < 2}
          data-testid="service-family-open"
        >
          Group services
        </Button>
      </div>

      {parents.length > 0 && (
        <section>
          <h4 className="mb-2 text-[13px] font-semibold uppercase text-[#8E8E93]">Families</h4>
          <div className="space-y-3">
            {parents.map((parent) => {
              const children = childIdsByParent.get(parent.id) ?? [];
              return (
                <div key={parent.id} className="overflow-hidden rounded-[18px] border border-gray-100 bg-white" data-testid={`service-family-${parent.id}`}>
                  <div className="border-b border-gray-100 px-4 py-3">
                    <span className="block text-[15px] font-semibold text-[#1C1C1E]">{parent.name}</span>
                    {parent.variantKind && (
                      <span className="text-[12px] text-[#8E8E93]">
                        Varies by
                        {' '}
                        {parent.variantKind}
                      </span>
                    )}
                  </div>
                  {children.map(child => (
                    <div key={child.id} className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-2 last:border-b-0">
                      <span className="text-[14px] text-[#1C1C1E]">
                        {child.variantLabel ?? child.name}
                      </span>
                      <button
                        type="button"
                        className="text-[13px] font-medium text-rose-800"
                        onClick={() => setDialog({ mode: 'detach', childServiceId: child.id })}
                        data-testid={`service-family-detach-${child.id}`}
                      >
                        Remove from family
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-[13px] font-semibold uppercase text-[#8E8E93]">Not grouped</h4>
        {standalone.length === 0
          ? <p className="text-[13px] text-[#8E8E93]">Every service is part of a family.</p>
          : (
              <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white">
                {standalone.map((service, index) => (
                  <div
                    key={service.id}
                    data-testid={`service-standalone-${service.id}`}
                    className={`flex items-center justify-between px-4 py-2.5 text-[14px] text-[#1C1C1E] ${index < standalone.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    {service.name}
                    <ChevronRight className="size-4 text-transparent" aria-hidden="true" />
                  </div>
                ))}
              </div>
            )}
      </section>

      {dialog && (
        <ServiceFamilyDialog
          salonSlug={salonSlug}
          services={services}
          mode={dialog.mode}
          fixedChildServiceId={dialog.mode === 'detach' ? dialog.childServiceId : undefined}
          onClose={() => setDialog(null)}
          onCommitted={() => {
            setDialog(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
