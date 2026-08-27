import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type { OriginStarter } from '../model/types';
import { StarterChooser } from './StarterChooser';

const EXPECTED_STARTERS: ReadonlyArray<{
  cta: string;
  description: string;
  id: OriginStarter;
  included: string;
  includesLabel: string;
  title: string;
}> = [
  {
    cta: 'Start with Quick Book',
    description: 'Start taking bookings with only the essentials.',
    id: 'quick_book',
    included: 'Salon intro · Services · Booking',
    includesLabel: 'Includes',
    title: 'Quick Book',
  },
  {
    cta: 'Start with One-page',
    description: 'Show your whole business on one scrolling page.',
    id: 'one_page',
    included: 'Welcome · About · Services · Gallery · Reviews · Booking',
    includesLabel: 'Includes',
    title: 'One-page website',
  },
  {
    cta: 'Start with Multi-page',
    description: 'Give each part of your business its own page and navigation link.',
    id: 'multi_page',
    included: 'Home · Services & Booking · Gallery · About · Contact',
    includesLabel: 'Includes pages',
    title: 'Multi-page website',
  },
];

type MediaPreferences = {
  finePointer: boolean;
  reducedMotion: boolean;
};

type ObservedRatio = {
  ratio: number;
  target: Element;
};

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observed = new Set<Element>();
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: readonly number[];

  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
    TestIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => this.observed.add(target));
  takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  unobserve = vi.fn((target: Element) => this.observed.delete(target));

  emit(entries: readonly ObservedRatio[]) {
    const records = entries.map(({ ratio, target }) => ({
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: ratio,
      intersectionRect: target.getBoundingClientRect(),
      isIntersecting: ratio > 0,
      rootBounds: null,
      target,
      time: performance.now(),
    })) as IntersectionObserverEntry[];
    this.callback(records, this as unknown as IntersectionObserver);
  }
}

let mediaPreferences: MediaPreferences;
let visibilityState: DocumentVisibilityState;

function installBrowserPreferences(preferences: Partial<MediaPreferences> = {}) {
  mediaPreferences = {
    finePointer: preferences.finePointer ?? true,
    reducedMotion: preferences.reducedMotion ?? false,
  };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: query.includes('prefers-reduced-motion')
      ? mediaPreferences.reducedMotion
      : mediaPreferences.finePointer,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
}

function getCard(title: string) {
  return screen.getByRole('button', { name: new RegExp(`^${title}`) });
}

function getPreview(starterId: OriginStarter) {
  return screen.getByTestId(`starter-preview-${starterId}`);
}

function expectOnlyPreviewActive(starterId: OriginStarter | null) {
  for (const starter of EXPECTED_STARTERS) {
    expect(getPreview(starter.id)).toHaveAttribute(
      'data-preview-active',
      starter.id === starterId ? 'true' : 'false',
    );
  }
}

beforeEach(() => {
  installBrowserPreferences();
  TestIntersectionObserver.instances = [];
  vi.stubGlobal(
    'IntersectionObserver',
    TestIntersectionObserver as unknown as typeof IntersectionObserver,
  );
  visibilityState = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StarterChooser copy and accessibility', () => {
  it('uses the exact owner-friendly copy and removes technical starter-count badges', () => {
    render(<StarterChooser onChoose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Choose your starting point' })).toBeVisible();
    expect(screen.getByText(
      'Start simple or with a full website. You can add or change pages and sections anytime.',
    )).toBeVisible();

    for (const starter of EXPECTED_STARTERS) {
      const card = getCard(starter.title);
      const copy = card.querySelector<HTMLElement>('.final-starter-card__copy');
      const preview = getPreview(starter.id);

      expect(within(card).getByText(starter.description)).toBeVisible();
      expect(within(card).getByText(starter.includesLabel)).toBeVisible();
      expect(within(card).getByText(starter.included)).toBeVisible();
      expect(within(card).getByText(starter.cta)).toBeVisible();
      expect(copy).not.toBeNull();
      expect(copy?.nextElementSibling).toBe(preview);
      expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(preview.querySelectorAll('a, button, input, select, textarea, [tabindex]').length).toBe(0);
      expect(card.querySelectorAll('button, a, input, select, textarea').length).toBe(0);
      expect(card).toHaveAccessibleName(
        `${starter.title} ${starter.description} ${starter.includesLabel} ${starter.included} ${starter.cta}`,
      );
      expect(card).not.toHaveAccessibleName(/Luster Nail Studio|Toronto nail artist/);
    }

    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText(/Starts with [356] (?:sections|pages)/)).not.toBeInTheDocument();
    expect(screen.getByText('Nothing is permanent.')).toBeVisible();
    expect(screen.getByText(
      'Every starting point uses the same editor. Add, remove, or rearrange pages and sections anytime.',
    )).toBeVisible();
  });

  it('keeps one whole-card activation target with pointer and keyboard activation', async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<StarterChooser onChoose={onChoose} />);

    await user.click(getCard('Quick Book'));
    expect(onChoose).toHaveBeenLastCalledWith('quick_book');

    const multiPage = getCard('Multi-page website');
    act(() => multiPage.focus());
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenLastCalledWith('multi_page');
    expect(onChoose).toHaveBeenCalledTimes(2);
  });
});

describe('StarterChooser preview playback', () => {
  it('plays only the hovered or keyboard-focused desktop preview and resets after exit', () => {
    vi.useFakeTimers();
    render(<StarterChooser onChoose={vi.fn()} />);

    const quickBook = getCard('Quick Book');
    const onePage = getCard('One-page website');
    const multiPage = getCard('Multi-page website');
    expectOnlyPreviewActive(null);

    fireEvent.mouseEnter(quickBook);
    expectOnlyPreviewActive('quick_book');

    fireEvent.mouseEnter(onePage);
    expectOnlyPreviewActive('one_page');
    fireEvent.mouseLeave(onePage);
    act(() => vi.advanceTimersByTime(179));
    expectOnlyPreviewActive('one_page');
    act(() => vi.advanceTimersByTime(1));
    expectOnlyPreviewActive(null);

    act(() => multiPage.focus());
    expectOnlyPreviewActive('multi_page');
    expect(getPreview('multi_page')).toHaveAttribute('data-preview-state', 'playing');
    act(() => multiPage.blur());
    act(() => vi.advanceTimersByTime(180));
    expectOnlyPreviewActive(null);
  });

  it('uses the most-visible eligible mobile card and cleans up its observer', () => {
    installBrowserPreferences({ finePointer: false });
    const { unmount } = render(<StarterChooser onChoose={vi.fn()} />);
    const observer = TestIntersectionObserver.instances.at(-1);
    expect(observer).toBeDefined();

    const quickBook = getCard('Quick Book');
    const onePage = getCard('One-page website');
    const multiPage = getCard('Multi-page website');
    act(() => observer?.emit([
      { ratio: 0.72, target: quickBook },
      { ratio: 0.42, target: onePage },
      { ratio: 0, target: multiPage },
    ]));
    expectOnlyPreviewActive('quick_book');

    act(() => observer?.emit([
      { ratio: 0.38, target: quickBook },
      { ratio: 0.84, target: onePage },
      { ratio: 0.12, target: multiPage },
    ]));
    expectOnlyPreviewActive('one_page');

    act(() => observer?.emit([
      { ratio: 0.2, target: quickBook },
      { ratio: 0.4, target: onePage },
      { ratio: 0.76, target: multiPage },
    ]));
    expectOnlyPreviewActive('multi_page');

    act(() => observer?.emit([
      { ratio: 0.12, target: quickBook },
      { ratio: 0.2, target: onePage },
      { ratio: 0.3, target: multiPage },
    ]));
    expectOnlyPreviewActive(null);

    act(() => observer?.emit([{ ratio: 0.81, target: quickBook }]));
    expectOnlyPreviewActive('quick_book');
    unmount();
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stops a focused preview off-screen and replays it when it becomes visible again', () => {
    render(<StarterChooser onChoose={vi.fn()} />);
    const observer = TestIntersectionObserver.instances.at(-1);
    const quickBook = getCard('Quick Book');

    act(() => quickBook.focus());
    expectOnlyPreviewActive('quick_book');
    act(() => observer?.emit([{ ratio: 0, target: quickBook }]));
    expectOnlyPreviewActive(null);
    act(() => observer?.emit([{ ratio: 0.78, target: quickBook }]));
    expectOnlyPreviewActive('quick_book');
  });

  it('pauses the active preview while the document is hidden and resumes it in place', () => {
    render(<StarterChooser onChoose={vi.fn()} />);
    fireEvent.mouseEnter(getCard('Quick Book'));
    expect(getPreview('quick_book')).toHaveAttribute('data-preview-state', 'playing');

    visibilityState = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(getPreview('quick_book')).toHaveAttribute('data-preview-state', 'paused');
    expect(getPreview('quick_book')).toHaveAttribute('data-preview-paused', 'true');
    expectOnlyPreviewActive('quick_book');

    visibilityState = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(getPreview('quick_book')).toHaveAttribute('data-preview-state', 'playing');
    expect(getPreview('quick_book')).toHaveAttribute('data-preview-paused', 'false');
  });

  it('keeps useful static posters and selectable cards when reduced motion is requested', async () => {
    installBrowserPreferences({ reducedMotion: true });
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<StarterChooser onChoose={onChoose} />);

    fireEvent.mouseEnter(getCard('Quick Book'));
    act(() => getCard('One-page website').focus());
    expectOnlyPreviewActive(null);
    for (const starter of EXPECTED_STARTERS) {
      expect(getPreview(starter.id)).toHaveAttribute('data-preview-state', 'poster');
      expect(getPreview(starter.id).querySelector('[data-preview-poster]')).toBeVisible();
      expect(screen.getByText(starter.description)).toBeVisible();
    }

    await user.click(getCard('Multi-page website'));
    expect(onChoose).toHaveBeenCalledWith('multi_page');
  });
});
