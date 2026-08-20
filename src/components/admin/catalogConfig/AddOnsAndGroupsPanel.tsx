'use client';

/**
 * Luster L1 PR6 — owner catalog configuration: add-on groups (A) and add-on
 * create + group assignment (B).
 *
 * Owner vocabulary only: "Choose one" / "Choose multiple", "Required" /
 * "Optional", and an optional maximum — `minSelections`/`maxSelections`
 * never appear as words in this file's JSX. Group deletion is blocked
 * server-side while members remain; that error surfaces here verbatim
 * rather than being silently retried or hidden.
 */

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import type { AddOnGroupResponse, AddOnResponse, ServiceResponse } from '@/types/admin';

import {
  ADD_ON_CATEGORIES,
  ADD_ON_CATEGORY_LABELS,
  extractApiError,
  formatCurrency,
  formatDuration,
} from './shared';

type AddOnsAndGroupsPanelProps = {
  salonSlug: string;
  services: ServiceResponse[];
  addOns: AddOnResponse[];
  addOnGroups: AddOnGroupResponse[];
  onRefresh: () => void;
};

function describeGroupBounds(group: AddOnGroupResponse): string {
  const choice = group.maxSelections === 1 ? 'Choose one' : 'Choose multiple';
  const required = group.minSelections > 0 ? 'Required' : 'Optional';
  const cap = group.maxSelections && group.maxSelections !== 1 ? ` · up to ${group.maxSelections}` : '';
  return `${choice} · ${required}${cap}`;
}

const DIALOG_ALIGN = 'items-end justify-center p-4 sm:items-center';
const DIALOG_CONTENT = 'max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl';

// =============================================================================
// GROUP FORM (create / edit)
// =============================================================================

type GroupDraft = {
  choiceType: 'one' | 'multiple';
  required: boolean;
  maxWhenMultiple: string;
};

function GroupFormDialog({
  salonSlug,
  group,
  onClose,
  onSaved,
}: {
  salonSlug: string;
  group: AddOnGroupResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = group !== null;
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [draft, setDraft] = useState<GroupDraft>(() => ({
    choiceType: group?.maxSelections === 1 ? 'one' : 'multiple',
    required: (group?.minSelections ?? 0) > 0,
    maxWhenMultiple: group && group.maxSelections !== null && group.maxSelections !== 1
      ? String(group.maxSelections)
      : '',
  }));
  const [isActive, setIsActive] = useState(group?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const handleSubmit = async () => {
    if (submitInFlightRef.current) {
      return;
    }
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }
    let maxSelections: number | null = null;
    if (draft.choiceType === 'one') {
      maxSelections = 1;
    } else if (draft.maxWhenMultiple.trim() !== '') {
      const parsed = Number.parseInt(draft.maxWhenMultiple, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError('Maximum must be a whole number of at least 1, or left blank for no limit.');
        return;
      }
      maxSelections = parsed;
    }

    submitInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        isEdit ? `/api/salon/add-on-groups/${encodeURIComponent(group.id)}` : '/api/salon/add-on-groups',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            name: name.trim(),
            description: description.trim() || null,
            sortOrder: group?.sortOrder ?? 0,
            isActive,
            minSelections: draft.required ? 1 : 0,
            maxSelections,
          }),
        },
      );
      if (!response.ok) {
        setError(await extractApiError(response, 'The group could not be saved. Try again.'));
        return;
      }
      onSaved();
    } catch {
      setError('We could not save this group. Check your connection and try again.');
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <DialogShell
      isOpen
      onClose={saving ? () => {} : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-md"
      contentClassName={DIALOG_CONTENT}
      alignClassName={DIALOG_ALIGN}
    >
      <div className="space-y-4" data-testid="addon-group-form-dialog">
        <h2 className="text-xl font-semibold text-[#1C1C1E]">
          {isEdit ? 'Edit add-on group' : 'New add-on group'}
        </h2>
        <p className="text-sm text-[#6B7280]">
          A group lets clients choose between related add-ons — e.g. "Nail
          shape" or "Polish finish".
        </p>

        <label className="block" htmlFor="addon-group-name">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Name</span>
          <input
            id="addon-group-name"
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>

        <label className="block" htmlFor="addon-group-description">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Description (optional)</span>
          <textarea
            id="addon-group-description"
            value={description}
            rows={2}
            onChange={event => setDescription(event.target.value)}
            disabled={saving}
            className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>

        <fieldset disabled={saving}>
          <legend className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">How many can a client pick?</legend>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 p-2.5 text-sm has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
              <input
                type="radio"
                name="addon-group-choice-type"
                checked={draft.choiceType === 'one'}
                onChange={() => setDraft(current => ({ ...current, choiceType: 'one' }))}
              />
              Choose one
            </label>
            <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 p-2.5 text-sm has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
              <input
                type="radio"
                name="addon-group-choice-type"
                checked={draft.choiceType === 'multiple'}
                onChange={() => setDraft(current => ({ ...current, choiceType: 'multiple' }))}
              />
              Choose multiple
            </label>
          </div>
        </fieldset>

        {draft.choiceType === 'multiple' && (
          <label className="block" htmlFor="addon-group-max">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Maximum (optional)</span>
            <input
              id="addon-group-max"
              type="number"
              min="1"
              inputMode="numeric"
              value={draft.maxWhenMultiple}
              onChange={event => setDraft(current => ({ ...current, maxWhenMultiple: event.target.value }))}
              placeholder="No limit"
              disabled={saving}
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
            />
          </label>
        )}

        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span className="text-sm font-medium text-[#1C1C1E]">Required</span>
          <input
            type="checkbox"
            checked={draft.required}
            onChange={event => setDraft(current => ({ ...current, required: event.target.checked }))}
            disabled={saving}
            className="size-4"
          />
        </label>

        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span>
            <span className="block text-sm font-medium text-[#1C1C1E]">Active</span>
            <span className="block text-xs text-[#6B7280]">Turn off to hide this group without deleting it.</span>
          </span>
          <input
            type="checkbox"
            checked={isActive}
            onChange={event => setIsActive(event.target.checked)}
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
          <Button type="button" variant="brand" size="pillSm" onClick={() => void handleSubmit()} disabled={saving} data-testid="addon-group-save">
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving…
                  </>
                )
              : isEdit ? 'Save group' : 'Create group'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

// =============================================================================
// ADD-ON CREATE DIALOG (B)
// =============================================================================

function AddOnCreateDialog({
  salonSlug,
  services,
  addOnGroups,
  onClose,
  onSaved,
}: {
  salonSlug: string;
  services: ServiceResponse[];
  addOnGroups: AddOnGroupResponse[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(ADD_ON_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [priceDisplayText, setPriceDisplayText] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('15');
  const [pricingType, setPricingType] = useState<'fixed' | 'per_unit'>('fixed');
  const [unitLabel, setUnitLabel] = useState('');
  const [maxQuantity, setMaxQuantity] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const handleSubmit = async () => {
    if (submitInFlightRef.current) {
      return;
    }
    const parsedPrice = Number.parseFloat(price);
    const parsedDuration = Number.parseInt(durationMinutes, 10);
    const parsedMaxQuantity = maxQuantity.trim() === '' ? null : Number.parseInt(maxQuantity, 10);
    if (!name.trim()) {
      setError('Add-on name is required.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Enter a valid price.');
      return;
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 0) {
      setError('Enter a valid duration in minutes.');
      return;
    }
    if (parsedMaxQuantity !== null && (!Number.isInteger(parsedMaxQuantity) || parsedMaxQuantity < 1)) {
      setError('Quantity limit must be at least 1, or left empty.');
      return;
    }

    submitInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/salon/add-ons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          name: name.trim(),
          category,
          descriptionItems: description.split('\n').map(item => item.trim()).filter(Boolean),
          priceCents: Math.round(parsedPrice * 100),
          priceDisplayText: priceDisplayText.trim() || null,
          durationMinutes: parsedDuration,
          pricingType,
          unitLabel: pricingType === 'per_unit' ? (unitLabel.trim() || null) : null,
          maxQuantity: pricingType === 'per_unit' ? parsedMaxQuantity : null,
          isActive,
          groupId: groupId || null,
          serviceIds,
        }),
      });
      if (!response.ok) {
        setError(await extractApiError(response, 'The add-on could not be created. Try again.'));
        return;
      }
      onSaved();
    } catch {
      setError('We could not create this add-on. Check your connection and try again.');
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <DialogShell
      isOpen
      onClose={saving ? () => {} : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-md"
      contentClassName={DIALOG_CONTENT}
      alignClassName={DIALOG_ALIGN}
    >
      <div className="space-y-4" data-testid="addon-create-dialog">
        <h2 className="text-xl font-semibold text-[#1C1C1E]">New add-on</h2>
        <p className="text-sm text-[#6B7280]">
          Add-ons appear for clients after they pick a compatible base
          service.
        </p>

        <label className="block" htmlFor="addon-create-name">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Name</span>
          <input
            id="addon-create-name"
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>

        <label className="block" htmlFor="addon-create-category">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Category</span>
          <select
            id="addon-create-category"
            value={category}
            onChange={event => setCategory(event.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          >
            {ADD_ON_CATEGORIES.map(value => (
              <option key={value} value={value}>{ADD_ON_CATEGORY_LABELS[value] ?? value}</option>
            ))}
          </select>
        </label>

        <label className="block" htmlFor="addon-create-description">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Description</span>
          <textarea
            id="addon-create-description"
            value={description}
            rows={2}
            onChange={event => setDescription(event.target.value)}
            placeholder="What the client gets — one line per point."
            disabled={saving}
            className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block" htmlFor="addon-create-price">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Price</span>
            <input
              id="addon-create-price"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={event => setPrice(event.target.value)}
              disabled={saving}
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
            />
          </label>
          <label className="block" htmlFor="addon-create-duration">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Duration (min)</span>
            <input
              id="addon-create-duration"
              type="number"
              min="0"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              onChange={event => setDurationMinutes(event.target.value)}
              disabled={saving}
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
            />
          </label>
        </div>

        <label className="block" htmlFor="addon-create-price-display">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Price display text (optional)</span>
          <input
            id="addon-create-price-display"
            type="text"
            value={priceDisplayText}
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$10+"
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>

        <fieldset disabled={saving}>
          <legend className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Pricing style</legend>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 p-2.5 text-sm has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
              <input
                type="radio"
                name="addon-create-pricing-type"
                checked={pricingType === 'fixed'}
                onChange={() => setPricingType('fixed')}
              />
              Fixed price
            </label>
            <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 p-2.5 text-sm has-[:checked]:border-rose-700 has-[:checked]:bg-rose-50">
              <input
                type="radio"
                name="addon-create-pricing-type"
                checked={pricingType === 'per_unit'}
                onChange={() => setPricingType('per_unit')}
              />
              Per unit
            </label>
          </div>
        </fieldset>

        {pricingType === 'per_unit' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block" htmlFor="addon-create-unit-label">
              <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Unit label</span>
              <input
                id="addon-create-unit-label"
                type="text"
                value={unitLabel}
                onChange={event => setUnitLabel(event.target.value)}
                placeholder="nail"
                disabled={saving}
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
              />
            </label>
            <label className="block" htmlFor="addon-create-max-quantity">
              <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Quantity limit</span>
              <input
                id="addon-create-max-quantity"
                type="number"
                min="1"
                inputMode="numeric"
                value={maxQuantity}
                onChange={event => setMaxQuantity(event.target.value)}
                placeholder="10"
                disabled={saving}
                className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
              />
            </label>
          </div>
        )}

        <label className="block" htmlFor="addon-create-group">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Add-on group (optional)</span>
          <select
            id="addon-create-group"
            value={groupId}
            onChange={event => setGroupId(event.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          >
            <option value="">No group</option>
            {addOnGroups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </label>

        <div data-testid="addon-create-compatibility">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Offered with</span>
          <p className="mb-2 text-xs text-[#6B7280]">Clients see this add-on only after choosing one of these services.</p>
          {services.length === 0
            ? (
                <p className="rounded-xl border border-gray-200 p-3 text-xs text-[#8E8E93]">
                  Add a service first, then choose where this add-on appears.
                </p>
              )
            : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2">
                  {services.map(service => (
                    <label key={service.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
                      <span className="min-w-0 truncate text-[13px] text-[#1C1C1E]">{service.name}</span>
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={serviceIds.includes(service.id)}
                        onChange={(event) => {
                          setServiceIds(current => (event.target.checked
                            ? [...current, service.id]
                            : current.filter(id => id !== service.id)));
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
        </div>

        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span className="text-sm font-medium text-[#1C1C1E]">Bookable</span>
          <input
            type="checkbox"
            checked={isActive}
            onChange={event => setIsActive(event.target.checked)}
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
          <Button type="button" variant="brand" size="pillSm" onClick={() => void handleSubmit()} disabled={saving} data-testid="addon-create-save">
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating…
                  </>
                )
              : 'Create add-on'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

// =============================================================================
// CHANGE GROUP (existing add-on) — B's "let an add-on be placed in a group"
// for add-ons that already exist.
// =============================================================================

function AddOnGroupAssignDialog({
  salonSlug,
  addOn,
  addOnGroups,
  onClose,
  onSaved,
}: {
  salonSlug: string;
  addOn: AddOnResponse;
  addOnGroups: AddOnGroupResponse[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [groupId, setGroupId] = useState<string>(addOn.groupId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const dirty = groupId !== (addOn.groupId ?? '');

  const handleSubmit = async () => {
    if (submitInFlightRef.current || !dirty) {
      return;
    }
    submitInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/salon/add-ons/${encodeURIComponent(addOn.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          name: addOn.name,
          descriptionItems: addOn.descriptionItems ?? [],
          priceCents: addOn.priceCents,
          priceDisplayText: addOn.priceDisplayText ?? null,
          durationMinutes: addOn.durationMinutes,
          maxQuantity: addOn.maxQuantity ?? null,
          isActive: addOn.isActive ?? true,
          groupId: groupId || null,
        }),
      });
      if (!response.ok) {
        setError(await extractApiError(response, 'The group could not be changed. Try again.'));
        return;
      }
      onSaved();
    } catch {
      setError('We could not save this change. Check your connection and try again.');
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <DialogShell
      isOpen
      onClose={saving ? () => {} : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-sm"
      contentClassName={DIALOG_CONTENT}
      alignClassName={DIALOG_ALIGN}
    >
      <div className="space-y-4" data-testid="addon-group-assign-dialog">
        <h2 className="text-lg font-semibold text-[#1C1C1E]">
          Group for "
          {addOn.name}
          "
        </h2>
        <label className="block" htmlFor="addon-group-assign-select">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Add-on group</span>
          <select
            id="addon-group-assign-select"
            value={groupId}
            onChange={event => setGroupId(event.target.value)}
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          >
            <option value="">No group</option>
            {addOnGroups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
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
          <Button
            type="button"
            variant="brand"
            size="pillSm"
            onClick={() => void handleSubmit()}
            disabled={saving || !dirty}
            data-testid="addon-group-assign-save"
          >
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving…
                  </>
                )
              : 'Save'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

// =============================================================================
// MAIN PANEL
// =============================================================================

export function AddOnsAndGroupsPanel({
  salonSlug,
  services,
  addOns,
  addOnGroups,
  onRefresh,
}: AddOnsAndGroupsPanelProps) {
  const [groupDialogGroup, setGroupDialogGroup] = useState<AddOnGroupResponse | null>(null);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<AddOnGroupResponse | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showAddOnCreate, setShowAddOnCreate] = useState(false);
  const [assigningAddOn, setAssigningAddOn] = useState<AddOnResponse | null>(null);

  const groupNameById = new Map(addOnGroups.map(group => [group.id, group.name]));

  const handleDeleteGroup = async () => {
    if (!deletingGroup) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/salon/add-on-groups/${encodeURIComponent(deletingGroup.id)}?salonSlug=${encodeURIComponent(salonSlug)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setDeleteError(await extractApiError(response, 'The group could not be deleted. Try again.'));
        return;
      }
      setDeletingGroup(null);
      onRefresh();
    } catch {
      setDeleteError('We could not delete this group. Check your connection and try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="catalog-addons-panel">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Add-on groups</h3>
          <Button type="button" variant="brandSoft" size="pillSm" onClick={() => setShowGroupCreate(true)} data-testid="addon-group-create-open">
            <Plus className="mr-1 size-4" />
            New group
          </Button>
        </div>
        <p className="mb-3 text-[13px] text-[#6B7280]">
          A group lets clients choose between related add-ons, like nail
          shapes or polish finishes.
        </p>
        {addOnGroups.length === 0
          ? (
              <div className="rounded-[18px] border border-gray-200 bg-white p-4 text-[14px] text-[#8E8E93]">
                No add-on groups yet. Most salons never need one — create a
                group only if clients should pick between related add-ons.
              </div>
            )
          : (
              <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white">
                {addOnGroups.map((group, index) => (
                  <div
                    key={group.id}
                    data-testid={`addon-group-row-${group.id}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${index < addOnGroups.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => setGroupDialogGroup(group)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[15px] font-semibold text-[#1C1C1E]">{group.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[#8E8E93]">
                        <span>{describeGroupBounds(group)}</span>
                        <span>·</span>
                        <span>
                          {group.memberAddOnIds.length}
                          {' '}
                          {group.memberAddOnIds.length === 1 ? 'add-on' : 'add-ons'}
                        </span>
                        {!group.isActive && (
                          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-600">Inactive</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${group.name}`}
                      data-testid={`addon-group-delete-${group.id}`}
                      onClick={() => {
                        setDeleteError(null);
                        setDeletingGroup(group);
                      }}
                      className="rounded-full p-2 text-red-600 transition hover:bg-red-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Add-ons</h3>
          <Button type="button" variant="brandSoft" size="pillSm" onClick={() => setShowAddOnCreate(true)} data-testid="addon-create-open">
            <Plus className="mr-1 size-4" />
            New add-on
          </Button>
        </div>
        {addOns.length === 0
          ? (
              <div className="rounded-[18px] border border-gray-200 bg-white p-4 text-[14px] text-[#8E8E93]">
                No add-ons yet.
              </div>
            )
          : (
              <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white">
                {addOns.map((addOn, index) => (
                  <div
                    key={addOn.id}
                    data-testid={`catalog-addon-row-${addOn.id}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${index < addOns.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-[#1C1C1E]">{addOn.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[#8E8E93]">
                        <span>{addOn.priceDisplayText || formatCurrency(addOn.priceCents)}</span>
                        <span>·</span>
                        <span>{formatDuration(addOn.durationMinutes)}</span>
                        <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px]">
                          {addOn.groupId ? (groupNameById.get(addOn.groupId) ?? 'Ungrouped') : 'Ungrouped'}
                        </span>
                        {!addOn.isActive && (
                          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-600">Inactive</span>
                        )}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="brandSoft"
                      size="pillSm"
                      onClick={() => setAssigningAddOn(addOn)}
                      data-testid={`catalog-addon-change-group-${addOn.id}`}
                    >
                      Change group
                    </Button>
                  </div>
                ))}
              </div>
            )}
      </section>

      {(showGroupCreate || groupDialogGroup) && (
        <GroupFormDialog
          salonSlug={salonSlug}
          group={groupDialogGroup}
          onClose={() => {
            setShowGroupCreate(false);
            setGroupDialogGroup(null);
          }}
          onSaved={() => {
            setShowGroupCreate(false);
            setGroupDialogGroup(null);
            onRefresh();
          }}
        />
      )}

      {showAddOnCreate && (
        <AddOnCreateDialog
          salonSlug={salonSlug}
          services={services}
          addOnGroups={addOnGroups}
          onClose={() => setShowAddOnCreate(false)}
          onSaved={() => {
            setShowAddOnCreate(false);
            onRefresh();
          }}
        />
      )}

      {assigningAddOn && (
        <AddOnGroupAssignDialog
          salonSlug={salonSlug}
          addOn={assigningAddOn}
          addOnGroups={addOnGroups}
          onClose={() => setAssigningAddOn(null)}
          onSaved={() => {
            setAssigningAddOn(null);
            onRefresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deletingGroup !== null}
        title={`Delete "${deletingGroup?.name ?? ''}"?`}
        description={(
          <>
            {deleteError ?? 'This cannot be undone. Groups that still have add-ons in them cannot be deleted.'}
          </>
        )}
        confirmLabel="Delete group"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void handleDeleteGroup()}
        onClose={() => {
          if (!deleteBusy) {
            setDeletingGroup(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
