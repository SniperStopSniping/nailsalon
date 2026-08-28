import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';

import type { ResolveCustomDesignAction } from '../components/view-types';
import type {
  CustomDesignAction,
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignSettings,
} from '../model/types';
import { ActionEditor } from './ActionEditor';
import { CustomDesignOwnerEditor } from './CustomDesignOwnerEditor';
import { CustomDesignSectionCard } from './CustomDesignSectionCard';
import { HotspotEditor } from './HotspotEditor';
import {
  getCustomDesignImageAccessibilityStatus,
  getCustomDesignOwnerIdentity,
} from './owner-identity';

const installBrowserStubs = (): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    matches: query.includes('min-width: 900px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
};

const makeArea = (
  id = 'area-1',
  overrides: Partial<CustomDesignInteractiveArea> = {},
): CustomDesignInteractiveArea => ({
  id,
  accessibleLabel: 'Book this service',
  action: { type: 'start_booking' },
  geometry: { x: 10, y: 10, width: 30, height: 12 },
  labelConfirmed: true,
  reviewStatus: 'approved',
  semanticOrder: 0,
  validationStatus: 'valid',
  ...overrides,
});

const makeImage = (
  id: string,
  overrides: Partial<CustomDesignImageItem> = {},
): CustomDesignImageItem => ({
  id,
  altText: '',
  aspectRatio: 0.5,
  assetId: `asset-${id}`,
  decorative: false,
  fileName: `${id}.png`,
  fileSize: 3_000,
  height: 2_000,
  interactiveAreas: [],
  mimeType: 'image/png',
  width: 1_000,
  ...overrides,
});

const makeSettings = (
  overrides: Partial<CustomDesignSettings> = {},
): CustomDesignSettings => ({
  background: { mode: 'site' },
  cta: { type: 'none' },
  displayMode: 'poster',
  gap: 'comfortable',
  images: [],
  schemaVersion: 1,
  ...overrides,
});

const assets = {
  'asset-page-1': {
    status: 'ready' as const,
    thumbnailUrl: 'blob:https://luster.test/thumb-1',
    url: 'blob:https://luster.test/page-1',
  },
  'asset-page-2': {
    status: 'ready' as const,
    url: 'blob:https://luster.test/page-2',
  },
};

const unresolvedAction: ResolveCustomDesignAction = () => ({
  status: 'unresolved',
  reason: 'invalid_destination',
});

afterEach(() => {
  document.body.style.removeProperty('overflow');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Custom Design owner identity and empty card', () => {
  it('uses concise Empty and image-count identities', () => {
    expect(getCustomDesignOwnerIdentity(makeSettings()).longDescription).toBe('Empty');
    expect(getCustomDesignOwnerIdentity(makeSettings({ images: [makeImage('page-1')] })))
      .toMatchObject({ longDescription: '1 image · Poster', shortDescription: '1 image' });
    expect(getCustomDesignImageAccessibilityStatus(makeImage('page-1')))
      .toBe('Needs alt text');
    expect(getCustomDesignImageAccessibilityStatus(makeImage('page-1', {
      decorative: true,
    }))).toBe('Decorative');
  });

  it('shows the exact owner-only upload state and emits a multi-file operation', async () => {
    installBrowserStubs();
    const onChooseImages = vi.fn();
    const user = userEvent.setup();
    render(
      <CustomDesignSectionCard
        assets={{}}
        onChooseImages={onChooseImages}
        onEdit={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
        onReplaceImage={vi.fn()}
        onSelect={vi.fn()}
        onToggleVisible={vi.fn()}
        order={4}
        resolveAction={unresolvedAction}
        sectionId="custom-1"
        selected
        settings={makeSettings()}
        visible
      />,
    );

    expect(screen.getByRole('heading', { name: 'Upload your design' })).toBeVisible();
    expect(screen.getByRole('listitem', { name: 'Section 4: Custom Design' }))
      .toHaveAttribute('data-section-instance-id', 'custom-1');
    expect(screen.getByText('Add one image or several pages from Canva, Adobe Express, Picsart, or your designer.')).toBeVisible();
    expect(screen.getByText('PNG, JPG, or WebP')).toBeVisible();
    expect(screen.getByText('Your design will be full width on phones and centred on larger screens by default.')).toBeVisible();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    expect(input?.parentElement).toBe(screen.getByText('Choose images'));
    input?.focus();
    expect(input).toHaveFocus();
    const files = [
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.webp', { type: 'image/webp' }),
    ];
    await user.upload(input as HTMLInputElement, files);
    expect(onChooseImages).toHaveBeenCalledWith(files);
  });

  it('retains missing image metadata and exposes Replace recovery', () => {
    installBrowserStubs();
    render(
      <CustomDesignSectionCard
        assets={{ 'asset-page-1': { status: 'missing' } }}
        onChooseImages={vi.fn()}
        onEdit={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
        onReplaceImage={vi.fn()}
        onSelect={vi.fn()}
        onToggleVisible={vi.fn()}
        order={1}
        resolveAction={unresolvedAction}
        sectionId="custom-1"
        selected={false}
        settings={makeSettings({
          images: [makeImage('page-1', { interactiveAreas: [makeArea()] })],
        })}
        visible
      />,
    );
    expect(screen.getByText('This design file isn’t available in this browser.')).toBeVisible();
    expect(screen.getByText(/Your labels, links, and settings are still saved/)).toBeVisible();
    expect(screen.getByText(/page-1.png · 1000 × 2000px · 1 link area/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace image' })).toBeEnabled();
  });
});

describe('ActionEditor structured actions', () => {
  const cases: readonly [string, CustomDesignAction][] = [
    ['Start booking', { type: 'start_booking' }],
    ['Location / directions', { type: 'directions', destination: { address: '100 King St W' } }],
    ['Instagram', { type: 'instagram', destination: { username: 'luster.nails' } }],
    ['Website', { type: 'website', destination: { url: 'https://example.com/' } }],
    ['Call', { type: 'call', destination: { phoneNumber: '+14165550123' } }],
    ['Text', { type: 'text', destination: { phoneNumber: '+14165550123' } }],
    ['Email', { type: 'email', destination: { email: 'hello@example.com' } }],
    ['Internal Luster page or section', { type: 'internal', destination: { pageId: 'page-about' } }],
    ['Custom safe URL', { type: 'custom_url', destination: { url: 'https://example.com/policies' } }],
  ];

  it.each(cases)('preserves %s as a structured validated action', (label, action) => {
    const onChange = vi.fn();
    render(
      <ActionEditor
        action={action}
        internalTargets={[{
          id: 'page-about',
          label: 'About',
          sections: [],
          visible: true,
        }]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'What should happen?' }))
      .toHaveValue(action.type);
    expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('contact_me');
  });

  it('emits null for an unsafe URL without replacing local owner input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ActionEditor
        action={{ type: 'website', destination: { url: 'https://example.com/' } }}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Secure URL' });
    await user.clear(input);
    await user.type(input, 'javascript:alert(1)');
    expect(input).toHaveValue('javascript:alert(1)');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Enter a complete, safe destination.')).toBeVisible();
  });
});

describe('CustomDesignOwnerEditor', () => {
  it('exposes typed values for every native display, spacing, and background radio', () => {
    installBrowserStubs();
    render(
      <CustomDesignOwnerEditor
        assets={assets}
        onAddImages={vi.fn()}
        onCommitImageOrder={vi.fn()}
        onEditAreas={vi.fn()}
        onRemoveImage={vi.fn()}
        onReplaceImage={vi.fn()}
        onUpdateAccessibility={vi.fn()}
        onUpdateBackground={vi.fn()}
        onUpdateCta={vi.fn()}
        onUpdateDisplay={vi.fn()}
        onUpdateGap={vi.fn()}
        settings={makeSettings({ images: [makeImage('page-1')] })}
      />,
    );

    const valuesByName = new Map(
      screen.getAllByRole<HTMLInputElement>('radio').map(radio => [
        radio.getAttribute('aria-label') ?? radio.parentElement?.textContent?.trim(),
        radio.value,
      ]),
    );
    expect([...valuesByName.values()]).toEqual([
      'poster',
      'contained',
      'full_width',
      'seamless',
      'small',
      'comfortable',
      'site',
      'transparent',
      'custom',
    ]);
    expect([...valuesByName.values()]).not.toContain('on');
  });

  it('keeps reorder changes local until Save order and exposes complete row metadata', async () => {
    installBrowserStubs();
    const user = userEvent.setup();
    const onCommitImageOrder = vi.fn();
    render(
      <CustomDesignOwnerEditor
        assets={assets}
        onAddImages={vi.fn()}
        onCommitImageOrder={onCommitImageOrder}
        onEditAreas={vi.fn()}
        onRemoveImage={vi.fn()}
        onReplaceImage={vi.fn()}
        onUpdateAccessibility={vi.fn()}
        onUpdateBackground={vi.fn()}
        onUpdateCta={vi.fn()}
        onUpdateDisplay={vi.fn()}
        onUpdateGap={vi.fn()}
        settings={makeSettings({
          images: [
            makeImage('page-1', { altText: 'About the artist', interactiveAreas: [makeArea()] }),
            makeImage('page-2'),
          ],
        })}
      />,
    );

    expect(screen.queryByText('About the artist', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('Alt text added · 1 link area')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Move page 1 down' }));
    expect(onCommitImageOrder).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save order' }));
    expect(onCommitImageOrder).toHaveBeenCalledWith(['page-2', 'page-1']);
  });

  it('commits accessibility once through the existing modal lifecycle', async () => {
    installBrowserStubs();
    const user = userEvent.setup();
    const onUpdateAccessibility = vi.fn();
    render(
      <CustomDesignOwnerEditor
        assets={assets}
        onAddImages={vi.fn()}
        onCommitImageOrder={vi.fn()}
        onEditAreas={vi.fn()}
        onRemoveImage={vi.fn()}
        onReplaceImage={vi.fn()}
        onUpdateAccessibility={onUpdateAccessibility}
        onUpdateBackground={vi.fn()}
        onUpdateCta={vi.fn()}
        onUpdateDisplay={vi.fn()}
        onUpdateGap={vi.fn()}
        settings={makeSettings({ images: [makeImage('page-1')] })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accessibility' }));
    const dialog = screen.getByRole('dialog', { name: 'Accessibility' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Decorative image' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Accessible text version' }), 'Policy text.');
    await user.click(within(dialog).getByRole('button', { name: 'Save accessibility' }));
    expect(onUpdateAccessibility).toHaveBeenCalledTimes(1);
    expect(onUpdateAccessibility).toHaveBeenCalledWith('page-1', {
      accessibleSummary: 'Policy text.',
      altText: '',
      decorative: true,
    });
  });
});

describe('HotspotEditor bounded session', () => {
  it('cancels without committing and commits one complete session on Done', async () => {
    installBrowserStubs();
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const image = makeImage('page-1', { interactiveAreas: [makeArea()] });
    const { rerender } = render(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={image}
        onCancel={onCancel}
        onCommit={onCommit}
        open
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    rerender(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={image}
        onCancel={onCancel}
        onCommit={onCommit}
        open
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('page-1', [expect.objectContaining({
      id: 'area-1',
      accessibleLabel: 'Book this service',
      validationStatus: 'valid',
    })]);
  });

  it('blocks overlap and review states, then allows explicit review approval', async () => {
    installBrowserStubs();
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const image = makeImage('page-1', {
      interactiveAreas: [
        makeArea('area-1', {
          reviewStatus: 'needs_review',
          reviewReason: 'aspect_ratio_changed',
        }),
        makeArea('area-2', {
          accessibleLabel: 'Directions',
          geometry: { x: 20, y: 15, width: 30, height: 12 },
          semanticOrder: 1,
        }),
      ],
    });
    render(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={image}
        onCancel={vi.fn()}
        onCommit={onCommit}
        open
      />,
    );
    expect(screen.getByText(
      'Book this service overlaps Directions. Move or resize one area.',
    )).toBeVisible();
    expect(screen.getByText(/still needs its position reviewed/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Approve this position' }));
    expect(screen.queryByText(/still needs its position reviewed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('gates the documented near-full rectangle while allowing the boundary below it', () => {
    installBrowserStubs();
    const onCommit = vi.fn();
    const { rerender } = render(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={makeImage('page-2', {
          interactiveAreas: [makeArea('area-full', {
            geometry: { x: 0, y: 0, width: 95, height: 95 },
          })],
        })}
        onCancel={vi.fn()}
        onCommit={onCommit}
        open
      />,
    );
    expect(screen.getByText(
      'Book this service cannot cover nearly the whole image.',
    )).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();

    rerender(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={makeImage('page-1', {
          interactiveAreas: [makeArea('area-safe-boundary', {
            geometry: { x: 0, y: 0, width: 94.99, height: 100 },
          })],
        })}
        onCancel={vi.fn()}
        onCommit={onCommit}
        open
      />,
    );
    expect(screen.queryByText(/cannot cover nearly the whole image/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('stages a resize that becomes unsafe, blocks Done, and permits an explicit fix', async () => {
    installBrowserStubs();
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const rect = {
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect as DOMRect);
    render(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={makeImage('page-1', {
          interactiveAreas: [makeArea('area-resize', {
            geometry: { x: 0, y: 0, width: 94, height: 94 },
          })],
        })}
        onCancel={vi.fn()}
        onCommit={onCommit}
        open
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Design being edited' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Make Book this service wider' }));
    await user.click(screen.getByRole('button', { name: 'Make Book this service taller' }));
    expect(screen.getByText(
      'Book this service cannot cover nearly the whole image.',
    )).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Make Book this service shorter' }));
    expect(screen.queryByText(/cannot cover nearly the whole image/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('stages an overlapping keyboard move and accepts exact edge contact after correction', () => {
    installBrowserStubs();
    const onCommit = vi.fn();
    const rect = {
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect as DOMRect);
    render(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={makeImage('page-1', {
          interactiveAreas: [
            makeArea('area-first', {
              accessibleLabel: 'First action',
              geometry: { x: 0, y: 0, width: 20, height: 20 },
            }),
            makeArea('area-second', {
              accessibleLabel: 'Second action',
              geometry: { x: 30, y: 0, width: 20, height: 20 },
              semanticOrder: 1,
            }),
          ],
        })}
        onCancel={vi.fn()}
        onCommit={onCommit}
        open
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Design being edited' }));
    const moveFirst = screen.getByRole('button', {
      name: 'Move clickable area: First action',
    });
    for (let index = 0; index < 11; index += 1) {
      fireEvent.keyDown(moveFirst, { key: 'ArrowRight' });
    }
    expect(screen.getByText(
      'First action overlaps Second action. Move or resize one area.',
    )).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(moveFirst, { key: 'ArrowLeft' });
    expect(screen.queryByText(/First action overlaps Second action/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('warns for the phone rendition without enlarging desktop geometry', async () => {
    installBrowserStubs();
    const rect = {
      bottom: 1_560,
      height: 1_560,
      left: 0,
      right: 780,
      top: 0,
      width: 780,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect as DOMRect);
    render(
      <HotspotEditor
        asset={assets['asset-page-1']}
        image={makeImage('page-1', {
          interactiveAreas: [makeArea('area-small', {
            geometry: { x: 10, y: 10, width: 10, height: 10 },
          })],
        })}
        onCancel={vi.fn()}
        onCommit={vi.fn()}
        open
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Design being edited' }));
    await waitFor(() => expect(screen.getByText(/This link may be difficult to tap on phones/)).toBeVisible());
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('preserves saved metadata but suppresses Done when the underlying asset is missing', () => {
    installBrowserStubs();
    render(
      <HotspotEditor
        asset={{ status: 'missing' }}
        image={makeImage('page-1', { interactiveAreas: [makeArea()] })}
        onCancel={vi.fn()}
        onCommit={vi.fn()}
        open
      />,
    );
    expect(screen.getByText(/Replace it before editing link positions/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });
});
