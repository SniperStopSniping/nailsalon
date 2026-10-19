import { DEPOSIT_ISO_CURRENCY } from '@/libs/depositPolicy';
import { formatMoney } from '@/libs/formatMoney';

import { reminderReviewValue } from './booking-extras';
import type { SetupDocument } from './contracts';

export function BookingExtrasSummary({ document, published = false }: { published?: boolean; document: Pick<SetupDocument, 'deposit' | 'depositEditedFields' | 'reminders' | 'remindersEditedFields'> }) {
  if (!document.depositEditedFields?.length && !document.remindersEditedFields?.length) {
    return null;
  }
  return (
    <details className="bg-white p-4 text-sm">
      <summary>{published ? 'Deposits and reminders' : 'Proposed deposits and reminders'}</summary>
      {Boolean(document.depositEditedFields?.length) && (
        <p>
          {document.deposit?.amountCents === null || document.deposit?.amountCents === undefined ? 'Deposit amount still needed' : `Deposit amount: ${formatMoney(document.deposit.amountCents, DEPOSIT_ISO_CURRENCY)}`}
          .
          {' '}
          {document.deposit?.enabled ? published ? 'Deposit collection is requested. Collection depends on your payment connection.' : 'Collection requested after approval; payment readiness must pass before activation.' : 'Regular collection off; existing no-show protection is kept.'}
          {' '}
          Nothing is charged in preview.
        </p>
      )}
      {Boolean(document.remindersEditedFields?.length) && (
        <p>
          {reminderReviewValue(document.reminders)}
          {' '}
          Nothing is sent in preview.
        </p>
      )}
    </details>
  );
}
