import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { vi } from 'vitest';

import {
  calculateDisplayGeometry,
  CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX,
  resolveCustomDesignAction,
  resolveNativeCtaAction,
} from '../model';
import type {
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignSettings,
} from '../model/types';
import { AccessibilitySummary } from './AccessibilitySummary';
import { CustomDesignRenderer } from './CustomDesignRenderer';
import { OwnerMissingAsset } from './MissingAsset';
import { OwnerThumbnail } from './OwnerThumbnail';
import { isSafeRenderedHref, SemanticAction } from './SemanticAction';
import type {
  ResolveCustomDesignAction,
  ResolveCustomDesignAsset,
} from './view-types';

const makeArea = (
  overrides: Partial<CustomDesignInteractiveArea> = {},
): CustomDesignInteractiveArea => ({
  id: 'area-1',
  accessibleLabel: 'Visit the nail studio website',
  action: {
    type: 'website',
    destination: { url: 'https://example.com/' },
  },
  geometry: { x: 10, y: 20, width: 30, height: 12 },
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
  accessibleSummary: `Important policies for ${id}.`,
  altText: `Branded policy page ${id}`,
  aspectRatio: 0.5,
  assetId: `asset-${id}`,
  decorative: false,
  fileName: `${id}.png`,
  fileSize: 2_048,
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
  images: [makeImage('page-1')],
  schemaVersion: 1,
  ...overrides,
});

const readyAsset: ResolveCustomDesignAsset = assetId => ({
  status: 'ready',
  url: `blob:https://luster.test/${assetId}`,
});

const actionContext = {
  bookingHref: '#booking',
  contactHref: '/contact',
  resolveInternalHref: (pageId: string, sectionId?: string) =>
    `/pages/${pageId}${sectionId ? `#${sectionId}` : ''}`,
};

const resolveAction: ResolveCustomDesignAction = (action, source) =>
  source.type === 'cta'
    ? resolveNativeCtaAction(source.cta, actionContext)
    : resolveCustomDesignAction(action, actionContext);

const dispatchPointer = (
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: MouseEventInit & { pointerId: number; isPrimary?: boolean },
) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperties(event, {
    isPrimary: { value: init.isPrimary ?? true },
    pointerId: { value: init.pointerId },
  });
  fireEvent(target, event);
};

const finishImageLoad = (accessibleName: string): HTMLImageElement => {
  const image = screen.getByRole('img', { name: accessibleName });
  fireEvent.load(image);
  return image as HTMLImageElement;
};

describe('Custom Design customer renderer', () => {
  it.each([
    ['poster', 'seamless'],
    ['contained', 'small'],
    ['full_width', 'comfortable'],
  ] as const)('exposes %s with %s as bounded renderer states', (displayMode, gap) => {
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({ displayMode, gap })}
      />,
    );
    const section = screen.getByTestId('custom-design-customer-renderer');

    expect(section).toHaveAttribute('data-display-mode', displayMode);
    expect(section).toHaveAttribute('data-gap', gap);
  });

  it('shares one canonical default Poster maximum with pure geometry', () => {
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({ displayMode: 'poster' })}
      />,
    );

    expect(screen.getByTestId('custom-design-customer-renderer')).toHaveStyle({
      '--custom-design-poster-max-width': `${CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX}px`,
    });
    expect(calculateDisplayGeometry({
      mode: 'poster',
      availableWidth: 1_200,
      intrinsicWidth: 800,
      intrinsicHeight: 1_600,
    })?.width).toBe(CUSTOM_DESIGN_POSTER_MAX_WIDTH_PX);
  });

  it('adds a unique customer landmark name only when the caller supplies one', () => {
    const settings = makeSettings();
    const { rerender } = render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={settings}
      />,
    );

    expect(screen.getByTestId('custom-design-customer-renderer'))
      .not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    rerender(
      <CustomDesignRenderer
        accessibleSectionLabel="Home policies design"
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={settings}
      />,
    );

    expect(screen.getByRole('region', { name: 'Home policies design' }))
      .toBeVisible();
  });

  it('renders responsive modes, gaps, custom background, and reserved image geometry', () => {
    const settings = makeSettings({
      background: { mode: 'custom', color: '#AABBCC' },
      displayMode: 'contained',
      gap: 'small',
      images: [
        makeImage('page-1'),
        makeImage('page-2', {
          aspectRatio: 1 / 3,
          height: 1_200,
          width: 400,
        }),
      ],
    });

    render(
      <CustomDesignRenderer
        contentMaxWidth="1080px"
        posterMaxWidth="780px"
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={settings}
      />,
    );

    const section = screen.getByTestId('custom-design-customer-renderer');

    expect(section).toHaveAttribute('data-display-mode', 'contained');
    expect(section).toHaveAttribute('data-gap', 'small');
    expect(section).toHaveAttribute('data-background-mode', 'custom');
    expect(section).toHaveStyle({
      '--custom-design-background': '#AABBCC',
      '--custom-design-content-max-width': '1080px',
      '--custom-design-poster-max-width': '780px',
    });

    const images = screen.getAllByRole('img');

    expect(images[0]).toHaveAttribute('width', '1000');
    expect(images[0]).toHaveAttribute('height', '2000');
    expect(images[0]).toHaveAttribute('loading', 'eager');
    expect(images[0]).toHaveAttribute('fetchpriority', 'high');
    expect(images[1]).toHaveAttribute('loading', 'lazy');
    expect(images[1]).toHaveAttribute('fetchpriority', 'auto');
    expect(images[0]?.parentElement).toHaveStyle({ aspectRatio: '1000 / 2000' });

    const entries = section.querySelectorAll<HTMLElement>('.custom-design-stack-entry');

    expect(entries[0]).toHaveStyle('--custom-design-quality-width: 1500px');
    expect(entries[1]).toHaveStyle('--custom-design-quality-width: 600px');
  });

  it('reserves persisted geometry while browser assets resolve asynchronously', () => {
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={() => ({ status: 'loading' })}
        settings={makeSettings({
          images: [makeImage('tall-page', { height: 3_000, width: 1_000 })],
        })}
      />,
    );

    expect(screen.getByTestId('custom-design-customer-renderer')).toBeVisible();
    expect(screen.getByTestId('custom-design-customer-loading-asset')).toHaveStyle({
      aspectRatio: '1000 / 3000',
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('emits fetch priority in initial markup without a React 18 unknown-prop warning', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <CustomDesignRenderer
          resolveAction={resolveAction}
          resolveAsset={readyAsset}
          settings={makeSettings()}
        />,
      );

      expect(screen.getByRole('img')).toHaveAttribute('fetchpriority', 'high');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders approved, confirmed areas as safe semantic links at normalized geometry', () => {
    const image = makeImage('page-1', { interactiveAreas: [makeArea()] });
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({ images: [image] })}
      />,
    );

    finishImageLoad('Branded policy page page-1');
    const link = screen.getByRole('link', {
      name: 'Visit the nail studio website',
    });

    expect(link).toHaveAttribute('href', 'https://example.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveStyle({
      height: '12%',
      left: '10%',
      top: '20%',
      width: '30%',
    });
    expect(link).toHaveClass('custom-design-area-link');
    expect(screen.queryByText('Replace image')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Clickable area editor')).not.toBeInTheDocument();
  });

  it('keeps semantic area order independent from normalized visual position', () => {
    const second = makeArea({
      id: 'area-second',
      accessibleLabel: 'Second action',
      geometry: { x: 5, y: 5, width: 20, height: 10 },
      semanticOrder: 2,
    });
    const first = makeArea({
      id: 'area-first',
      accessibleLabel: 'First action',
      geometry: { x: 70, y: 70, width: 20, height: 10 },
      semanticOrder: 1,
    });
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [makeImage('page-1', { interactiveAreas: [second, first] })],
        })}
      />,
    );
    finishImageLoad('Branded policy page page-1');

    expect(screen.getAllByRole('link').map(link => link.getAttribute('aria-label')))
      .toEqual(['First action', 'Second action']);
  });

  it('uses empty alt text for an owner-confirmed decorative image', () => {
    const { container } = render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [makeImage('page-1', {
            accessibleSummary: undefined,
            altText: '',
            decorative: true,
          })],
        })}
      />,
    );

    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    ['invalid', makeArea({ validationStatus: 'invalid' })],
    ['needs review', makeArea({
      reviewReason: 'aspect_ratio_changed',
      reviewStatus: 'needs_review',
    })],
    ['unconfirmed label', makeArea({ labelConfirmed: false })],
    ['empty label', makeArea({ accessibleLabel: '' })],
  ])('suppresses a %s customer area', (_label, area) => {
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [makeImage('page-1', { interactiveAreas: [area] })],
        })}
      />,
    );

    finishImageLoad('Branded policy page page-1');

    expect(screen.queryByTestId(`custom-design-area-${area.id}`))
      .not.toBeInTheDocument();
  });

  it('suppresses unsafe or unresolved destinations even if a caller mis-resolves them', () => {
    const unsafeResolver: ResolveCustomDesignAction = () => ({
      status: 'resolved',
      external: true,
      href: 'javascript:alert(1)',
    });
    render(
      <CustomDesignRenderer
        resolveAction={unsafeResolver}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [makeImage('page-1', { interactiveAreas: [makeArea()] })],
        })}
      />,
    );
    finishImageLoad('Branded policy page page-1');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(isSafeRenderedHref('/\\evil.example')).toBe(false);
    expect(isSafeRenderedHref('/%5cevil.example')).toBe(false);
    expect(isSafeRenderedHref('/policies/%2e%2e/admin')).toBe(false);
    expect(isSafeRenderedHref('https://owner:secret@example.com/')).toBe(false);
    expect(isSafeRenderedHref('//bad.example/path')).toBe(false);
    expect(isSafeRenderedHref('http://bad.example/path')).toBe(false);
    expect(isSafeRenderedHref(' https://safe.example/path')).toBe(false);
    expect(isSafeRenderedHref('https://safe.example/path')).toBe(true);
    expect(isSafeRenderedHref('/about?view=hours#contact')).toBe(true);
    expect(isSafeRenderedHref('#booking')).toBe(true);
    expect(isSafeRenderedHref('tel:+14165550123')).toBe(true);
    expect(isSafeRenderedHref('sms:+14165550123')).toBe(true);
    expect(isSafeRenderedHref('tel:+12')).toBe(false);
    expect(isSafeRenderedHref('sms:+14165550123?body=unexpected')).toBe(false);
    expect(isSafeRenderedHref(
      'mailto:owner@example.com?subject=New%20appointment',
    )).toBe(true);
    expect(isSafeRenderedHref('mailto:owner@example.com?bcc=bad@example.com'))
      .toBe(false);
    expect(isSafeRenderedHref('mailto:owner@example.com?subject=Hi%0ABcc%3Abad'))
      .toBe(false);
  });

  it('derives external-link safety from the normalized href, not caller metadata', () => {
    const { rerender } = render(
      <SemanticAction
        accessibleLabel="External policies"
        className="custom-design-native-cta"
        resolution={{
          status: 'resolved',
          external: false,
          href: 'https://example.com/policies',
        }}
      />,
    );
    let link = screen.getByRole('link', { name: 'External policies' });

    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    rerender(
      <SemanticAction
        accessibleLabel="Internal policies"
        className="custom-design-native-cta"
        resolution={{
          status: 'resolved',
          external: true,
          href: '/policies#deposits',
        }}
      />,
    );
    link = screen.getByRole('link', { name: 'Internal policies' });

    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });

  it('activates areas only after image load and suppresses them after a render error', () => {
    const onAssetRenderError = vi.fn();
    render(
      <CustomDesignRenderer
        missingAssetFallback="placeholder"
        onAssetRenderError={onAssetRenderError}
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [makeImage('page-1', { interactiveAreas: [makeArea()] })],
        })}
      />,
    );

    const image = screen.getByRole('img', { name: 'Branded policy page page-1' });
    const loadingFrame = image.closest('.custom-design-image-frame');

    expect(loadingFrame).toHaveAttribute('data-image-render-state', 'loading');
    expect(loadingFrame).toHaveStyle({ aspectRatio: '1000 / 2000' });
    expect(screen.queryByRole('link', {
      name: 'Visit the nail studio website',
    })).not.toBeInTheDocument();

    fireEvent.load(image);

    expect(screen.getByRole('link', {
      name: 'Visit the nail studio website',
    })).toBeVisible();

    fireEvent.error(image);

    expect(screen.queryByRole('link', {
      name: 'Visit the nail studio website',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Design image unavailable' })).toBeVisible();
    expect(onAssetRenderError).toHaveBeenCalledTimes(1);
    expect(onAssetRenderError).toHaveBeenCalledWith('asset-page-1', 'page-1');
  });

  it('resets image readiness when a replacement or revoked object URL changes', () => {
    const image = makeImage('page-1', { interactiveAreas: [makeArea()] });
    const settings = makeSettings({ images: [image] });
    let assetUrl = 'blob:https://luster.test/original';
    const resolveReplacingAsset: ResolveCustomDesignAsset = () => ({
      status: 'ready',
      url: assetUrl,
    });
    const onAssetRenderError = vi.fn();
    const { rerender } = render(
      <CustomDesignRenderer
        onAssetRenderError={onAssetRenderError}
        resolveAction={resolveAction}
        resolveAsset={resolveReplacingAsset}
        settings={settings}
      />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Branded policy page page-1' }));

    expect(screen.getByRole('link', {
      name: 'Visit the nail studio website',
    })).toBeVisible();

    assetUrl = 'blob:https://luster.test/replacement';
    rerender(
      <CustomDesignRenderer
        onAssetRenderError={onAssetRenderError}
        resolveAction={resolveAction}
        resolveAsset={resolveReplacingAsset}
        settings={settings}
      />,
    );
    const replacement = screen.getByRole('img', {
      name: 'Branded policy page page-1',
    });

    expect(replacement).toHaveAttribute('src', assetUrl);
    expect(screen.queryByRole('link', {
      name: 'Visit the nail studio website',
    })).not.toBeInTheDocument();

    fireEvent.error(replacement);

    expect(screen.queryByRole('link', {
      name: 'Visit the nail studio website',
    })).not.toBeInTheDocument();
    expect(onAssetRenderError).toHaveBeenCalledWith('asset-page-1', 'page-1');
  });

  it('resets readiness when a replacement asset reuses a stable resolved URL', () => {
    const image = makeImage('page-1', { interactiveAreas: [makeArea()] });
    const stableAsset: ResolveCustomDesignAsset = () => ({
      status: 'ready',
      url: 'https://assets.luster.test/stable-design',
    });
    const { rerender } = render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={stableAsset}
        settings={makeSettings({ images: [image] })}
      />,
    );
    finishImageLoad('Branded policy page page-1');

    expect(screen.getByRole('link', {
      name: 'Visit the nail studio website',
    })).toBeVisible();

    const replacement = { ...image, assetId: 'asset-page-1-replacement' };
    rerender(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={stableAsset}
        settings={makeSettings({ images: [replacement] })}
      />,
    );

    const replacementImage = screen.getByRole('img', {
      name: 'Branded policy page page-1',
    });

    expect(replacementImage).toHaveAttribute(
      'src',
      'https://assets.luster.test/stable-design',
    );
    expect(screen.queryByRole('link', {
      name: 'Visit the nail studio website',
    })).not.toBeInTheDocument();

    fireEvent.load(replacementImage);

    expect(screen.getByRole('link', {
      name: 'Visit the nail studio website',
    })).toBeVisible();
  });

  it('renders a visible summary disclosure without placing it in hidden image metadata', async () => {
    const user = userEvent.setup();
    render(
      <AccessibilitySummary
        fileName="policies.png"
        imageItemId="page-1"
        summary={'Deposits are required.\nPlease arrive on time.'}
      />,
    );

    const disclosure = screen.getByText('Text version of policies.png');

    expect(disclosure).toBeVisible();

    await user.click(disclosure);
    const summary = screen.getByText(/Deposits are required/);

    expect(summary).toBeVisible();
    expect(summary).toHaveTextContent(
      'Deposits are required. Please arrive on time.',
    );
    expect(summary.textContent).toBe(
      'Deposits are required.\nPlease arrive on time.',
    );
  });

  it('keeps a native CTA attached to its stable image when pages reorder', () => {
    const cta = {
      type: 'book_now' as const,
      label: 'Book now',
      placement: { type: 'after_image' as const, imageItemId: 'page-1' },
    };
    const pageOne = makeImage('page-1');
    const pageTwo = makeImage('page-2');
    const { rerender } = render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({ cta, images: [pageOne, pageTwo] })}
      />,
    );

    let ctaLink = screen.getByRole('link', { name: 'Book now' });

    expect(ctaLink).toHaveAttribute('href', '#booking');
    expect(ctaLink.closest('.custom-design-stack-entry'))
      .toHaveAttribute('style', expect.stringContaining('--custom-design-quality-width'));
    expect(ctaLink.closest('.custom-design-stack-entry'))
      .toHaveTextContent('Text version of page-1.png');

    rerender(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({ cta, images: [pageTwo, pageOne] })}
      />,
    );
    ctaLink = screen.getByRole('link', { name: 'Book now' });

    expect(ctaLink.closest('.custom-design-stack-entry'))
      .toHaveTextContent('Text version of page-1.png');
  });

  it('falls an orphaned stable-image CTA placement back to after all pages', () => {
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          cta: {
            type: 'custom',
            label: 'Email me',
            placement: { type: 'after_image', imageItemId: 'removed-page' },
            action: {
              type: 'email',
              destination: { email: 'owner@example.com' },
            },
          },
          images: [makeImage('page-1'), makeImage('page-2')],
        })}
      />,
    );
    const cta = screen.getByRole('link', { name: 'Email me' });
    const stack = cta.closest('.custom-design-image-stack');

    expect(cta).toHaveAttribute('href', 'mailto:owner@example.com');
    expect(cta.closest('.custom-design-stack-entry')).toBeNull();
    expect(stack?.lastElementChild).toContainElement(cta);
  });

  it('makes the first available image eager when an earlier local asset is missing', () => {
    const mixedAssets: ResolveCustomDesignAsset = assetId =>
      assetId === 'asset-page-1'
        ? { status: 'missing' }
        : { status: 'ready', url: `blob:https://luster.test/${assetId}` };
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={mixedAssets}
        settings={makeSettings({
          images: [makeImage('page-1'), makeImage('page-2')],
        })}
      />,
    );
    const visibleImage = screen.getByRole('img', { name: 'Branded policy page page-2' });

    expect(visibleImage).toHaveAttribute('loading', 'eager');
    expect(visibleImage).toHaveAttribute('fetchpriority', 'high');
  });

  it('suppresses missing artwork links while preserving accessible text and the native CTA', () => {
    const missing: ResolveCustomDesignAsset = () => ({ status: 'missing' });
    const settings = makeSettings({
      cta: {
        type: 'book_now',
        label: 'Book now',
        placement: { type: 'after_all' },
      },
      images: [makeImage('page-1', { interactiveAreas: [makeArea()] })],
    });
    const { rerender } = render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={missing}
        settings={settings}
      />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Visit the nail studio website' }))
      .not.toBeInTheDocument();
    expect(screen.getByText('Important policies for page-1.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book now' })).toBeInTheDocument();

    rerender(
      <CustomDesignRenderer
        missingAssetFallback="placeholder"
        resolveAction={resolveAction}
        resolveAsset={missing}
        settings={settings}
      />,
    );

    expect(screen.getByRole('img', { name: 'Design image unavailable' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Visit the nail studio website' }))
      .not.toBeInTheDocument();
  });

  it('does not publish a CTA-only section when required artwork is empty', () => {
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          cta: {
            label: 'Book now',
            placement: { type: 'after_all' },
            type: 'book_now',
          },
          images: [],
        })}
      />,
    );

    expect(screen.queryByTestId('custom-design-customer-renderer'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Book now' })).not.toBeInTheDocument();
  });

  it('suppresses a stale-valid near-full area without suppressing a safe area on another image', () => {
    const unsafeFull = makeArea({
      id: 'unsafe-full',
      accessibleLabel: 'Unsafe full image link',
      geometry: { x: 0, y: 0, width: 95, height: 95 },
    });
    const safe = makeArea({
      id: 'safe-link',
      accessibleLabel: 'Safe website link',
    });
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [
            makeImage('page-1', { interactiveAreas: [unsafeFull] }),
            makeImage('page-2', { interactiveAreas: [safe] }),
          ],
        })}
      />,
    );
    finishImageLoad('Branded policy page page-1');
    finishImageLoad('Branded policy page page-2');

    expect(screen.queryByRole('link', { name: 'Unsafe full image link' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Safe website link' })).toBeVisible();
  });

  it('suppresses stale-valid overlapping areas while preserving exact edge contact', () => {
    const overlappingOne = makeArea({
      id: 'overlap-one',
      accessibleLabel: 'First overlapping link',
      geometry: { x: 5, y: 5, width: 30, height: 20 },
      semanticOrder: 1,
    });
    const overlappingTwo = makeArea({
      id: 'overlap-two',
      accessibleLabel: 'Second overlapping link',
      geometry: { x: 20, y: 10, width: 30, height: 20 },
      semanticOrder: 2,
    });
    const edgeOne = makeArea({
      id: 'edge-one',
      accessibleLabel: 'First edge link',
      geometry: { x: 0, y: 0, width: 25, height: 20 },
      semanticOrder: 0,
    });
    const edgeTwo = makeArea({
      id: 'edge-two',
      accessibleLabel: 'Second edge link',
      geometry: { x: 25, y: 0, width: 25, height: 20 },
      semanticOrder: 1,
    });
    render(
      <CustomDesignRenderer
        resolveAction={resolveAction}
        resolveAsset={readyAsset}
        settings={makeSettings({
          images: [
            makeImage('page-1', {
              interactiveAreas: [overlappingOne, overlappingTwo],
            }),
            makeImage('page-2', {
              interactiveAreas: [edgeOne, edgeTwo],
            }),
          ],
        })}
      />,
    );
    finishImageLoad('Branded policy page page-1');
    finishImageLoad('Branded policy page page-2');

    expect(screen.queryByRole('link', { name: 'First overlapping link' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Second overlapping link' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First edge link' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Second edge link' })).toBeVisible();
  });
});

describe('clear tap versus scroll activation', () => {
  it('cancels link activation after meaningful pointer movement but preserves keyboard activation', async () => {
    const onActivate = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    const user = userEvent.setup();
    render(
      <SemanticAction
        accessibleLabel="Open booking"
        className="custom-design-area-link"
        resolution={{
          status: 'resolved',
          external: false,
          href: '#booking',
          onActivate,
        }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Open booking' });

    dispatchPointer(link, 'pointerdown', {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 4,
    });
    dispatchPointer(link, 'pointermove', {
      clientX: 10,
      clientY: 30,
      isPrimary: true,
      pointerId: 4,
    });
    dispatchPointer(link, 'pointerup', {
      clientX: 10,
      clientY: 30,
      isPrimary: true,
      pointerId: 4,
    });

    expect(fireEvent.click(link, { detail: 1 })).toBe(false);
    expect(onActivate).not.toHaveBeenCalled();

    link.focus();
    await user.keyboard('{Enter}');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('cancels after its supplied Preview scroll host moves and allows a clear button tap', () => {
    const onActivate = vi.fn();
    const scrollPosition = { x: 0, y: 0 };
    const { rerender } = render(
      <SemanticAction
        accessibleLabel="Start booking"
        className="custom-design-area-link"
        getScrollPosition={() => scrollPosition}
        resolution={{ status: 'button', onActivate }}
      />,
    );
    let button = screen.getByRole('button', { name: 'Start booking' });
    fireEvent.pointerDown(button, {
      button: 0,
      clientX: 5,
      clientY: 5,
      isPrimary: true,
      pointerId: 9,
    });
    scrollPosition.y = 20;
    fireEvent.pointerUp(button, {
      clientX: 5,
      clientY: 5,
      isPrimary: true,
      pointerId: 9,
    });
    fireEvent.click(button, { detail: 1 });

    expect(onActivate).not.toHaveBeenCalled();

    scrollPosition.y = 0;
    rerender(
      <SemanticAction
        accessibleLabel="Start booking"
        className="custom-design-area-link"
        getScrollPosition={() => scrollPosition}
        resolution={{ status: 'button', onActivate }}
      />,
    );
    button = screen.getByRole('button', { name: 'Start booking' });
    fireEvent.pointerDown(button, {
      button: 0,
      clientX: 5,
      clientY: 5,
      isPrimary: true,
      pointerId: 10,
    });
    fireEvent.pointerUp(button, {
      clientX: 9,
      clientY: 5,
      isPrimary: true,
      pointerId: 10,
    });
    fireEvent.click(button, { detail: 1 });

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('owner asset rendering', () => {
  it('renders a replace-ready recovery state with unique labelled headings', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <>
        <OwnerMissingAsset
          fileName="policies.png"
          onReplace={onReplace}
        />
        <OwnerMissingAsset
          fileName="policies.png"
          onReplace={() => undefined}
        />
      </>,
    );
    const recoveryStates = screen.getAllByTestId('custom-design-owner-missing-asset');

    expect(recoveryStates[0]).toHaveTextContent('link positions are still saved');

    const headingIds = recoveryStates.map(state =>
      within(state).getByRole('heading').getAttribute('id'));

    expect(new Set(headingIds).size).toBe(2);

    await user.click(within(recoveryStates[0] as HTMLElement).getByRole('button'));

    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it('renders a bounded owner thumbnail with page metadata and replace action', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <OwnerThumbnail
        asset={{ status: 'ready', url: 'blob:https://luster.test/thumb' }}
        image={makeImage('page-4')}
        pageNumber={4}
        onReplace={onReplace}
      />,
    );

    expect(screen.getByText('Page 4')).toBeVisible();
    expect(screen.getByText('1000 × 2000px')).toBeVisible();
    expect(screen.getByTestId('custom-design-thumbnail-page-4').querySelector('img'))
      .toHaveAttribute('alt', '');

    await user.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onReplace).toHaveBeenCalledTimes(1);
  });
});
