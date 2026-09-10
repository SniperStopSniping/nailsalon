'use client';

/**
 * Create an add-on from the Add-ons tab.
 *
 * The audit found the Add-ons tab could only ever be filled from the Library
 * ("No add-ons yet. Add them from the Library tab."), so an extra a salon
 * actually charges for — anything the template catalogue does not carry — had
 * no owner-side route at all, even though POST /api/salon/add-ons has accepted
 * one (with its service eligibility list) since the owner-catalog work.
 *
 * Same field vocabulary and the same "Offered with" eligibility list as the
 * edit dialog, so creating and editing an add-on read as one screen.
 */

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import { InlineFeedback } from '@/components/ui/inline-feedback';
import { ADD_ON_CATEGORIES } from '@/models/serviceCatalogTypes';

import { addOnCategoryLabel } from './addOnCategories';

export type AddOnCreateService = {
  id: string;
  name: string;
  isActive: boolean;
};

export type CreatedAddOn = {
  id: string;
  name: string;
};

export function AddOnCreateDialog({
  isOpen,
  salonSlug,
  services,
  initialServiceIds,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  salonSlug: string | null;
  services: AddOnCreateService[];
  /**
   * Services ticked when the sheet opens. Set when the owner reaches this
   * dialog from inside one service ("Add-ons for Gel Manicure -> Create new
   * add-on"), so the add-on they are plainly creating FOR that service comes
   * back already offered with it. Still fully editable here — the owner can
   * untick it or add more.
   */
  initialServiceIds?: string[];
  onClose: () => void;
  onCreated: (addOn: CreatedAddOn) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('nail_art');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [priceDisplayText, setPriceDisplayText] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh sheet every time it opens: a half-typed add-on must never be
  // resurrected under a different name.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName('');
    setCategory('nail_art');
    setDescription('');
    setPrice('');
    setDurationMinutes('');
    setPriceDisplayText('');
    setIsActive(true);
    setServiceIds(initialServiceIds ?? []);
    setSaving(false);
    setError(null);
    // `initialServiceIds` is read once per open on purpose: re-syncing it
    // would undo the owner's own ticks while the sheet is still open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async () => {
    if (!salonSlug) {
      setError('Select a salon before creating an add-on.');
      return;
    }
    const parsedPrice = Number.parseFloat(price);
    const parsedDuration = Number.parseInt(durationMinutes, 10);
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
          descriptionItems: description
            .split('\n')
            .map(item => item.trim())
            .filter(Boolean),
          priceCents: Math.round(parsedPrice * 100),
          priceDisplayText: priceDisplayText.trim() || null,
          durationMinutes: parsedDuration,
          isActive,
          serviceIds,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Failed to create add-on');
      }
      const created = result?.data?.addOn as CreatedAddOn | undefined;
      if (!created) {
        throw new Error('The created add-on was missing from the response');
      }
      onCreated(created);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create add-on');
      setSaving(false);
    }
  };

  return (
    <DialogShell
      isOpen
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[90dvh] overflow-y-auto rounded-3xl bg-[var(--owner-surface)] p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4" data-testid="addon-create-dialog">
        <div>
          <h2 className="text-xl font-semibold text-[var(--owner-ink)]">New add-on</h2>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">
            Add-ons appear for clients after they pick one of the services you
            choose below — they are never listed on their own.
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Name</span>
          <input
            type="text"
            value={name}
            data-testid="addon-create-name"
            onChange={event => setName(event.target.value)}
            placeholder="Chrome finish"
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Category</span>
          <select
            value={category}
            data-testid="addon-create-category"
            onChange={event => setCategory(event.target.value)}
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          >
            {ADD_ON_CATEGORIES.map(value => (
              <option key={value} value={value}>{addOnCategoryLabel(value)}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Description</span>
          <textarea
            value={description}
            rows={2}
            data-testid="addon-create-description"
            onChange={event => setDescription(event.target.value)}
            placeholder="What the client gets — one line per point."
            className="w-full rounded-xl border border-[var(--owner-line)] p-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              data-testid="addon-create-price"
              onChange={event => setPrice(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Duration (min)</span>
            <input
              type="number"
              min="0"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              data-testid="addon-create-duration"
              onChange={event => setDurationMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Price display text</span>
          <input
            type="text"
            value={priceDisplayText}
            data-testid="addon-create-price-display"
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$10+"
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>

        <div data-testid="addon-create-compatibility">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Offered with</span>
          <p className="mb-2 text-xs text-[var(--owner-muted)]">
            Clients see this add-on only after choosing one of these services.
            {services.length > 0 ? ' Leave everything unticked to set this up later.' : ''}
          </p>
          {services.length === 0
            ? (
                <p className="rounded-xl border border-[var(--owner-line)] p-3 text-xs text-[var(--owner-muted)]">
                  Add a service first, then choose where this add-on appears.
                </p>
              )
            : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[var(--owner-line)] p-2">
                  {services.map(service => (
                    <label
                      key={service.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-[13px] text-[var(--owner-ink)]">
                        {service.name}
                        {!service.isActive && (
                          <span className="ml-1 text-[11px] text-[var(--owner-muted)]">(inactive)</span>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        data-testid={`addon-create-service-${service.id}`}
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

        <label className="flex items-center justify-between rounded-xl border border-[var(--owner-line)] p-3">
          <span>
            <span className="block text-sm font-medium text-[var(--owner-ink)]">Bookable</span>
            <span className="block text-xs text-[var(--owner-muted)]">
              Turn off to save it without offering it to clients yet.
            </span>
          </span>
          <input
            type="checkbox"
            checked={isActive}
            data-testid="addon-create-active"
            onChange={event => setIsActive(event.target.checked)}
            className="size-4"
          />
        </label>

        {error && (
          <InlineFeedback
            tone="error"
            message={error}
            data-testid="addon-create-error"
            onDismiss={() => setError(null)}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="brandSoft" size="pillSm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            size="pillSm"
            data-testid="addon-create-submit"
            onClick={() => void handleSubmit()}
            disabled={saving}
          >
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating...
                  </>
                )
              : 'Create Add-on'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
