'use client';

/**
 * Owner-facing Service Library: browse the global template catalog and add
 * services to the salon's own menu. Templates are configuration data, so the
 * UI is compact list rows (no image cards) built for scanning speed.
 */

import { Check, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import {
  getStarterTemplates,
  getTemplatesByLibraryCategory,
  searchTemplates,
  SERVICE_TEMPLATE_CATEGORIES,
  type ServiceTemplate,
  type ServiceTemplateCategory,
} from '@/libs/serviceTemplateCatalog';
import { formatDuration } from '@/utils/Helpers';

const CATEGORY_LABELS: Record<ServiceTemplateCategory, string> = {
  popular: 'Popular',
  gel_natural: 'Gel & Natural',
  extensions: 'Extensions',
  pedicure: 'Pedicures',
  combos: 'Combos',
  nail_art: 'Add-ons',
  removal_repair: 'Removal',
  spa: 'Spa',
  acrylic_dip: 'Acrylic & Dip',
};

function formatTemplatePrice(template: ServiceTemplate): string {
  return template.priceDisplayText ?? `$${(template.defaultPriceCents / 100).toFixed(0)}`;
}

function TemplateRow({
  template,
  isAdded,
  onAdd,
}: {
  template: ServiceTemplate;
  isAdded: boolean;
  onAdd: (template: ServiceTemplate) => void;
}) {
  return (
    <div
      data-testid={`library-template-${template.systemKey}`}
      className="flex min-h-[56px] items-center gap-3 border-b border-gray-100 px-4 py-2.5 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-[#1C1C1E]">{template.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[#8E8E93]">
          <span>{formatTemplatePrice(template)}</span>
          <span>·</span>
          <span>{formatDuration(template.defaultDurationMinutes)}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px]">
            {template.serviceType === 'addon' ? 'Add-on' : CATEGORY_LABELS[template.templateCategory]}
          </span>
        </div>
        {template.description && (
          <div className="mt-0.5 truncate text-[12px] text-[#8E8E93]">{template.description}</div>
        )}
      </div>
      {isAdded
        ? (
            <span
              data-testid={`library-added-${template.systemKey}`}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700"
            >
              <Check className="size-3.5" />
              Added
            </span>
          )
        : (
            <Button
              type="button"
              variant="brandSoft"
              size="pillSm"
              data-testid={`library-add-${template.systemKey}`}
              onClick={() => onAdd(template)}
            >
              Add
            </Button>
          )}
    </div>
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
  const selectedKeys = selectable
    .filter(template => !unchecked.has(template.systemKey))
    .map(template => template.systemKey);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[85dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[#1C1C1E]">Add recommended services</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            {selectedKeys.length}
            {' '}
            services and add-ons will be created on your menu. Uncheck anything you don’t offer —
            every price and duration stays editable afterwards.
          </p>
        </div>

        <div className="max-h-[45dvh] space-y-1 overflow-y-auto rounded-2xl border border-gray-200 p-2">
          {starters.map((template) => {
            const alreadyAdded = ownedTemplateKeys.has(template.systemKey);
            return (
              <label
                key={template.systemKey}
                className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${alreadyAdded ? 'opacity-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-[#1C1C1E]">{template.name}</span>
                  <span className="block text-[12px] text-[#8E8E93]">
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
              : `Add ${selectedKeys.length} to menu`}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

export function ServiceLibraryTab({
  ownedTemplateKeys,
  bulkAddBusy,
  onAddTemplate,
  onBulkAdd,
  onCreateCustom,
}: {
  ownedTemplateKeys: Set<string>;
  bulkAddBusy: boolean;
  onAddTemplate: (template: ServiceTemplate) => void;
  onBulkAdd: (templateKeys: string[]) => Promise<void>;
  onCreateCustom: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ServiceTemplateCategory>('popular');
  const [showBulkAdd, setShowBulkAdd] = useState(false);

  const trimmedQuery = query.trim();
  const templates = trimmedQuery
    ? searchTemplates(trimmedQuery)
    : getTemplatesByLibraryCategory(activeCategory);

  return (
    <div data-testid="service-library-tab">
      <div className="px-4 pb-1 pt-2">
        <p className="text-sm text-[#6B7280]">Choose from popular services or create your own.</p>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8E8E93]" />
          <input
            type="search"
            data-testid="library-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search services (try “BIAB” or “shellac”)"
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-rose-700"
          />
        </div>
      </div>

      {!trimmedQuery && (
        <div className="px-4 pb-2 pt-1">
          <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">
            {SERVICE_TEMPLATE_CATEGORIES.map(category => (
              <button
                key={category}
                type="button"
                data-testid={`library-chip-${category}`}
                onClick={() => setActiveCategory(category)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-all ${
                  activeCategory === category
                    ? 'bg-rose-800 text-white shadow-sm'
                    : 'border border-gray-200 bg-white text-[#1C1C1E]'
                }`}
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeCategory === 'popular' && !trimmedQuery && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[18px] border border-rose-100 bg-white p-4 shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-[#1C1C1E]">
              <Sparkles className="size-4 text-rose-700" />
              Recommended quick start
            </div>
            <p className="mt-0.5 text-[13px] text-[#6B7280]">
              Add the full recommended menu in one go — no acrylic, everything editable.
            </p>
          </div>
          <Button
            type="button"
            variant="brand"
            size="pillSm"
            data-testid="bulk-add-open"
            onClick={() => setShowBulkAdd(true)}
          >
            Add recommended
          </Button>
        </div>
      )}

      {activeCategory === 'acrylic_dip' && !trimmedQuery && (
        <p className="mx-4 mb-2 text-[12px] text-[#8E8E93]">Traditional enhancement services</p>
      )}

      <div className="mx-4 overflow-hidden rounded-[10px] bg-white shadow-sm">
        {templates.length === 0
          ? (
              <div className="px-4 py-8 text-center text-sm text-[#8E8E93]">
                No templates match your search — you can always create a custom service.
              </div>
            )
          : templates.map(template => (
            <TemplateRow
              key={template.systemKey}
              template={template}
              isAdded={ownedTemplateKeys.has(template.systemKey)}
              onAdd={onAddTemplate}
            />
          ))}
      </div>

      <div className="p-4">
        <button
          type="button"
          data-testid="library-create-custom"
          onClick={onCreateCustom}
          className="inline-flex items-center gap-1.5 text-[15px] font-medium text-rose-800"
        >
          <Plus className="size-4" />
          Create custom service
        </button>
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
