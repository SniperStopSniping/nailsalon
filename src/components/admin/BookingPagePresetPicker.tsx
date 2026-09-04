'use client';

import { useId, useRef, useState } from 'react';

import { normalizeBookingPagePreviewFrame } from '@/components/admin/bookingPagePreviewFrame';
import { DialogShell } from '@/components/ui/dialog-shell';
import { isBookingPagePresentationCustomized } from '@/libs/bookingPageBuilder';
import { formatBookingPagePresetPreviewQuery } from '@/libs/bookingPagePresetPreview';
import {
  BOOKING_PAGE_PRESET_IDS,
  BOOKING_PAGE_PRESET_RECIPE_VERSION,
  type BookingPagePresetId,
  type BookingPagePresetPresentationState,
  type BookingPagePresetReference,
  describeBookingPagePresetChanges,
  findMatchingBookingPagePreset,
  getBookingPagePresentationSignature,
  isCurrentBookingPagePresetReference,
} from '@/libs/bookingPagePresetRecipes';

export type BookingPagePresetApplyOperation = Readonly<{
  type: 'apply_preset';
  presetId: BookingPagePresetId;
  presetVersion: typeof BOOKING_PAGE_PRESET_RECIPE_VERSION;
  expectedPresentationSignature: string;
}>;

export type BookingPagePresetPickerStatus = 'idle' | 'success' | 'stale' | 'error';

export type BookingPagePresetPickerProps = {
  draft: BookingPagePresetPresentationState;
  pending: boolean;
  disabled?: boolean;
  status?: BookingPagePresetPickerStatus;
  /** Same-origin real-renderer draft URL used for a non-mutating target preview. */
  previewBaseUrl?: string | null;
  onOperation: (operation: BookingPagePresetApplyOperation) => void;
};

type PresetCopy = Readonly<{
  label: string;
  description: string;
}>;

type PendingSelection = Readonly<{
  reference: BookingPagePresetReference;
  expectedPresentationSignature: string;
  changes: readonly string[];
  replacesCustomPresentation: boolean;
}>;

const PRESET_COPY = {
  quick_book: {
    label: 'Quick Book',
    description: 'A compact, services-first page that gets clients booking quickly.',
  },
  signature: {
    label: 'Signature',
    description: 'An editorial page led by your salon image and featured services.',
  },
  menu: {
    label: 'Menu',
    description: 'An editorial page that groups your services into an easy-to-scan menu.',
  },
  collective: {
    label: 'Collective',
    description: 'An editorial page that brings your team and their work forward.',
  },
} as const satisfies Record<BookingPagePresetId, PresetCopy>;

const HUMAN_TERMS: Readonly<Record<string, string>> = {
  quick_book: 'Quick Book',
  editorial: 'Editorial',
  salonProfile: 'Salon profile',
  technicianProfile: 'Technician profile',
  featuredServices: 'Featured services',
  serviceMenu: 'Services',
  hoursLocation: 'Hours and location',
  policies: 'Policies',
  socialLinks: 'Social links',
  bookingCta: 'Booking button',
  grouped_categories: 'Grouped categories',
  hero_image: 'Hero image',
  location_cards: 'Location cards',
  compact: 'Compact',
  full: 'Full',
  cards: 'Cards',
  carousel: 'Carousel',
  signature: 'Signature',
  list: 'List',
  card: 'Card',
  inline: 'Inline',
  icons: 'Icons',
  labeled: 'Labeled',
  inherited: 'Inherited',
  none: 'None',
};

const HUMAN_TERM_PATTERN = new RegExp(
  Object.keys(HUMAN_TERMS)
    .sort((left, right) => right.length - left.length)
    .join('|'),
  'g',
);

const CARD_CLASS = 'min-h-11 w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none';
const ACTION_CLASS = 'min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-50';

function presetReference(presetId: BookingPagePresetId): BookingPagePresetReference {
  return {
    presetId,
    recipeVersion: BOOKING_PAGE_PRESET_RECIPE_VERSION,
  };
}

function humanizeChange(change: string): string {
  const presentation = /^Presentation \(([^)]+)\): (.+)$/.exec(change);
  if (presentation) {
    const section = presentation[1] ?? '';
    const detail = presentation[2] ?? '';

    return `${HUMAN_TERMS[section] ?? section} presentation: ${detail.replace(
      HUMAN_TERM_PATTERN,
      term => HUMAN_TERMS[term] ?? term,
    )}`;
  }

  return change
    .replace(/^Preset base:/, 'Starting design:')
    .replace(/^Layout:/, 'Page layout:')
    .replace(HUMAN_TERM_PATTERN, term => HUMAN_TERMS[term] ?? term);
}

function stateLabel(
  matchingPreset: BookingPagePresetReference | null,
  presetBase: BookingPagePresetReference | null,
): string {
  if (matchingPreset) {
    const label = PRESET_COPY[matchingPreset.presetId].label;
    return isCurrentBookingPagePresetReference(matchingPreset)
      ? label
      : `${label} v${matchingPreset.recipeVersion}`;
  }
  if (presetBase) {
    const label = PRESET_COPY[presetBase.presetId].label;
    const version = isCurrentBookingPagePresetReference(presetBase)
      ? ''
      : ` v${presetBase.recipeVersion}`;
    return `Custom · based on ${label}${version}`;
  }

  return 'Custom · existing design';
}

function statusCopy(status: BookingPagePresetPickerStatus, pending: boolean): string | null {
  if (pending) {
    return 'Saving draft…';
  }

  switch (status) {
    case 'success':
      return 'Starting design applied to your draft. Review the preview, then publish when you’re ready.';
    case 'stale':
      return 'Your draft changed since you opened the confirmation. Review the latest draft, then choose a starting design again.';
    case 'error':
      return 'We couldn’t switch the starting design. Your draft was not changed.';
    case 'idle':
      return null;
  }
}

function presetPreviewUrl(
  baseUrl: string | null | undefined,
  reference: BookingPagePresetReference,
): string | null {
  if (!baseUrl) {
    return null;
  }

  const url = new URL(baseUrl, window.location.href);
  const query = formatBookingPagePresetPreviewQuery(reference);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function BookingPagePresetPicker({
  draft,
  pending,
  disabled = false,
  status = 'idle',
  previewBaseUrl = null,
  onOperation,
}: BookingPagePresetPickerProps) {
  const titleId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogSafetyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLHeadingElement>(null);
  const submissionStartedRef = useRef(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const exactMatchingPreset = findMatchingBookingPagePreset(draft);
  const matchingPreset = exactMatchingPreset
    ?? (!isBookingPagePresentationCustomized(draft) ? draft.presetBase : null);
  const controlsDisabled = disabled || pending;
  const message = statusCopy(status, pending);
  const selectedCopy = selection ? PRESET_COPY[selection.reference.presetId] : null;
  const selectedPreviewUrl = selection
    ? presetPreviewUrl(previewBaseUrl, selection.reference)
    : null;

  const closeDialog = () => {
    if (controlsDisabled) {
      return;
    }

    submissionStartedRef.current = false;
    setSelection(null);
  };

  const openConfirmation = (presetId: BookingPagePresetId) => {
    if (controlsDisabled) {
      return;
    }

    const reference = presetReference(presetId);
    submissionStartedRef.current = false;
    setSelection({
      reference,
      expectedPresentationSignature: getBookingPagePresentationSignature(draft),
      changes: describeBookingPagePresetChanges(draft, reference).map(humanizeChange),
      replacesCustomPresentation: matchingPreset === null,
    });
  };

  const confirmSelection = () => {
    if (!selection || controlsDisabled || submissionStartedRef.current) {
      return;
    }

    submissionStartedRef.current = true;
    const operation: BookingPagePresetApplyOperation = {
      type: 'apply_preset',
      presetId: selection.reference.presetId,
      presetVersion: selection.reference.recipeVersion,
      expectedPresentationSignature: selection.expectedPresentationSignature,
    };
    // The opener becomes disabled as soon as its semantic write starts. Move
    // focus to a stable, meaningful point before closing so the shared modal
    // lifecycle never has to restore focus to a disabled card.
    returnFocusRef.current?.focus({ preventScroll: true });
    setSelection(null);
    onOperation(operation);
  };

  return (
    <section
      aria-busy={pending}
      aria-labelledby={titleId}
      className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      data-testid="booking-page-preset-picker"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            ref={returnFocusRef}
            id={titleId}
            tabIndex={-1}
            className="text-lg font-semibold text-stone-950"
          >
            Starting design
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
            Choose a starting point for the structure of your draft. You can fine-tune sections
            afterward.
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs font-medium text-stone-500">Current design</span>
          <span
            className="mt-1 inline-block rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-800"
            data-testid="booking-page-preset-state"
          >
            {stateLabel(matchingPreset, draft.presetBase)}
          </span>
        </div>
      </div>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="booking-page-preset-list">
        {BOOKING_PAGE_PRESET_IDS.map((presetId) => {
          const copy = PRESET_COPY[presetId];
          const isCurrent = matchingPreset?.presetId === presetId
            && isCurrentBookingPagePresetReference(matchingPreset);

          return (
            <li key={presetId}>
              <button
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`${copy.label} starting design${isCurrent ? ', current' : ''}`}
                className={`${CARD_CLASS} ${
                  isCurrent
                    ? 'border-rose-300 bg-rose-50'
                    : 'border-stone-200 bg-white hover:border-rose-300 hover:bg-rose-50'
                }`}
                disabled={controlsDisabled || isCurrent}
                onClick={() => openConfirmation(presetId)}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-stone-950">{copy.label}</span>
                  <span className="text-xs font-semibold text-rose-800">
                    {isCurrent ? 'Current' : 'Review switch'}
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-5 text-stone-600">
                  {copy.description}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {message
        ? (
            <p className="mt-4 text-sm text-stone-700" role="status" aria-live="polite">
              {message}
            </p>
          )
        : null}

      <DialogShell
        isOpen={selection !== null}
        onClose={closeDialog}
        initialFocusRef={cancelRef}
        closeOnBackdrop={!controlsDisabled}
        closeOnEscape={!controlsDisabled}
        alignClassName="items-stretch justify-center p-4"
        maxWidthClassName="flex max-w-lg items-center"
        contentClassName="max-h-full w-full touch-pan-y overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl"
        overlayTestId="booking-page-preset-dialog-overlay"
        contentTestId="booking-page-preset-dialog-content"
      >
        {selection && selectedCopy
          ? (
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                aria-describedby={`${dialogDescriptionId} ${dialogSafetyId}`}
                data-testid="booking-page-preset-dialog"
              >
                <h2 id={dialogTitleId} className="text-lg font-semibold text-stone-950">
                  Switch to
                  {' '}
                  {selectedCopy.label}
                  ?
                </h2>
                <div id={dialogDescriptionId} className="mt-2 space-y-2 text-sm leading-6 text-stone-600">
                  <p>
                    Only the draft’s layout, section order, section visibility, and section
                    presentations will change.
                  </p>
                  {selection.replacesCustomPresentation
                    ? (
                        <p className="font-medium text-amber-900">
                          You have custom presentation changes. Switching will replace them in the
                          draft.
                        </p>
                      )
                    : null}
                </div>

                <div className="mt-4 rounded-xl bg-stone-50 p-4">
                  <h3 className="text-sm font-semibold text-stone-900">What will change</h3>
                  <ul aria-label="Changes to your draft" className="mt-2 list-disc space-y-1 pl-5 text-sm leading-5 text-stone-700">
                    {selection.changes.map(change => <li key={change}>{change}</li>)}
                  </ul>
                </div>

                {selectedPreviewUrl
                  ? (
                      <div className="mt-4">
                        <h3 className="text-sm font-semibold text-stone-900">
                          Real page preview
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-stone-600">
                          This view uses your real draft content and the same renderer clients see.
                          It does not save or publish the selected design.
                        </p>
                        <div
                          data-booking-page-preview-scroll
                          className="mt-2 h-72 overflow-hidden overscroll-contain rounded-xl border border-stone-200 bg-white"
                        >
                          <iframe
                            key={selectedPreviewUrl}
                            title={`${selectedCopy.label} design preview`}
                            src={selectedPreviewUrl}
                            aria-hidden="true"
                            inert
                            sandbox="allow-same-origin"
                            tabIndex={-1}
                            onLoad={event => normalizeBookingPagePreviewFrame({
                              expectedSrc: selectedPreviewUrl,
                              frame: event.currentTarget,
                            })}
                            className="pointer-events-none block size-full bg-white"
                          />
                        </div>
                      </div>
                    )
                  : null}

                <div
                  id={dialogSafetyId}
                  className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
                >
                  <p>
                    Your salon details, services, prices, policy text, style pack, and custom color
                    settings stay unchanged.
                  </p>
                  <p className="mt-1">
                    Your live booking page will not change until you publish.
                  </p>
                </div>

                <div className="mt-5 flex gap-3">
                  <button
                    ref={cancelRef}
                    type="button"
                    className={`${ACTION_CLASS} border border-stone-300 bg-white text-stone-700`}
                    disabled={controlsDisabled}
                    onClick={closeDialog}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${ACTION_CLASS} bg-stone-950 text-white`}
                    disabled={controlsDisabled}
                    onClick={confirmSelection}
                  >
                    {pending ? 'Switching…' : `Use ${selectedCopy.label}`}
                  </button>
                </div>
              </div>
            )
          : null}
      </DialogShell>
    </section>
  );
}
