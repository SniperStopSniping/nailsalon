import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { SetupAddOn } from './add-ons';
import { AddOnBookingSummary } from './AddOnBookingSummary';
import { AddOnEditor } from './AddOnEditor';
import type { SetupService } from './contracts';

const services = [{ id: 'gel', name: 'Gel manicure' }, { id: 'biab', name: 'BIAB' }] as SetupService[];
const art: SetupAddOn = { id: 'extra', name: 'Nail art', category: 'nail_art', descriptionItems: ['Simple details'], priceCents: 1000, durationMinutes: 15, pricingType: 'fixed', unitLabel: null, maxQuantity: null, isActive: true, serviceIds: ['gel'], origin: 'assistant', confirmed: false };

it('distinguishes owner-supplied amounts from AI suggestions without accepting either automatically', () => {
  const { rerender } = render(<AddOnEditor addOns={[art]} sources={{ extra: { name: 'owner', priceCents: 'owner', durationMinutes: 'owner' } }} services={services} revision={2} disabled={false} onSave={vi.fn()} onConfirm={vi.fn()} />);

  expect(screen.getByText('Supplied by you · Needs your review')).toBeVisible();
  expect(screen.queryByText(/illustrative starting points/)).not.toBeInTheDocument();

  rerender(<AddOnEditor addOns={[art]} sources={{ extra: { name: 'upload', priceCents: 'upload', durationMinutes: 'suggested' } }} services={services} revision={3} disabled={false} onSave={vi.fn()} onConfirm={vi.fn()} />);

  expect(screen.getByText(/Price: Read from your upload · Time: AI suggestion · Needs your review/)).toBeVisible();
  expect(screen.getByText(/illustrative starting points/)).toBeVisible();
});

it('saves real add-on values and eligible services without accepting other proposed extras', () => {
  const onSave = vi.fn();
  const onConfirm = vi.fn();
  render(<AddOnEditor addOns={[art]} services={services} revision={2} disabled={false} onSave={onSave} onConfirm={onConfirm} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Price' }), { target: { value: '12.50' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'BIAB' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save add-on' }));

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'extra', priceCents: 1250, durationMinutes: 15, serviceIds: ['gel', 'biab'] }));
  expect(onConfirm).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Accept the displayed add-ons' }));

  expect(onConfirm).toHaveBeenCalledWith(['extra']);
});

it('keeps advanced selection rules while permitting a price edit', () => {
  const onSave = vi.fn();
  render(<AddOnEditor addOns={[{ ...art, groupId: 'group', advancedRules: true }]} services={services} revision={3} disabled={false} onSave={onSave} onConfirm={vi.fn()} />);

  expect(screen.getByRole('checkbox', { name: 'BIAB' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Offer this add-on' })).toBeDisabled();

  fireEvent.click(screen.getByText('Description and price options'));

  expect(screen.getByRole('combobox', { name: 'Charge' })).toBeDisabled();

  fireEvent.change(screen.getByRole('spinbutton', { name: 'Price' }), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save add-on' }));

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 1500, serviceIds: ['gel'], pricingType: 'fixed', isActive: true }));
});

it('blocks saves while busy and shows a useful local validation error', () => {
  const onSave = vi.fn();
  const { rerender } = render(<AddOnEditor addOns={[art]} services={services} revision={2} disabled={false} onSave={onSave} onConfirm={vi.fn()} />);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Extra minutes' }), { target: { value: '241' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Nail art add-on' }));

  expect(screen.getByRole('alert')).toBeVisible();
  expect(onSave).not.toHaveBeenCalled();

  rerender(<AddOnEditor addOns={[art]} services={services} revision={2} disabled onSave={onSave} onConfirm={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Save add-on' })).toBeDisabled();
});

it('shows proposed price, per-unit time and named services with preview limitations', () => {
  render(<AddOnBookingSummary document={{ addOns: [{ ...art, pricingType: 'per_unit', unitLabel: 'nail', maxQuantity: 2 }], services, booking: { currency: 'CAD' } } as never} />);
  fireEvent.click(screen.getByText('Proposed add-ons'));

  expect(screen.getByText(/Nail art:.*10.*per nail.*15 extra minutes per unit.*Gel manicure.*needs your review/)).toBeVisible();
  expect(screen.getByText(/Simulated preview times show the base service only/)).toBeVisible();
});
