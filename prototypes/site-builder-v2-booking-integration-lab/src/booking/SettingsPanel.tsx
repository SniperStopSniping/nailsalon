import { Check, RotateCcw } from 'lucide-react';
import { type ReactNode, useId } from 'react';

import { BOOKING_LAYOUT_META } from './layout-meta';
import {
  createDefaultBookingPresentationSettings,
  replaceActiveLayoutSettings,
  switchBookingLayout,
} from './presentation';
import type {
  BookingMenuLayout,
  BookingSectionPresentationSettings,
} from './types';

export type BookingSettingsPanelProps = {
  allowFeaturedServices?: boolean;
  layoutOnly?: boolean;
  settings: BookingSectionPresentationSettings;
  showIntro?: boolean;
  onChange: (settings: BookingSectionPresentationSettings) => void;
  onLayoutChange?: (layout: BookingMenuLayout) => void;
  onReset?: () => void;
};

type Option<Value extends string> = {
  label: string;
  value: Value;
};

const LAYOUTS = Object.keys(BOOKING_LAYOUT_META) as BookingMenuLayout[];

const TYPOGRAPHY_OPTIONS = [
  { value: 'modern', label: 'Modern' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'soft', label: 'Soft' },
  { value: 'bold', label: 'Bold' },
  { value: 'classic', label: 'Classic' },
] as const;

function LayoutMiniature({ layout }: { layout: BookingMenuLayout }) {
  return (
    <span className={`booking-layout-miniature mini-${layout}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function SegmentedControl<Value extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  wrap = false,
}: {
  ariaLabel: string;
  options: readonly Option<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  wrap?: boolean;
}) {
  return (
    <div
      className={`booking-settings-segments${wrap ? ' is-wrapped' : ''}`}
      aria-label={ariaLabel}
      role="group"
    >
      {options.map(option => (
        <button
          key={option.value}
          className="booking-settings-segment"
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="booking-settings-toggle-row">
      <span>{label}</span>
      <span className="booking-settings-toggle">
        <input
          type="checkbox"
          checked={checked}
          onChange={event => onChange(event.currentTarget.checked)}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

function Control({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="booking-settings-control">
      <span className="booking-settings-control-label">{label}</span>
      {children}
    </div>
  );
}

function LayoutControls({
  allowFeaturedServices = true,
  settings,
  onChange,
}: Pick<BookingSettingsPanelProps, 'allowFeaturedServices' | 'settings' | 'onChange'>) {
  if (settings.layout === 'visual_grid') {
    const options = settings.layoutSettings;
    const update = (patch: Partial<typeof options>) => onChange(
      replaceActiveLayoutSettings(settings, { ...options, ...patch }),
    );
    return (
      <>
        <Control label="Density">
          <SegmentedControl
            ariaLabel="Visual Grid density"
            value={options.density}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'spacious', label: 'Spacious' },
            ]}
            onChange={density => update({ density })}
          />
        </Control>
        <Control label="Images">
          <SegmentedControl
            ariaLabel="Visual Grid image mode"
            value={options.imageMode}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'show', label: 'Show' },
              { value: 'hide', label: 'Hide' },
            ]}
            onChange={imageMode => update({ imageMode })}
          />
        </Control>
        {allowFeaturedServices
          ? (
              <Toggle label="Featured services" checked={options.showFeatured} onChange={showFeatured => update({ showFeatured })} />
            )
          : null}
        <Toggle label="Category pills" checked={options.categoryNavigation === 'pills'} onChange={enabled => update({ categoryNavigation: enabled ? 'pills' : 'none' })} />
        <Toggle label="Short descriptions" checked={options.showDescriptions} onChange={showDescriptions => update({ showDescriptions })} />
      </>
    );
  }

  if (settings.layout === 'clean_list') {
    const options = settings.layoutSettings;
    const update = (patch: Partial<typeof options>) => onChange(
      replaceActiveLayoutSettings(settings, { ...options, ...patch }),
    );
    return (
      <>
        <Control label="Density">
          <SegmentedControl
            ariaLabel="Clean List density"
            value={options.density}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
            onChange={density => update({ density })}
          />
        </Control>
        <Toggle label="Tiny thumbnails" checked={options.showThumbnails} onChange={showThumbnails => update({ showThumbnails })} />
        <Toggle label="Descriptions" checked={options.showDescriptions} onChange={showDescriptions => update({ showDescriptions })} />
        <Toggle label="Category chips" checked={options.categoryNavigation === 'pills'} onChange={enabled => update({ categoryNavigation: enabled ? 'pills' : 'none' })} />
      </>
    );
  }

  if (settings.layout === 'editorial_cards') {
    const options = settings.layoutSettings;
    const update = (patch: Partial<typeof options>) => onChange(
      replaceActiveLayoutSettings(settings, { ...options, ...patch }),
    );
    return (
      <>
        <Control label="Density">
          <SegmentedControl
            ariaLabel="Editorial Cards density"
            value={options.density}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'spacious', label: 'Spacious' },
            ]}
            onChange={density => update({ density })}
          />
        </Control>
        <Control label="Image ratio">
          <SegmentedControl
            ariaLabel="Editorial Cards image ratio"
            value={options.imageShape}
            options={[
              { value: 'landscape', label: 'Landscape' },
              { value: 'portrait', label: 'Portrait' },
              { value: 'adaptive', label: 'Adaptive' },
            ]}
            onChange={imageShape => update({ imageShape })}
          />
        </Control>
        <Control label="Description">
          <SegmentedControl
            ariaLabel="Editorial Cards description length"
            value={options.descriptionLength}
            options={[
              { value: 'short', label: 'Short' },
              { value: 'full', label: 'Full' },
            ]}
            onChange={descriptionLength => update({ descriptionLength })}
          />
        </Control>
        <Control label="Featured treatment">
          <SegmentedControl
            ariaLabel="Editorial Cards featured treatment"
            value={options.featuredTreatment}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'large', label: 'Large' },
            ]}
            onChange={featuredTreatment => update({ featuredTreatment })}
          />
        </Control>
      </>
    );
  }

  if (settings.layout === 'category_menu') {
    const options = settings.layoutSettings;
    const update = (patch: Partial<typeof options>) => onChange(
      replaceActiveLayoutSettings(settings, { ...options, ...patch }),
    );
    return (
      <>
        <Control label="Density">
          <SegmentedControl
            ariaLabel="Category Menu density"
            value={options.density}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
            onChange={density => update({ density })}
          />
        </Control>
        <Control label="Mobile navigation">
          <SegmentedControl
            ariaLabel="Category Menu mobile navigation"
            value={options.mobileNavigation}
            options={[
              { value: 'pills', label: 'Pills' },
              { value: 'tabs', label: 'Tabs' },
              { value: 'accordion', label: 'Accordion' },
            ]}
            onChange={mobileNavigation => update({ mobileNavigation })}
          />
        </Control>
        <Control label="Desktop navigation">
          <SegmentedControl
            ariaLabel="Category Menu desktop navigation"
            value={options.desktopNavigation}
            options={[
              { value: 'sidebar', label: 'Sidebar' },
              { value: 'top', label: 'Top' },
            ]}
            onChange={desktopNavigation => update({ desktopNavigation })}
          />
        </Control>
        <Toggle label="Descriptions" checked={options.showDescriptions} onChange={showDescriptions => update({ showDescriptions })} />
        <Toggle label="Category counts" checked={options.showCategoryCounts} onChange={showCategoryCounts => update({ showCategoryCounts })} />
      </>
    );
  }

  const options = settings.layoutSettings;
  const update = (patch: Partial<typeof options>) => onChange(
    replaceActiveLayoutSettings(settings, { ...options, ...patch }),
  );
  return (
    <>
      <Control label="Density">
        <SegmentedControl
          ariaLabel="Editorial Price List density"
          value={options.density}
          options={[
            { value: 'comfortable', label: 'Standard' },
            { value: 'spacious', label: 'Spacious' },
          ]}
          onChange={density => update({ density })}
        />
      </Control>
      <Toggle label="Category imagery" checked={options.showCategoryImages} onChange={showCategoryImages => update({ showCategoryImages })} />
      <Control label="Description">
        <SegmentedControl
          ariaLabel="Editorial Price List description length"
          value={options.descriptionLength}
          options={[
            { value: 'short', label: 'Short' },
            { value: 'full', label: 'Full' },
          ]}
          onChange={descriptionLength => update({ descriptionLength })}
        />
      </Control>
      <Control label="Divider style">
        <SegmentedControl
          ariaLabel="Editorial Price List divider style"
          value={options.dividerStyle}
          options={[
            { value: 'fine', label: 'Fine' },
            { value: 'strong', label: 'Strong' },
            { value: 'none', label: 'None' },
          ]}
          onChange={dividerStyle => update({ dividerStyle })}
        />
      </Control>
    </>
  );
}

export function BookingSettingsPanel({
  allowFeaturedServices = true,
  layoutOnly = false,
  settings,
  showIntro = true,
  onChange,
  onLayoutChange,
  onReset,
}: BookingSettingsPanelProps) {
  const id = useId();

  const chooseLayout = (layout: BookingMenuLayout) => {
    if (onLayoutChange) {
      onLayoutChange(layout);
      return;
    }
    onChange(switchBookingLayout(settings, layout));
  };

  const updateGlobal = (
    patch: Partial<Pick<
      BookingSectionPresentationSettings,
      'typographyPreset' | 'headingScale' | 'bodyScale' | 'spacing'
    >>,
  ) => onChange({ ...settings, ...patch });

  const reset = () => {
    if (onReset) {
      onReset();
      return;
    }
    onChange(createDefaultBookingPresentationSettings());
  };

  return (
    <div className="booking-settings-panel" data-testid="booking-settings-panel">
      {showIntro
        ? (
            <header className="booking-settings-intro">
              <h2>Booking</h2>
              <p>
                Choose how clients browse your services. You can change this anytime.
                Your services, prices and booking settings stay the same.
              </p>
            </header>
          )
        : null}

      <section aria-labelledby={`${id}-layout-heading`}>
        <h3 id={`${id}-layout-heading`}>Layout</h3>
        <div className="booking-layout-picker">
          {LAYOUTS.map((layout) => {
            const meta = BOOKING_LAYOUT_META[layout];
            return (
              <button
                key={layout}
                className="booking-layout-option"
                type="button"
                aria-pressed={settings.layout === layout}
                data-layout-option={layout}
                onClick={() => chooseLayout(layout)}
              >
                <LayoutMiniature layout={layout} />
                <span className="booking-layout-option-copy">
                  <strong>{meta.shortLabel.toLocaleUpperCase('en-US')}</strong>
                  <span>{meta.description}</span>
                  <small>{meta.recommendation}</small>
                </span>
                <span className="booking-layout-option-check" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>
        <p className="booking-photo-guidance">
          {BOOKING_LAYOUT_META[settings.layout].photoGuidance}
        </p>
      </section>

      {layoutOnly
        ? null
        : (
            <section aria-labelledby={`${id}-type-heading`}>
              <h3 id={`${id}-type-heading`}>Typography</h3>
              <Control label="Preset">
                <select
                  className="booking-settings-select"
                  aria-label="Booking typography preset"
                  value={settings.typographyPreset}
                  onChange={event => updateGlobal({
                    typographyPreset: event.currentTarget.value as BookingSectionPresentationSettings['typographyPreset'],
                  })}
                >
                  {TYPOGRAPHY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Control>
              <Control label="Heading scale">
                <SegmentedControl
                  ariaLabel="Booking heading scale"
                  value={settings.headingScale}
                  options={[
                    { value: 'small', label: 'Small' },
                    { value: 'standard', label: 'Standard' },
                    { value: 'large', label: 'Large' },
                  ]}
                  onChange={headingScale => updateGlobal({ headingScale })}
                />
              </Control>
              <Control label="Body scale">
                <SegmentedControl
                  ariaLabel="Booking body scale"
                  value={settings.bodyScale}
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'large', label: 'Large' },
                  ]}
                  onChange={bodyScale => updateGlobal({ bodyScale })}
                />
              </Control>
              <Control label="Spacing">
                <SegmentedControl
                  ariaLabel="Booking spacing"
                  value={settings.spacing}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'spacious', label: 'Spacious' },
                  ]}
                  onChange={spacing => updateGlobal({ spacing })}
                />
              </Control>
            </section>
          )}

      {layoutOnly
        ? null
        : (
            <section aria-labelledby={`${id}-options-heading`}>
              <h3 id={`${id}-options-heading`}>Layout options</h3>
              <p className="booking-settings-caption">Compatible controls only</p>
              <div className="booking-layout-controls">
                <LayoutControls
                  allowFeaturedServices={allowFeaturedServices}
                  settings={settings}
                  onChange={onChange}
                />
              </div>
            </section>
          )}

      {layoutOnly
        ? null
        : (
            <button className="booking-reset-presentation" type="button" onClick={reset}>
              <RotateCcw aria-hidden="true" size={16} />
              Reset presentation
            </button>
          )}
    </div>
  );
}
