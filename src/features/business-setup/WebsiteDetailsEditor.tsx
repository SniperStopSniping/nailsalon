'use client';
import type { WebsiteDetails } from '@/features/custom-sites/website-details';
import { EMPTY_WEBSITE_DETAILS } from '@/features/custom-sites/website-details';

export function WebsiteDetailsEditor({ value, disabled, onSave }: { value?: WebsiteDetails; disabled: boolean; onSave: (value: WebsiteDetails) => void }) {
  const details = value ?? EMPTY_WEBSITE_DETAILS;
  return (
    <form
      key={JSON.stringify(details)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const field = (name: string) => String(form.get(name) ?? '').trim() || null;
        onSave({ locationDirections: field('locationDirections'), instagram: field('instagram'), email: field('email'), phone: field('phone'), sections: details.sections.map(section => ({ ...section, title: String(form.get(`${section.id}-title`)), text: String(form.get(`${section.id}-text`)) })) });
      }}
    >
      <h3>Contact details and website policies</h3>
      <p>These words appear on your website after approval. They do not turn on deposits, payments or booking restrictions.</p>
      <label>
        Public intersection or directions
        <input name="locationDirections" defaultValue={details.locationDirections ?? ''} maxLength={500} />
      </label>
      <label>
        Instagram handle
        <input name="instagram" defaultValue={details.instagram ?? ''} maxLength={31} />
      </label>
      <label>
        Public email
        <input name="email" type="email" defaultValue={details.email ?? ''} maxLength={254} />
      </label>
      <label>
        Public phone
        <input name="phone" type="tel" defaultValue={details.phone ?? ''} maxLength={30} />
      </label>
      {details.sections.map(section => (
        <fieldset key={section.id}>
          <legend>{section.title}</legend>
          <label>
            Heading
            <input name={`${section.id}-title`} defaultValue={section.title} required maxLength={120} />
          </label>
          <label>
            Wording
            <textarea name={`${section.id}-text`} defaultValue={section.text} required maxLength={3000} />
          </label>
        </fieldset>
      ))}
      <button type="submit" disabled={disabled}>Save website details</button>
    </form>
  );
}
