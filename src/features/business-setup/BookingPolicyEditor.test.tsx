import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig.shared';
import { resolveBookingExperience } from '@/libs/bookingExperience';

import { hydrateSetupPolicy, setupPolicyInput } from './booking-policy';
import { BookingPolicyEditor } from './BookingPolicyEditor';
import { applySetupOperations, CLOSED_HOURS, type SetupDocument, setupOperationSchema } from './contracts';

const policy = resolveBookingExperience(null, { includeAcknowledgmentConfiguration: true }).policy;

it('edits the agreement through the shared validator without exposing derived version fields', () => {
  const onSave = vi.fn();
  render(<BookingPolicyEditor value={policy} disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByText('Booking agreement', { exact: true }));
  fireEvent.change(screen.getByLabelText('Your booking agreement'), { target: { value: 'Please arrive on time.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save booking agreement' }));

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ text: 'Please arrive on time.', acknowledgment: { required: true, text: policy.acknowledgment.text } }));
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('version');
});

it('can turn off an agreement without retaining a hidden required checkbox', () => {
  const onSave = vi.fn();
  render(<BookingPolicyEditor value={policy} disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByText('Booking agreement', { exact: true }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show a booking agreement' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save booking agreement' }));

  expect(onSave.mock.calls[0]![0]).toMatchObject({ enabled: false, acknowledgment: { required: false } });
});

it('rejects forged versions and upload-origin activation while preserving existing acknowledgment', () => {
  const values = setupPolicyInput(policy);

  expect(setupOperationSchema.safeParse({ type: 'booking_policy', values: { ...values, version: 'invented' } }).success).toBe(false);

  const document: SetupDocument = { schemaVersion: 1, bookingPolicy: policy, business: { name: 'Studio', city: 'Toronto', exactAddress: '', homeBased: false, workMode: 'solo', locationDisplayMode: 'city_only' }, services: [], hours: CLOSED_HOURS, booking: resolveBookingConfigFromSettings(null), website: { config: {}, content: {} } as SetupDocument['website'] };

  expect(() => applySetupOperations(document, [{ type: 'booking_policy', values }], 'upload')).toThrow(/Discuss booking requirements/);

  const { acknowledgment: _acknowledgment, ...withoutAcknowledgment } = values;
  const proposed = applySetupOperations(document, [{ type: 'booking_policy', values: { ...withoutAcknowledgment, text: 'New policy wording.' } }], 'assistant');

  expect(proposed.bookingPolicy?.acknowledgment?.required).toBe(true);
  expect(proposed.bookingPolicy?.text).toBe('New policy wording.');
  expect(proposed.bookingPolicyEdited).toBe(true);
  expect(hydrateSetupPolicy({ ...policy, acknowledgment: undefined }, policy)?.acknowledgment?.required).toBe(true);
  expect(hydrateSetupPolicy({ ...policy, enabled: false, acknowledgment: undefined }, policy)?.acknowledgment?.required).toBe(false);

  document.business.exactAddress = '123 Private Street';

  expect(() => applySetupOperations(document, [{ type: 'booking_policy', values: { ...values, text: 'Visit 123 Private Street.' } }], 'assistant')).toThrow(/private street address/);
});
