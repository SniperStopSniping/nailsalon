import type { GallerySectionSettings } from '../../model/section-library/settings';
import { ChoiceField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/**
 * Gallery binds the shared onboarding gallery. The context carries photo ids
 * only — no thumbnails, file names, or captions reach the Builder — so the
 * picker names photos by their position in the Gallery step instead of
 * inventing labels for them.
 */
export function GallerySectionEditor({
  context,
  onChange,
  settings,
}: LibrarySectionEditorProps<'gallery'>) {
  const imageIds = context.galleryImageIds;
  const selection = settings.selection;
  // Ids of photos that have since left the gallery fall out on the next edit.
  const pickedIds = selection.mode === 'picked'
    ? selection.imageIds.filter(id => imageIds.includes(id))
    : [];

  if (imageIds.length === 0) {
    return (
      <p className="form-hint">
        No photos in your gallery yet. Add them in the Gallery step — this
        section stays off your site until there is at least one.
      </p>
    );
  }

  const togglePhoto = (imageId: string, included: boolean) => {
    const nextIds = included
      ? [...pickedIds.filter(id => id !== imageId), imageId]
      : pickedIds.filter(id => id !== imageId);
    onChange({
      ...settings,
      selection: { imageIds: nextIds, mode: 'picked' },
    } satisfies GallerySectionSettings);
  };

  return (
    <>
      <ChoiceField
        hint="Photos come from your Gallery step — add, remove, or replace them there."
        label="Photos"
        onChange={mode => onChange({
          ...settings,
          selection: mode === 'picked'
            ? {
                imageIds: selection.mode === 'picked' ? pickedIds : [...imageIds],
                mode: 'picked',
              }
            : { mode: 'all' },
        } satisfies GallerySectionSettings)}
        options={[
          { label: 'All my photos', value: 'all' },
          { label: 'Pick specific photos', value: 'picked' },
        ]}
        value={selection.mode}
      />
      {selection.mode === 'picked'
        ? (
            <div className="form-field">
              <span>Photos in this section</span>
              <div className="editor-record-list">
                {imageIds.map((imageId, index) => (
                  <label className="form-field form-field--toggle" key={imageId}>
                    <input
                      checked={pickedIds.includes(imageId)}
                      onChange={event => togglePhoto(imageId, event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      {'Photo '}
                      {index + 1}
                    </span>
                  </label>
                ))}
              </div>
              <small className="form-hint">
                Numbered in the order they sit in your Gallery step. Photos you add
                later stay out of this section until you pick them here.
              </small>
            </div>
          )
        : null}
    </>
  );
}
