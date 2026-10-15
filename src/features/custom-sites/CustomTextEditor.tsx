'use client';

import { useEffect, useState } from 'react';

import type { CustomSiteSource } from './contracts';

/** Edits the same generated source; never a second page configuration. */
export function CustomTextEditor({ source, onChange }: { source: CustomSiteSource; onChange: (source: CustomSiteSource) => void }) {
  const [fields, setFields] = useState<{ name: string; value: string }[]>([]);
  useEffect(() => {
    const document = new DOMParser().parseFromString(source.html, 'text/html');
    setFields([...document.querySelectorAll('[data-edit]')].filter(node => !node.hasAttribute('data-luster-field') && !node.querySelector('[data-luster-field],[data-luster-book]')).map(node => ({ name: node.getAttribute('data-edit')!, value: node.textContent ?? '' })));
  }, [source.html]);
  if (!fields.length) {
    return null;
  }
  return (
    <fieldset>
      <legend>Website wording</legend>
      <p>These changes are saved with “Save design changes” below. Business names, services and prices come from your business setup.</p>
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
  );
}
