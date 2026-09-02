'use client';

import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
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
  /** Preview revision issued only after the server accepted the latest move. */
  completedMoveRevision?: number | null;
  /**
   * Revision-bound IDs Stage 2 admits for the real owner preview. `null`
   * means the preview result is still unavailable, so the builder does not
   * guess that configured content is missing.
   */
  previewedSectionIds?: ReadonlySet<SectionId> | null;
  /** Ordered movable flow from the same completed canonical preview. */
  previewedReorderableSectionOrder?: readonly SectionId[] | null;
  /** Revision that produced `previewedSectionIds`; null means unattested. */
  previewAdmissionRevision?: number | null;
  /** Current revision requested from the real owner preview iframe. */
  previewRequestRevision?: number;
  /** Admin-only base recipe provenance; never passed to the public renderer. */
  presetBase?: BookingPagePresetReference | null;
  pending: boolean;
  onOperation: (operation: BookingPageBuilderOperation) => void;
};

type SectionDefinition = ReturnType<typeof listBookingPageBuilderSections>[number];
type MoveDirection = 'up' | 'down';

type PendingMoveIntent = {
  direction: MoveDirection;
  previousSectionOrder: SectionId[];
  previewRequestRevision: number;
  sawPending: boolean;
  sectionId: SectionId;
};

type CompletedMoveResult = Pick<PendingMoveIntent, 'direction' | 'sectionId'> & {
  requiredPreviewRevision: number;
};

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

function attestedReorderableFlowOrder(
  previewedSectionIds: ReadonlySet<SectionId>,
  previewedReorderableSectionOrder: readonly SectionId[],
): SectionId[] {
  const seen = new Set<SectionId>();

  return previewedReorderableSectionOrder.filter((sectionId) => {
    if (seen.has(sectionId)) {
      return false;
    }
    seen.add(sectionId);

    return previewedSectionIds.has(sectionId);
  });
}

function restoreMoveFocusIfLost({
  direction,
  moveControls,
  restoreFromSectionRow = false,
  sectionId,
  sectionRows,
}: {
  direction: MoveDirection;
  moveControls: ReadonlyMap<string, HTMLButtonElement>;
  restoreFromSectionRow?: boolean;
  sectionId: SectionId;
  sectionRows: ReadonlyMap<SectionId, HTMLLIElement>;
}): void {
  const activeElement = document.activeElement;
  const oppositeDirection = direction === 'up' ? 'down' : 'up';
  const preferredControl = moveControls.get(`${sectionId}:${direction}`);
  const oppositeControl = moveControls.get(`${sectionId}:${oppositeDirection}`);
  const sectionRow = sectionRows.get(sectionId);
  const focusWasLost = activeElement === null
    || activeElement === document.body
    || activeElement === document.documentElement
    || !document.contains(activeElement);
  const focusNeedsRepair = focusWasLost
    || (activeElement === preferredControl && preferredControl.disabled)
    || (activeElement === oppositeControl && oppositeControl.disabled)
    || (restoreFromSectionRow && activeElement === sectionRow);

  // A slow save must not pull focus back from another control the owner
  // deliberately reached while the request was pending.
  if (!focusNeedsRepair) {
    return;
  }

  const focusTarget = preferredControl && !preferredControl.disabled
    ? preferredControl
    : oppositeControl && !oppositeControl.disabled
      ? oppositeControl
      : sectionRow;

  focusTarget?.focus();
}

function moveTargetForSection({
  sectionId,
  direction,
  reorderableSectionOrder,
}: {
  sectionId: SectionId;
  direction: 'up' | 'down';
  reorderableSectionOrder: readonly SectionId[];
}): SectionId | null {
  const currentIndex = reorderableSectionOrder.indexOf(sectionId);
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  return reorderableSectionOrder[targetIndex] ?? null;
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
  completedMoveRevision,
  previewedSectionIds = null,
  previewedReorderableSectionOrder = null,
  previewAdmissionRevision = null,
  previewRequestRevision = 0,
  presetBase = null,
  pending,
  onOperation,
}: BookingPageBuilderProps) {
  const presentationState = { ...draft, presetBase };
  const sectionDefinitions = listBookingPageBuilderSections(
    draft.layout,
    draft.quickBookProfile,
  );
  const definitionsById = new Map(
    sectionDefinitions.map(definition => [definition.id, definition]),
  );
  const orderedDefinitions = orderSectionDefinitions(draft, sectionDefinitions);
  const hidden = new Set(draft.hiddenSections);
  const previewAdmissionIsCurrent = previewedSectionIds !== null
    && (previewAdmissionRevision === null
      || previewAdmissionRevision === previewRequestRevision);
  const unversionedReorderableSectionOrder = previewAdmissionRevision === null
    ? projectedReorderableFlowOrder(draft, definitionsById, previewedSectionIds)
    : null;
  const currentPreviewedReorderableSectionOrder = previewAdmissionIsCurrent
    ? previewedReorderableSectionOrder ?? unversionedReorderableSectionOrder
    : null;
  const pageCustomized = isBookingPagePresentationCustomized(presentationState);
  const moveControlRefs = useRef(new Map<string, HTMLButtonElement>());
  const sectionRowRefs = useRef(new Map<SectionId, HTMLLIElement>());
  const pendingMoveIntentRef = useRef<PendingMoveIntent | null>(null);
  const completedMoveResultRef = useRef<CompletedMoveResult | null>(null);
  const latestDraftRef = useRef(draft);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  latestDraftRef.current = draft;

  useEffect(() => {
    const intent = pendingMoveIntentRef.current;
    if (!intent) {
      return;
    }
    if (pending) {
      intent.sawPending = true;
      return;
    }

    const orderChanged = draft.sectionOrder.length !== intent.previousSectionOrder.length
      || draft.sectionOrder.some(
        (sectionId, index) => sectionId !== intent.previousSectionOrder[index],
      );
    const moveCompleted = completedMoveRevision === undefined
      ? draft.sectionOrder.includes(intent.sectionId) && orderChanged
      : completedMoveRevision !== null
        && completedMoveRevision > intent.previewRequestRevision;

    if (moveCompleted || intent.sawPending) {
      restoreMoveFocusIfLost({
        direction: intent.direction,
        moveControls: moveControlRefs.current,
        sectionId: intent.sectionId,
        sectionRows: sectionRowRefs.current,
      });
    }
    const requiredPreviewRevision = completedMoveRevision ?? previewRequestRevision;
    if (moveCompleted && requiredPreviewRevision > intent.previewRequestRevision) {
      completedMoveResultRef.current = {
        direction: intent.direction,
        requiredPreviewRevision,
        sectionId: intent.sectionId,
      };
    }
    pendingMoveIntentRef.current = null;
  }, [completedMoveRevision, draft, pending, previewRequestRevision]);

  useEffect(() => {
    const completed = completedMoveResultRef.current;
    if (!completed) {
      return;
    }
    if (completedMoveRevision !== undefined
      && completedMoveRevision !== completed.requiredPreviewRevision) {
      completedMoveResultRef.current = null;
      return;
    }
    if (previewRequestRevision > completed.requiredPreviewRevision) {
      // Another presentation refresh superseded this move before its exact
      // Stage 2 result arrived. Silence is safer than attributing the newer
      // configuration's position to the older operation.
      completedMoveResultRef.current = null;
      return;
    }
    if (previewedSectionIds === null
      || previewedReorderableSectionOrder === null
      || previewAdmissionRevision !== completed.requiredPreviewRevision
      || previewRequestRevision !== completed.requiredPreviewRevision) {
      return;
    }

    const currentDraft = latestDraftRef.current;
    const currentOrder = attestedReorderableFlowOrder(
      previewedSectionIds,
      previewedReorderableSectionOrder,
    );
    const currentPosition = currentOrder.indexOf(completed.sectionId);
    const label = listBookingPageBuilderSections(
      currentDraft.layout,
      currentDraft.quickBookProfile,
    )
      .find(definition => definition.id === completed.sectionId)?.label
      ?? completed.sectionId;
    restoreMoveFocusIfLost({
      direction: completed.direction,
      moveControls: moveControlRefs.current,
      restoreFromSectionRow: true,
      sectionId: completed.sectionId,
      sectionRows: sectionRowRefs.current,
    });

    setReorderAnnouncement(currentPosition === -1
      ? `${label} is no longer available to reorder in the current preview.`
      : `${label} moved to position ${currentPosition + 1} of ${currentOrder.length} movable sections.`);
    completedMoveResultRef.current = null;
  }, [
    completedMoveRevision,
    previewAdmissionRevision,
    pending,
    previewedSectionIds,
    previewedReorderableSectionOrder,
    previewRequestRevision,
  ]);

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
    const participantIds = currentPreviewedReorderableSectionOrder ?? [];
    const previousPosition = participantIds.indexOf(sectionId);
    if (previousPosition === -1) {
      return;
    }

    // A newer move supersedes any older result still waiting for its preview
    // attestation, so a late iframe load cannot announce the older action.
    completedMoveResultRef.current = null;
    pendingMoveIntentRef.current = {
      direction,
      previousSectionOrder: [...draft.sectionOrder],
      previewRequestRevision,
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
          const showMoveControls = definition.reorderable
            && configuredVisible
            && previewedSectionIds !== null
            && previewedSectionIds.has(definition.id);
          const canMove = showMoveControls
            && currentPreviewedReorderableSectionOrder !== null
            && currentPreviewedReorderableSectionOrder.includes(definition.id);
          const moveUpTarget = canMove
            ? moveTargetForSection({
              sectionId: definition.id,
              direction: 'up',
              reorderableSectionOrder: currentPreviewedReorderableSectionOrder,
            })
            : null;
          const moveDownTarget = canMove
            ? moveTargetForSection({
              sectionId: definition.id,
              direction: 'down',
              reorderableSectionOrder: currentPreviewedReorderableSectionOrder,
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

              {(showMoveControls || customized)
                ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {showMoveControls
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
