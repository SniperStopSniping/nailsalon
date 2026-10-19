'use client';

import { useState } from 'react';

import type { CanvaPagePresentation } from './canva';

export function CanvaPageLayout({ value, pageIndex, multiple, disabled, onSave }: {
  value?: CanvaPagePresentation;
  pageIndex: number;
  multiple: boolean;
  disabled: boolean;
  onSave: (pageIndex: number, value: CanvaPagePresentation) => Promise<void>;
}) {
  const initial: CanvaPagePresentation = value ?? { displayMode: 'poster', background: 'transparent', gapAfter: 0 };
  const [layout, setLayout] = useState(initial);
  const changed = JSON.stringify(layout) !== JSON.stringify(initial);
  return (
    <details>
      <summary>{multiple ? `Adjust layout for page ${pageIndex + 1}` : 'Adjust image layout'}</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && changed) {
          void onSave(pageIndex, layout);
        }
      }}
      >
        <fieldset className="studio-image-layout" disabled={disabled}>
          <legend>{multiple ? `Layout for page ${pageIndex + 1}` : 'Image layout'}</legend>
          <label>
            Width on larger screens
            <select value={layout.displayMode} onChange={event => setLayout({ ...layout, displayMode: event.target.value as CanvaPagePresentation['displayMode'] })}>
              <option value="poster">Keep original width</option>
              <option value="contained">Wide, with room at the sides</option>
              <option value="full_width">Edge to edge</option>
            </select>
          </label>
          <label>
            Background behind the image
            <select value={layout.background === 'transparent' ? 'website' : 'custom'} onChange={event => setLayout({ ...layout, background: event.target.value === 'website' ? 'transparent' : '#f6e8ed' })}>
              <option value="website">Use website background</option>
              <option value="custom">Choose a colour</option>
            </select>
          </label>
          {layout.background !== 'transparent' && (
            <label>
              Background colour
              <input type="color" value={layout.background} onChange={event => setLayout({ ...layout, background: event.target.value })} />
            </label>
          )}
          <label>
            Space after the image
            <select value={layout.gapAfter} onChange={event => setLayout({ ...layout, gapAfter: Number(event.target.value) as CanvaPagePresentation['gapAfter'] })}>
              <option value={0}>None</option>
              <option value={8}>Small</option>
              <option value={16}>Comfortable</option>
            </select>
          </label>
          <p>The image keeps its proportions. Its links stay in place. Review your changes before publishing.</p>
          <button type="submit" disabled={disabled || !changed}>Save image layout</button>
        </fieldset>
      </form>
    </details>
  );
}
