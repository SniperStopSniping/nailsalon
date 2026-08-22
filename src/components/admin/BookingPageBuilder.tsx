'use client';

import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';

import {
  applyBookingPageBuilderOperation,
  type BookingPageBuilderOperation,
  type BookingPagePresentationState,
  getBookingPageBuilderVariantLabel,
  isBookingPagePresentationCustomized,
  isBookingPageSectionCustomized,
  listBookingPageBuilderSections,
} from '@/libs/bookingPageBuilder';
import type { BookingPageConfigSide, SectionId } from '@/libs/bookingPageConfig';

export type BookingPageBuilderProps = {
  draft: BookingPageConfigSide;
  /**
   * IDs Stage 2 currently admits for the real owner preview. `null` means the
   * preview result is still unavailable, so the builder does not guess that
   * configured content is missing.
   */
  previewedSectionIds?: ReadonlySet<SectionId> | null;
  pending: boolean;
  onOperation: (operation: BookingPageBuilderOperation) => void;
};

type SectionDefinition = ReturnType<typeof listBookingPageBuilderSections>[number];

const CONTROL_CLASS = 'min-h-11 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition-colors hover:border-rose-300 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

function orderSectionDefinitions(
  draft: BookingPageConfigSide,
  definitions: readonly SectionDefinition[],
): SectionDefinition[] {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const seen = new Set<SectionId>();
  const ordered: SectionDefinition[] = [];

  for (const sectionId of draft.sectionOrder) {
    const definition = byId.get(sectionId);
    if (definition && !seen.has(sectionId)) {
      ordered.push(definition);
      seen.add(sectionId);
    }
  }

  for (const definition of definitions) {
    if (!seen.has(definition.id)) {
      ordered.push(definition);
      seen.add(definition.id);
    }
  }

  return ordered;
}

function projectedReorderableFlowOrder(
  state: BookingPagePresentationState,
  definitions: ReadonlyMap<SectionId, SectionDefinition>,
  previewedSectionIds: ReadonlySet<SectionId> | null,
): SectionId[] {
  const hidden = new Set(state.hiddenSections);

  return state.sectionOrder.filter((sectionId) => {
    const definition = definitions.get(sectionId);

    return Boolean(
      definition
      && definition.reorderable
      && !hidden.has(sectionId)
      && (previewedSectionIds === null || previewedSectionIds.has(sectionId)),
    );
  });
}

function moveTargetForSection({
  draft,
  sectionId,
  direction,
  definitions,
  previewedSectionIds,
}: {
  draft: BookingPageConfigSide;
  sectionId: SectionId;
  direction: 'up' | 'down';
  definitions: ReadonlyMap<SectionId, SectionDefinition>;
  previewedSectionIds: ReadonlySet<SectionId> | null;
}): SectionId | null {
  const flowOrder = projectedReorderableFlowOrder(draft, definitions, previewedSectionIds);
  const currentIndex = flowOrder.indexOf(sectionId);
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  const targetSectionId = flowOrder[targetIndex];
  if (!targetSectionId) {
    return null;
  }

  const result = applyBookingPageBuilderOperation(draft, {
    type: 'move_section',
    sectionId,
    targetSectionId,
    direction,
  });
  if (!result.ok) {
    return null;
  }

  const after = projectedReorderableFlowOrder(
    {
      layout: draft.layout,
      sectionOrder: result.patch.sectionOrder ?? draft.sectionOrder,
      sectionVariants: result.patch.sectionVariants ?? draft.sectionVariants,
      hiddenSections: result.patch.hiddenSections ?? draft.hiddenSections,
    },
    definitions,
    previewedSectionIds,
  );

  return after.indexOf(sectionId) === targetIndex ? targetSectionId : null;
}

function statusForSection({
  definition,
  configuredVisible,
  previewedSectionIds,
}: {
  definition: SectionDefinition;
  configuredVisible: boolean;
  previewedSectionIds: ReadonlySet<SectionId> | null;
}): { label: string; description: string | null; tone: string } {
  if (!definition.supported) {
    return {
      label: 'Unavailable',
      description: 'This section is not available yet.',
      tone: 'bg-stone-100 text-stone-600',
    };
  }

  if (definition.protected) {
    return {
      label: 'Protected',
      description: 'This section keeps the booking page complete and cannot be hidden.',
      tone: 'bg-sky-50 text-sky-800',
    };
  }

  if (!configuredVisible) {
    return {
      label: 'Hidden',
      description: 'This section stays saved and can be shown again.',
      tone: 'bg-stone-100 text-stone-700',
    };
  }

  if (previewedSectionIds !== null && !previewedSectionIds.has(definition.id)) {
    return {
      label: 'Unavailable',
      description: 'Add the section content before it can appear in your preview.',
      tone: 'bg-amber-50 text-amber-900',
    };
  }

  return {
    label: 'Visible',
    description: null,
    tone: 'bg-emerald-50 text-emerald-800',
  };
}

export function BookingPageBuilder({
  draft,
  previewedSectionIds = null,
  pending,
  onOperation,
}: BookingPageBuilderProps) {
  const sectionDefinitions = listBookingPageBuilderSections(draft.layout);
  const definitionsById = new Map(
    sectionDefinitions.map(definition => [definition.id, definition]),
  );
  const orderedDefinitions = orderSectionDefinitions(draft, sectionDefinitions);
  const hidden = new Set(draft.hiddenSections);
  const pageCustomized = isBookingPagePresentationCustomized(draft);

  const dispatch = (operation: BookingPageBuilderOperation) => {
    if (!pending) {
      onOperation(operation);
    }
  };

  return (
    <section
      aria-labelledby="booking-page-builder-title"
      className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      data-testid="booking-page-builder"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="booking-page-builder-title" className="text-lg font-semibold text-stone-950">
            Make it yours
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Choose what clients see and how each available section is presented. Your salon details,
            services, prices, and booking rules stay unchanged.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            pageCustomized ? 'bg-rose-50 text-rose-800' : 'bg-stone-100 text-stone-700'
          }`}
          data-testid="booking-page-customization-state"
        >
          {pageCustomized ? 'Customized' : 'Using starting design'}
        </span>
      </div>

      <ol className="mt-5 space-y-3" data-testid="booking-page-builder-section-list">
        {orderedDefinitions.map((definition) => {
          const configuredVisible = draft.sectionOrder.includes(definition.id)
            && !hidden.has(definition.id);
          const status = statusForSection({
            definition,
            configuredVisible,
            previewedSectionIds,
          });
          const customized = isBookingPageSectionCustomized(draft, definition.id);
          const explicitVariant = draft.sectionVariants[definition.id];
          const explicitVariantIsAllowed = explicitVariant !== undefined
            && (definition.allowedVariants as readonly string[]).includes(explicitVariant);
          const selectedVariant = explicitVariantIsAllowed ? explicitVariant : '';
          const canMove = definition.reorderable
            && configuredVisible
            && (previewedSectionIds === null || previewedSectionIds.has(definition.id));
          const moveUpTarget = canMove
            ? moveTargetForSection({
              draft,
              sectionId: definition.id,
              direction: 'up',
              definitions: definitionsById,
              previewedSectionIds,
            })
            : null;
          const moveDownTarget = canMove
            ? moveTargetForSection({
              draft,
              sectionId: definition.id,
              direction: 'down',
              definitions: definitionsById,
              previewedSectionIds,
            })
            : null;
          const variantSelectId = `booking-page-variant-${definition.id}`;

          return (
            <li
              key={definition.id}
              className="rounded-2xl border border-stone-200 p-4"
              data-section-id={definition.id}
              data-testid={`builder-section-${definition.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-stone-900">{definition.label}</h3>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${status.tone}`}
                      data-testid={`builder-section-status-${definition.id}`}
                    >
                      {status.label}
                    </span>
                    <span className="text-xs font-medium text-stone-500">
                      {customized ? 'Customized' : 'Inherited'}
                    </span>
                  </div>
                  {status.description
                    ? (
                        <p className="mt-1 text-xs leading-5 text-stone-600">{status.description}</p>
                      )
                    : null}
                  {definition.ownerConfigurable
                  && definition.supported
                  && definition.placement === 'serviceMenuSlot'
                    ? (
                        <p className="mt-1 text-xs leading-5 text-stone-600">
                          Position is fixed with Services in this layout.
                        </p>
                      )
                    : null}
                </div>

                {definition.ownerConfigurable && definition.supported
                  ? (
                      <button
                        type="button"
                        aria-label={`${configuredVisible ? 'Hide' : 'Show'} ${definition.label}`}
                        aria-pressed={configuredVisible}
                        className={CONTROL_CLASS}
                        data-testid={`builder-visibility-${definition.id}`}
                        disabled={pending}
                        onClick={() => dispatch({
                          type: 'set_visibility',
                          sectionId: definition.id,
                          visible: !configuredVisible,
                        })}
                      >
                        {configuredVisible ? 'Hide' : 'Show'}
                      </button>
                    )
                  : null}
              </div>

              {definition.supported
              && (definition.allowedVariants.length > 1 || explicitVariant !== undefined)
                ? (
                    <div className="mt-4">
                      <label className="text-sm font-medium text-stone-800" htmlFor={variantSelectId}>
                        Presentation
                      </label>
                      <select
                        id={variantSelectId}
                        aria-label={`${definition.label} presentation`}
                        className="mt-1 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid={`builder-variant-${definition.id}`}
                        disabled={pending}
                        value={selectedVariant}
                        onChange={event => dispatch({
                          type: 'set_variant',
                          sectionId: definition.id,
                          variant: event.target.value === '' ? null : event.target.value,
                        })}
                      >
                        <option value="">Inherited default</option>
                        {definition.allowedVariants.map(variant => (
                          <option key={variant} value={variant}>
                            {getBookingPageBuilderVariantLabel(variant)}
                          </option>
                        ))}
                      </select>
                      {explicitVariant !== undefined && !explicitVariantIsAllowed
                        ? (
                            <p className="mt-1 text-xs text-amber-800">
                              This saved presentation is not available here, so the inherited default is shown.
                            </p>
                          )
                        : null}
                    </div>
                  )
                : null}

              {(canMove || customized)
                ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canMove
                        ? (
                            <>
                              <button
                                type="button"
                                aria-label={`Move ${definition.label} up`}
                                className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
                                data-testid={`builder-move-up-${definition.id}`}
                                disabled={pending || moveUpTarget === null}
                                onClick={() => dispatch({
                                  type: 'move_section',
                                  sectionId: definition.id,
                                  targetSectionId: moveUpTarget!,
                                  direction: 'up',
                                })}
                              >
                                <ArrowUp aria-hidden="true" className="size-4" />
                                Move up
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${definition.label} down`}
                                className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
                                data-testid={`builder-move-down-${definition.id}`}
                                disabled={pending || moveDownTarget === null}
                                onClick={() => dispatch({
                                  type: 'move_section',
                                  sectionId: definition.id,
                                  targetSectionId: moveDownTarget!,
                                  direction: 'down',
                                })}
                              >
                                <ArrowDown aria-hidden="true" className="size-4" />
                                Move down
                              </button>
                            </>
                          )
                        : null}

                      {customized
                        ? (
                            <button
                              type="button"
                              aria-label={`Reset ${definition.label}`}
                              className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
                              data-testid={`builder-reset-${definition.id}`}
                              disabled={pending}
                              onClick={() => dispatch({ type: 'reset_section', sectionId: definition.id })}
                            >
                              <RotateCcw aria-hidden="true" className="size-4" />
                              Reset section
                            </button>
                          )
                        : null}
                    </div>
                  )
                : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-5 border-t border-stone-200 pt-5">
        <button
          type="button"
          className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
          data-testid="builder-reset-all"
          disabled={pending || !pageCustomized}
          onClick={() => dispatch({ type: 'reset_all' })}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Reset page customization
        </button>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          Resetting changes presentation only. Your salon details, services, prices, and policies stay saved.
        </p>
      </div>
    </section>
  );
}
