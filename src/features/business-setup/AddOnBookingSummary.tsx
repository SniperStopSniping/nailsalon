import { addOnReviewValue } from './add-ons';
import type { SetupDocument } from './contracts';

/** Proposed catalogue beside custom and standard previews, never live values. */
export function AddOnBookingSummary({ document, published = false }: { published?: boolean; document: Pick<SetupDocument, 'addOns' | 'services' | 'booking'> }) {
  if (!document.addOns?.length) {
    return null;
  }
  return (
    <details className="bg-white p-4 text-sm">
      <summary>{published ? 'Add-ons' : 'Proposed add-ons'}</summary>
      <p style={{ whiteSpace: 'pre-line' }}>{addOnReviewValue(document.addOns, document.services, document.booking.currency)}</p>
      <p>{published ? 'These extras are selected in Luster’s original booking flow. Simulated preview times show the base service only; selected extras can add time.' : 'These extras are selected in Luster’s original booking flow after publication. Simulated preview times show the base service only; selected extras can add time.'}</p>
    </details>
  );
}
