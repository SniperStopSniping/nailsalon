'use client';

/**
 * Luster L1 PR6 — owner catalog configuration: the rule editor (E).
 *
 * NO GENERIC RULE BUILDER. The owner never sees "subject → ruleType →
 * object → params → priority" — every rule is presented, both in the list
 * and while being edited, as a sentence naming the resolved service/add-on/
 * capability. The typed six-intent contract (`ownerCatalogRules.server.ts`)
 * stays underneath; this file only ever sends the SAME owner-intent shape
 * that module's schema accepts — never a raw `ruleType`, `params`, or
 * `priority`.
 */

import { Loader2, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import type { AddOnResponse, CapabilityResponse, CatalogRuleResponse, ServiceResponse } from '@/types/admin';

import {
  addOnName,
  capabilityName,
  extractApiError,
  INTENT_DESCRIPTIONS,
  INTENT_LABELS,
  intentForRuleType,
  MAX_ADD_ON_QUANTITY,
  OWNER_RULE_INTENTS,
  type OwnerRuleIntent,
  ruleSentence,
  serviceName,
} from './shared';

type RulesPanelProps = {
  salonSlug: string;
  services: ServiceResponse[];
  addOns: AddOnResponse[];
  capabilities: CapabilityResponse[];
  rules: CatalogRuleResponse[];
  onRefresh: () => void;
};

const DIALOG_ALIGN = 'items-end justify-center p-4 sm:items-center';
const DIALOG_CONTENT = 'max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl';

type RuleDraft = {
  intent: OwnerRuleIntent | null;
  subjectKind: 'service' | 'addOn';
  subjectId: string;
  addOnId: string;
  capabilityId: string;
  maxQuantity: string;
  autoAdd: boolean;
  scopeServiceId: string;
  isActive: boolean;
  note: string;
};

const EMPTY_DRAFT: RuleDraft = {
  intent: null,
  subjectKind: 'service',
  subjectId: '',
  addOnId: '',
  capabilityId: '',
  maxQuantity: '1',
  autoAdd: false,
  scopeServiceId: '',
  isActive: true,
  note: '',
};

function draftFromRule(rule: CatalogRuleResponse): RuleDraft {
  const maxQuantityValue = rule.params.maxQuantity;
  return {
    intent: intentForRuleType(rule.ruleType),
    subjectKind: rule.subjectServiceId ? 'service' : 'addOn',
    subjectId: rule.subjectServiceId ?? rule.subjectAddOnId ?? '',
    addOnId: rule.objectAddOnId ?? '',
    capabilityId: rule.capabilityId ?? '',
    maxQuantity: typeof maxQuantityValue === 'number' ? String(maxQuantityValue) : '1',
    autoAdd: rule.params.autoAdd === true,
    scopeServiceId: rule.serviceScopeId ?? '',
    isActive: rule.isActive,
    note: rule.note ?? '',
  };
}

function RuleFormDialog({
  salonSlug,
  rule,
  services,
  addOns,
  capabilities,
  onClose,
  onSaved,
}: {
  salonSlug: string;
  rule: CatalogRuleResponse | null;
  services: ServiceResponse[];
  addOns: AddOnResponse[];
  capabilities: CapabilityResponse[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = rule !== null;
  const [draft, setDraft] = useState<RuleDraft>(() => (rule ? draftFromRule(rule) : EMPTY_DRAFT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const intent = draft.intent;

  const previewSentence = intent
    ? ruleSentence({
      intent,
      subjectLabel: draft.subjectKind === 'service'
        ? serviceName(services, draft.subjectId)
        : addOnName(addOns, draft.subjectId),
      addOnLabel: draft.addOnId ? addOnName(addOns, draft.addOnId) : '…',
      capabilityLabel: draft.capabilityId ? capabilityName(capabilities, draft.capabilityId) : '…',
      maxQuantity: Number.parseInt(draft.maxQuantity, 10) || undefined,
      autoAdd: draft.autoAdd,
    })
    : null;

  const handleSubmit = async () => {
    if (submitInFlightRef.current || !intent) {
      return;
    }
    if (!draft.subjectId) {
      setError('Pick what this rule applies to.');
      return;
    }
    if (intent === 'require_capability' && !draft.capabilityId) {
      setError('Pick a skill.');
      return;
    }
    if (intent !== 'require_capability' && !draft.addOnId) {
      setError('Pick an add-on.');
      return;
    }
    let maxQuantity: number | undefined;
    if (intent === 'limit_add_on_quantity') {
      const parsed = Number.parseInt(draft.maxQuantity, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ADD_ON_QUANTITY) {
        setError(`Enter a quantity limit between 1 and ${MAX_ADD_ON_QUANTITY}.`);
        return;
      }
      maxQuantity = parsed;
    }
    if (draft.subjectKind === 'addOn' && draft.addOnId && draft.subjectId === draft.addOnId) {
      setError('An add-on cannot reference itself.');
      return;
    }

    submitInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        intent,
        salonSlug,
        scopeServiceId: draft.scopeServiceId || null,
        subjectKind: draft.subjectKind,
        subjectId: draft.subjectId,
        isActive: draft.isActive,
        note: draft.note.trim() || null,
      };
      if (intent === 'require_capability') {
        body.capabilityId = draft.capabilityId;
      } else {
        body.addOnId = draft.addOnId;
      }
      if (intent === 'limit_add_on_quantity') {
        body.maxQuantity = maxQuantity;
      }
      if (intent === 'bundle_add_on') {
        body.autoAdd = draft.autoAdd;
      }

      const response = await fetch(
        isEdit ? `/api/salon/catalog-rules/${encodeURIComponent(rule.id)}` : '/api/salon/catalog-rules',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        setError(await extractApiError(response, 'This rule could not be saved. Try again.'));
        return;
      }
      onSaved();
    } catch {
      setError('We could not save this rule. Check your connection and try again.');
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  const subjectOptions = draft.subjectKind === 'service' ? services : addOns;

  return (
    <DialogShell
      isOpen
      onClose={saving ? () => {} : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-lg"
      contentClassName={DIALOG_CONTENT}
      alignClassName={DIALOG_ALIGN}
    >
      <div className="space-y-4" data-testid="rule-form-dialog">
        <h2 className="text-xl font-semibold text-[#1C1C1E]">{isEdit ? 'Edit rule' : 'New rule'}</h2>

        {!intent
          ? (
              <div>
                <p className="mb-3 text-sm text-[#6B7280]">What should this rule do?</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {OWNER_RULE_INTENTS.map(candidate => (
                    <button
                      key={candidate}
                      type="button"
                      data-testid={`rule-intent-${candidate}`}
                      onClick={() => setDraft(current => ({ ...current, intent: candidate }))}
                      className="rounded-xl border border-gray-200 p-3 text-left transition hover:border-rose-700 hover:bg-rose-50"
                    >
                      <span className="block text-sm font-semibold text-[#1C1C1E]">{INTENT_LABELS[candidate]}</span>
                      <span className="mt-0.5 block text-xs text-[#6B7280]">{INTENT_DESCRIPTIONS[candidate]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          : (
              <>
                {!isEdit && (
                  <button
                    type="button"
                    className="text-xs font-medium text-rose-800"
                    onClick={() => setDraft(EMPTY_DRAFT)}
                  >
                    ← Choose a different rule type
                  </button>
                )}
                <p className="rounded-xl bg-gray-50 p-3 text-sm text-[#1C1C1E]" data-testid="rule-sentence-preview">
                  {previewSentence}
                </p>

                <fieldset disabled={saving}>
                  <legend className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">When this is selected…</legend>
                  <div className="flex gap-2">
                    <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 p-2 text-sm has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
                      <input
                        type="radio"
                        name="rule-subject-kind"
                        checked={draft.subjectKind === 'service'}
                        onChange={() => setDraft(current => ({ ...current, subjectKind: 'service', subjectId: '' }))}
                      />
                      A service
                    </label>
                    <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 p-2 text-sm has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
                      <input
                        type="radio"
                        name="rule-subject-kind"
                        checked={draft.subjectKind === 'addOn'}
                        onChange={() => setDraft(current => ({ ...current, subjectKind: 'addOn', subjectId: '' }))}
                      />
                      An add-on
                    </label>
                  </div>
                </fieldset>

                <label className="block" htmlFor="rule-subject-id">
                  <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
                    {draft.subjectKind === 'service' ? 'Service' : 'Add-on'}
                  </span>
                  <select
                    id="rule-subject-id"
                    value={draft.subjectId}
                    onChange={event => setDraft(current => ({ ...current, subjectId: event.target.value }))}
                    disabled={saving}
                    className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                  >
                    <option value="">Select…</option>
                    {subjectOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </select>
                </label>

                {intent === 'require_capability'
                  ? (
                      <label className="block" htmlFor="rule-capability-id">
                        <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Required skill</span>
                        <select
                          id="rule-capability-id"
                          value={draft.capabilityId}
                          onChange={event => setDraft(current => ({ ...current, capabilityId: event.target.value }))}
                          disabled={saving}
                          className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                        >
                          <option value="">Select…</option>
                          {capabilities.map(capability => (
                            <option key={capability.id} value={capability.id}>{capability.name}</option>
                          ))}
                        </select>
                      </label>
                    )
                  : (
                      <label className="block" htmlFor="rule-addon-id">
                        <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Add-on</span>
                        <select
                          id="rule-addon-id"
                          value={draft.addOnId}
                          onChange={event => setDraft(current => ({ ...current, addOnId: event.target.value }))}
                          disabled={saving}
                          className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                        >
                          <option value="">Select…</option>
                          {addOns.map(addOn => (
                            <option key={addOn.id} value={addOn.id}>{addOn.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                {intent === 'limit_add_on_quantity' && (
                  <label className="block" htmlFor="rule-max-quantity">
                    <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Maximum quantity</span>
                    <input
                      id="rule-max-quantity"
                      type="number"
                      min="1"
                      max={MAX_ADD_ON_QUANTITY}
                      inputMode="numeric"
                      value={draft.maxQuantity}
                      onChange={event => setDraft(current => ({ ...current, maxQuantity: event.target.value }))}
                      disabled={saving}
                      className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                    />
                  </label>
                )}

                {intent === 'bundle_add_on' && (
                  <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
                    <span>
                      <span className="block text-sm font-medium text-[#1C1C1E]">Add it automatically</span>
                      <span className="block text-xs text-[#6B7280]">No extra tap needed for the client.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.autoAdd}
                      onChange={event => setDraft(current => ({ ...current, autoAdd: event.target.checked }))}
                      disabled={saving}
                      className="size-4"
                    />
                  </label>
                )}

                <label className="block" htmlFor="rule-scope-service">
                  <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Applies to</span>
                  <select
                    id="rule-scope-service"
                    value={draft.scopeServiceId}
                    onChange={event => setDraft(current => ({ ...current, scopeServiceId: event.target.value }))}
                    disabled={saving}
                    className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                  >
                    <option value="">Any service (salon-wide)</option>
                    {services.map(service => (
                      <option key={service.id} value={service.id}>{service.name}</option>
                    ))}
                  </select>
                </label>

                <label className="block" htmlFor="rule-note">
                  <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Internal note (optional)</span>
                  <textarea
                    id="rule-note"
                    value={draft.note}
                    rows={2}
                    onChange={event => setDraft(current => ({ ...current, note: event.target.value }))}
                    placeholder="Only you and your staff see this."
                    disabled={saving}
                    className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
                  <span className="text-sm font-medium text-[#1C1C1E]">Active</span>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))}
                    disabled={saving}
                    className="size-4"
                  />
                </label>

                {error && (
                  <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="brandSoft" size="pillSm" onClick={onClose} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="button" variant="brand" size="pillSm" onClick={() => void handleSubmit()} disabled={saving} data-testid="rule-save">
                    {saving
                      ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Saving…
                          </>
                        )
                      : isEdit ? 'Save rule' : 'Create rule'}
                  </Button>
                </div>
              </>
            )}
      </div>
    </DialogShell>
  );
}

export function RulesPanel({ salonSlug, services, addOns, capabilities, rules, onRefresh }: RulesPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingRule, setEditingRule] = useState<CatalogRuleResponse | null>(null);
  const [deletingRule, setDeletingRule] = useState<CatalogRuleResponse | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deletingRule) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/salon/catalog-rules/${encodeURIComponent(deletingRule.id)}?salonSlug=${encodeURIComponent(salonSlug)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setDeleteError(await extractApiError(response, 'This rule could not be deleted. Try again.'));
        return;
      }
      setDeletingRule(null);
      onRefresh();
    } catch {
      setDeleteError('We could not delete this rule. Check your connection and try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="catalog-rules-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Rules</h3>
          <p className="mt-0.5 text-[13px] text-[#6B7280]">
            Bundle, hide, require, block, or limit add-ons — and require
            skills for specific services.
          </p>
        </div>
        <Button type="button" variant="brandSoft" size="pillSm" onClick={() => setShowCreate(true)} data-testid="rule-create-open">
          <Plus className="mr-1 size-4" />
          New rule
        </Button>
      </div>

      {rules.length === 0
        ? (
            <div className="rounded-[18px] border border-gray-200 bg-white p-4 text-[14px] text-[#8E8E93]">
              No rules yet. Most menus never need one.
            </div>
          )
        : (
            <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white">
              {rules.map((rule, index) => {
                const intent = intentForRuleType(rule.ruleType);
                const maxQuantityValue = rule.params.maxQuantity;
                const sentence = ruleSentence({
                  intent,
                  subjectLabel: rule.subjectServiceId
                    ? serviceName(services, rule.subjectServiceId)
                    : addOnName(addOns, rule.subjectAddOnId),
                  addOnLabel: rule.objectAddOnId ? addOnName(addOns, rule.objectAddOnId) : undefined,
                  capabilityLabel: rule.capabilityId ? capabilityName(capabilities, rule.capabilityId) : undefined,
                  maxQuantity: typeof maxQuantityValue === 'number' ? maxQuantityValue : undefined,
                  autoAdd: rule.params.autoAdd === true,
                });
                return (
                  <div
                    key={rule.id}
                    data-testid={`rule-row-${rule.id}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${index < rules.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] text-[#1C1C1E]">{sentence}</p>
                      {!rule.isActive && (
                        <span className="mt-1 inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[11px] text-gray-600">Inactive</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="text-[13px] font-medium text-rose-800"
                        onClick={() => setEditingRule(rule)}
                        data-testid={`rule-edit-${rule.id}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label="Delete rule"
                        data-testid={`rule-delete-${rule.id}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeletingRule(rule);
                        }}
                        className="rounded-full p-1.5 text-red-600 transition hover:bg-red-50"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

      {(showCreate || editingRule) && (
        <RuleFormDialog
          salonSlug={salonSlug}
          rule={editingRule}
          services={services}
          addOns={addOns}
          capabilities={capabilities}
          onClose={() => {
            setShowCreate(false);
            setEditingRule(null);
          }}
          onSaved={() => {
            setShowCreate(false);
            setEditingRule(null);
            onRefresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deletingRule !== null}
        title="Delete this rule?"
        description={deleteError ?? 'This cannot be undone.'}
        confirmLabel="Delete rule"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onClose={() => {
          if (!deleteBusy) {
            setDeletingRule(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
