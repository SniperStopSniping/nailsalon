'use client';

/**
 * Owner-facing Service Library: browse the global template catalog and add
 * services to the salon's own menu.
 *
 * AG-services-06 found two pickers over one catalogue — this dashboard tab and
 * the onboarding "Choose your services" sheet — with different interaction
 * models. The catalogue itself is already shared (both resolve
 * `@/libs/serviceTemplateCatalog`; `serviceLibraryCatalogParity.test.ts` keeps
 * the onboarding ids mapped to production template keys), so the repair is to
 * make this tab READ that one catalogue through the onboarding sheet's
 * interaction model rather than to ship a third picker:
 *
 *   title + explanation · search · Services/Add-ons segments · category pills ·
 *   list rows with duration and price · an explicit Added state ·
 *   a persistent footer carrying the menu counts and Done.
 *
 * One deliberate divergence: production templates carry no imagery (the
 * onboarding sheet's photos come from the lab package's own fixtures), so rows
 * lead with a category glyph instead of a photo.
 */

import { Check, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import {
  getStarterTemplates,
  getTemplatesByShelf,
  getTemplateShelf,
  LIBRARY_SHELF_LABELS,
  searchTemplates,
  SERVICE_TEMPLATES,
  type ServiceTemplate,
  type ServiceTemplateCategory,
} from '@/libs/serviceTemplateCatalog';
import { formatDuration } from '@/utils/Helpers';

import { ADD_ON_CATEGORY_ORDER, addOnCategoryLabel } from './addOnCategories';

/**
 * Secondary service-type labels only — these describe WHAT a service is on
 * the card. They are never navigation: the shelves are Popular / Manicure /
 * Pedicure / Combos, inside a Services or Add-ons segment.
 */
const TEMPLATE_TYPE_LABELS: Record<ServiceTemplateCategory, string> = {
  popular: 'Popular',
  gel_natural: 'Gel & natural',
  extensions: 'Extensions',
  pedicure: 'Pedicure',
  combos: 'Combo',
  nail_art: 'Nail art',
  removal_repair: 'Removal & repair',
  spa: 'Spa',
  acrylic_dip: 'Acrylic & dip',
};

type LibrarySegment = 'services' | 'addons';

/** Category rail for the Services segment; `all` is the escape hatch. */
const SERVICE_SHELF_RAIL = [
  { id: 'popular', label: LIBRARY_SHELF_LABELS.popular },
  { id: 'manicure', label: LIBRARY_SHELF_LABELS.manicure },
  { id: 'pedicure', label: LIBRARY_SHELF_LABELS.pedicure },
  { id: 'combo', label: LIBRARY_SHELF_LABELS.combo },
  { id: 'all', label: 'All services' },
];

const BASE_SERVICE_TEMPLATES = SERVICE_TEMPLATES.filter(
  template => template.serviceType !== 'addon',
);
const ADD_ON_TEMPLATES = getTemplatesByShelf('addon');

/** Add-on rail: only the categories the catalogue actually contains. */
const ADD_ON_CATEGORY_RAIL = [
  { id: 'all', label: 'All add-ons' },
  ...ADD_ON_CATEGORY_ORDER.filter(category =>
    ADD_ON_TEMPLATES.some(template => (template.addOnCategory ?? 'nail_art') === category),
  ).map(category => ({ id: category as string, label: addOnCategoryLabel(category) })),
];

function isAddOn(template: ServiceTemplate): boolean {
  return template.serviceType === 'addon';
}

function templatesForCategory(segment: LibrarySegment, categoryId: string): ServiceTemplate[] {
  if (segment === 'addons') {
    return categoryId === 'all'
      ? ADD_ON_TEMPLATES
      : ADD_ON_TEMPLATES.filter(
        template => (template.addOnCategory ?? 'nail_art') === categoryId,
      );
  }
  if (categoryId === 'all') {
    return BASE_SERVICE_TEMPLATES;
  }
  if (categoryId === 'popular') {
    return getTemplatesByShelf('popular').filter(template => !isAddOn(template));
  }
  return BASE_SERVICE_TEMPLATES.filter(template => getTemplateShelf(template) === categoryId);
}

/** Base service / Combo / Add-on — what kind of record this creates. */
function templateKindLabel(template: ServiceTemplate): string {
  if (isAddOn(template)) {
    return 'Add-on';
  }
  if (template.serviceType === 'combo' || template.bookingCategory === 'combo') {
    return 'Combo';
  }
  return 'Base service';
}

function formatTemplatePrice(template: ServiceTemplate): string {
  return template.priceDisplayText ?? `$${(template.defaultPriceCents / 100).toFixed(0)}`;
}

/**
 * Bring the results back to the top when the owner changes what they are
 * looking at. Without this the list keeps its previous scroll offset and a
 * new shelf appears to open half way down — the "scroll position" behaviour
 * the audit could not exercise.
 */
function scrollResultsIntoView(node: HTMLElement | null): void {
  if (!node) {
    return;
  }
  let ancestor: HTMLElement | null = node.parentElement;
  while (ancestor) {
    const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(ancestor)
      : null;
    const scrolls = style ? /auto|scroll|overlay/.test(String(style.overflowY)) : false;
    if (scrolls && ancestor.scrollHeight > ancestor.clientHeight) {
      ancestor.scrollTop = 0;
      return;
    }
    ancestor = ancestor.parentElement;
  }
}

function TemplateRow({
  template,
  isAdded,
  isPending,
  onAdd,
}: {
  template: ServiceTemplate;
  isAdded: boolean;
  isPending: boolean;
  onAdd: (template: ServiceTemplate) => void;
}) {
  return (
    <li
      data-testid={`library-template-${template.systemKey}`}
      data-added={isAdded ? 'true' : 'false'}
      className="flex min-h-[64px] items-center gap-3 border-b border-[var(--owner-line)] px-4 py-3 last:border-b-0"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--owner-blush)] text-[var(--owner-accent)]"
      >
        <Sparkles className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] font-semibold leading-5 text-[var(--owner-ink)]">
          {template.name}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--owner-muted)]">
          <span>{formatDuration(template.defaultDurationMinutes)}</span>
          <span aria-hidden="true">·</span>
          <span
            data-testid={`library-kind-${template.systemKey}`}
            className="rounded-full bg-[var(--owner-blush)] px-2 py-0.5 text-[11px] text-[var(--owner-accent-strong)]"
          >
            {templateKindLabel(template)}
          </span>
          <span className="rounded-full border border-[var(--owner-line)] px-2 py-0.5 text-[11px]">
            {TEMPLATE_TYPE_LABELS[template.templateCategory]}
          </span>
        </p>
        <p className="mt-0.5 text-[13px] font-semibold text-[var(--owner-ink)]">
          {formatTemplatePrice(template)}
        </p>
        {template.description && (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--owner-muted)]">
            {template.description}
          </p>
        )}
      </div>
      {isAdded
        ? (
            <span
              data-testid={`library-added-${template.systemKey}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700"
            >
              <Check aria-hidden="true" className="size-3.5" />
              Added
            </span>
          )
        : (
            <Button
              type="button"
              variant="ownerSecondary"
              size="pillSm"
              className="min-h-11 shrink-0 gap-1"
              disabled={isPending}
              aria-label={isAddOn(template)
                ? `Add ${template.name} to your menu`
                : `Add ${template.name} — review its price and duration`}
              data-testid={`library-add-${template.systemKey}`}
              onClick={() => onAdd(template)}
            >
              {isPending
                ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                : <Plus aria-hidden="true" className="size-3.5" />}
              {isPending ? 'Adding' : 'Add'}
            </Button>
          )}
    </li>
  );
}

function BulkAddRecommendedDialog({
  isOpen,
  ownedTemplateKeys,
  busy,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  ownedTemplateKeys: Set<string>;
  busy: boolean;
  onClose: () => void;
  onConfirm: (templateKeys: string[]) => void;
}) {
  const starters = useMemo(() => getStarterTemplates(), []);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const selectable = starters.filter(template => !ownedTemplateKeys.has(template.systemKey));
  const selected = selectable.filter(template => !unchecked.has(template.systemKey));
  const selectedKeys = selected.map(template => template.systemKey);
  const selectedServiceCount = selected.filter(template => template.serviceType !== 'addon').length;
  const selectedAddOnCount = selected.length - selectedServiceCount;
  const alreadyOwnedCount = starters.length - selectable.length;

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[85dvh] overflow-y-auto rounded-3xl bg-[var(--owner-surface)] p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--owner-ink)]">Add recommended services</h2>
          <p data-testid="bulk-add-summary" className="mt-1 text-sm text-[var(--owner-muted)]">
            {`Add ${selectedServiceCount} ${selectedServiceCount === 1 ? 'service' : 'services'} and ${selectedAddOnCount} ${selectedAddOnCount === 1 ? 'add-on' : 'add-ons'}.`}
            {alreadyOwnedCount > 0
              ? ` ${alreadyOwnedCount} already on your menu ${alreadyOwnedCount === 1 ? 'is' : 'are'} skipped.`
              : ''}
            {' Uncheck anything you don’t offer — every price and duration stays editable afterwards.'}
          </p>
        </div>

        <div className="max-h-[45dvh] space-y-1 overflow-y-auto rounded-2xl border border-[var(--owner-line)] p-2">
          {starters.map((template) => {
            const alreadyAdded = ownedTemplateKeys.has(template.systemKey);
            return (
              <label
                key={template.systemKey}
                className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${alreadyAdded ? 'opacity-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-[var(--owner-ink)]">{template.name}</span>
                  <span className="block text-[12px] text-[var(--owner-muted)]">
                    {formatTemplatePrice(template)}
                    {' · '}
                    {formatDuration(template.defaultDurationMinutes)}
                    {template.serviceType === 'addon' ? ' · add-on' : ''}
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="size-4"
                  data-testid={`bulk-add-check-${template.systemKey}`}
                  disabled={alreadyAdded || busy}
                  checked={alreadyAdded || !unchecked.has(template.systemKey)}
                  onChange={(event) => {
                    setUnchecked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) {
                        next.delete(template.systemKey);
                      } else {
                        next.add(template.systemKey);
                      }
                      return next;
                    });
                  }}
                />
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="brandSoft" size="pillSm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            size="pillSm"
            data-testid="bulk-add-confirm"
            onClick={() => onConfirm(selectedKeys)}
            disabled={busy || selectedKeys.length === 0}
          >
            {busy
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Adding...
                  </>
                )
              : `Add ${selectedServiceCount} services · ${selectedAddOnCount} add-ons`}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

export function ServiceLibraryTab({
  ownedTemplateKeys,
  bulkAddBusy,
  menuServiceCount,
  menuAddOnCount,
  onAddTemplate,
  onBulkAdd,
  onCreateCustom,
  onDone,
}: {
  ownedTemplateKeys: Set<string>;
  bulkAddBusy: boolean;
  /** Live menu totals, so the footer counts what the owner actually has. */
  menuServiceCount: number;
  menuAddOnCount: number;
  onAddTemplate: (template: ServiceTemplate) => void | Promise<void>;
  onBulkAdd: (templateKeys: string[]) => Promise<void>;
  onCreateCustom: () => void;
  /** Leaves the Library for the menu the owner has just been building. */
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<LibrarySegment>('services');
  const [activeCategory, setActiveCategory] = useState<string>('popular');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [pendingTemplateKey, setPendingTemplateKey] = useState<string | null>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  /**
   * The filter the results are currently showing. A "first render" boolean is
   * not enough: React runs an effect twice on mount in development, so the
   * second invoke fired the reset and zeroed a scroll offset the Services
   * sheet had just restored for this tab. Comparing the filter itself is
   * idempotent, so a re-run with unchanged filters is a no-op.
   */
  const shownFilterRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = query.trim();
  const categoryRail = segment === 'services' ? SERVICE_SHELF_RAIL : ADD_ON_CATEGORY_RAIL;

  const templates = trimmedQuery
    // A search always searches the whole segment: an owner typing "gel" on the
    // Popular shelf must not be told the catalogue has no gel services.
    ? searchTemplates(trimmedQuery).filter(template => (segment === 'addons') === isAddOn(template))
    : templatesForCategory(segment, activeCategory);

  const addedInView = templates.filter(template => ownedTemplateKeys.has(template.systemKey)).length;
  const menuCountsLabel = `${menuServiceCount} ${menuServiceCount === 1 ? 'service' : 'services'} · ${menuAddOnCount} ${menuAddOnCount === 1 ? 'add-on' : 'add-ons'} on your menu`;

  useEffect(() => {
    const filterKey = `${segment}|${activeCategory}|${trimmedQuery}`;
    const previous = shownFilterRef.current;
    shownFilterRef.current = filterKey;
    if (previous === null || previous === filterKey) {
      return;
    }
    scrollResultsIntoView(resultsRef.current);
  }, [segment, activeCategory, trimmedQuery]);

  const selectSegment = (next: LibrarySegment) => {
    setSegment(next);
    setActiveCategory(next === 'services' ? 'popular' : 'all');
  };

  const handleAdd = (template: ServiceTemplate) => {
    const result = onAddTemplate(template);
    // Only an add-on is written straight to the menu; a base service opens the
    // review sheet instead, so there is nothing to wait for.
    if (isAddOn(template) && result && typeof (result as Promise<void>).finally === 'function') {
      setPendingTemplateKey(template.systemKey);
      void (result as Promise<void>).finally(() => setPendingTemplateKey(null));
    }
  };

  return (
    <div data-testid="service-library-tab" className="flex min-h-full flex-col">
      <div className="px-4 pb-1 pt-2">
        <h2 className="owner-title text-[19px] font-semibold text-[var(--owner-ink)]">
          Service Library
        </h2>
        <p className="mt-0.5 text-[13px] leading-5 text-[var(--owner-muted)]">
          The same library your onboarding used. Add what you offer — every price
          and duration stays editable on your menu afterwards.
        </p>
        <p
          data-testid="library-header-counts"
          className="mt-1 text-[12px] font-semibold text-[var(--owner-accent-strong)]"
        >
          {menuCountsLabel}
        </p>
        <div className="relative mt-2">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--owner-muted)]" />
          <label className="sr-only" htmlFor="library-search-input">Search the service library</label>
          <input
            id="library-search-input"
            ref={searchInputRef}
            type="search"
            data-testid="library-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search services (try “BIAB” or “shellac”)"
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] pl-9 pr-3 text-sm text-[var(--owner-ink)] outline-none transition focus:border-[var(--owner-accent)]"
          />
        </div>
      </div>

      <div className="px-4 py-2">
        <div
          role="tablist"
          aria-label="Service library type"
          data-testid="library-segments"
          tabIndex={-1}
          className="grid grid-cols-2 gap-1 rounded-full bg-[var(--owner-blush)] p-1"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const next: LibrarySegment = event.key === 'ArrowLeft' || event.key === 'Home'
              ? 'services'
              : 'addons';
            const tabList = event.currentTarget;
            selectSegment(next);
            window.requestAnimationFrame(() => {
              tabList.querySelector<HTMLElement>(`[data-library-segment="${next}"]`)?.focus();
            });
          }}
        >
          {([
            ['services', 'Services'],
            ['addons', 'Add-ons'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-library-segment={id}
              data-testid={`library-segment-${id}`}
              aria-selected={segment === id}
              aria-controls="library-results"
              tabIndex={segment === id ? 0 : -1}
              onClick={() => selectSegment(id)}
              className={`rounded-full py-2 text-[13px] font-semibold transition-all ${
                segment === id
                  ? 'bg-[var(--owner-surface)] text-[var(--owner-ink)] shadow-sm'
                  : 'text-[var(--owner-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {trimmedQuery
        ? (
            <div className="flex items-center justify-between gap-3 px-4 pb-2">
              <p data-testid="library-search-summary" role="status" className="text-[12px] text-[var(--owner-muted)]">
                {`${templates.length} ${templates.length === 1 ? 'result' : 'results'} for “${trimmedQuery}” in ${segment === 'addons' ? 'Add-ons' : 'Services'}`}
              </p>
              <button
                type="button"
                data-testid="library-search-clear"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[var(--owner-accent)]"
              >
                <X aria-hidden="true" className="size-3.5" />
                Clear
              </button>
            </div>
          )
        : (
            <div className="px-4 pb-2">
              <div
                role="group"
                aria-label={segment === 'addons' ? 'Add-on categories' : 'Service categories'}
                className="scrollbar-hide flex gap-2 overflow-x-auto pb-1"
              >
                {categoryRail.map(shelf => (
                  <button
                    key={shelf.id}
                    type="button"
                    data-testid={`library-chip-${shelf.id}`}
                    aria-pressed={activeCategory === shelf.id}
                    onClick={() => setActiveCategory(shelf.id)}
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-all ${
                      activeCategory === shelf.id
                        ? 'bg-[var(--owner-accent)] text-white shadow-sm'
                        : 'border border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-ink)]'
                    }`}
                  >
                    {shelf.label}
                  </button>
                ))}
              </div>
            </div>
          )}

      {segment === 'services' && activeCategory === 'popular' && !trimmedQuery && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-[var(--owner-ink)]">
              <Sparkles aria-hidden="true" className="size-4 text-[var(--owner-accent)]" />
              Recommended quick start
            </div>
            <p className="mt-0.5 text-[13px] text-[var(--owner-muted)]">
              Add the full recommended menu in one go — no acrylic, everything editable.
            </p>
          </div>
          <Button
            type="button"
            variant="ownerPrimary"
            size="pillSm"
            className="shrink-0"
            data-testid="bulk-add-open"
            onClick={() => setShowBulkAdd(true)}
          >
            Add recommended
          </Button>
        </div>
      )}

      {segment === 'addons' && !trimmedQuery && (
        <p className="mx-4 mb-2 text-[12px] text-[var(--owner-muted)]">
          Add-ons appear for clients after they pick a compatible base service.
        </p>
      )}

      <ul
        ref={resultsRef}
        id="library-results"
        data-testid="library-results"
        aria-label={segment === 'addons' ? 'Library add-ons' : 'Library services'}
        className="mx-4 overflow-hidden rounded-owner-card border border-[var(--owner-line)] bg-[var(--owner-surface)] shadow-sm"
      >
        {templates.length === 0
          ? (
              <li data-testid="library-empty" className="px-4 py-8 text-center text-sm text-[var(--owner-muted)]">
                {segment === 'addons'
                  ? 'No add-ons match your search — you can create your own from the Add-ons tab.'
                  : 'No templates match your search — you can always create a custom service.'}
              </li>
            )
          : templates.map(template => (
            <TemplateRow
              key={template.systemKey}
              template={template}
              isAdded={ownedTemplateKeys.has(template.systemKey)}
              isPending={pendingTemplateKey === template.systemKey}
              onAdd={handleAdd}
            />
          ))}
      </ul>

      <div className="p-4">
        <button
          type="button"
          data-testid="library-create-custom"
          onClick={onCreateCustom}
          className="inline-flex items-center gap-1.5 text-[15px] font-medium text-[var(--owner-accent)]"
        >
          <Plus aria-hidden="true" className="size-4" />
          Create custom service
        </button>
      </div>

      {/*
        The counts-and-Done bar. It closes the list rather than floating over
        it: `position: sticky` cannot pin here, because an ancestor of every
        tab (`ServicesModal`'s `flex-1 overflow-y-auto` content region) is an
        overflow container that never scrolls itself — it becomes the sticky
        scrollport and the bar stays put. Pinning it would mean changing chrome
        shared with My Menu, so the same counts are repeated at the top of the
        tab (`library-header-counts`), where they are visible on entry, and the
        bar is last in flow so it can never cover the final row.
      */}
      <div className="mt-auto" />
      <div
        data-testid="library-footer"
        className="flex items-center justify-between gap-3 border-t border-[var(--owner-line)] bg-[var(--owner-surface)] px-4 py-3"
      >
        <p data-testid="library-footer-counts" className="min-w-0 text-[13px] leading-4 text-[var(--owner-muted)]">
          <span className="block font-semibold text-[var(--owner-ink)]">
            {menuCountsLabel}
          </span>
          <span className="block">
            {`${addedInView} of ${templates.length} shown here ${addedInView === 1 ? 'is' : 'are'} already added`}
          </span>
        </p>
        <Button
          type="button"
          variant="ownerPrimary"
          size="pillSm"
          className="min-h-11 shrink-0"
          data-testid="library-done"
          onClick={onDone}
        >
          Done
        </Button>
      </div>

      <BulkAddRecommendedDialog
        isOpen={showBulkAdd}
        ownedTemplateKeys={ownedTemplateKeys}
        busy={bulkAddBusy}
        onClose={() => setShowBulkAdd(false)}
        onConfirm={(templateKeys) => {
          void onBulkAdd(templateKeys).then(() => setShowBulkAdd(false));
        }}
      />
    </div>
  );
}
