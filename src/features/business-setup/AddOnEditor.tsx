'use client';

import { useState } from 'react';

import { ADD_ON_CATEGORIES } from '@/models/serviceCatalogTypes';

import { type SetupAddOn, setupAddOnSchema } from './add-ons';
import type { SetupService } from './contracts';
import { hasUnverifiedAiValues, type SetupValueSources, valueSourcesSummary } from './value-sources';

type Values = ReturnType<typeof setupAddOnSchema.parse>;
function AddOnForm({ addOn, sources, services, disabled, onSave }: { addOn: SetupAddOn; sources?: SetupValueSources; services: SetupService[]; disabled: boolean; onSave: (values: Values) => void }) {
  const keepRules = Boolean(addOn.groupId || addOn.advancedRules);
  const [error, setError] = useState('');
  return (
    <form
      className="setup-service"
      aria-label={`${addOn.name} add-on`}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const amount = String(form.get('price')).trim();
        const time = String(form.get('duration')).trim();
        const result = setupAddOnSchema.safeParse({
          id: addOn.id,
          name: String(form.get('name')),
          category: String(form.get('category')),
          descriptionItems: String(form.get('description')).split('\n').map(text => text.trim()).filter(Boolean),
          priceCents: amount ? Math.round(Number(amount) * 100) : null,
          priceDisplayText: String(form.get('priceDisplayText')).trim() || null,
          durationMinutes: time ? Number(time) : null,
          pricingType: keepRules ? addOn.pricingType : String(form.get('pricingType')),
          unitLabel: keepRules ? addOn.unitLabel : String(form.get('unitLabel')).trim() || null,
          maxQuantity: keepRules ? addOn.maxQuantity : form.get('maxQuantity') ? Number(form.get('maxQuantity')) : null,
          isActive: keepRules ? addOn.isActive : form.has('active'),
          serviceIds: keepRules ? addOn.serviceIds : form.getAll('services').map(String),
        });
        if (!result.success) {
          setError(result.error.issues[0]?.message ?? 'Check the add-on details.');
          return;
        }
        setError('');
        onSave(result.data);
      }}
    >
      <label>
        Add-on name
        <input name="name" required maxLength={120} defaultValue={addOn.name} disabled={disabled} />
      </label>
      <label>
        Category
        <select name="category" defaultValue={addOn.category} disabled={disabled}>{ADD_ON_CATEGORIES.map(category => <option value={category} key={category}>{category.replaceAll('_', ' ')}</option>)}</select>
      </label>
      <label>
        Price
        <input name="price" type="number" min="0" max="1000000" step="0.01" defaultValue={addOn.priceCents === null ? '' : addOn.priceCents / 100} disabled={disabled} />
      </label>
      <label>
        Extra minutes
        <input name="duration" type="number" min="0" max="240" step="1" defaultValue={addOn.durationMinutes ?? ''} disabled={disabled} />
      </label>
      <p>{`${valueSourcesSummary(addOn, sources)} · ${addOn.confirmed ? 'Reviewed' : 'Needs your review'}`}</p>
      {addOn.priceLabelNeedsReview && <p role="alert">Update or clear the old price wording before publishing.</p>}
      <details>
        <summary>Description and price options</summary>
        <label>
          Description, one point per line
          <textarea name="description" defaultValue={addOn.descriptionItems?.join('\n') ?? ''} maxLength={10000} disabled={disabled} />
        </label>
        <label>
          Price wording
          <input name="priceDisplayText" maxLength={240} defaultValue={addOn.priceDisplayText ?? ''} disabled={disabled} />
        </label>
        <label>
          Charge
          <select name="pricingType" defaultValue={addOn.pricingType} disabled={disabled || keepRules}>
            <option value="fixed">Once per appointment service</option>
            <option value="per_unit">Per unit, such as each nail</option>
          </select>
        </label>
        <label>
          Unit name
          <input name="unitLabel" maxLength={120} defaultValue={addOn.unitLabel ?? ''} disabled={disabled || keepRules} placeholder="nail" />
        </label>
        <label>
          Maximum quantity
          <input name="maxQuantity" type="number" min="1" max="50" defaultValue={addOn.maxQuantity ?? ''} disabled={disabled || keepRules} />
        </label>
      </details>
      <fieldset disabled={disabled || keepRules}>
        <legend>Offer with these services</legend>
        {services.map(service => (
          <label key={service.id}>
            <input name="services" type="checkbox" value={service.id} defaultChecked={addOn.serviceIds.includes(service.id)} />
            {' '}
            {service.name}
          </label>
        ))}
      </fieldset>
      <label>
        <input name="active" type="checkbox" defaultChecked={addOn.isActive} disabled={disabled || keepRules} />
        {' '}
        Offer this add-on
      </label>
      {keepRules && <p>Existing group and selection rules are kept. Change those choices in your service library.</p>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={disabled}>Save add-on</button>
    </form>
  );
}

export function AddOnEditor({ addOns, sources, services, revision, disabled, onSave, onConfirm }: { addOns: SetupAddOn[]; sources?: Record<string, SetupValueSources>; services: SetupService[]; revision: number; disabled: boolean; onSave: (values: Values) => void; onConfirm: (ids: string[]) => void }) {
  const pending = addOns.filter(addOn => !addOn.confirmed);
  return (
    <details open={pending.length > 0}>
      <summary>
        Add-ons and extra time
        {addOns.length ? ` (${addOns.length})` : ''}
      </summary>
      <p>Extras use your existing booking menu. Choose where they’re offered; prices and extra time stay private until you publish. Existing appointments keep their booked prices and times.</p>
      {pending.length > 0 && (
        <div className="setup-notice">
          <p>Review the proposed prices, extra minutes and service choices.</p>
          {pending.some(addOn => hasUnverifiedAiValues(addOn, sources?.[addOn.id])) && <p>AI suggestions are illustrative starting points, not researched local market rates.</p>}
          <button type="button" disabled={disabled} onClick={() => onConfirm(pending.map(addOn => addOn.id))}>Accept the displayed add-ons</button>
        </div>
      )}
      {addOns.map(addOn => <AddOnForm key={`${addOn.id}-${revision}`} addOn={addOn} sources={sources?.[addOn.id]} services={services} disabled={disabled} onSave={onSave} />)}
      <button type="button" disabled={disabled} onClick={() => onSave({ id: `draft_${crypto.randomUUID()}`, name: 'New add-on', category: 'nail_art', descriptionItems: null, priceCents: null, durationMinutes: null, pricingType: 'fixed', unitLabel: null, maxQuantity: null, isActive: true, serviceIds: [] })}>Add an extra</button>
    </details>
  );
}
