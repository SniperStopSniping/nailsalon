import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { OffersSettings } from '../../model/section-library/settings';
import type { OfferRecord } from '../../model/section-library/site-content';
import { TextField } from './fields';
import type { LibrarySectionEditorProps } from './types';

const createOfferId = (): string =>
  `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The registry binds at most three offers (`offerIds.slice(0, 3)`). */
const MAX_SHOWN_OFFERS = 3;

/**
 * Offers binds shared `siteContent.offers` records. Record edits apply
 * immediately (they are a shared authority); the section's own settings
 * (preset, which offers show, order) save with the dialog.
 */
export function OffersEditor({
  context,
  onChange,
  onSiteContent,
  settings,
}: LibrarySectionEditorProps<'offers'>) {
  const [draftTitle, setDraftTitle] = useState('');
  const offers = context.siteContent.offers;
  const atLimit = settings.offerIds.length >= MAX_SHOWN_OFFERS;

  const toggleOffer = (offerId: string, included: boolean) => {
    const nextIds = included
      ? [...settings.offerIds, offerId].slice(0, MAX_SHOWN_OFFERS)
      : settings.offerIds.filter(id => id !== offerId);
    onChange({ ...settings, offerIds: nextIds } satisfies OffersSettings);
  };

  const addOffer = () => {
    const title = draftTitle.trim();
    if (!title) {
      return;
    }
    const record: OfferRecord = {
      actionLabel: null,
      detail: '',
      expiresAt: null,
      id: createOfferId(),
      terms: '',
      title,
    };
    if (onSiteContent({ collection: 'offers', operation: 'upsert', record })) {
      // At the limit the offer joins your collection unshown, rather than
      // silently pushing another offer off this section.
      if (!atLimit) {
        onChange({ ...settings, offerIds: [...settings.offerIds, record.id] });
      }
      setDraftTitle('');
    }
  };

  const updateOffer = (record: OfferRecord) => {
    onSiteContent({ collection: 'offers', operation: 'upsert', record });
  };

  const removeOffer = (offerId: string) => {
    if (onSiteContent({ collection: 'offers', operation: 'remove', recordId: offerId })) {
      onChange({
        ...settings,
        offerIds: settings.offerIds.filter(id => id !== offerId),
      });
    }
  };

  return (
    <div className="form-field">
      <span>Offers</span>
      {offers.length === 0
        ? (
            <small className="form-hint">
              No offers yet — add your first below. The section stays off your site
              until an offer is shown.
            </small>
          )
        : (
            <small className="form-hint">
              This section shows up to three offers, in the order you tick them.
            </small>
          )}
      <div className="editor-record-list">
        {offers.map((offer) => {
          const included = settings.offerIds.includes(offer.id);
          return (
            <details className="editor-record" key={offer.id}>
              <summary>
                <label className="editor-record-include">
                  <input
                    checked={included}
                    disabled={!included && atLimit}
                    onChange={event => toggleOffer(offer.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="visually-hidden">
                    {'Show '}
                    {offer.title}
                    {' '}
                    in this section
                  </span>
                </label>
                <strong>{offer.title}</strong>
                {offer.expiresAt
                  ? (
                      <small>
                        {'Ends '}
                        {offer.expiresAt.slice(0, 10)}
                      </small>
                    )
                  : null}
              </summary>
              <TextField
                label="Offer title"
                maxLength={60}
                onChange={title => updateOffer({ ...offer, title })}
                value={offer.title}
              />
              <TextField
                label="What the client gets"
                maxLength={200}
                multiline
                onChange={detail => updateOffer({ ...offer, detail })}
                placeholder="15% off any manicure on your first visit."
                value={offer.detail}
              />
              <TextField
                hint="Any condition a client should know before booking."
                label="Terms"
                maxLength={160}
                onChange={terms => updateOffer({ ...offer, terms })}
                placeholder="First visit only."
                value={offer.terms}
              />
              <label className="form-field">
                <span>Ends on</span>
                <input
                  onChange={event => updateOffer({
                    ...offer,
                    expiresAt: event.target.value || null,
                  })}
                  type="date"
                  value={offer.expiresAt?.slice(0, 10) ?? ''}
                />
                <small className="form-hint">
                  Leave empty for an ongoing offer. The end date only shows while
                  it is still ahead; after it passes the offer stops showing.
                </small>
              </label>
              <TextField
                hint="Leave empty to use “Book now”."
                label="Button label"
                maxLength={40}
                onChange={actionLabel => updateOffer({
                  ...offer,
                  actionLabel: actionLabel || null,
                })}
                placeholder="Book now"
                value={offer.actionLabel ?? ''}
              />
              <button
                className="secondary-button editor-record-remove"
                onClick={() => removeOffer(offer.id)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
                {' Remove '}
                {offer.title}
              </button>
            </details>
          );
        })}
      </div>
      <div className="editor-record-new">
        <input
          autoComplete="off"
          onChange={event => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addOffer();
            }
          }}
          placeholder="New offer’s title"
          type="text"
          value={draftTitle}
        />
        <button
          className="secondary-button"
          disabled={!draftTitle.trim()}
          onClick={addOffer}
          type="button"
        >
          Add offer
        </button>
      </div>
    </div>
  );
}
