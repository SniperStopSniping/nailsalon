import { X } from 'lucide-react';

import { BookingOverlayDialog } from './BookingOverlayDialog';
import { formatDuration, formatMoney, summarizeSelection } from './helpers';
import type {
  BookingSelection,
  MockMenuFixture,
  MockService,
} from './types';

export type ServiceDetailProps = {
  draftAddOnIds: readonly string[];
  fixture: MockMenuFixture;
  imageMode: 'auto' | 'show' | 'hide';
  selection: BookingSelection;
  service: MockService | null;
  showSalonIdentity: boolean;
  onClose: () => void;
  onContinue: (service: MockService) => void;
  onDeselect: (service: MockService) => void;
  onDiscardChanges: () => void;
  onDismissDirtyWarning: () => void;
  onKeepBrowsing: (service: MockService) => void;
  onSaveChanges: (service: MockService) => void;
  onToggleAddOn: (service: MockService, addOnId: string) => void;
  showDirtyWarning: boolean;
};

export function ServiceDetail({
  draftAddOnIds,
  fixture,
  imageMode,
  selection,
  service,
  showSalonIdentity,
  onClose,
  onContinue,
  onDeselect,
  onDiscardChanges,
  onDismissDirtyWarning,
  onKeepBrowsing,
  onSaveChanges,
  onToggleAddOn,
  showDirtyWarning,
}: ServiceDetailProps) {
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
  const showServiceMedia = imageMode === 'show'
    || (imageMode === 'auto' && Boolean(service?.image));

  if (!service) {
    return null;
  }

  return (
    <>
      <BookingOverlayDialog
        className="booking-service-dialog booking-service-detail-shell"
        labelledBy="booking-service-detail-title"
        onClose={onClose}
        suspended={showDirtyWarning}
        testId="service-detail-dialog"
      >
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
            className="booking-service-detail-body"
            data-image-mode={imageMode}
            data-testid="service-detail-scroll-body"
          >
            <div
              className="booking-detail-layout"
              data-has-image={showServiceMedia && service.image ? 'true' : 'false'}
            >
              {showServiceMedia
                ? (
                    <div className="booking-detail-image-wrap">
                      {service.image
                        ? (
                            <img src={service.image.src} alt={service.image.alt} />
                          )
                        : (
                            <div
                              className="booking-detail-image-fallback"
                              role="img"
                              aria-label={`No service photo available for ${service.name}`}
                            >
                              <span>{showSalonIdentity ? fixture.salon.name : 'Service photo coming soon'}</span>
                            </div>
                          )}
                    </div>
                  )
                : null}
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
                  ?? (showSalonIdentity
                    ? `Ask ${fixture.salon.name} about the finish and options available for this service.`
                    : 'Ask about the finish and options available for this service.')}
                </p>

                {compatibleAddOns.length > 0
                  ? (
                      <fieldset className="booking-add-on-fieldset">
                        <legend>Options and add-ons</legend>
                        {compatibleAddOns.map(addOn => (
                          <label key={addOn.id} className="booking-add-on-option">
                            <input
                              aria-label={addOn.name}
                              type="checkbox"
                              checked={draftAddOnIds.includes(addOn.id)}
                              onChange={() => onToggleAddOn(service, addOn.id)}
                            />
                            <span className="booking-add-on-name">{addOn.name}</span>
                            <span className="booking-add-on-adjustment">
                              +
                              {formatMoney(addOn.priceCents)}
                              {' '}
                              · +
                              {formatDuration(addOn.durationMinutes)}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    )
                  : (
                      <p className="booking-detail-description">
                        No add-ons are offered with this service.
                      </p>
                    )}
                {selected
                  ? (
                      <button
                        className="booking-detail-remove-selection"
                        type="button"
                        onClick={() => onDeselect(service)}
                      >
                        Remove selected service
                      </button>
                    )
                  : null}
              </div>
            </div>
          </div>
          <footer
            className="booking-service-detail-footer"
            data-testid="service-detail-action-footer"
          >
            <div className="booking-detail-actions">
              <button
                className="customer-secondary-button"
                type="button"
                onClick={() => onKeepBrowsing(service)}
              >
                Keep browsing
              </button>
              <button
                className="customer-primary-button"
                type="button"
                onClick={() => onContinue(service)}
              >
                Continue
              </button>
            </div>
          </footer>
        </div>
      </BookingOverlayDialog>
      {showDirtyWarning
        ? (
            <BookingOverlayDialog
              className="booking-option-warning-dialog"
              labelledBy="booking-option-warning-title"
              onClose={onDismissDirtyWarning}
              testId="booking-option-warning-dialog"
            >
              <div className="booking-option-warning-panel">
                <p className="booking-detail-eyebrow">Unsaved options</p>
                <h2 id="booking-option-warning-title">Save your option changes?</h2>
                <p>
                  Save the changes you made to
                  {' '}
                  {service.name}
                  , or discard them and keep your last saved options.
                </p>
                <div className="booking-option-warning-actions">
                  <button className="customer-quiet-button" type="button" onClick={onDismissDirtyWarning}>
                    Keep editing
                  </button>
                  <button className="customer-secondary-button" type="button" onClick={onDiscardChanges}>
                    Discard changes
                  </button>
                  <button className="customer-primary-button" type="button" onClick={() => onSaveChanges(service)}>
                    Save changes
                  </button>
                </div>
              </div>
            </BookingOverlayDialog>
          )
        : null}
    </>
  );
}
