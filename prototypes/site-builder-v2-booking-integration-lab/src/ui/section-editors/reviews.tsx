import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ReviewsSettings } from '../../model/section-library/settings';
import type { ReviewRecord, ReviewSource } from '../../model/section-library/site-content';
import { ChoiceField, TextField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

const createReviewId = (): string =>
  `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** `none` maps to a null rating: the renderer then shows no stars at all. */
type RatingChoice = 'none' | '1' | '2' | '3' | '4' | '5';

const RATING_OPTIONS: ReadonlyArray<{ value: RatingChoice; label: string }> = [
  { label: 'No rating', value: 'none' },
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
];

const SOURCE_OPTIONS: ReadonlyArray<{ value: ReviewSource; label: string }> = [
  { label: 'Told to you', value: 'client' },
  { label: 'Google', value: 'google' },
  { label: 'Somewhere else', value: 'other' },
];

/**
 * Reviews binds shared `siteContent.reviews` records. Record edits apply
 * immediately (they are a shared authority); the section's own settings
 * (preset, which reviews show, order, ratings) save with the dialog.
 */
export function ReviewsEditor({
  context,
  onChange,
  onSiteContent,
  settings,
}: LibrarySectionEditorProps<'reviews'>) {
  const [draftQuote, setDraftQuote] = useState('');
  const reviews = context.siteContent.reviews;

  const toggleReview = (reviewId: string, included: boolean) => {
    const nextIds = included
      ? [...settings.reviewIds, reviewId]
      : settings.reviewIds.filter(id => id !== reviewId);
    onChange({ ...settings, reviewIds: nextIds } satisfies ReviewsSettings);
  };

  const addReview = () => {
    const quote = draftQuote.trim();
    if (!quote) {
      return;
    }
    const record: ReviewRecord = {
      authorName: '',
      id: createReviewId(),
      quote,
      rating: null,
      source: 'client',
      visible: true,
    };
    if (onSiteContent({ collection: 'reviews', operation: 'upsert', record })) {
      onChange({ ...settings, reviewIds: [...settings.reviewIds, record.id] });
      setDraftQuote('');
    }
  };

  const updateReview = (record: ReviewRecord) => {
    onSiteContent({ collection: 'reviews', operation: 'upsert', record });
  };

  const removeReview = (reviewId: string) => {
    if (onSiteContent({ collection: 'reviews', operation: 'remove', recordId: reviewId })) {
      onChange({
        ...settings,
        reviewIds: settings.reviewIds.filter(id => id !== reviewId),
      });
    }
  };

  return (
    <>
      <ToggleField
        hint="Reviews you left without a rating never show stars either way."
        label="Show star ratings"
        onChange={showRatings => onChange({ ...settings, showRatings })}
        value={settings.showRatings}
      />
      <div className="form-field">
        <span>Client reviews</span>
        {reviews.length === 0
          ? (
              <small className="form-hint">
                No reviews yet — add your first below. The section stays off your
                site until a visible review is shown.
              </small>
            )
          : (
              <small className="form-hint">
                Only real client words belong here. Ticked reviews show in this order.
              </small>
            )}
        <div className="editor-record-list">
          {reviews.map((review) => {
            const included = settings.reviewIds.includes(review.id);
            const author = review.authorName.trim();
            return (
              <details className="editor-record" key={review.id}>
                <summary>
                  <label className="editor-record-include">
                    <input
                      checked={included}
                      onChange={event => toggleReview(review.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="visually-hidden">
                      Show
                      {' '}
                      {author || 'this review'}
                      {' '}
                      in this section
                    </span>
                  </label>
                  <strong>{author || 'Review without a name'}</strong>
                  {review.visible ? null : <small>Hidden everywhere</small>}
                </summary>
                <TextField
                  label="What they said"
                  maxLength={400}
                  multiline
                  onChange={quote => updateReview({ ...review, quote })}
                  value={review.quote}
                />
                <TextField
                  hint="However they are happy to be credited, e.g. “Maya R.”"
                  label="Who said it"
                  maxLength={80}
                  onChange={authorName => updateReview({ ...review, authorName })}
                  placeholder="Maya R."
                  value={review.authorName}
                />
                <ChoiceField
                  label="Rating"
                  onChange={choice => updateReview({
                    ...review,
                    rating: choice === 'none' ? null : Number(choice),
                  })}
                  options={RATING_OPTIONS}
                  value={review.rating === null ? 'none' : (String(review.rating) as RatingChoice)}
                />
                <ChoiceField
                  hint="Google reviews are credited as such beside the name."
                  label="Where it came from"
                  onChange={source => updateReview({ ...review, source })}
                  options={SOURCE_OPTIONS}
                  value={review.source}
                />
                <ToggleField
                  hint="Hidden reviews stay in your collection but never reach your site."
                  label="Visible on your site"
                  onChange={visible => updateReview({ ...review, visible })}
                  value={review.visible}
                />
                <button
                  className="secondary-button editor-record-remove"
                  onClick={() => removeReview(review.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {' Remove '}
                  {author || 'this review'}
                </button>
              </details>
            );
          })}
        </div>
        <div className="editor-record-new">
          <input
            autoComplete="off"
            onChange={event => setDraftQuote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addReview();
              }
            }}
            placeholder="What a client actually said"
            type="text"
            value={draftQuote}
          />
          <button
            className="secondary-button"
            disabled={!draftQuote.trim()}
            onClick={addReview}
            type="button"
          >
            Add review
          </button>
        </div>
      </div>
    </>
  );
}
