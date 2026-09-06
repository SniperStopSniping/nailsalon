import { fireEvent, render, screen, within } from '@testing-library/react';

import { ServiceLibraryTab } from './ServiceLibraryTab';

function renderTab(overrides: Partial<Parameters<typeof ServiceLibraryTab>[0]> = {}) {
  const props = {
    ownedTemplateKeys: new Set<string>(),
    bulkAddBusy: false,
    menuServiceCount: 8,
    menuAddOnCount: 0,
    onAddTemplate: vi.fn(),
    onBulkAdd: vi.fn().mockResolvedValue(undefined),
    onCreateCustom: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  render(<ServiceLibraryTab {...props} />);
  return props;
}

describe('ServiceLibraryTab', () => {
  it('opens on a titled, explained Popular shelf with a search field', () => {
    renderTab();

    expect(screen.getByRole('heading', { name: 'Service Library' })).toBeInTheDocument();
    expect(screen.getByTestId('service-library-tab')).toHaveTextContent(
      'The same library your onboarding used',
    );
    expect(screen.getByTestId('library-search')).toBeInTheDocument();
    expect(screen.getByTestId('library-chip-popular')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('library-template-luster_manicure')).toBeInTheDocument();
  });

  it('separates services from add-ons with segments instead of one mixed shelf list', () => {
    renderTab();

    // Services segment: no add-on templates.
    expect(screen.getByTestId('library-segment-services')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('library-template-chrome')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-segment-addons'));

    expect(screen.getByTestId('library-segment-addons')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('library-results')).toHaveAttribute('aria-label', 'Library add-ons');
    expect(screen.getByTestId('library-template-chrome')).toBeInTheDocument();
    expect(screen.getByTestId('library-kind-chrome')).toHaveTextContent('Add-on');
    // A base service is not reachable from the Add-ons segment.
    expect(screen.queryByTestId('library-template-luster_manicure')).not.toBeInTheDocument();
    // The rail follows the segment.
    expect(screen.getByTestId('library-chip-all')).toHaveTextContent('All add-ons');
    expect(screen.getByTestId('library-chip-nail_art')).toBeInTheDocument();
    expect(screen.queryByTestId('library-chip-manicure')).not.toBeInTheDocument();
  });

  it('filters the add-on rail by add-on category', () => {
    renderTab();

    fireEvent.click(screen.getByTestId('library-segment-addons'));
    fireEvent.click(screen.getByTestId('library-chip-removal'));

    expect(screen.getByTestId('library-chip-removal')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('library-template-chrome')).not.toBeInTheDocument();
  });

  it('searches the whole segment, not just the shelf the owner happens to be on', () => {
    renderTab();

    // Popular is the open shelf; "gel" must still find gel templates that are
    // not on it.
    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'gel' } });

    expect(screen.getByTestId('library-template-builder_gel_refill')).toBeInTheDocument();
    expect(screen.getByTestId('library-search-summary')).toHaveTextContent('for “gel” in Services');
    // Search results stay inside the active segment.
    expect(screen.queryByTestId('library-template-chrome')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-search-clear'));

    expect(screen.getByTestId('library-search')).toHaveValue('');
    expect(screen.getByTestId('library-chip-popular')).toBeInTheDocument();
  });

  it('shows an explicit Added state instead of an Add control for owned templates', () => {
    renderTab({ ownedTemplateKeys: new Set(['gel_manicure']) });

    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'gel manicure' } });

    const row = screen.getByTestId('library-template-gel_manicure');

    expect(row).toHaveAttribute('data-added', 'true');
    expect(within(row).getByTestId('library-added-gel_manicure')).toHaveTextContent('Added');
    expect(screen.queryByTestId('library-add-gel_manicure')).not.toBeInTheDocument();
  });

  it('names what Add will do, and hands the template back to the host', () => {
    const props = renderTab();

    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'classic pedicure' } });

    expect(screen.getByTestId('library-add-classic_pedicure')).toHaveAccessibleName(
      'Add Classic Pedicure — Regular Polish — review its price and duration',
    );

    fireEvent.click(screen.getByTestId('library-add-classic_pedicure'));

    expect(props.onAddTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ systemKey: 'classic_pedicure' }),
    );
  });

  it('shows the menu counts on entry and again with Done at the end of the list', () => {
    const props = renderTab({
      menuServiceCount: 9,
      menuAddOnCount: 1,
      ownedTemplateKeys: new Set(['luster_manicure']),
    });

    // Counts are visible without scrolling…
    expect(screen.getByTestId('library-header-counts')).toHaveTextContent(
      '9 services · 1 add-on on your menu',
    );
    // …and repeated where the owner leaves the tab.
    expect(screen.getByTestId('library-footer-counts')).toHaveTextContent(
      '9 services · 1 add-on on your menu',
    );
    expect(screen.getByTestId('library-footer-counts')).toHaveTextContent('already added');

    fireEvent.click(screen.getByTestId('library-done'));

    expect(props.onDone).toHaveBeenCalledOnce();
  });

  it('closes the list with the counts bar rather than covering the last row', () => {
    renderTab();

    const results = screen.getByTestId('library-results');
    const footer = screen.getByTestId('library-footer');

    // Last in flow, after the results, so it can never overlay a row.
    expect(results.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(footer).not.toHaveClass('sticky');
  });

  it('returns the results to the top when the shelf changes', () => {
    renderTab();

    const scroller = screen.getByTestId('library-results').parentElement!;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
    scroller.style.overflowY = 'auto';
    scroller.scrollTop = 800;

    fireEvent.click(screen.getByTestId('library-chip-pedicure'));

    expect(scroller.scrollTop).toBe(0);
  });

  it('offers the recommended quick start only on the Popular services shelf', () => {
    renderTab();

    expect(screen.getByTestId('bulk-add-open')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-segment-addons'));

    expect(screen.queryByTestId('bulk-add-open')).not.toBeInTheDocument();
  });

  it('offers a custom service when nothing in the library matches', () => {
    const props = renderTab();

    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'zzzz' } });

    expect(screen.getByTestId('library-empty')).toBeInTheDocument();
    expect(screen.getByTestId('library-search-summary')).toHaveTextContent('0 results');

    fireEvent.click(screen.getByTestId('library-create-custom'));

    expect(props.onCreateCustom).toHaveBeenCalledOnce();
  });
});
