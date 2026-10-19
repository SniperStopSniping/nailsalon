import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CanvaPageLayout } from './CanvaPageLayout';

afterEach(cleanup);

it('lets owners save width, background and spacing together without changing image proportions or link positions', () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<CanvaPageLayout pageIndex={1} multiple value={{ displayMode: 'poster', background: 'transparent', gapAfter: 0 }} disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByText('Adjust layout for page 2'));

  expect(screen.getByRole('button', { name: 'Save image layout' })).toBeDisabled();

  fireEvent.change(screen.getByRole('combobox', { name: 'Width on larger screens' }), { target: { value: 'contained' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Background behind the image' }), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Background colour'), { target: { value: '#e8daba' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Space after the image' }), { target: { value: '16' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save image layout' }));

  expect(onSave).toHaveBeenCalledWith(1, { displayMode: 'contained', background: '#e8daba', gapAfter: 16 });
  expect(screen.getByText(/Its links stay in place/)).toBeVisible();
});

it('locks all layout fields during a save and does not submit unchanged or disabled values', () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(<CanvaPageLayout pageIndex={0} multiple={false} disabled={false} onSave={onSave} />);
  fireEvent.click(screen.getByText('Adjust image layout'));
  fireEvent.submit(screen.getByRole('button', { name: 'Save image layout' }).closest('form')!);

  expect(onSave).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole('combobox', { name: 'Width on larger screens' }), { target: { value: 'full_width' } });
  view.rerender(<CanvaPageLayout pageIndex={0} multiple={false} disabled onSave={onSave} />);

  expect(screen.getByRole('combobox', { name: 'Width on larger screens' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Background behind the image' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save image layout' })).toBeDisabled();

  fireEvent.submit(screen.getByRole('button', { name: 'Save image layout' }).closest('form')!);

  expect(onSave).not.toHaveBeenCalled();
});
