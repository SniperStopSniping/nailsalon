import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { FaqSettings } from '../../model/section-library/settings';
import type { FaqItemRecord } from '../../model/section-library/site-content';
import { TextField } from './fields';
import type { LibrarySectionEditorProps } from './types';

const createFaqItemId = (): string =>
  `faq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The registry binds at most twelve questions (`itemIds.slice(0, 12)`). */
const MAX_SHOWN_ITEMS = 12;

/**
 * FAQ binds shared `siteContent.faq` records. Record edits apply immediately
 * (they are a shared authority); which questions this section shows, and in
 * what order, saves with the dialog.
 */
export function FaqEditor({
  context,
  onChange,
  onSiteContent,
  settings,
}: LibrarySectionEditorProps<'faq'>) {
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const items = context.siteContent.faq;
  const atLimit = settings.itemIds.length >= MAX_SHOWN_ITEMS;

  const toggleItem = (itemId: string, included: boolean) => {
    const nextIds = included
      ? [...settings.itemIds, itemId].slice(0, MAX_SHOWN_ITEMS)
      : settings.itemIds.filter(id => id !== itemId);
    onChange({ ...settings, itemIds: nextIds } satisfies FaqSettings);
  };

  const addItem = () => {
    const question = draftQuestion.trim();
    const answer = draftAnswer.trim();
    // A question without its answer is not a saveable record, so both are
    // required before this does anything.
    if (!question || !answer) {
      return;
    }
    const record: FaqItemRecord = { answer, id: createFaqItemId(), question };
    if (onSiteContent({ collection: 'faq', operation: 'upsert', record })) {
      if (!atLimit) {
        onChange({ ...settings, itemIds: [...settings.itemIds, record.id] });
      }
      setDraftQuestion('');
      setDraftAnswer('');
    }
  };

  const updateItem = (record: FaqItemRecord) => {
    onSiteContent({ collection: 'faq', operation: 'upsert', record });
  };

  const removeItem = (itemId: string) => {
    if (onSiteContent({ collection: 'faq', operation: 'remove', recordId: itemId })) {
      onChange({
        ...settings,
        itemIds: settings.itemIds.filter(id => id !== itemId),
      });
    }
  };

  return (
    <div className="form-field">
      <span>Questions</span>
      {items.length === 0
        ? (
            <small className="form-hint">
              No questions yet — add your first below. The section stays off your
              site until a question is shown.
            </small>
          )
        : (
            <small className="form-hint">
              This section shows up to twelve questions, in the order you tick them.
            </small>
          )}
      <div className="editor-record-list">
        {items.map((item) => {
          const included = settings.itemIds.includes(item.id);
          return (
            <details className="editor-record" key={item.id}>
              <summary>
                <label className="editor-record-include">
                  <input
                    checked={included}
                    disabled={!included && atLimit}
                    onChange={event => toggleItem(item.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="visually-hidden">
                    Show “
                    {item.question}
                    ” in this section
                  </span>
                </label>
                <strong>{item.question}</strong>
              </summary>
              <TextField
                label="Question"
                maxLength={160}
                onChange={question => updateItem({ ...item, question })}
                value={item.question}
              />
              <TextField
                hint="Answer it the way you would in a message to a client."
                label="Answer"
                maxLength={600}
                multiline
                onChange={answer => updateItem({ ...item, answer })}
                value={item.answer}
              />
              <button
                className="secondary-button editor-record-remove"
                onClick={() => removeItem(item.id)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
                {' '}
                Remove this question
              </button>
            </details>
          );
        })}
      </div>
      <div className="form-field">
        <span>Add a question</span>
        <input
          autoComplete="off"
          onChange={event => setDraftQuestion(event.target.value)}
          placeholder="How should I prepare for my appointment?"
          type="text"
          value={draftQuestion}
        />
        <textarea
          onChange={event => setDraftAnswer(event.target.value)}
          placeholder="Its answer, in your own words."
          value={draftAnswer}
        />
        <button
          className="secondary-button"
          disabled={!draftQuestion.trim() || !draftAnswer.trim()}
          onClick={addItem}
          type="button"
        >
          Add question
        </button>
      </div>
    </div>
  );
}
