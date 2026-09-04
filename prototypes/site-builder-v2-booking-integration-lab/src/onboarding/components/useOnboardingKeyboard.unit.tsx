import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { vi } from 'vitest';

import { useOnboardingKeyboard } from './useOnboardingKeyboard';

function Harness() {
  const root = useRef<HTMLDivElement>(null);
  const open = useOnboardingKeyboard(root);
  return (
    <div ref={root} data-testid="shell" data-keyboard-open={open}>
      <label htmlFor="name">Business name</label>
      <input id="name" defaultValue="My studio" />
      <textarea aria-label="Introduction" />
      <input aria-label="Address" aria-controls="suggestions" aria-expanded="true" role="combobox" />
      <div id="suggestions" role="listbox"><button aria-selected="false" role="option" type="button">Toronto address</button></div>
      <input aria-label="Read only" readOnly />
      <input aria-label="Visibility" type="checkbox" />
      <p>Page background</p>
    </div>
  );
}

describe('onboarding software keyboard', () => {
  let viewport: EventTarget & { height: number; scale: number };
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    viewport = Object.assign(new EventTarget(), { height: 844, scale: 1 });
    frames = new Map();
    let sequence = 0;
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flush = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
  const resize = (height: number) => {
    viewport.height = height;
    viewport.dispatchEvent(new Event('resize'));
    flush();
  };
  const focus = (name = 'Business name') => {
    screen.getByLabelText(name).focus();
    flush();
  };
  const expectOpen = (open: boolean) => expect(screen.getByTestId('shell')).toHaveAttribute('data-keyboard-open', String(open));

  it('hides for a software keyboard, preserves the input, and restores after viewport recovery', () => {
    render(<Harness />);
    focus();
    expectOpen(false);
    resize(430);
    expectOpen(true);

    expect(screen.getByLabelText('Business name')).toHaveValue('My studio');

    // Native keyboard Done can restore the viewport without a DOM blur.
    resize(844);
    expectOpen(false);

    expect(screen.getByLabelText('Business name')).toHaveFocus();
  });

  it('keeps actions hidden during keyboard dismissal rather than flashing over the closing keyboard', () => {
    render(<Harness />);
    focus();
    resize(430);
    fireEvent.click(screen.getByText('Page background'));
    flush();

    expect(screen.getByLabelText('Business name')).not.toHaveFocus();

    expectOpen(true);
    resize(844);
    expectOpen(false);
  });

  it('dismisses on an intentional vertical page swipe, not programmatic scroll or a horizontal gesture', () => {
    render(<Harness />);
    focus();
    resize(430);
    fireEvent.scroll(window);
    fireEvent.scroll(document);

    expect(screen.getByLabelText('Business name')).toHaveFocus();

    const page = screen.getByText('Page background');
    fireEvent.touchStart(page, { touches: [{ clientX: 20, clientY: 200 }] });
    fireEvent.touchMove(page, { touches: [{ clientX: 80, clientY: 198 }] });

    expect(screen.getByLabelText('Business name')).toHaveFocus();

    fireEvent.touchEnd(page);
    fireEvent.touchStart(page, { touches: [{ clientX: 20, clientY: 200 }] });
    fireEvent.touchMove(page, { touches: [{ clientX: 21, clientY: 170 }] });

    expect(screen.getByLabelText('Business name')).not.toHaveFocus();
  });

  it('preserves field taps, labels, textarea scrolling, and address suggestion selection', () => {
    render(<Harness />);
    focus();
    resize(430);
    fireEvent.click(screen.getByText('Business name'));

    expect(screen.getByLabelText('Business name')).toHaveFocus();

    focus('Introduction');
    const textarea = screen.getByLabelText('Introduction');
    fireEvent.touchStart(textarea, { touches: [{ clientX: 20, clientY: 200 }] });
    fireEvent.touchMove(textarea, { touches: [{ clientX: 20, clientY: 120 }] });

    expect(textarea).toHaveFocus();

    focus('Address');
    fireEvent.click(screen.getByRole('option'));

    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('does not treat small toolbar changes, zoom or a checkbox as a keyboard', () => {
    render(<Harness />);
    focus();
    resize(760);
    expectOpen(false);
    viewport.scale = 2;
    resize(422);
    expectOpen(false);
    viewport.scale = 1;
    focus('Visibility');
    resize(430);
    expectOpen(false);
    focus('Read only');
    expectOpen(false);
  });

  it('does not hide desktop actions or dismiss desktop keyboard editing', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    render(<Harness />);
    focus();
    resize(430);
    expectOpen(false);
    fireEvent.click(screen.getByText('Page background'));

    expect(screen.getByLabelText('Business name')).toHaveFocus();
  });

  it('still hides when Safari zooms a focused input and restores while the page remains zoomed', () => {
    render(<Harness />);
    focus();
    viewport.scale = 1.3;
    resize(430 / 1.3);
    expectOpen(true);
    resize(844 / 1.3);
    expectOpen(false);

    expect(screen.getByLabelText('Business name')).toHaveFocus();
  });

  it('supports browsers that resize the layout viewport and a subsequent orientation change', () => {
    render(<Harness />);
    focus();
    vi.stubGlobal('innerHeight', 430);
    resize(430);
    expectOpen(true);
    vi.stubGlobal('innerHeight', 844);
    resize(844);
    expectOpen(false);
    vi.stubGlobal('innerHeight', 390);
    vi.stubGlobal('innerWidth', 844);
    resize(390);
    expectOpen(false);
    resize(230);
    expectOpen(true);
  });

  it('cleans up listeners and scheduled work when onboarding unmounts', () => {
    const view = render(<Harness />);
    focus();
    viewport.dispatchEvent(new Event('resize'));

    expect(frames.size).toBe(1);

    view.unmount();

    expect(frames.size).toBe(0);

    viewport.dispatchEvent(new Event('resize'));

    expect(frames.size).toBe(0);
  });
});
