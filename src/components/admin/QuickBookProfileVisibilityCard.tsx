'use client';

import type {
  BookingPageConfigSide,
  QuickBookProfileVisibilityPatch,
} from '@/libs/bookingPageConfig';

export type QuickBookProfileVisibilityKey = keyof QuickBookProfileVisibilityPatch;

export type QuickBookProfileConfigPatch = {
  quickBookProfile: QuickBookProfileVisibilityPatch;
};

type QuickBookProfileVisibilityCardProps = {
  savedDetails?: Record<string, string[]>;
  grouped?: boolean;
  disabled: boolean;
  draft: Pick<BookingPageConfigSide, 'layout' | 'quickBookProfile'>;
  onConfigPatch: (patch: QuickBookProfileConfigPatch) => void;
};

export const QUICK_BOOK_VISIBILITY_OPTIONS: ReadonlyArray<{
  description: string;
  key: QuickBookProfileVisibilityKey;
  label: string;
}> = [
  {
    description: 'Use the name of your active nail tech (Staff), not your private account name.',
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

export const QUICK_BOOK_VISIBILITY_GROUPS: ReadonlyArray<{ title: string; keys: QuickBookProfileVisibilityKey[] }> = [
  { title: 'Business identity', keys: ['showTechName', 'showTechPhoto', 'showBio'] },
  { title: 'Location', keys: ['showLocation'] },
  { title: 'Contact', keys: ['showPhone', 'showEmail', 'showInstagram'] },
  { title: 'Hours', keys: ['showHours'] },
  { title: 'Other public content', keys: ['showBookingPolicy', 'showCancellationPolicy', 'showReviews'] },
];

/**
 * One Quick Book visibility switch. Shared with the Your Information editor so
 * "hide it publicly" and "edit the saved value" sit in the same accordion
 * without a second copy of the switch semantics.
 */
export function QuickBookVisibilitySwitch({
  option,
  checked,
  onConfigPatch,
}: {
  option: typeof QUICK_BOOK_VISIBILITY_OPTIONS[number];
  checked: boolean;
  onConfigPatch: (patch: QuickBookProfileConfigPatch) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-3 has-[:disabled]:opacity-60">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-stone-800">{option.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-stone-500">{option.description}</span>
      </span>
      <input
        checked={checked}
        className="size-5 shrink-0 accent-rose-700"
        onChange={event => onConfigPatch({ quickBookProfile: { [option.key]: event.currentTarget.checked } })}
        role="switch"
        type="checkbox"
      />
    </label>
  );
}

export function QuickBookProfileVisibilityCard({
  savedDetails,
  grouped = false,
  disabled,
  draft,
  onConfigPatch,
}: QuickBookProfileVisibilityCardProps) {
  if (draft.layout !== 'quick_book') {
    return null;
  }

  const renderOption = (option: typeof QUICK_BOOK_VISIBILITY_OPTIONS[number]) => (
    <QuickBookVisibilitySwitch
      checked={draft.quickBookProfile[option.key]}
      key={option.key}
      onConfigPatch={onConfigPatch}
      option={option}
    />
  );
  const groups = QUICK_BOOK_VISIBILITY_GROUPS;

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
        {grouped
          ? groups.map(group => (
            <details className="py-2" key={group.title}>
              <summary className="min-h-11 cursor-pointer py-3 font-semibold">{group.title}</summary>
              {[...new Set(savedDetails?.[group.title] ?? [])].map(detail => <p className="mb-2 break-words text-sm text-stone-700" key={detail}>{detail}</p>)}
              {QUICK_BOOK_VISIBILITY_OPTIONS.filter(option => group.keys.includes(option.key)).map(renderOption)}
            </details>
          ))
          : QUICK_BOOK_VISIBILITY_OPTIONS.map(renderOption)}
      </fieldset>
    </section>
  );
}
