'use client';

import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
import {
  type BookingPagePresetReference,
  getBookingPagePresentationSignature,
} from '@/libs/bookingPagePresetRecipes';

export type BookingPageBuilderProps = {
  draft: BookingPageConfigSide;
  /**
   * IDs Stage 2 currently admits for the real owner preview. `null` means the
   * preview result is still unavailable, so the builder does not guess that
   * configured content is missing.
   */
  previewedSectionIds?: ReadonlySet<SectionId> | null;
  /** Admin-only base recipe provenance; never passed to the public renderer. */
  presetBase?: BookingPagePresetReference | null;
  pending: boolean;
  onOperation: (operation: BookingPageBuilderOperation) => void;
};

type SectionDefinition = ReturnType<typeof listBookingPageBuilderSections>[number];
type MoveDirection = 'up' | 'down';

type PendingMoveIntent = {
  direction: MoveDirection;
  participantIds: SectionId[];
  previousSectionOrder: SectionId[];
  sawPending: boolean;
  sectionId: SectionId;
};

type CompletedMoveResult = Pick<PendingMoveIntent, 'direction' | 'sectionId'>;

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
  if (previewedSectionIds === null) {
    return [];
  }

  const hidden = new Set(state.hiddenSections);

  return state.sectionOrder.filter((sectionId) => {
    const definition = definitions.get(sectionId);

    return Boolean(
      definition
      && definition.reorderable
      && !hidden.has(sectionId)
      && previewedSectionIds.has(sectionId),
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
  presetBase = null,
  pending,
  onOperation,
}: BookingPageBuilderProps) {
  const presentationState = { ...draft, presetBase };
  const sectionDefinitions = listBookingPageBuilderSections(draft.layout);
  const definitionsById = new Map(
    sectionDefinitions.map(definition => [definition.id, definition]),
  );
  const orderedDefinitions = orderSectionDefinitions(draft, sectionDefinitions);
  const hidden = new Set(draft.hiddenSections);
  const pageCustomized = isBookingPagePresentationCustomized(presentationState);
  const moveControlRefs = useRef(new Map<string, HTMLButtonElement>());
  const sectionRowRefs = useRef(new Map<SectionId, HTMLLIElement>());
  const pendingMoveIntentRef = useRef<PendingMoveIntent | null>(null);
  const completedMoveResultRef = useRef<CompletedMoveResult | null>(null);
  const latestDraftRef = useRef(draft);
  const latestDefinitionsRef = useRef(definitionsById);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  latestDraftRef.current = draft;
  latestDefinitionsRef.current = definitionsById;

  useEffect(() => {
    const intent = pendingMoveIntentRef.current;
    if (!intent) {
      return;
    }
    if (pending) {
      intent.sawPending = true;
      return;
    }

    const participants = new Set(intent.participantIds);
    const resultingOrder = draft.sectionOrder.filter(sectionId => participants.has(sectionId));
    const resultingPosition = resultingOrder.indexOf(intent.sectionId);
    const orderChanged = draft.sectionOrder.length !== intent.previousSectionOrder.length
      || draft.sectionOrder.some(
        (sectionId, index) => sectionId !== intent.previousSectionOrder[index],
      );
    const moveCompleted = resultingPosition !== -1 && orderChanged;

    // A successful save can place the moved section at a boundary, disabling
    // the control that initiated the move. Keep the keyboard workflow in the
    // same row by preferring that control, then its enabled counterpart.
    const oppositeDirection = intent.direction === 'up' ? 'down' : 'up';
    const preferredControl = moveControlRefs.current.get(
      `${intent.sectionId}:${intent.direction}`,
    );
    const oppositeControl = moveControlRefs.current.get(
      `${intent.sectionId}:${oppositeDirection}`,
    );
    const focusTarget = preferredControl && !preferredControl.disabled
      ? preferredControl
      : oppositeControl && !oppositeControl.disabled
        ? oppositeControl
        : null;

    if (moveCompleted || intent.sawPending) {
      focusTarget?.focus();
    }
    if (moveCompleted) {
      const label = listBookingPageBuilderSections(draft.layout)
        .find(definition => definition.id === intent.sectionId)?.label
        ?? intent.sectionId;
      completedMoveResultRef.current = {
        direction: intent.direction,
        sectionId: intent.sectionId,
      };
      setReorderAnnouncement(
        `${label} moved to position ${resultingPosition + 1} of ${resultingOrder.length} movable sections.`,
      );
    }
    pendingMoveIntentRef.current = null;
  }, [draft, pending]);

  useEffect(() => {
    const completed = completedMoveResultRef.current;
    if (!completed || previewedSectionIds === null) {
      return;
    }

    const currentDraft = latestDraftRef.current;
    const currentOrder = projectedReorderableFlowOrder(
      currentDraft,
      latestDefinitionsRef.current,
      previewedSectionIds,
    );
    const currentPosition = currentOrder.indexOf(completed.sectionId);
    const label = listBookingPageBuilderSections(currentDraft.layout)
      .find(definition => definition.id === completed.sectionId)?.label
      ?? completed.sectionId;
    const activeElement = document.activeElement;
    const focusWasLost = activeElement === document.body
      || (activeElement instanceof HTMLElement && !document.contains(activeElement));

    if (focusWasLost) {
      const oppositeDirection = completed.direction === 'up' ? 'down' : 'up';
      const preferredControl = moveControlRefs.current.get(
        `${completed.sectionId}:${completed.direction}`,
      );
      const oppositeControl = moveControlRefs.current.get(
        `${completed.sectionId}:${oppositeDirection}`,
      );
      const row = sectionRowRefs.current.get(completed.sectionId);
      const focusTarget = preferredControl && !preferredControl.disabled
        ? preferredControl
        : oppositeControl && !oppositeControl.disabled
          ? oppositeControl
          : row;

      focusTarget?.focus();
    }

    setReorderAnnouncement(currentPosition === -1
      ? `${label} is no longer available to reorder in the current preview.`
      : `${label} moved to position ${currentPosition + 1} of ${currentOrder.length} movable sections.`);
    completedMoveResultRef.current = null;
  }, [previewedSectionIds]);

  const dispatch = (operation: BookingPageBuilderOperation) => {
    if (!pending) {
      onOperation(operation);
    }
  };

  const dispatchMove = (
    sectionId: SectionId,
    targetSectionId: SectionId,
    direction: MoveDirection,
  ) => {
    if (pending) {
      return;
    }
    const participantIds = projectedReorderableFlowOrder(
      draft,
      definitionsById,
      previewedSectionIds,
    );
    const previousPosition = participantIds.indexOf(sectionId);
    if (previousPosition === -1) {
      return;
    }

    pendingMoveIntentRef.current = {
      direction,
      participantIds,
      previousSectionOrder: [...draft.sectionOrder],
      sawPending: false,
      sectionId,
    };
    // Clearing first ensures moving away and then back to the same position
    // still produces a fresh live-region change for assistive technology.
    setReorderAnnouncement('');
    onOperation({
      type: 'move_section',
      sectionId,
      targetSectionId,
      direction,
    });
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
          const customized = isBookingPageSectionCustomized(presentationState, definition.id);
          const explicitVariant = draft.sectionVariants[definition.id];
          const explicitVariantIsAllowed = explicitVariant !== undefined
            && (definition.allowedVariants as readonly string[]).includes(explicitVariant);
          const selectedVariant = explicitVariantIsAllowed ? explicitVariant : '';
          const canMove = definition.reorderable
            && configuredVisible
            && previewedSectionIds !== null
            && previewedSectionIds.has(definition.id);
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
              ref={(row) => {
                if (row) {
                  sectionRowRefs.current.set(definition.id, row);
                } else {
                  sectionRowRefs.current.delete(definition.id);
                }
              }}
              key={definition.id}
              className="rounded-2xl border border-stone-200 p-4"
              data-section-id={definition.id}
              data-testid={`builder-section-${definition.id}`}
              tabIndex={-1}
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
                                ref={(control) => {
                                  const key = `${definition.id}:up`;
                                  if (control) {
                                    moveControlRefs.current.set(key, control);
                                  } else {
                                    moveControlRefs.current.delete(key);
                                  }
                                }}
                                type="button"
                                aria-label={`Move ${definition.label} up`}
                                className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
                                data-testid={`builder-move-up-${definition.id}`}
                                disabled={pending || moveUpTarget === null}
                                onClick={() => dispatchMove(
                                  definition.id,
                                  moveUpTarget!,
                                  'up',
                                )}
                              >
                                <ArrowUp aria-hidden="true" className="size-4" />
                                Move up
                              </button>
                              <button
                                ref={(control) => {
                                  const key = `${definition.id}:down`;
                                  if (control) {
                                    moveControlRefs.current.set(key, control);
                                  } else {
                                    moveControlRefs.current.delete(key);
                                  }
                                }}
                                type="button"
                                aria-label={`Move ${definition.label} down`}
                                className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
                                data-testid={`builder-move-down-${definition.id}`}
                                disabled={pending || moveDownTarget === null}
                                onClick={() => dispatchMove(
                                  definition.id,
                                  moveDownTarget!,
                                  'down',
                                )}
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

      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-testid="builder-reorder-status"
        role="status"
      >
        {reorderAnnouncement}
      </p>

      <div className="mt-5 border-t border-stone-200 pt-5">
        <button
          type="button"
          className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
          data-testid="builder-reset-all"
          disabled={pending || !pageCustomized}
          onClick={() => dispatch({
            type: 'reset_all',
            expectedPresentationSignature: getBookingPagePresentationSignature(presentationState),
          })}
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
