'use client';

import { useId, useState } from 'react';

import { isValidSalonSlug, normalizeSalonSlug, suggestSalonSlug } from '@/libs/tenantSlug';

export function BookingLinkEditor({ slug, businessName, locale, disabled, onSave }: { slug: string; businessName: string; locale: string; disabled: boolean; onSave: (slug: string) => void }) {
  const [value, setValue] = useState(slug);
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  const normalized = normalizeSalonSlug(value) ?? '';
  const suggestion = suggestSalonSlug(businessName);
  return (
    <section aria-label="Your booking link">
      <h3>Your booking link</h3>
      <p>Choose the address you’ll share with customers. It becomes active only after you approve and publish.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!isValidSalonSlug(normalized)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onSave(normalized);
      }}
      >
        <label>
          Booking link name
          <input
            name="bookingLink"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
            disabled={disabled}
            maxLength={47}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={invalid}
            aria-describedby={hintId}
          />
        </label>
        <p id={hintId}>{invalid ? 'Use letters, numbers and hyphens, with no spaces. Choose a name Luster hasn’t reserved.' : `/${locale}/${normalized || 'your-salon'}/book`}</p>
        {suggestion !== normalized && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setValue(suggestion);
              setInvalid(false);
            }}
          >
            {`Use ${suggestion}`}
          </button>
        )}
        <button type="submit" disabled={disabled || normalized === slug}>Save booking link</button>
      </form>
      <p>Saving checks this name when you review. If someone takes it before publication, your draft stays safe so you can choose another.</p>
    </section>
  );
}
