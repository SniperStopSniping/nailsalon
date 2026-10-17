import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CustomDesignImageItem } from '../model/types';
import { DesignExportHelp } from './DesignExportHelp';

const image = (width: number): CustomDesignImageItem => ({
  altText: 'Salon design',
  aspectRatio: width / 1280,
  assetId: 'owned-image',
  decorative: false,
  fileName: 'Canva export.png',
  fileSize: 1000,
  height: 1280,
  id: 'page-1',
  interactiveAreas: [],
  mimeType: 'image/png',
  width,
});

describe('DesignExportHelp', () => {
  it('lets owners continue with a small upload and explains how to replace it', async () => {
    const original = image(279);
    render(<DesignExportHelp images={[original]} />);

    expect(screen.getByRole('status')).toHaveTextContent('Canva export.png');
    expect(screen.getByRole('status')).toHaveTextContent('You can continue and replace them later');

    await userEvent.click(screen.getByText('Get a sharp Canva export'));

    expect(screen.getByText(/1,200 pixels wide/)).toBeVisible();
    expect(screen.getByText(/cannot recover detail/)).toBeVisible();
    expect(original.width).toBe(279);
  });

  it('keeps export advice optional for a large original or an empty upload', () => {
    const view = render(<DesignExportHelp images={[image(1600)]} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/1,200 pixels wide/)).not.toBeVisible();

    view.rerender(<DesignExportHelp images={[]} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains unusually wide and long images without requiring a different shape', async () => {
    render(<DesignExportHelp images={[{ ...image(2400), height: 300 }, { ...image(1200), height: 9000 }]} />);

    expect(screen.getByText(/Wide artwork stays in proportion/)).toBeVisible();
    expect(screen.getByText(/long design will scroll naturally/)).toBeVisible();

    await userEvent.click(screen.getByText('Get a sharp Canva export'));

    const sizes = screen.getByRole('table', { name: 'Suggested image sizes' });

    expect(sizes).toBeVisible();
    expect(sizes).toHaveTextContent('1,200 × 1,800 px');
    expect(sizes).toHaveTextContent('1,920 × 1,080 px');
    expect(screen.getByText(/There is no required shape/)).toBeVisible();
  });
});
