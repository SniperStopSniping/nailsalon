import { useState } from 'react';

import { AppointmentPaymentsPanel } from '../../../src/components/customerPayments/AppointmentPaymentsPanel';
import type { AdjustmentBalanceInput } from '../../../src/libs/customerPayments/adjustments';
import { adjustmentPermissions, resolveAdjustmentBalance } from '../../../src/libs/customerPayments/adjustments';

const scope = { salonId: 'example-salon', appointmentId: 'example-appointment' };

function example(kind: 'extra' | 'refund' | 'deposit' | 'unpaid'): AdjustmentBalanceInput {
  return {
    revision: 2,
    bill: { ...scope, revision: 2, serviceCents: kind === 'refund' ? 8000 : 12000, taxCents: 0, tipCents: 0 },
    payments: kind === 'unpaid' ? [] : [{ ...scope, id: 'original', movementId: 'original-movement', kind: kind === 'deposit' ? 'deposit' : 'online', principalCents: kind === 'deposit' ? 2000 : 10000, tipCents: 0, state: 'confirmed' }],
    refunds: [],
    requests: [],
  };
}

export function AdjustmentPreview() {
  const [evidence, setEvidence] = useState(() => example('extra'));
  const [role, setRole] = useState<'staff' | 'owner'>('staff');
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState('');
  const balance = resolveAdjustmentBalance(evidence);
  const permissions = adjustmentPermissions({ role, hasAppointmentAccess: true, impersonating: false, canEditItems: true, canRecordPayment: true });
  const activeRequest = evidence.requests.find(request => request.state === 'open');
  const activeRefund = evidence.refunds.find(refund => refund.state === 'requested');
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
        <h1 className="text-lg font-semibold">Appointment payments preview</h1>
        <p>Example records only. No payments, refunds, messages or bookings are made. Amounts are example final totals.</p>
        <div className="flex flex-wrap gap-2">
          {(['extra', 'refund', 'deposit', 'unpaid'] as const).map(kind => (
            <button
              key={kind}
              type="button"
              className="min-h-11 rounded-lg border px-3"
              onClick={() => {
                setEvidence(example(kind));
                setMessage('');
              }}
            >
              {kind === 'extra' ? 'Add a service' : kind === 'refund' ? 'Remove a service' : kind === 'deposit' ? 'Deposit paid' : 'No payment yet'}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2">
          Preview as
          <select aria-label="Preview role" className="min-h-11 rounded-lg border px-3" value={role} onChange={event => setRole(event.target.value as 'owner' | 'staff')}>
            <option value="staff">Tech</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={online} onChange={event => setOnline(event.target.checked)} />
          Online requests available
        </label>
      </div>
      <AppointmentPaymentsPanel
        appointmentId={evidence.bill.appointmentId}
        key={`${role}:${evidence.bill.appointmentId}`}
        clientName="Example client"
        balance={balance}
        permissions={permissions}
        onlinePaymentsAvailable={online}
        history={[
          ...evidence.payments.map(payment => ({ id: payment.id, label: payment.kind === 'deposit' ? 'Booking deposit' : payment.kind === 'manual' ? 'Payment recorded at salon' : 'Online payment', amountCents: payment.principalCents + payment.tipCents, status: 'paid' as const })),
          ...evidence.refunds.map(refund => ({ id: refund.id, label: 'Service adjustment refund', amountCents: refund.principalCents + refund.tipCents, status: refund.state === 'succeeded' ? 'refunded' as const : 'pending' as const })),
        ]}
        onAction={async (action) => {
          if (action === 'edit') {
            setMessage('In the app this opens Edit services & items. Use the scenario buttons above to preview a revised bill.');
          } else if (action === 'request_payment') {
            setEvidence(current => ({ ...current, revision: current.revision + 1, requests: [...current.requests, { ...scope, id: `request-${current.revision}`, billRevision: current.bill.revision, principalCents: balance.principalDueCents, tipCents: balance.tipDueCents, state: 'open' }] }));
            setMessage('Example request opened. No link or message was sent.');
          } else if (action === 'record_payment') {
            setEvidence(current => ({ ...current, revision: current.revision + 1, payments: [...current.payments, { ...scope, id: `manual-${current.revision}`, movementId: `manual-movement-${current.revision}`, kind: 'manual', principalCents: balance.principalDueCents, tipCents: balance.tipDueCents, state: 'confirmed' }] }));
            setMessage('Example in-person payment recorded in this preview only.');
          } else if (action === 'request_refund' || action === 'review_refund') {
            const original = evidence.payments[0]!;
            setEvidence(current => ({ ...current, revision: current.revision + 1, refunds: [...current.refunds, { ...scope, id: `refund-${current.revision}`, paymentId: original.id, principalCents: balance.principalOverpaidCents, tipCents: balance.tipOverpaidCents, state: 'requested' }] }));
            setMessage(action === 'request_refund' ? 'Example owner approval request recorded. No refund was issued.' : 'Example refund allocation reserved for review. No refund was issued.');
          }
        }}
      />
      {activeRequest && (
        <button
          type="button"
          className="min-h-11 w-full rounded-xl border bg-amber-50 p-3"
          onClick={() => {
            setEvidence(current => ({ ...current, revision: current.revision + 1, requests: current.requests.map(request => request.id === activeRequest.id ? { ...request, state: 'paid' } : request), payments: [...current.payments, { ...scope, id: `payment-${activeRequest.id}`, requestId: activeRequest.id, movementId: `movement-${activeRequest.id}`, kind: 'online', principalCents: activeRequest.principalCents, tipCents: activeRequest.tipCents, state: 'confirmed' }] }));
            setMessage('Simulated provider confirmation. No real payment occurred.');
          }}
        >
          Simulate customer payment confirmation
        </button>
      )}
      {activeRefund && (
        <button
          type="button"
          className="min-h-11 w-full rounded-xl border bg-amber-50 p-3"
          onClick={() => {
            setEvidence(current => ({ ...current, revision: current.revision + 1, refunds: current.refunds.map(refund => refund.id === activeRefund.id ? { ...refund, state: 'succeeded' } : refund) }));
            setMessage('Simulated approved refund confirmation. No real refund occurred.');
          }}
        >
          Simulate approved refund confirmation
        </button>
      )}
      <p role="status" className="text-sm text-stone-600">{message}</p>
    </main>
  );
}
