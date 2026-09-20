import '@/styles/global.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import { CheckoutSheet } from '@/components/appointments/CheckoutSheet';

const longServiceName = 'Russian Manicure with Structured Builder Gel, Detailed Cuticle Care and Long-Wear Chrome Finish';

function appointmentDetail(status = 'confirmed') {
  return {
    appointment: {
      id: 'appt_browser_1',
      salonId: 'salon_fixture',
      salonSlug: 'fixture',
      salonName: 'Fixture Nail Studio',
      timeZone: 'America/Toronto',
      parkingInstructions: null,
      clientName: 'Alexandria Verylongname',
      clientPhone: '4165550101',
      technicianId: 'tech_1',
      locationId: 'loc_1',
      locationName: 'Studio',
      status,
      startTime: '2026-09-19T15:00:00.000Z',
      endTime: '2026-09-19T16:00:00.000Z',
      totalPrice: 3500,
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      slotIntervalMinutes: 15,
      isLocked: false,
      lockedAt: null,
      paymentStatus: 'pending',
      baseServiceId: `svc_${'x'.repeat(68)}`,
      baseServiceName: longServiceName,
      discountType: null,
      discountAmountCents: 0,
      notes: null,
      techNotes: null,
    },
    client: { id: 'client_1', notes: 'Prefers quiet appointments', sensitivities: 'HEMA sensitivity', nailPreferences: { shape: 'Almond', length: 'Short', favoriteColors: 'Neutral pinks', productsUsed: 'Builder gel' } },
    location: { id: 'loc_1', name: 'Studio', address: '1 King Street', city: 'Toronto', state: 'ON', zipCode: 'M5H 1A1' },
    services: [{ id: `svc_${'x'.repeat(68)}`, name: longServiceName, category: 'manicure', priceAtBooking: 3500, durationAtBooking: 60, isBaseService: true }],
    addOns: [],
    serviceOptions: [{ id: `svc_${'x'.repeat(68)}`, name: longServiceName, category: 'manicure', priceCents: 3500, durationMinutes: 60 }],
    technicianOptions: [{ id: 'tech_1', name: 'Isla Nail Technician' }],
    financial: { state: 'resolved', currency: 'CAD', classification: 'estimate', serviceInvoiceTotalCents: 3500, invoiceTotalCents: 3500, taxAmountCents: 0, taxLabel: null, depositCreditAppliedCents: 0, amountAlreadyPaidCents: 0, balanceCents: 3500 },
    permissions: { canMove: true, canChangeService: true, canCancel: true, canMarkCompleted: ['confirmed', 'in_progress'].includes(status), canStart: status === 'confirmed', canConfirm: status === 'pending', canDecline: status === 'pending', canMarkNoShow: ['pending', 'confirmed', 'in_progress'].includes(status), canReassignTechnician: false },
    warnings: [],
    communications: [{ channel: 'email', purpose: 'booking_confirmation', status: 'delivered', updatedAt: '2026-09-19T12:00:00.000Z' }],
  };
}

export function AppointmentWorkflowFixture() {
  const [quickOpen, setQuickOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [status, setStatus] = useState('confirmed');
  const detail = appointmentDetail(status);

  return (
    <main className="owner-workspace-theme min-h-screen bg-stone-50 p-4">
      <h1 className="mb-4 text-xl font-semibold">Appointment workflow fixture</h1>
      <div className="mb-4 flex flex-wrap gap-2">
        {['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].map(next => <button className="min-h-11 rounded-xl border px-3" data-testid={`status-${next}`} key={next} onClick={() => setStatus(next)} type="button">{next}</button>)}
      </div>
      <button className="min-h-11 rounded-xl bg-black px-4 text-white" data-testid="open-appointment" onClick={() => setQuickOpen(true)} type="button">Open appointment</button>
      <button className="ml-2 min-h-11 rounded-xl bg-black px-4 text-white" data-testid="open-checkout" onClick={() => setCheckoutOpen(true)} type="button">Open checkout</button>
      <AppointmentQuickEditSheet
        actionError={null}
        detail={detail as never}
        isOpen={quickOpen}
        loading={false}
        saving={false}
        onCancelAppointment={async () => {}}
        onClose={() => setQuickOpen(false)}
        onMarkCompleted={() => {
          setQuickOpen(false);
          setCheckoutOpen(true);
        }}
        onMoveToNextAvailable={async () => {}}
        onSaveEdits={async () => {}}
        onStartAppointment={async () => {
          setStatus('in_progress');
        }}
        onConfirmAppointment={async () => {
          setStatus('confirmed');
        }}
        onDeclineAppointment={async () => {
          setStatus('cancelled');
        }}
        onMarkNoShow={async () => {
          setStatus('no_show');
        }}
      />
      <CheckoutSheet appointmentId="appt_browser_1" isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<AppointmentWorkflowFixture />);
