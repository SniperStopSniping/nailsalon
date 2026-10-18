'use client';

import { useEffect, useState } from 'react';

import type { CustomSiteSource } from './contracts';

/** Edits the same generated source; never a second page configuration. */
export function CustomTextEditor({ source, onChange, onSave, disabled }: { source: CustomSiteSource; onChange: (source: CustomSiteSource) => void; onSave: () => Promise<void>; disabled: boolean }) {
  const [fields, setFields] = useState<{ name: string; value: string }[]>([]);
  useEffect(() => {
    const document = new DOMParser().parseFromString(source.html, 'text/html');
    setFields([...document.querySelectorAll('[data-edit]')].filter(node => !node.hasAttribute('data-luster-field') && !node.querySelector('[data-luster-field],[data-luster-book]')).map(node => ({ name: node.getAttribute('data-edit')!, value: node.textContent ?? '' })));
  }, [source.html]);
  if (!fields.length) {
    return null;
  }
  return (
    <details>
      <summary>Edit website wording</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) {
          void onSave();
        }
      }}
      >
        <fieldset disabled={disabled}>
          <legend>Website wording</legend>
          <p>Change your website text here, then save it as a draft. Business names, services and prices come from your business details.</p>
          {fields.map(field => (
            <label key={field.name}>
              {field.name.replaceAll('-', ' ')}
              <textarea
                aria-label={`Website text: ${field.name}`}
                value={field.value}
                maxLength={2000}
                onChange={(event) => {
                  const document = new DOMParser().parseFromString(source.html, 'text/html');
                  for (const node of document.querySelectorAll('[data-edit]')) {
                    if (node.getAttribute('data-edit') === field.name) {
                      node.textContent = event.target.value;
                    }
                  }
                  onChange({ ...source, html: document.body.innerHTML });
                }}
              />
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={disabled}>Save wording</button>
      </form>
    </details>
  );
}
