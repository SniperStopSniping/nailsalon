import { X } from 'lucide-react';

import { formatDuration, formatMoney, summarizeSelection } from './helpers';
import type {
  BookingSelection,
  MockMenuFixture,
  MockService,
} from './types';
import { useManagedDialog } from './useManagedDialog';

export type ServiceDetailProps = {
  draftAddOnIds: readonly string[];
  fixture: MockMenuFixture;
  selection: BookingSelection;
  service: MockService | null;
  onClose: () => void;
  onContinue: (service: MockService) => void;
  onDeselect: (service: MockService) => void;
  onSelect: (service: MockService) => void;
  onToggleAddOn: (service: MockService, addOnId: string) => void;
};

export function ServiceDetail({
  draftAddOnIds,
  fixture,
  selection,
  service,
  onClose,
  onContinue,
  onDeselect,
  onSelect,
  onToggleAddOn,
}: ServiceDetailProps) {
  const dialogRef = useManagedDialog(Boolean(service));
  const selected = service !== null && selection.serviceId === service.id;
  const category = fixture.categories.find(
    candidate => candidate.id === service?.category,
  );
  const compatibleAddOns = fixture.addOns.filter(addOn =>
    service?.compatibleAddOnIds.includes(addOn.id),
  );
  const draftSummary = service
    ? summarizeSelection(
      { serviceId: service.id, addOnIds: draftAddOnIds },
      fixture.services,
      fixture.addOns,
    )
    : null;

  return (
    <dialog
      ref={dialogRef}
      className="booking-service-dialog"
      aria-labelledby="booking-service-detail-title"
      data-testid="service-detail-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      {service ? (
        <div className="booking-dialog-panel" role="document">
          <button
            className="booking-dialog-close"
            type="button"
            aria-label="Close service details"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
          <div
            className="booking-detail-layout"
            data-has-image={service.image ? 'true' : 'false'}
          >
            <div className="booking-detail-image-wrap">
              {service.image ? (
                <img src={service.image.src} alt={service.image.alt} />
              ) : (
                <div
                  className="booking-detail-image-fallback"
                  role="img"
                  aria-label={`No service photo available for ${service.name}`}
                >
                  <span>Isla Nail Studio</span>
                </div>
              )}
            </div>
            <div className="booking-detail-copy">
              <p className="booking-detail-eyebrow">
                {category?.label ?? service.category}
                {service.badge ? ` · ${service.badge}` : ''}
              </p>
              <h2 id="booking-service-detail-title" className="booking-detail-title">
                {service.name}
              </h2>
              <p
                className="booking-detail-meta"
                aria-live="polite"
                data-testid="service-detail-total"
              >
                <span>{draftSummary?.durationLabel}</span>
                <span aria-hidden="true">·</span>
                <strong>{draftSummary?.price.label}</strong>
              </p>
              <p className="booking-detail-description">
                {service.longDescription
                  ?? 'Ask Isla Nail Studio about the finish and options available for this service.'}
              </p>

              {compatibleAddOns.length > 0 ? (
                <fieldset className="booking-add-on-fieldset">
                  <legend>Options and add-ons</legend>
                  {compatibleAddOns.map(addOn => (
                    <label key={addOn.id} className="booking-add-on-option">
                      <input
                        type="checkbox"
                        checked={draftAddOnIds.includes(addOn.id)}
                        onChange={() => onToggleAddOn(service, addOn.id)}
                      />
                      <span className="booking-add-on-name">{addOn.name}</span>
                      <span className="booking-add-on-adjustment">
                        +{formatMoney(addOn.priceCents)} · +{formatDuration(addOn.durationMinutes)}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="booking-detail-description">
                  No add-ons are offered with this mock service.
                </p>
              )}

              <div className="booking-detail-actions">
                <button className="customer-secondary-button" type="button" onClick={onClose}>
                  Keep browsing
                </button>
                <button
                  className="customer-primary-button"
                  type="button"
                  onClick={() => selected ? onContinue(service) : onSelect(service)}
                >
                  {selected ? 'Continue' : 'Select service'}
                </button>
              </div>
              {selected ? (
                <button
                  className="booking-detail-remove-selection"
                  type="button"
                  onClick={() => onDeselect(service)}
                >
                  Remove selected service
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
