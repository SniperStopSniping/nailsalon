'use client';

import type {
  BookingPageConfigSide,
  QuickBookProfileVisibilityPatch,
} from '@/libs/bookingPageConfig';

type QuickBookProfileVisibilityKey = keyof QuickBookProfileVisibilityPatch;

export type QuickBookProfileConfigPatch = {
  quickBookProfile: QuickBookProfileVisibilityPatch;
};

type QuickBookProfileVisibilityCardProps = {
  disabled: boolean;
  draft: Pick<BookingPageConfigSide, 'layout' | 'quickBookProfile'>;
  onConfigPatch: (patch: QuickBookProfileConfigPatch) => void;
};

const VISIBILITY_OPTIONS: ReadonlyArray<{
  description: string;
  key: QuickBookProfileVisibilityKey;
  label: string;
}> = [
  {
    description: 'Use the nail tech name saved in the shared salon profile.',
    key: 'showTechName',
    label: 'Show nail tech name',
  },
  {
    description: 'Use the saved nail tech photo when one is available.',
    key: 'showTechPhoto',
    label: 'Show nail tech photo',
  },
  {
    description: 'Show the public location detail already saved for the salon.',
    key: 'showLocation',
    label: 'Show location',
  },
  {
    description: 'Show today’s hours from the salon’s shared weekly schedule.',
    key: 'showHours',
    label: 'Show business hours',
  },
  {
    description: 'Show the salon phone number when a public number is available.',
    key: 'showPhone',
    label: 'Show phone',
  },
  {
    description: 'Show the salon email address when a public email is available.',
    key: 'showEmail',
    label: 'Show email',
  },
  {
    description: 'Include the enabled booking policy in the compact Policies view.',
    key: 'showBookingPolicy',
    label: 'Show booking policy',
  },
  {
    description: 'Include the enabled cancellation policy in the compact Policies view.',
    key: 'showCancellationPolicy',
    label: 'Show cancellation policy',
  },
  {
    description: 'Show verified review information only when real review data is available.',
    key: 'showReviews',
    label: 'Show reviews',
  },
  {
    description: 'Show the valid Instagram account saved in the shared salon profile.',
    key: 'showInstagram',
    label: 'Show Instagram / work',
  },
  {
    description: 'Show the short bio saved in the shared salon profile.',
    key: 'showBio',
    label: 'Show short bio',
  },
];

export function QuickBookProfileVisibilityCard({
  disabled,
  draft,
  onConfigPatch,
}: QuickBookProfileVisibilityCardProps) {
  if (draft.layout !== 'quick_book') {
    return null;
  }

  return (
    <section
      data-testid="quick-book-profile-visibility-card"
      className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-stone-950">Quick Book profile</h2>
      <p className="mt-1 text-sm text-stone-500">
        Choose which saved salon details appear above booking. Turning an item off only hides it
        on Quick Book — the underlying detail stays saved and shared with your other designs.
      </p>

      <fieldset disabled={disabled} className="mt-4 divide-y divide-stone-100">
        <legend className="sr-only">Quick Book public profile visibility</legend>
        {VISIBILITY_OPTIONS.map(option => (
          <label
            key={option.key}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-stone-800">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-stone-500">
                {option.description}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={draft.quickBookProfile[option.key]}
              onChange={event => onConfigPatch({
                quickBookProfile: {
                  [option.key]: event.currentTarget.checked,
                },
              })}
              className="size-5 shrink-0 accent-rose-700"
            />
          </label>
        ))}
      </fieldset>
    </section>
  );
}
