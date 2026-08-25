import type { ReactNode } from 'react';

import { filterServices, formatDuration, formatPrice } from './helpers';
import { getLayoutSettings } from './presentation';
import type {
  BookingMenuLayout,
  BookingSectionPresentationSettings,
  BookingSelection,
  CategoryDefinition,
  MockMenuFixture,
  MockService,
  ServiceCategory,
} from './types';

export type LayoutRenderProps = {
  layout: BookingMenuLayout;
  fixture: MockMenuFixture;
  settings: BookingSectionPresentationSettings;
  selection: BookingSelection;
  activeCategory: ServiceCategory | 'all';
  query: string;
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: ServiceCategory | 'all') => void;
  onOpenDetails: (service: MockService) => void;
};

type LayoutProps = Omit<LayoutRenderProps, 'layout'>;

type CategoryGroup = {
  category: CategoryDefinition;
  services: readonly MockService[];
};

function SearchIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16.25 16.25 4.25 4.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function monogramFor(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase('en-US') || 'I';
}

function categoryLabel(
  fixture: MockMenuFixture,
  category: ServiceCategory | 'all',
): string {
  if (category === 'all') {
    return 'All services';
  }

  return fixture.categories.find(candidate => candidate.id === category)?.label ?? category;
}

function groupedServices(
  fixture: MockMenuFixture,
  services: readonly MockService[],
): readonly CategoryGroup[] {
  return fixture.categories.flatMap((category) => {
    const categoryServices = services.filter(service => service.category === category.id);
    return categoryServices.length > 0 ? [{ category, services: categoryServices }] : [];
  });
}

function descriptionFor(
  service: MockService,
  length: 'short' | 'full',
): string | null {
  return length === 'full'
    ? service.longDescription ?? service.shortDescription
    : service.shortDescription ?? service.longDescription;
}

function serviceCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'service' : 'services'}`;
}

function SearchField({
  query,
  onQueryChange,
}: Pick<LayoutProps, 'query' | 'onQueryChange'>) {
  return (
    <label className="booking-search-field">
      <span className="sr-only">Search services</span>
      <SearchIcon />
      <input
        type="search"
        value={query}
        placeholder="Search services"
        autoComplete="off"
        onChange={event => onQueryChange(event.currentTarget.value)}
      />
      {query.length > 0 && (
        <button
          type="button"
          className="booking-search-clear"
          aria-label="Clear service search"
          onClick={() => onQueryChange('')}
        >
          <CloseIcon />
        </button>
      )}
    </label>
  );
}

function CategoryStrip({
  fixture,
  activeCategory,
  onCategoryChange,
  variant = 'pills',
  showCounts = false,
}: Pick<LayoutProps, 'fixture' | 'activeCategory' | 'onCategoryChange'> & {
  variant?: 'pills' | 'tabs';
  showCounts?: boolean;
}) {
  const options: readonly (CategoryDefinition | { id: 'all'; label: string })[] = [
    { id: 'all', label: 'All' },
    ...fixture.categories,
  ];

  return (
    <div
      className="booking-category-strip"
      data-variant={variant}
      role="group"
      aria-label="Service categories"
    >
      {options.map((category) => {
        const isActive = activeCategory === category.id;
        const count = category.id === 'all'
          ? fixture.services.length
          : fixture.services.filter(service => service.category === category.id).length;
        const visibleLabel = showCounts
          ? `${category.label} · ${count}`
          : category.label;

        return (
          <button
            key={category.id}
            type="button"
            className="booking-category-pill"
            aria-pressed={isActive}
            aria-current={isActive ? 'true' : undefined}
            aria-label={showCounts ? `${category.label}, ${serviceCountLabel(count)}` : category.label}
            onClick={() => onCategoryChange(category.id)}
          >
            {visibleLabel}
          </button>
        );
      })}
    </div>
  );
}

function ServiceMedia({
  service,
  loading = 'lazy',
  decorative = false,
}: {
  service: MockService;
  loading?: 'eager' | 'lazy';
  decorative?: boolean;
}) {
  if (service.image) {
    return (
      // The Lab is a standalone Vite app; Next's Image component is intentionally unavailable.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={service.image.src}
        alt={decorative ? '' : service.image.alt}
        loading={loading}
        decoding="async"
      />
    );
  }

  return (
    <div
      className="booking-missing-image"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : `No service photo available for ${service.name}`}
    >
      <span>Isla studio service</span>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="booking-empty-state" role="status">
      <div>
        <div className="booking-empty-state-icon" aria-hidden="true">
          <SearchIcon />
        </div>
        <h3>No services found</h3>
        <p>
          {query.trim().length > 0
            ? 'Try another search or category.'
            : 'Choose another category to continue browsing.'}
        </p>
      </div>
    </div>
  );
}

function SelectedLabel() {
  return (
    <span className="booking-selected-indicator">
      <CheckIcon />
      Selected
    </span>
  );
}

export function VisualGridLayout(props: LayoutProps) {
  const { fixture, settings, selection, activeCategory, query } = props;
  const layoutSettings = getLayoutSettings(settings, 'visual_grid');
  const filtered = filterServices(fixture.services, { category: activeCategory, query });
  const featured = filtered.filter(service => service.featured);
  const shouldShowMedia = (service: MockService) => {
    if (layoutSettings.imageMode === 'show') {
      return true;
    }

    return layoutSettings.imageMode === 'auto' && Boolean(service.image);
  };

  return (
    <section
      className="visual-grid-layout"
      data-density={layoutSettings.density}
      aria-label="Visual service grid"
    >
      <header className="vg-hero">
        <div>
          <div className="vg-identity">
            <div className="salon-monogram" aria-hidden="true">
              {monogramFor(fixture.salon.name)}
            </div>
            <div>
              <h1>{fixture.salon.name}</h1>
              <p>{fixture.salon.location}</p>
            </div>
          </div>
          <div className="vg-hero-copy">
            <h2>Find your next polished look.</h2>
            <p>{fixture.salon.tagline}</p>
          </div>
        </div>
        <SearchField query={query} onQueryChange={props.onQueryChange} />
      </header>

      {layoutSettings.categoryNavigation === 'pills' && (
        <nav className="vg-nav-wrap" aria-label="Browse service categories">
          <CategoryStrip
            fixture={fixture}
            activeCategory={activeCategory}
            onCategoryChange={props.onCategoryChange}
          />
        </nav>
      )}

      {layoutSettings.showFeatured && featured.length > 0 && (
        <section className="vg-section" aria-labelledby="visual-featured-heading">
          <div className="vg-section-heading">
            <h2 id="visual-featured-heading">Featured services</h2>
            <span>{serviceCountLabel(featured.length)}</span>
          </div>
          <div className="featured-scroller">
            {featured.map((service) => {
              return (
                <button
                  key={service.id}
                  type="button"
                  className="featured-tile"
                  aria-label={`View details for ${service.name}, ${formatDuration(service.durationMinutes)}, ${formatPrice(service.price)}`}
                  onClick={() => props.onOpenDetails(service)}
                >
                  {shouldShowMedia(service) && <ServiceMedia service={service} />}
                  <span className="featured-tile-copy">
                    <small>{service.badge ?? categoryLabel(fixture, service.category)}</small>
                    <strong>{service.name}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="vg-section" aria-labelledby="visual-services-heading">
        <div className="vg-section-heading">
          <h2 id="visual-services-heading">{categoryLabel(fixture, activeCategory)}</h2>
          <span>{serviceCountLabel(filtered.length)}</span>
        </div>
        {filtered.length === 0
          ? <EmptyState query={query} />
          : (
              <div className="vg-grid">
                {filtered.map((service) => {
                  const isSelected = selection.serviceId === service.id;
                  const hasVisibleMedia = shouldShowMedia(service);
                  return (
                    <article
                      key={service.id}
                      className="vg-card"
                      data-has-image={hasVisibleMedia ? 'true' : 'false'}
                      data-selected={isSelected ? 'true' : 'false'}
                    >
                      <button
                        type="button"
                        className="vg-card-entry"
                        aria-label={`${isSelected ? 'Change options for' : 'View details for'} ${service.name}, ${formatDuration(service.durationMinutes)}, ${formatPrice(service.price)}${isSelected ? ', selected' : ''}`}
                        onClick={() => props.onOpenDetails(service)}
                      >
                        {hasVisibleMedia && (
                          <span className="vg-card-media">
                            <ServiceMedia service={service} />
                          </span>
                        )}
                        {isSelected && <SelectedLabel />}
                        <span className="vg-card-copy">
                          <span className="vg-card-name">{service.name}</span>
                          {layoutSettings.showDescriptions && service.shortDescription && (
                            <span className="vg-card-description">{service.shortDescription}</span>
                          )}
                          <span className="vg-card-meta">
                            <span>{formatDuration(service.durationMinutes)}</span>
                            <strong>{formatPrice(service.price)}</strong>
                          </span>
                          <span className="vg-card-detail-action">
                            {isSelected ? 'Change options' : 'View details'}
                            <ArrowIcon />
                          </span>
                        </span>
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
      </section>
    </section>
  );
}

export function CleanListLayout(props: LayoutProps) {
  const { fixture, settings, selection, activeCategory, query } = props;
  const layoutSettings = getLayoutSettings(settings, 'clean_list');
  const filtered = filterServices(fixture.services, { category: activeCategory, query });
  const groups = groupedServices(fixture, filtered);

  return (
    <section
      className="clean-list-layout"
      data-density={layoutSettings.density}
      aria-label="Clean service list"
    >
      <header className="clean-header">
        <div className="clean-identity">
          <div>
            <h1>{fixture.salon.name}</h1>
            <p>{fixture.salon.tagline}</p>
          </div>
          <span className="clean-service-count">{serviceCountLabel(filtered.length)}</span>
        </div>
        <SearchField query={query} onQueryChange={props.onQueryChange} />
      </header>

      {layoutSettings.categoryNavigation === 'pills' && (
        <nav className="clean-nav" aria-label="Browse service categories">
          <CategoryStrip
            fixture={fixture}
            activeCategory={activeCategory}
            onCategoryChange={props.onCategoryChange}
          />
        </nav>
      )}

      <div className="clean-menu">
        {filtered.length === 0
          ? <EmptyState query={query} />
          : groups.map(group => (
            <section key={group.category.id} className="clean-category" aria-labelledby={`clean-${group.category.id}`}>
              <h2 id={`clean-${group.category.id}`} className="clean-category-heading">
                {group.category.label}
                <span>
                  ·
                  {serviceCountLabel(group.services.length)}
                </span>
              </h2>
              {group.services.map((service) => {
                const isSelected = selection.serviceId === service.id;
                return (
                  <article key={service.id} className="clean-row">
                    <div className="clean-main">
                      {layoutSettings.showThumbnails && (
                        <div className="clean-thumbnail">
                          <ServiceMedia service={service} />
                        </div>
                      )}
                      <div className="clean-copy">
                        <div className="clean-title-line">
                          <button
                            type="button"
                            className="clean-title-button"
                            aria-label={`View details for ${service.name}`}
                            style={{ overflowWrap: 'anywhere' }}
                            onClick={() => props.onOpenDetails(service)}
                          >
                            {service.name}
                          </button>
                          {isSelected && <SelectedLabel />}
                        </div>
                        {layoutSettings.showDescriptions && service.shortDescription && (
                          <p>{service.shortDescription}</p>
                        )}
                        <div className="clean-mobile-meta">
                          {formatDuration(service.durationMinutes)}
                          {' · '}
                          {formatPrice(service.price)}
                        </div>
                      </div>
                    </div>
                    <span className="clean-desktop-meta">{formatDuration(service.durationMinutes)}</span>
                    <span className="clean-desktop-meta price">{formatPrice(service.price)}</span>
                    <button
                      type="button"
                      className="clean-detail-button"
                      data-selected={isSelected ? 'true' : 'false'}
                      aria-label={`${isSelected ? 'Change options for' : 'View details for'} ${service.name}`}
                      onClick={() => props.onOpenDetails(service)}
                    >
                      {isSelected ? 'Change' : 'View details'}
                      <ArrowIcon />
                    </button>
                  </article>
                );
              })}
            </section>
          ))}
      </div>
    </section>
  );
}

export function EditorialCardsLayout(props: LayoutProps) {
  const { fixture, settings, selection, activeCategory, query } = props;
  const layoutSettings = getLayoutSettings(settings, 'editorial_cards');
  const filtered = filterServices(fixture.services, { category: activeCategory, query });
  const heroService = filtered.find(service => service.image) ?? filtered[0] ?? fixture.services[0];
  const hasHeroImage = Boolean(heroService?.image);

  return (
    <section
      className="editorial-cards-layout"
      data-density={layoutSettings.density}
      aria-label="Editorial service stories"
    >
      <header className="editorial-hero" data-has-image={hasHeroImage ? 'true' : 'false'}>
        {heroService?.image && <ServiceMedia service={heroService} loading="eager" />}
        <div className="editorial-hero-content">
          <small>
            {fixture.salon.location}
            {' '}
            · Nail atelier
          </small>
          <h1>{fixture.salon.name}</h1>
          <p>{fixture.salon.tagline}</p>
        </div>
      </header>

      <div className="editorial-intro">
        <div>
          <h2>Made to become part of your story.</h2>
          <span>{serviceCountLabel(filtered.length)}</span>
        </div>
        {fixture.menuSize === 'stress_100' && (
          <SearchField query={query} onQueryChange={props.onQueryChange} />
        )}
      </div>

      {filtered.length === 0
        ? <EmptyState query={query} />
        : (
            <div className="editorial-stories">
              {filtered.map((service, index) => {
                const isSelected = selection.serviceId === service.id;
                const description = descriptionFor(service, layoutSettings.descriptionLength);
                const ratio = layoutSettings.imageShape === 'adaptive'
                  ? index % 2 === 0 ? 'portrait' : 'landscape'
                  : layoutSettings.imageShape;
                const featuredTreatment = layoutSettings.featuredTreatment === 'large'
                  && service.featured
                  ? 'large'
                  : 'standard';

                return (
                  <article
                    key={service.id}
                    className="editorial-story"
                    data-featured={featuredTreatment}
                    data-has-image={service.image ? 'true' : 'false'}
                    data-selected={isSelected ? 'true' : 'false'}
                  >
                    {service.image && (
                      <button
                        type="button"
                        className="editorial-story-media"
                        data-ratio={ratio}
                        aria-label={`View details for ${service.name}`}
                        onClick={() => props.onOpenDetails(service)}
                      >
                        <ServiceMedia service={service} />
                        <span className="editorial-story-index" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </button>
                    )}
                    <div className="editorial-story-copy">
                      <small>
                        {categoryLabel(fixture, service.category)}
                        {service.badge ? ` · ${service.badge}` : ''}
                      </small>
                      <h3>{service.name}</h3>
                      {description && <p className="editorial-story-description">{description}</p>}
                      <div className="editorial-story-meta">
                        <span>{formatDuration(service.durationMinutes)}</span>
                        <strong>{formatPrice(service.price)}</strong>
                      </div>
                      {isSelected && <SelectedLabel />}
                      <div className="editorial-story-actions">
                        <button
                          type="button"
                          className={isSelected ? 'customer-secondary-button' : 'customer-primary-button'}
                          aria-label={`${isSelected ? 'Change options for' : 'View details for'} ${service.name}`}
                          onClick={() => props.onOpenDetails(service)}
                        >
                          {isSelected ? 'Change options' : 'View details'}
                          <ArrowIcon />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
    </section>
  );
}

function CategoryAccordionNavigation(props: Pick<LayoutProps, 'fixture' | 'activeCategory' | 'onCategoryChange'> & {
  showCounts: boolean;
}) {
  const options: readonly (CategoryDefinition | { id: 'all'; label: string })[] = [
    { id: 'all', label: 'All services' },
    ...props.fixture.categories,
  ];

  return (
    <div className="category-mobile-nav" data-style="accordion">
      <div className="category-accordions" aria-label="Service categories">
        {options.map((category) => {
          const count = category.id === 'all'
            ? props.fixture.services.length
            : props.fixture.services.filter(service => service.category === category.id).length;
          const isActive = props.activeCategory === category.id;
          return (
            <details
              key={category.id}
              className="category-accordion"
              open={isActive}
              onToggle={(event) => {
                if (event.currentTarget.open && !isActive) {
                  props.onCategoryChange(category.id);
                } else if (!event.currentTarget.open && isActive) {
                  event.currentTarget.open = true;
                }
              }}
            >
              <summary
                aria-current={isActive ? 'true' : undefined}
              >
                {category.label}
                <span>{props.showCounts ? serviceCountLabel(count) : isActive ? 'Showing' : 'View'}</span>
              </summary>
              {isActive && (
                <div
                  aria-live="polite"
                  style={{ padding: '0 15px 13px', color: 'var(--booking-muted)', fontSize: 'var(--body-caption)' }}
                >
                  Showing this category below.
                </div>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryMenuLayout(props: LayoutProps) {
  const { fixture, settings, selection, activeCategory, query } = props;
  const layoutSettings = getLayoutSettings(settings, 'category_menu');
  const filtered = filterServices(fixture.services, { category: activeCategory, query });
  const activeLabel = categoryLabel(fixture, activeCategory);

  return (
    <section
      className="category-menu-layout"
      data-density={layoutSettings.density}
      aria-label="Category service menu"
    >
      <header className="category-menu-header">
        <div className="category-menu-brand">
          <span>{fixture.salon.name}</span>
          <span>{fixture.salon.location}</span>
        </div>
        <div>
          <h1>Services</h1>
          <p>Navigate the studio menu by category, then choose the service that fits.</p>
        </div>
        <SearchField query={query} onQueryChange={props.onQueryChange} />
      </header>

      {layoutSettings.mobileNavigation === 'accordion'
        ? (
            <CategoryAccordionNavigation
              fixture={fixture}
              activeCategory={activeCategory}
              onCategoryChange={props.onCategoryChange}
              showCounts={layoutSettings.showCategoryCounts}
            />
          )
        : (
            <nav
              className="category-mobile-nav"
              data-style={layoutSettings.mobileNavigation}
              aria-label="Browse service categories"
            >
              <CategoryStrip
                fixture={fixture}
                activeCategory={activeCategory}
                onCategoryChange={props.onCategoryChange}
                variant={layoutSettings.mobileNavigation}
                showCounts={layoutSettings.showCategoryCounts}
              />
            </nav>
          )}

      <div className="category-workspace" data-desktop-nav={layoutSettings.desktopNavigation}>
        <nav className="category-sidebar" aria-label="Service category navigation">
          <p className="category-sidebar-label">Service menu</p>
          {([{ id: 'all', label: 'All services' }, ...fixture.categories] as const).map((category) => {
            const count = category.id === 'all'
              ? fixture.services.length
              : fixture.services.filter(service => service.category === category.id).length;
            const isActive = activeCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                className="category-sidebar-button"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => props.onCategoryChange(category.id)}
              >
                {category.label}
                {layoutSettings.showCategoryCounts && <span>{count}</span>}
              </button>
            );
          })}
        </nav>

        <section className="category-results" aria-labelledby="category-results-heading">
          <div className="category-result-heading">
            <div>
              <small>{query.trim() ? 'Filtered menu' : 'Service category'}</small>
              <h2 id="category-results-heading">{activeLabel}</h2>
            </div>
            <span>{serviceCountLabel(filtered.length)}</span>
          </div>
          {filtered.length === 0
            ? <EmptyState query={query} />
            : filtered.map((service, index) => {
              const isSelected = selection.serviceId === service.id;
              return (
                <button
                  key={service.id}
                  type="button"
                  className="category-service-row"
                  data-selected={isSelected ? 'true' : 'false'}
                  aria-label={`${isSelected ? 'Change options for' : 'View details for'} ${service.name}, ${formatDuration(service.durationMinutes)}, ${formatPrice(service.price)}${isSelected ? ', selected' : ''}`}
                  onClick={() => props.onOpenDetails(service)}
                >
                  <span className="category-row-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="category-row-copy">
                    <span className="category-row-title">
                      <span>{service.name}</span>
                      {isSelected && <SelectedLabel />}
                    </span>
                    {layoutSettings.showDescriptions && service.shortDescription && (
                      <span className="category-row-description">{service.shortDescription}</span>
                    )}
                    <span className="category-row-meta">
                      {formatDuration(service.durationMinutes)}
                      {' · '}
                      {formatPrice(service.price)}
                    </span>
                  </span>
                  <span className="category-desktop-meta clean-desktop-meta">
                    {formatDuration(service.durationMinutes)}
                  </span>
                  <span className="category-desktop-meta clean-desktop-meta price">
                    {formatPrice(service.price)}
                  </span>
                  <span className="category-detail-action">
                    {isSelected ? 'Change' : 'View details'}
                    <ArrowIcon />
                  </span>
                </button>
              );
            })}
        </section>
      </div>
    </section>
  );
}

function CategoryCover({ group }: { group: CategoryGroup }) {
  const coverService = group.services.find(service => service.image);
  if (!coverService) {
    return null;
  }

  return (
    <div className="category-cover">
      <ServiceMedia service={coverService} decorative />
    </div>
  );
}

export function EditorialPriceListLayout(props: LayoutProps) {
  const { fixture, settings, selection, activeCategory, query } = props;
  const layoutSettings = getLayoutSettings(settings, 'editorial_price_list');
  const filtered = filterServices(fixture.services, { category: activeCategory, query });
  const groups = groupedServices(fixture, filtered);

  return (
    <section
      className="price-list-layout"
      data-density={layoutSettings.density}
      data-divider={layoutSettings.dividerStyle}
      aria-label="Editorial service price list"
    >
      <header className="price-list-masthead">
        <div className="price-list-seal" aria-hidden="true">
          {monogramFor(fixture.salon.name)}
        </div>
        <small>
          {fixture.salon.location}
          {' '}
          · Service menu
        </small>
        <h1>{fixture.salon.name}</h1>
        <p>{fixture.salon.tagline}</p>
      </header>

      {fixture.menuSize === 'stress_100' && (
        <div className="price-list-search">
          <SearchField query={query} onQueryChange={props.onQueryChange} />
        </div>
      )}

      {filtered.length === 0
        ? <EmptyState query={query} />
        : (
            <div className="price-list-content">
              {groups.map((group, groupIndex) => (
                <section
                  key={group.category.id}
                  className="price-category"
                  aria-labelledby={`price-${group.category.id}`}
                >
                  <div className="price-category-heading">
                    <span className="price-category-number" aria-hidden="true">
                      {String(groupIndex + 1).padStart(2, '0')}
                    </span>
                    <h2 id={`price-${group.category.id}`}>{group.category.label}</h2>
                    <span>{serviceCountLabel(group.services.length)}</span>
                  </div>
                  {layoutSettings.showCategoryImages && <CategoryCover group={group} />}
                  <div className="price-services">
                    {group.services.map((service) => {
                      const isSelected = selection.serviceId === service.id;
                      const description = descriptionFor(service, layoutSettings.descriptionLength);
                      return (
                        <button
                          key={service.id}
                          type="button"
                          className="price-service"
                          data-selected={isSelected ? 'true' : 'false'}
                          aria-label={`View ${service.name} details, ${formatDuration(service.durationMinutes)}, ${formatPrice(service.price)}${isSelected ? ', selected' : ''}`}
                          onClick={() => props.onOpenDetails(service)}
                        >
                          <span>
                            <span className="price-service-name" style={{ display: 'block' }}>{service.name}</span>
                            {description && (
                              <span className="price-service-description" style={{ display: 'block' }}>
                                {description}
                              </span>
                            )}
                            <span className="price-service-duration" style={{ display: 'block' }}>
                              {formatDuration(service.durationMinutes)}
                            </span>
                            {isSelected && (
                              <span className="price-selected-label">
                                <CheckIcon />
                                {' '}
                                Selected
                              </span>
                            )}
                          </span>
                          <span className="price-service-trailing">
                            <span className="price-service-price">{formatPrice(service.price)}</span>
                            <span className="price-service-affordance">
                              {isSelected ? 'Change' : 'View details'}
                              <ArrowIcon />
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
    </section>
  );
}

const LAYOUT_RENDERERS: Record<BookingMenuLayout, (props: LayoutProps) => ReactNode> = {
  visual_grid: VisualGridLayout,
  clean_list: CleanListLayout,
  editorial_cards: EditorialCardsLayout,
  category_menu: CategoryMenuLayout,
  editorial_price_list: EditorialPriceListLayout,
};

export function BookingLayout({ layout, ...props }: LayoutRenderProps) {
  const Renderer = LAYOUT_RENDERERS[layout];
  return <Renderer {...props} />;
}
